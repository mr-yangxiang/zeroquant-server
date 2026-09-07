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
    {"secid": "1.603696", "code": "sh603696", "name": "安记食品"},
    {"secid": "0.000572", "code": "sz000572", "name": "海马汽车"},
    {"secid": "1.603366", "code": "sh603366", "name": "日出东方"}
]

def run_simulation_for_years(years_back):
    limit_days = years_back * 250
    sim_results = {}
    for s in STOCKS:
        url = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={s['secid']}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt={limit_days}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            res = urllib.request.urlopen(req, timeout=10).read().decode()
            klines = json.loads(res).get("data", {}).get("klines", [])
            
            total_days = len(klines)
            valid_t_days = sum(1 for k in klines if float(k.split(",")[7]) >= 2.5)
            pullback_days = sum(1 for k in klines if (float(k.split(",")[3]) - max(float(k.split(",")[1]), float(k.split(",")[2]))) / float(k.split(",")[1]) * 100 > 1.5)
            rebound_days = sum(1 for k in klines if (min(float(k.split(",")[1]), float(k.split(",")[2])) - float(k.split(",")[4])) / float(k.split(",")[1]) * 100 > 1.5)
            
            sim_results[s["name"]] = {
                "years": years_back,
                "total_days": total_days,
                "valid_t_ratio": f"{round(valid_t_days / total_days * 100, 1)}%",
                "pullback_rate": f"{round(pullback_days / total_days * 100, 1)}%",
                "rebound_rate": f"{round(rebound_days / total_days * 100, 1)}%"
            }
        except Exception as e:
            print(f"Sim error for {s['name']}: {e}")
    return sim_results

def update_kb_with_simulation(old_years, new_years, sim_old, sim_new):
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    update_text = f"\n\n## 🔄【{now_str}】历史延伸自动化模拟对比报告 (近 {old_years} 年 vs 近 {new_years} 年)\n\n"
    update_text += f"根据“3次连续核对一致则历史延伸+1年”规则，已完成近 {old_years} 年与近 {new_years} 年（{new_years*250} 个交易日）的全量回测模拟对比：\n\n"
    update_text += "| 标的名称 | 分析时间跨度 | 具备做T空间天数占比 | 冲高回落率 | 探底反弹率 | 模拟对比结论与策略修正 |\n"
    update_text += "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
    
    for s in STOCKS:
        name = s["name"]
        o = sim_old.get(name, {})
        n = sim_new.get(name, {})
        
        diff_pullback = round(float(n['pullback_rate'].replace('%','')) - float(o['pullback_rate'].replace('%','')), 1)
        conclusion = "历史规律高度稳定"
        if abs(diff_pullback) >= 3.0:
            conclusion = f"近{new_years}年周期更长，冲高回落变动 {diff_pullback}%，做T区间适度微调"
            
        update_text += f"| **{name}** | 近 {old_years}年 ➔ 近 {new_years}年 | {o.get('valid_t_ratio','')} ➔ **{n.get('valid_t_ratio','')}** | {o.get('pullback_rate','')} ➔ **{n.get('pullback_rate','')}** | {o.get('rebound_rate','')} ➔ **{n.get('rebound_rate','')}** | **{conclusion}** |\n"
        
    with open(KB_FILE, "a", encoding="utf-8") as f:
        f.write(update_text)

if __name__ == "__main__":
    sim1 = run_simulation_for_years(1)
    sim2 = run_simulation_for_years(2)
    update_kb_with_simulation(1, 2, sim1, sim2)
    print("Simulation report written to KB successfully.")