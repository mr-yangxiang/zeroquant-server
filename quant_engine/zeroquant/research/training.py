from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import platform
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

from .data import CODES, QUALITY_POLICY_VERSION, canonical, digest, instant, write_json

CLASSES = ("DOWN", "FLAT", "UP")
TRAINING_VERSION = "purged_temperature_v2"


def _parameters(train_days, calibration_days, test_days, embargo_minutes, holdout_days):
    for name, value in (("train_days", train_days), ("calibration_days", calibration_days),
                        ("test_days", test_days), ("holdout_days", holdout_days)):
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"{name} 必须是正整数；最终留出集不能禁用")
    if isinstance(embargo_minutes, bool) or not isinstance(embargo_minutes, int) or embargo_minutes < 0:
        raise ValueError("embargo_minutes 必须是非负整数")


def _label_known(row):
    return instant(row.get("label_available_at", row["label_end_time"]))


def _validate_rows(rows, manifest=None):
    """Validate even when there are too few dates to yield a single fold."""
    seen, horizons = set(), set()
    build_at = instant(manifest["build_at"]) if manifest and manifest.get("build_at") else None
    for row in rows:
        at, end = instant(row["decision_time"]), instant(row["label_end_time"])
        if end <= at or end.date() != at.date():
            raise ValueError("标签结束时间必须晚于决策且属于同一交易日")
        known = _label_known(row)
        if known < end or (build_at and known > build_at):
            raise ValueError("标签尚未成熟，或标签可用时间早于结束时间")
        if not row.get("feature_max_available_at") or instant(row["feature_max_available_at"]) > at:
            raise ValueError("发现未来特征，或缺少特征可用时间证据")
        if row.get("stock_code") not in CODES:
            raise ValueError("标的不在固定股票池内")
        key = (row["stock_code"], at)
        if key in seen:
            raise ValueError("同一标的决策时刻重复，禁止重复样本污染验证")
        seen.add(key)
        horizon = row.get("horizon_minutes")
        if isinstance(horizon, bool) or horizon not in (5, 15, 30, 60):
            raise ValueError("预测周期不合法")
        horizons.add(horizon)
        if row.get("direction_label") not in CLASSES:
            raise ValueError("缺少已成熟的三分类标签")
        target = row.get("target_return_pct")
        if isinstance(target, bool) or not isinstance(target, (int, float)) or not math.isfinite(target):
            raise ValueError("收益标签必须是有限数值")
        if not row.get("input_hash") or not isinstance(row.get("features"), dict) or not row["features"]:
            raise ValueError("缺少特征或输入来源哈希")
        for name, value in row["features"].items():
            if not isinstance(name, str) or not name or (value is not None and
                    (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value))):
                raise ValueError("特征仅允许有限数值或显式缺失值 None")
        if manifest and "neutral_bps" in manifest:
            threshold = float(manifest["neutral_bps"]) / 100
            if not math.isfinite(threshold) or threshold < 0:
                raise ValueError("中性标签阈值不合法")
            expected = "UP" if target > threshold else "DOWN" if target < -threshold else "FLAT"
            if row["direction_label"] != expected:
                raise ValueError("方向标签与冻结的收益阈值不一致")
    if len(horizons) > 1 or (horizons and manifest and "horizon_minutes" in manifest
                            and manifest["horizon_minutes"] not in horizons):
        raise ValueError("一个实验只能训练一个一致的预测周期")


@contextmanager
def _exclusive_experiment(output_dir):
    """An interrupted run is closed until audited; concurrent runs cannot race."""
    output_dir.mkdir(parents=True, exist_ok=True)
    lock = output_dir / "training-in-progress.lock"
    try:
        descriptor = lock.open("x", encoding="utf-8")
    except FileExistsError as exc:
        raise ValueError("训练目录存在进行中或中断的实验，请审计后使用新实验目录") from exc
    try:
        with descriptor:
            descriptor.write(TRAINING_VERSION + "\n")
        yield
    finally:
        lock.unlink(missing_ok=True)


