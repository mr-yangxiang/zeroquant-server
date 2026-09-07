import urllib.request
import json
import random
import datetime

def sample_and_verify():
    stocks = [
        {"secid": "1.600839", "name": "四川长虹"},
        {"secid": "1.601899", "name": "紫金矿业"},
        {"secid": "1.603696", "name": "安记食品"},
        {"secid": "0.000572", "name": "海马汽车"},
        {"secid": "1.603366", "name": "日出东方"}
    ]
    
    # 用当天日期做随机数种子，确保每天抽样 5 个不同的历史交易日
    seed_val = int(datetime.datetime.now().strftime("%Y%m%d"))
    random.seed(seed_val)
    
    results = {}
    for s in stocks:
        url = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={s['secid']}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=250"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        res = urllib.request.urlopen(req).read().decode()
        klines = json.loads(res).get("data", {}).get("klines", [])
        
        sampled_indices = random.sample(range(len(klines)), 5)
        samples = []
        for idx in sorted(sampled_indices):
            p = klines[idx].split(",")
            date_str, open_p, close_p, high_p, low_p = p[0], float(p[1]), float(p[2]), float(p[3]), float(p[4])
            t_space = round((high_p - low_p) / low_p * 100, 2)
            upper_shadow = round((high_p - max(open_p, close_p)) / open_p * 100, 2)
            lower_shadow = round((min(open_p, close_p) - low_p) / open_p * 100, 2)
            samples.append({
                "date": date_str,
                "t_space_pct": t_space,
                "upper_shadow_pct": upper_shadow,
                "lower_shadow_pct": lower_shadow,
                "fit_pattern": t_space >= 2.0
            })
        results[s["name"]] = samples
        
    return results

if __name__ == "__main__":
    res = sample_and_verify()
    print(json.dumps(res, ensure_ascii=False, indent=2))
