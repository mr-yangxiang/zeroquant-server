import urllib.request
import json
import os

STOCKS = [
    {"code": "sh600839", "secid": "1.600839", "name": "四川长虹"},
    {"code": "sh601899", "secid": "1.601899", "name": "紫金矿业"},
    {"code": "sh603696", "secid": "1.603696", "name": "安记食品"},
    {"code": "sz000572", "secid": "0.000572", "name": "海马汽车"},
    {"code": "sh603366", "secid": "1.603366", "name": "日出东方"}
]

# 抓取龙虎榜数据、十大股东数据与近250日K线
def fetch_stock_details(secid, code):
    # K线数据 (250交易日)
    k_url = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=250"
    # 龙虎榜/主力资金数据 (Eastmoney API)
    lhb_url = f"http://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=SECURITY_CODE,TRADE_DATE&sortTypes=-1,-1&pageSize=50&pageNumber=1&reportName=RPT_DAILY_BILLBOARD&columns=ALL&filter=(SECURITY_CODE%3D%22{code[2:]}%22)"
    
    k_data = []
    lhb_data = []
    
    try:
        req = urllib.request.Request(k_url, headers={"User-Agent": "Mozilla/5.0"})
        res = urllib.request.urlopen(req).read().decode()
        k_data = json.loads(res).get("data", {}).get("klines", [])
    except Exception as e:
        print(f"K-line error for {code}: {e}")

    try:
        req2 = urllib.request.Request(lhb_url, headers={"User-Agent": "Mozilla/5.0"})
        res2 = urllib.request.urlopen(req2).read().decode()
        lhb_data = json.loads(res2).get("result", {}).get("data", [])
    except Exception as e:
        print(f"LHB error for {code}: {e}")

    return k_data, lhb_data

for s in STOCKS:
    k, lhb = fetch_stock_details(s["secid"], s["code"])
    print(f"[{s['name']} ({s['code']})] K-lines count: {len(k)}, LHB record count: {len(lhb) if lhb else 0}")