def purged_folds(rows, train_days=120, calibration_days=20, test_days=20, embargo_minutes=60,
                 holdout_days=20):
    """Global date boundaries: every stock at a time belongs to the same partition."""
    _parameters(train_days, calibration_days, test_days, embargo_minutes, holdout_days)
    _validate_rows(rows)
    days = sorted({instant(r["decision_time"]).date() for r in rows})
    development = days[:-holdout_days]
    fold = 0
    for start in range(train_days + calibration_days, len(development)-test_days+1, test_days):
        cal_start = development[start-calibration_days]
        test_start = development[start]
        test_end = development[start+test_days-1]
        cal_boundary = min(instant(r["decision_time"]) for r in rows if instant(r["decision_time"]).date() == cal_start)
        test_boundary = min(instant(r["decision_time"]) for r in rows if instant(r["decision_time"]).date() == test_start)
        following_day = days[start + test_days]
        test_label_boundary = min(instant(r["decision_time"]) for r in rows
                                  if instant(r["decision_time"]).date() == following_day)
        embargo = timedelta(minutes=embargo_minutes)
        train, calibration, test = [], [], []
        for i, r in enumerate(rows):
            t, end = instant(r["decision_time"]), _label_known(r)
            if end < cal_boundary-embargo:
                train.append(i)
            elif cal_start <= t.date() < test_start and end < test_boundary-embargo:
                calibration.append(i)
            elif test_start <= t.date() <= test_end and end < test_label_boundary:
                test.append(i)
        if not train or not calibration or not test:
            continue
        yield {"fold":fold, "train":train, "calibration":calibration, "test":test,
               "train_end":max(_label_known(rows[i]) for i in train).isoformat(),
               "calibration_start":cal_boundary.isoformat(), "test_start":test_boundary.isoformat(),
               "test_label_boundary":test_label_boundary.isoformat(),
               "partition_hash":digest({"train":[rows[i]["input_hash"] for i in train],
                                        "calibration":[rows[i]["input_hash"] for i in calibration],
                                        "test":[rows[i]["input_hash"] for i in test]})}
        fold += 1


def metrics(y, probs):
    import numpy as np
    from sklearn.metrics import log_loss
    y = np.asarray(y, dtype=int)
    p = np.clip(probs, 1e-9, 1-1e-9)
    onehot = np.eye(3)[y]
    confidence, predicted = p.max(axis=1), p.argmax(axis=1)
    ece = 0.0
    for bucket in range(10):
        mask = np.minimum((confidence*10).astype(int),9) == bucket
        if mask.any():
            ece += mask.mean()*abs((predicted[mask] == y[mask]).mean()-confidence[mask].mean())
    return {"brier":float(((onehot-p)**2).sum(axis=1).mean()),
            "log_loss":float(log_loss(y,p,labels=[0,1,2])), "ece":float(ece),
            "accuracy":float((predicted == y).mean()), "sample_count":len(y)}


def temperature_scale(p, temperature):
    import numpy as np
    logits = np.log(np.clip(p,1e-9,1))/temperature
    logits -= logits.max(axis=1,keepdims=True)
    exp = np.exp(logits)
    return exp/exp.sum(axis=1,keepdims=True)


def make_model(algorithm):
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    if algorithm == "logistic":
        from sklearn.linear_model import LogisticRegression
        estimator = LogisticRegression(C=.1, max_iter=1000, random_state=42)
    elif algorithm == "lightgbm":
        from lightgbm import LGBMClassifier
        estimator = LGBMClassifier(n_estimators=150, max_depth=4, num_leaves=15,
                                  min_child_samples=50, learning_rate=.03,
                                  n_jobs=2, verbosity=-1, random_state=42)
    elif algorithm == "catboost":
        from catboost import CatBoostClassifier
        estimator = CatBoostClassifier(iterations=150, depth=4, learning_rate=.03,
                                       loss_function="MultiClass", random_seed=42,
                                       thread_count=2, verbose=False, allow_writing_files=False)
    else:
        raise ValueError("未知算法")
    return Pipeline([("impute",SimpleImputer(strategy="median",keep_empty_features=True,add_indicator=True)),
                     ("scale",StandardScaler()),("model",estimator)])


