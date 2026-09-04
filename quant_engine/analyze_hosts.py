import urllib.request
import json
import time

STOCKS = {
    "600839": {"name": "四川长虹", "secid": "1.600839", "code": "sh600839"},
    "601899": {"name": "紫金矿业", "secid": "1.601899", "code": "sh601899"},
    "603696": {"name": "安记食品", "secid": "1.603696", "code": "sh603696"},
    "000572": {"name": "海马汽车", "secid": "0.000572", "code": "sz000572"},
    "603366": {"name": "日出东方", "secid": "1.603366", "code": "sh603366"}
}

def get_stock_kline(secid):
    # 抓取近 250 个交易日 (约 1 年) 的日 K 线数据
    url = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=250"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        res = urllib.request.urlopen(req).read().decode()
        data = json.loads(res)
        klines = data.get("data", {}).get("klines", [])
        return klines
    except Exception as e:
        print(f"Error fetching kline {secid}: {e}")
        return []

def analyze():
    analysis_results = {}
    for code, info in STOCKS.items():
        klines = get_stock_kline(info["secid"])
        if not klines:
            continue
        
        # 解析日K线数据: 日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
        prices = []
        amplitudes = []
        turnovers = []
        pcts = []
        
        for k in klines:
            parts = k.split(",")
            if len(parts) >= 11:
                close_p = float(parts[2])
                high_p = float(parts[3])
                low_p = float(parts[4])
                amp = float(parts[7])
                pct = float(parts[8])
                turnover = float(parts[10])
                prices.append(close_p)
                amplitudes.append(amp)
                turnovers.append(turnover)
                pcts.append(pct)
        
        avg_amp = sum(amplitudes) / len(amplitudes) if amplitudes else 0
        avg_turnover = sum(turnovers) / len(turnovers) if turnovers else 0
        max_price = max(prices) if prices else 0
        min_price = min(prices) if prices else 0
        current_price = prices[-1] if prices else 0
        
        # 资金与大户特征推断
        analysis_results[code] = {
            "name": info["name"],
            "current_price": current_price,
            "1y_high": max_price,
            "1y_low": min_price,
            "1y_avg_amplitude": round(avg_amp, 2),
            "1y_avg_turnover": round(avg_turnover, 2),
            "trading_days": len(prices)
        }
    return analysis_results

if __name__ == "__main__":
    res = analyze()
    print(json.dumps(res, ensure_ascii=False, indent=2))
