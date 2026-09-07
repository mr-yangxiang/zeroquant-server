import urllib.request
import json
import math

STOCKS = [
    {"code": "sh600839", "secid": "1.600839", "name": "四川长虹"},
    {"code": "sh601899", "secid": "1.601899", "name": "紫金矿业"},
    {"code": "sh603696", "secid": "1.603696", "name": "安记食品"},
    {"code": "sz000572", "secid": "0.000572", "name": "海马汽车"},
    {"code": "sh603366", "secid": "1.603366", "name": "日出东方"}
]

def analyze_stock(secid, name):
    url = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=250"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    res = urllib.request.urlopen(req).read().decode()
    klines = json.loads(res).get("data", {}).get("klines", [])
    
    dates, closes, highs, lows, opens, pcts, amps, turnovers = [], [], [], [], [], [], [], []
    
    for k in klines:
        p = k.split(",")
        dates.append(p[0])
        opens.append(float(p[1]))
        closes.append(float(p[2]))
        highs.append(float(p[3]))
        lows.append(float(p[4]))
        amps.append(float(p[7]))
        pcts.append(float(p[8]))
        turnovers.append(float(p[10]))
        
    # 计算涨停天数、跌停天数、日内高开回落比例、低开反弹比例
    limit_ups = sum(1 for pct in pcts if pct >= 9.8)
    limit_downs = sum(1 for pct in pcts if pct <= -9.8)
    
    # 冲高回落天数 (最高价明显高于收盘价，且收盘价与最高价差幅度 > 1.5%)
    high_pullbacks = sum(1 for i in range(len(closes)) if (highs[i] - max(opens[i], closes[i])) / opens[i] * 100 > 1.5)
    # 低吸反弹天数 (最低价明显低于开盘价/收盘价，下影线 > 1.5%)
    low_rebounds = sum(1 for i in range(len(closes)) if (min(opens[i], closes[i]) - lows[i]) / opens[i] * 100 > 1.5)
    
    avg_amp = sum(amps) / len(amps)
    avg_turnover = sum(turnovers) / len(turnovers)
    
    return {
        "name": name,
        "days": len(dates),
        "high_1y": max(highs),
        "low_1y": min(lows),
        "avg_amp": round(avg_amp, 2),
        "avg_turnover": round(avg_turnover, 2),
        "limit_ups": limit_ups,
        "limit_downs": limit_downs,
        "high_pullback_rate": round(high_pullbacks / len(dates) * 100, 1),
        "low_rebound_rate": round(low_rebounds / len(dates) * 100, 1)
    }

results = [analyze_stock(s["secid"], s["name"]) for s in STOCKS]
print(json.dumps(results, ensure_ascii=False, indent=2))