def train_experiment(rows, manifest, output_dir: Path, **kwargs):
    """One immutable experiment per directory; retries do not re-open holdout."""
    fingerprint = digest({"dataset_hash":manifest.get("dataset_hash"),"options":kwargs,
                          "training_version":TRAINING_VERSION})
    with _exclusive_experiment(output_dir):
        sealed = output_dir/"experiment-seal.json"
        if sealed.exists():
            previous = json.loads(sealed.read_text())
            if previous["fingerprint"] != fingerprint:
                raise ValueError("实验目录已封存；不能更换数据/参数后重复查看同一留出集")
            if (output_dir/"report.json").exists():
                return json.loads((output_dir/"report.json").read_text())
            raise ValueError("封存实验曾中断，须人工审计；不可自动重新打开留出集")
        if manifest.get("dataset_hash") != digest(rows):
            raise ValueError("数据集内容哈希与 manifest 不一致")
        _validate_rows(rows,manifest)
        write_json(sealed,{"fingerprint":fingerprint,"training_version":TRAINING_VERSION})
        return _train_experiment(rows,manifest,output_dir,**kwargs)


def _train_experiment(rows, manifest, output_dir: Path,
                     algorithms=("logistic","lightgbm","catboost"),
                     train_days=120, calibration_days=20, test_days=20,
                     holdout_days=20, min_folds=3, embargo_minutes=60,
                     ablations=True):
    import numpy as np
    import joblib
    from scipy.optimize import minimize_scalar
    output_dir.mkdir(parents=True, exist_ok=True)
    if not isinstance(min_folds,int) or isinstance(min_folds,bool) or min_folds < 1:
        raise ValueError("min_folds 必须为正整数")
    if not algorithms or any(a not in ("logistic","lightgbm","catboost") for a in algorithms):
        raise ValueError("至少选择一种支持的算法")
    if manifest.get("dataset_hash") != digest(rows):
        raise ValueError("数据集内容哈希与 manifest 不一致")
    if len({r["horizon_minutes"] for r in rows}) > 1:
        raise ValueError("一个实验只能训练一个预测周期")
    # Canonical ordering independent of input file order.
    rows = sorted(rows,key=lambda r:(instant(r["decision_time"]),r["stock_code"]))
    folds = list(purged_folds(rows,train_days,calibration_days,test_days,embargo_minutes,holdout_days))
    report = {"status":"BLOCKED","dataset_id":manifest["dataset_id"], "dataset_hash":manifest["dataset_hash"],
              "production_approved":False, "models":{}, "fold_count":len(folds),
              "configuration":{"train_days":train_days,"calibration_days":calibration_days,
                               "test_days":test_days,"holdout_days":holdout_days,
                               "min_folds":min_folds,"embargo_minutes":embargo_minutes},
              "data_ready":manifest["quality"]["production_ready"] is True
                  and manifest["quality"].get("quality_policy") == QUALITY_POLICY_VERSION
                  and bool(manifest.get("build_at")) and all(r.get("label_available_at") for r in rows),
              "quality_policy":manifest["quality"].get("quality_policy"),
              "training_version":TRAINING_VERSION,
              "issues":[], "classes":list(CLASSES)}
    if len(folds) < min_folds:
        report["issues"] = [f"样本不足：需要至少 {train_days+calibration_days+test_days*min_folds+holdout_days} 个有标签交易日，当前折数 {len(folds)}"]
        write_json(output_dir/"report.json",report)
        return report
    names = sorted(rows[0]["features"])
    if any(sorted(r["features"]) != names for r in rows):
        raise ValueError("特征 schema 随时间变化，必须生成新版本")
    y = np.array([CLASSES.index(r["direction_label"]) for r in rows])
    x = np.array([[float("nan") if r["features"][n] is None else r["features"][n] for n in names] for r in rows],dtype=float)
    if np.isinf(x).any():
        raise ValueError("输入包含无限数值")
    groups = {"full":names}
    if ablations:
        for group,prefix in (("without_news","news_"),("without_seats","seat_"),("without_l2",("book_","l2_"))):
            groups[group] = [n for n in names if not n.startswith(prefix)]

    def fit_fold(algorithm, columns, fold):
        tr,ca,te = fold["train"],fold["calibration"],fold["test"]
        if set(y[tr]) != {0,1,2} or not ca or not te:
            raise ValueError("训练折必须覆盖三类，校准集/测试集不能为空")
        model = make_model(algorithm)
        model.fit(x[tr][:,columns],y[tr])
        raw_ca = model.predict_proba(x[ca][:,columns])
        temp = float(minimize_scalar(lambda t: metrics(y[ca],temperature_scale(raw_ca,t))["log_loss"],
                                     bounds=(.25,5),method="bounded").x)
        raw = model.predict_proba(x[te][:,columns])
        calibrated = temperature_scale(raw,temp)
        freq = np.bincount(y[tr],minlength=3)/len(tr)
        base = np.tile(freq,(len(te),1))
        # Quantiles are training-only unconditional baselines, explicitly labelled.
        returns = np.array([rows[i]["target_return_pct"] for i in tr])
        quantiles = np.quantile(returns,[.1,.5,.9]).tolist()
        actual = np.array([rows[i]["target_return_pct"] for i in te])
        result = {"fold":fold["fold"],"raw":metrics(y[te],raw),"calibrated":metrics(y[te],calibrated),
                  "frequency_benchmark":metrics(y[te],base),"temperature":temp,
                  "interval_method":"training_unconditional_baseline",
                  "q10_q50_q90":quantiles,
                  "interval_coverage":float(((actual>=quantiles[0])&(actual<=quantiles[2])).mean()),
                  "train_count":len(tr),"calibration_count":len(ca),"test_count":len(te)}
        return result,model,temp,calibrated

    candidates = {}
    for algorithm in algorithms:
        try:
            variants = {}
            oos = []
            for variant,fields in groups.items():
                columns = [names.index(n) for n in fields]
                summaries = []
                for fold in folds:
                    summary,model,temp,probs = fit_fold(algorithm,columns,fold)
                    summaries.append(summary)
                    if variant == "full":
                        for i,p in zip(fold["test"],probs):
                            oos.append({k:rows[i][k] for k in ("stock_code","decision_time","label_end_time","target_return_pct","direction_label")}|{"probabilities":p.tolist(),"fold":fold["fold"],"price":rows[i].get("reference_price"),"input_hash":rows[i]["input_hash"]})
                n = sum(s["test_count"] for s in summaries)
                variants[variant] = {"folds":summaries,"mean_brier":sum(s["calibrated"]["brier"]*s["test_count"] for s in summaries)/n}
            report["models"][algorithm] = {"status":"VALIDATED_RESEARCH","variants":variants}
            candidates[algorithm] = variants["full"]["mean_brier"]
            write_json(output_dir/f"{algorithm}-oos.json",oos)
        except (ImportError,OSError,ValueError) as exc:
            report["models"][algorithm] = {"status":"FAILED","reason":str(exc)}
    if not candidates:
        report["issues"].append("所有算法均未完成训练，请检查依赖和样本")
        write_json(output_dir/"report.json",report)
        return report
    # Select once on development folds, then touch the final holdout once.
    selected = min(candidates,key=candidates.get)
    days = sorted({instant(r["decision_time"]).date() for r in rows})
    # Build an exact final split using the last holdout_days dates.
    te_days, ca_days = set(days[-holdout_days:]), set(days[-holdout_days-calibration_days:-holdout_days])
    ca_start = min(instant(r["decision_time"]) for r in rows if instant(r["decision_time"]).date() in ca_days)
    te_start = min(instant(r["decision_time"]) for r in rows if instant(r["decision_time"]).date() in te_days)
    gap = timedelta(minutes=embargo_minutes)
    final_fold={"fold":"holdout",
                "train":[i for i,r in enumerate(rows) if _label_known(r)<ca_start-gap],
                "calibration":[i for i,r in enumerate(rows) if instant(r["decision_time"]).date() in ca_days and _label_known(r)<te_start-gap],
                "test":[i for i,r in enumerate(rows) if instant(r["decision_time"]).date() in te_days]}
    summary,model,temp,probs = fit_fold(selected,list(range(len(names))),final_fold)
    write_json(output_dir/"holdout-oos.json",[
        {k:rows[i][k] for k in ("stock_code","decision_time","label_end_time","target_return_pct","direction_label")}
        |{"probabilities":p.tolist(),"fold":"holdout","price":rows[i].get("reference_price"),"input_hash":rows[i]["input_hash"]}
        for i,p in zip(final_fold["test"],probs)])
    artifact_path = output_dir/"candidate.joblib"
    joblib.dump({"model":model,"temperature":temp,"feature_names":names,"classes":CLASSES,
                 "horizon_minutes":rows[0]["horizon_minutes"],"dataset_hash":manifest["dataset_hash"]},artifact_path)
    artifact_hash = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
    metadata = {"model_id":"candidate-"+artifact_hash[:24],"algorithm":selected,"state":"CALIBRATED",
                "calibrated":True,"production_approved":False,"file_hash":artifact_hash,
                "feature_names":names,"feature_version":manifest["feature_version"],
                "dataset_id":manifest["dataset_id"],"horizon_minutes":rows[0]["horizon_minutes"],
                "dataset_hash":manifest["dataset_hash"],"training_version":TRAINING_VERSION,
                "data_sources":manifest.get("data_sources",[]),
                "train_start":rows[final_fold["train"][0]]["decision_time"],
                "train_end":rows[final_fold["train"][-1]]["decision_time"],
                "holdout_start":rows[final_fold["test"][0]]["decision_time"],
                "holdout_end":max(_label_known(r) for r in rows).isoformat(),
                "dependencies":{n:importlib.metadata.version(n) for n in ("numpy","scikit-learn","joblib", *({"lightgbm":("lightgbm",),"catboost":("catboost",)}.get(selected,())) )},
                "python_version":platform.python_version()}
    write_json(output_dir/"candidate.json",metadata)
    report.update(status="VALIDATED_RESEARCH", selected_algorithm=selected, holdout=summary,
                  candidate=metadata, split_boundaries=[{k:v for k,v in f.items() if k not in ("train","test","calibration")} for f in folds])
    if not report["data_ready"]:
        report["issues"].append("数据完整性尚未通过，模型只能作研究候选")
    write_json(output_dir/"report.json",report)
    return report


def predict_candidate(artifact_dir: Path, features: dict, expected_hash: str | None = None):
    """Only load a locally built artifact whose digest matches its registry."""
    import json
    import joblib
    import numpy as np
    metadata = json.loads((artifact_dir/"candidate.json").read_text())
    actual = hashlib.sha256((artifact_dir/"candidate.joblib").read_bytes()).hexdigest()
    if actual != metadata["file_hash"] or (expected_hash and actual != expected_hash):
        raise ValueError("模型工件哈希不符")
    saved = joblib.load(artifact_dir/"candidate.joblib")
    names = saved["feature_names"]
    if set(features) != set(names):
        raise ValueError("线上特征与训练 schema 不一致")
    x = np.array([[float("nan") if features[n] is None else features[n] for n in names]])
    return temperature_scale(saved["model"].predict_proba(x),saved["temperature"])[0].tolist()
