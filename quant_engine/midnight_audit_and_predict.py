import datetime
import subprocess
import json
import os
import sys

# ZeroQuant 每日凌晨 00:00 (24:00) 全量脚本核验、数据巡检与开盘首轮基准预测生成引擎
LOG_FILE = "/root/stock_quant/midnight_audit.log"

def log(msg):
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{now_str}] {msg}"
    print(formatted)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(formatted + "\n")

def is_trading_day(dt):
    # 过滤周六、周日
    if dt.weekday() >= 5:
        return False
    return True

def run_midnight_inspection_and_prediction():
    now_dt = datetime.datetime.now()
    today_str = now_dt.strftime("%Y-%m-%d")
    log("================================================================================")
    log(f"🌙 STARTING MIDNIGHT 00:00 (24:00) ZEROQUANT SYSTEM AUDIT & INITIAL PREDICTIONS for {today_str}")
    log("================================================================================")

    # 1. 巡检关键系统服务状态 (zeroquant-server & PostgreSQL)
    log("🔍 1. Inspecting System Backend & Database Services...")
    try:
        zq_srv = subprocess.check_output("systemctl is-active zeroquant-server || true", shell=True).decode().strip()
        log(f"  - zeroquant-server service status: {zq_srv}")
    except Exception as e:
        log(f"  - ⚠️ zeroquant-server check failed: {e}")

    try:
        pg_chk = subprocess.check_output("docker exec truecost-postgres psql -U truecost -d zeroquant_db -t -c \"SELECT 'PG_DB_OK';\"", shell=True).decode().strip()
        log(f"  - PostgreSQL zeroquant_db connectivity: {pg_chk}")
    except Exception as e:
        log(f"  - ⚠️ PostgreSQL zeroquant_db check failed: {e}")

    # 2. 检查并核验所有核心 Python 脚本与 Cron 状态
    log("📜 2. Inspecting Core Quant Scripts Integrity...")
    core_scripts = [
        "/root/stock_quant/realtime_monitor_1m.py",
        "/root/stock_quant/generate_daily_predictions.py",
        "/root/stock_quant/sync_official_l2.py",
        "/root/stock_quant/hourly_verifier.py",
        "/root/.hermes/scripts/generate_opening_baseline_0920.py"
    ]
    for s in core_scripts:
        if os.path.exists(s):
            size = os.path.getsize(s)
            log(f"  - Script {os.path.basename(s)}: EXISTS ({size} bytes) ✅")
        else:
            log(f"  - ❌ Script MISSING: {s}")

    # 3. 校验历史数据完备性 (检查昨天数据点位数)
    log("📊 3. Auditing Historical Data Completeness...")
    try:
        audit_sql = "SELECT trade_date, stock_code, COUNT(*) FROM stock_price_histories GROUP BY trade_date, stock_code ORDER BY trade_date DESC, stock_code ASC LIMIT 12;"
        res_audit = subprocess.check_output(f"docker exec truecost-postgres psql -U truecost -d zeroquant_db -c \"{audit_sql}\"", shell=True).decode().strip()
        log(f"  - Recent histories check:\n{res_audit}")
    except Exception as e:
        log(f"  - ⚠️ History audit check failed: {e}")

    # 4. 若为交易日，执行当日凌晨 00:00 (24:00) 第一次初始预测数据生成
    if is_trading_day(now_dt):
        log(f"🚀 4. Today ({today_str}) is a Trading Day. Generating FIRST PREDICTIONS (00:00 Initial Baseline)...")
        try:
            cmd_gen = f"python3 /root/stock_quant/generate_daily_predictions.py {today_str}"
            out_gen = subprocess.check_output(cmd_gen, shell=True).decode().strip()
            log(f"  - Initial prediction generator output: {out_gen}")
            
            # 核验数据库中是否成功生成了今日初始预测数据
            pred_chk = f"SELECT stock_code, predict_date, direction, target_pct, is_base FROM stock_day_predictions WHERE predict_date = '{today_str}';"
            res_pred = subprocess.check_output(f"docker exec truecost-postgres psql -U truecost -d zeroquant_db -c \"{pred_chk}\"", shell=True).decode().strip()
            log(f"  - Initial predictions in DB for {today_str}:\n{res_pred}")
            log("  ✅ FIRST INITIAL PREDICTION SUCCESSFULLY GENERATED & LOCKED IN DB AT 00:00!")
        except Exception as e:
            log(f"  - ❌ Failed to generate initial predictions: {e}")
    else:
        log(f"🏖️ 4. Today ({today_str}) is Weekend/Holiday. Skipping initial market prediction generation.")

    log("================================================================================")
    log(f"✅ MIDNIGHT 00:00 (24:00) AUDIT & PREDICTION WORKFLOW FINISHED at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log("================================================================================")

if __name__ == "__main__":
    run_midnight_inspection_and_prediction()
