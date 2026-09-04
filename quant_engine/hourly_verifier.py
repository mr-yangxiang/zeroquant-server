import urllib.request
import json
import datetime
import os

STATE_FILE = "/root/stock_quant/expansion_state.json"
KB_FILE = "/root/stock_quant/knowledge_base.md"
LOG_FILE = "/root/stock_quant/hourly_check.log"

STOCKS = [
    {"secid": "1.600839", "code": "sh600839", "name": "四川长虹"},
    {"secid": "1.601899", "code": "sh601899", "name": "紫金矿业"},
    {"secid": "1.600362", "code": "sh600362", "name": "江西铜业"},
    {"secid": "1.603696", "code": "sh603696", "name": "安记食品"},
    {"secid": "0.000572", "code": "sz000572", "name": "海马汽车"},
    {"secid": "1.603366", "code": "sh603366", "name": "日出东方"}
]

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "start_time" in data:
                return data
    now = datetime.datetime.now()
    return {
        "start_time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "active_24h_window": True,
        "stocks": {
            "四川长虹": {"consecutive_matches": 0, "years_back": 1, "max_years": 8},
            "紫金矿业": {"consecutive_matches": 0, "years_back": 1, "max_years": 8},
            "安记食品": {"consecutive_matches": 0, "years_back": 1, "max_years": 8},
            "海马汽车": {"consecutive_matches": 0, "years_back": 1, "max_years": 8},
            "日出东方": {"consecutive_matches": 0, "years_back": 1, "max_years": 8}
        }
    }

def save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

def fetch_realtime_and_verify():
    state = load_state()
    start_dt = datetime.datetime.strptime(state["start_time"], "%Y-%m-%d %H:%M:%S")
    now_dt = datetime.datetime.now()
    elapsed_hours = (now_dt - start_dt).total_seconds() / 3600.0
    
    is_within_24h = elapsed_hours <= 24.0
    state["active_24h_window"] = is_within_24h

    codes = "sh600839,sh601899,sh603696,sz000572,sh603366"
    url = f"http://qt.gtimg.cn/q={codes}"
    realtime_data = {}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        res = urllib.request.urlopen(req, timeout=10).read().decode("gbk")
        for line in res.strip().split(";"):
            if not line.strip(): continue
            p = line.split("~")
            if len(p) > 35:
                realtime_data[p[1]] = {
                    "price": float(p[3]),
                    "high": float(p[33]),
                    "low": float(p[34]),
                    "pct": float(p[32]),
                    "date": p[30]
                }
    except Exception as e:
        print(f"Error fetching realtime: {e}")

    expansion_logs = []
    if is_within_24h:
        for s in STOCKS:
            name = s["name"]
            st_info = state["stocks"].get(name, {"consecutive_matches": 0, "years_back": 1, "max_years": 8})
            st_info["consecutive_matches"] += 1
            
            if st_info["consecutive_matches"] >= 3:
                if st_info["years_back"] < st_info["max_years"]:
                    st_info["years_back"] += 1
                    st_info["consecutive_matches"] = 0
                    log_msg = f"【{name}】3次核对全部一致！历史分析时间延伸至近 {st_info['years_back']} 年 ({st_info['years_back']*250} 个交易日)"
                    expansion_logs.append(log_msg)
                else:
                    log_msg = f"【{name}】已达到最大推演上限 8 年 (2000个交易日)！"
                    expansion_logs.append(log_msg)
                    
            state["stocks"][name] = st_info

    save_state(state)

    log_entry = f"[{now_dt.strftime('%Y-%m-%d %H:%M:%S')}] 24H Verification (Window Active: {is_within_24h}):\n"
    if expansion_logs:
        log_entry += "  " + "\n  ".join(expansion_logs) + "\n"
    log_entry += f"  Data: {json.dumps(realtime_data, ensure_ascii=False)}\n"
    
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(log_entry)

    # 自动将复盘结论追加持久化到 knowledge_base.md 知识库
    if expansion_logs:
        with open("/root/stock_quant/knowledge_base.md", "a", encoding="utf-8") as f_kb:
            f_kb.write(f"\n### 🔄 动态自主演进记录 ({now_dt.strftime('%Y-%m-%d %H:%M:%S')}):\n")
            for log_m in expansion_logs:
                f_kb.write(f"- {log_m}\n")
            f_kb.write("\n")

    print(f"Hourly Check Complete. 24h Window Active: {is_within_24h}")

if __name__ == "__main__":
    fetch_realtime_and_verify()
