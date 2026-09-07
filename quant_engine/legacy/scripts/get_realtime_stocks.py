import urllib.request
import sys

def get_realtime_data():
    url = "http://qt.gtimg.cn/q=sh600839,sh601899,sh000001,sz399001"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        res = urllib.request.urlopen(req).read().decode("gbk")
        lines = res.strip().split(";")
        result = {}
        for line in lines:
            if not line.strip():
                continue
            parts = line.split("~")
            if len(parts) > 35:
                code = parts[2]
                name = parts[1]
                price = float(parts[3])
                yest = float(parts[4])
                high = float(parts[33])
                low = float(parts[34])
                pct = float(parts[32])
                date = parts[30]
                result[code] = {
                    "name": name,
                    "price": price,
                    "yest": yest,
                    "high": high,
                    "low": low,
                    "pct": pct,
                    "date": date
                }
        return result
    except Exception as e:
        print(f"Fetch real data error: {e}", file=sys.stderr)
        return None

if __name__ == "__main__":
    data = get_realtime_data()
    print(data)
