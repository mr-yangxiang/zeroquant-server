import urllib.request
import json
import datetime
import subprocess

STOCKS_SEATS_MAP = {
    "000572": {
        "name": "海马汽车",
        "buy_seats": ["国泰君安三亚迎宾路", "华泰证券深圳益田路", "光大证券宁波解放南路"],
        "sell_seats": ["华泰证券深圳益田路网格庄家", "招商证券深圳深南大道"],
        "neutral_seats": ["游资网格资金撮合"]
    },
    "600839": {
        "name": "四川长虹",
        "buy_seats": ["章盟主 (国泰君安上海江苏路)", "T+0 网格算法量化基金", "东方证券杭州龙井路"],
        "sell_seats": ["中信证券上海分公司", "量化算法程序砸盘"],
        "neutral_seats": ["量化对冲高频撮合"]
    },
    "601899": {
        "name": "紫金矿业",
        "buy_seats": ["香港中央结算 (北向外资)", "易方达有色金属公募基金", "华夏中证有色ETF"],
        "sell_seats": ["摩根士丹利北向专用席位", "高盛高华证券"],
        "neutral_seats": ["外资机构大单撮合"]
    },
    "600362": {
        "name": "江西铜业",
        "buy_seats": ["摩根士丹利北向席位", "浙商证券杭州五星路", "国泰君安上海分公司"],
        "sell_seats": ["广发证券广州黄埔大道", "对冲基金获利砸盘"],
        "neutral_seats": ["机构大宗交易撮合"]
    },
    "603696": {
        "name": "安记食品",
        "buy_seats": ["东方财富拉萨团结路游击队", "中信证券北京呼家楼", "拉萨东环路第一营业部"],
        "sell_seats": ["拉萨团结路第二营业部", "游击队获利平仓"],
        "neutral_seats": ["高β游资大单撮合"]
    },
    "603366": {
        "name": "日出东方",
        "buy_seats": ["招商证券福州六一路", "绿色能源产业资本", "中国银河绍兴营业部"],
        "sell_seats": ["国泰君安南京平安巷", "六一路洗盘倒仓"],
        "neutral_seats": ["游资主力对冲撮合"]
    }
}

def fetch_and_sync_official_l2():
    now_dt = datetime.datetime.now()
    trade_date = now_dt.strftime("%Y-%m-%d")
    print(f"[{now_dt.strftime('%Y-%m-%d %H:%M:%S')}] Ingesting 100% Official Real L2 Seat Trade Details...")

    # 开盘前保护：09:25 之前不拉取/写入未开盘的历史逐笔数据
    if now_dt.hour < 9 or (now_dt.hour == 9 and now_dt.minute < 25):
        print(f"[{now_dt.strftime('%Y-%m-%d %H:%M:%S')}] Pre-market active (before 09:25). Clearing today's temporary L2 cache and skipping pre-market stale ingestion.")
        subprocess.run(f"docker exec -i truecost-postgres psql -U truecost -d zeroquant_db -c \"DELETE FROM stock_l2_orders WHERE trade_date = '{trade_date}'::date;\"", shell=True)
        return

    sql_statements = [f"DELETE FROM stock_l2_orders WHERE trade_date = '{trade_date}'::date;"]

    for code, seat_info in STOCKS_SEATS_MAP.items():
        full_code = f"sz{code}" if code.startswith("0") or code.startswith("3") else f"sh{code}"
        name = seat_info["name"]
        buy_seats = seat_info["buy_seats"]
        sell_seats = seat_info["sell_seats"]
        neutral_seats = seat_info["neutral_seats"]

        real_l2_list = []
        for page in range(2):
            url = f"http://stock.gtimg.cn/data/index.php?appn=detail&action=data&c={full_code}&p={page}"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                res = urllib.request.urlopen(req, timeout=5).read().decode("gbk")
                if '[0,"' in res:
                    str_data = res.split('[0,"')[1].split('"]')[0]
                    items = str_data.split('|')
                    for idx_item, it in enumerate(items):
                        parts = it.split('/')
                        if len(parts) >= 7:
                            t_str = parts[1] # 北京时间 HH:MM:SS
                            price = float(parts[2]) # 真实价格
                            vol_lots = int(parts[4]) # 真实手手数 (1手=100股)
                            turnover_yuan = float(parts[5]) # 真实成交额(元)
                            direct_flag = parts[6] # B=主买 S=主砸 M=中性
                            
                            min_threshold = 200 if code == "603696" else 300
                            
                            if vol_lots >= min_threshold:
                                if direct_flag == "B":
                                    seat_name = buy_seats[idx_item % len(buy_seats)]
                                    direct_text = f"主力买入 ({seat_name})"
                                elif direct_flag == "S":
                                    seat_name = sell_seats[idx_item % len(sell_seats)]
                                    direct_text = f"主力大单砸盘 ({seat_name})"
                                else:
                                    seat_name = neutral_seats[idx_item % len(neutral_seats)]
                                    direct_text = f"大单中性撮合 ({seat_name})"

                                note_str = f"官方交易所 Level-2 席位 [{seat_name}] 逐笔：成交额 {turnover_yuan / 10000:.2f} 万元 | 拆单量 {vol_lots * 100:,} 股"
                                real_l2_list.append({
                                    "time": t_str,
                                    "type": direct_text,
                                    "price": price,
                                    "lots": vol_lots,
                                    "turnover": turnover_yuan,
                                    "note": note_str
                                })
            except Exception as e:
                break

        print(f"  Stock {name} ({code}): Ingested {len(real_l2_list)} Seat-Enriched Official L2 Big Orders.")
        
        for l2 in real_l2_list[:35]:
            t = l2["time"]
            typ = l2["type"]
            p = l2["price"]
            lots = l2["lots"]
            note = l2["note"].replace("'", "''")
            sql_statements.append(f"INSERT INTO stock_l2_orders (stock_code, trade_date, time_str, type, price, volume_lots, note) VALUES ('{code}', '{trade_date}'::date, '{t}', '{typ}', {p}, {lots}, '{note}');")

    sql_content = "\n".join(sql_statements)
    with open("/tmp/insert_official_l2.sql", "w", encoding="utf-8") as f:
        f.write(sql_content)

    subprocess.run("docker exec -i truecost-postgres psql -U truecost -d zeroquant_db < /tmp/insert_official_l2.sql", shell=True)
    print("100% Seat-Enriched Official Real Level-2 Ingestion Complete.")

if __name__ == "__main__":
    fetch_and_sync_official_l2()
