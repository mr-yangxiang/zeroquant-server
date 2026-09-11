from __future__ import annotations

import json
import os
import ssl
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from .data import CODES, TZ, digest, normalize_record, session_minute, write_json
from ..news import _relation, classify_title


class TushareSource:
    """Authenticated provider API. No token -> explicit block, never sample data."""
    def __init__(self):
        self.token = os.getenv("TUSHARE_TOKEN","")
        if not self.token:
            raise ValueError("未配置 TUSHARE_TOKEN；分钟和新闻还需各自的数据权限")
        self.last_request = 0.

    def query(self,name,params,limit):
        time.sleep(max(0,1.1-(time.monotonic()-self.last_request)))
        self.last_request=time.monotonic()
        request=urllib.request.Request("https://api.tushare.pro",
            data=json.dumps({"api_name":name,"token":self.token,"params":params,"fields":""}).encode(),
            headers={"Content-Type":"application/json"},method="POST")
        from ..providers import HttpTransport
        with urllib.request.urlopen(request,timeout=20,context=HttpTransport().ssl_context) as response:
            result=json.load(response)
        if result.get("code") != 0:
            # Don't reflect vendor text that could contain a key/request.
            raise RuntimeError(f"Tushare {name} 请求失败，状态码 {result.get('code')}，请核对权限/额度")
        data=result.get("data") or {}
        rows=[dict(zip(data["fields"],row)) for row in data.get("items",[])]
        if len(rows)>=limit:
            raise ValueError(f"{name} 命中返回上限，禁止把截断数据视为完整窗口")
        return rows

    def daily_records(self,day,kinds=("minute","news","dragon_tiger","calendar")):
        stamp=day.strftime("%Y%m%d")
        output=[]
        if "calendar" in kinds:
            for r in self.query("trade_cal",{"exchange":"SSE","start_date":stamp,"end_date":stamp},6000):
                output.append({"kind":"calendar","stock_code":"MARKET","source":"tushare:trade_cal",
                    "event_at":datetime.combine(day,datetime.min.time(),TZ).isoformat(),
                    "payload":{"is_trading_day":bool(r["is_open"]),"exchange":r["exchange"]}})
        if "minute" in kinds:
            for code in CODES:
                symbol=code+(".SH" if code.startswith("6") else ".SZ")
                limits=self.query("stk_limit",{"ts_code":symbol,"trade_date":stamp},6000)
                limit=limits[0] if limits else {}
                bars=self.query("stk_mins",{"ts_code":symbol,"freq":"1min",
                    "start_date":f"{day} 09:30:00","end_date":f"{day} 15:00:00"},8000)
                for r in bars:
                    at=datetime.fromisoformat(r["trade_time"]).replace(tzinfo=TZ)
                    if session_minute(at) is None:
                        continue
                    output.append({"kind":"minute","stock_code":code,"source":"tushare:stk_mins",
                        "event_at":at.isoformat(),
                        "payload":{**{k:r[k] for k in ("open","high","low","close","amount")},
                                   "volume":r["vol"],"volume_unit":"shares","price_basis":"unadjusted",
                                   "upper_limit":limit.get("up_limit"),"lower_limit":limit.get("down_limit")}})
        if "dragon_tiger" in kinds:
            for r in self.query("top_inst",{"trade_date":stamp},10000):
                code=r["ts_code"].split(".")[0]
                if code not in CODES:
                    continue
                # Provider gives trade date, not release timestamp/rank. Keep raw
                # evidence with first receipt; never fabricate an exact disclosure.
                output.append({"kind":"dragon_tiger","stock_code":code,"source":"tushare:top_inst",
                    "event_at":f"{day}T15:00:00+08:00",
                    "payload":{"trade_date":str(day),"side":"BUY" if str(r["side"])=="0" else "SELL",
                               "seat_name":r["exalter"],"buy_amount":r["buy"],"sell_amount":r["sell"],
                               "net_amount":r["net_buy"],"reason":r["reason"],"time_semantics":"trade_date_only"}})
        if "news" in kinds:
            # Hour windows prevent the 1500-row truncation of a busy full day.
            for hour in range(24):
                start=datetime.combine(day,datetime.min.time())+timedelta(hours=hour)
                end=start+timedelta(hours=1)-timedelta(seconds=1)
                for r in self.query("news",{"src":"cls","start_date":str(start),"end_date":str(end)},1500):
                    text=f"{r.get('title','')} {r.get('content','')}"
                    for code in CODES:
                        relation=_relation(code,text)
                        if relation:
                            output.append({"kind":"news","stock_code":code,"source":"tushare:news:cls",
                                "event_at":datetime.fromisoformat(r["datetime"]).replace(tzinfo=TZ).isoformat(),
                                "payload":{"title":r.get("title") or r["content"][:150],"content":r.get("content",""),
                                           "sentiment":classify_title(text)[1],"relevance":relation[0],
                                           "time_semantics":"provider_published"}})
        return output


def backfill_tushare(start,end,output_dir:Path,warehouse=None,contracts=None,kinds=None):
    source=TushareSource()
    kinds=tuple(kinds or ("minute","news","dragon_tiger","calendar"))
    if start>end or end>datetime.now(TZ).date():
        raise ValueError("回填日期范围无效或包含未来日期")
    if any(kind not in ("minute","news","dragon_tiger","calendar") for kind in kinds):
        raise ValueError("此适配器仅支持分钟/新闻/龙虎榜/日历；Level-2 请使用授权导出导入")
    contracts=contracts or {}
    reports=[]
    day=start
    while day<=end:
        key=digest({"day":str(day),"kinds":kinds,"contracts":contracts})[:16]
        path=output_dir/f"tushare-{day}-{key}.json"
        if path.exists():
            saved=json.loads(path.read_text())
            # Replay persisted records to DB too: local download != DB receipt.
            # A newly connected warehouse retains explicit archived ingested_at.
            normalized=saved["records"]
        else:
            try:
                raw=source.daily_records(day,kinds)
                received=datetime.now(TZ)
                normalized=[normalize_record(r,received,contracts) for r in raw]
                write_json(path,{"records":normalized,"received_at":received.isoformat(),"kinds":kinds})
            except Exception as exc:
                reports.append({"day":str(day),"status":"FAILED","error":type(exc).__name__})
                # Stop on first failed window. Retry resumes from the unchanged day.
                break
        accepted=warehouse.ingest(normalized) if warehouse else 0
        reports.append({"day":str(day),"status":"DOWNLOADED","records":len(normalized),"inserted":accepted})
        day+=timedelta(days=1)
    report={"status":"COMPLETE" if day>end else "INCOMPLETE","windows":reports,
            "l2":"BLOCKED_REQUIRES_AUTHORIZED_VENDOR_EXPORT","source":"tushare",
            "availability":"first_receipt_unless_documented_contract",
            "scope":"fixed_six_stocks"}
    write_json(output_dir/"backfill-report.json",report)
    return report


def read_import(path:Path,contracts=None):
    received=datetime.now(TZ)
    # Entire batch validated before database writes.
    return [normalize_record(json.loads(line),received,contracts)
            for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def collect_public_recent(output_dir:Path,warehouse=None):
    """Capture real recent data with local first-observation time, never years."""
    from concurrent.futures import ThreadPoolExecutor,as_completed
    from ..config import STOCKS,Settings
    from ..news import NewsFusionClient
    from ..providers import HttpTransport
    settings=Settings.from_env()
    transport=HttpTransport(4)
    news=NewsFusionClient(transport,settings.state_dir/"news",
        announcement_cache_seconds=settings.news_cache_seconds,
        global_cache_seconds=settings.global_news_cache_seconds,
        global_lookback_hours=settings.global_news_lookback_hours,
        global_enabled=settings.global_news_enabled,google_rss_enabled=settings.google_news_rss_enabled,
        finnhub_api_key=settings.finnhub_api_key)
    def stock_capture(stock):
        raw=[]; errors=[]
        params=(f"secid={stock.secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8"
                "&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=5&iscr=0&iscca=0")
        try:
            data=transport.json("https://push2his.eastmoney.com/api/qt/stock/trends2/get?"+params).get("data") or {}
            now=datetime.now(TZ)
            for line in data.get("trends",[]):
                parts=line.split(",")
                if len(parts)<8:
                    continue
                at=datetime.fromisoformat(parts[0]).replace(tzinfo=TZ)
                if session_minute(at) is None or at>=now.replace(second=0,microsecond=0):
                    continue
                open_,close,high,low,vol,amount=map(float,parts[1:7])
                if min(open_,close,high,low)<=0:
                    continue
                # Eastmoney volume is lots. Validate scale against amount before
                # normalizing; a schema/unit change must fail visibly.
                if vol>0 and amount>0 and not .5 <= amount/(vol*100*close) <= 2:
                    raise ValueError("公开分钟源成交量单位与成交额不匹配")
                raw.append({"kind":"minute","stock_code":stock.code,"source":"eastmoney:recent_trends",
                            "event_at":at.isoformat(),"payload":{"open":open_,"close":close,"high":high,"low":low,
                            "volume":vol*100,"amount":amount,"volume_unit":"shares","price_basis":"unadjusted",
                            "time_semantics":"public_chart_minute_unverified_latency"}})
        except Exception as exc:
            errors.append({"source":"eastmoney:recent_trends","error_type":type(exc).__name__})
        try:
            events,flags=news.fetch(stock.code,datetime.now(TZ))
            errors.extend({"source":"news","flag":flag} for flag in flags if "unavailable" in flag)
            for e in events:
                if e.published_at:
                    raw.append({"kind":"news","stock_code":stock.code,"source":e.source,
                        "event_at":e.published_at.isoformat(),
                        "payload":{"title":e.title,"content":e.content,"url":e.url,"sentiment":e.sentiment,
                                   "relevance":e.relevance,"time_semantics":"provider_first_seen" if e.source.startswith("gdelt:") else "source_timestamp"}})
        except Exception as exc:
            errors.append({"source":"news","error_type":type(exc).__name__})
        received=datetime.now(TZ)
        normalized=[]
        for row in raw:
            try:
                normalized.append(normalize_record(row,received))
            except ValueError as exc:
                errors.append({"source":row["source"],"error":str(exc)})
        return normalized,errors
    records,errors=[],[]
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures={executor.submit(stock_capture,s):s for s in STOCKS}
        for f in as_completed(futures):
            batch,issues=f.result()
            records.extend(batch)
            errors.extend({"stock_code":futures[f].code,**item} for item in issues)
    records.sort(key=lambda r:(r["event_at"],r["record_hash"]))
    write_json(output_dir/"public-recent-records.json",records)
    accepted=warehouse.ingest(records) if warehouse else 0
    report={"status":"CAPTURED_RECENT_ONLY" if records else "BLOCKED_NO_SOURCE_DATA",
            "record_count":len(records),"inserted":accepted,"errors":errors,
            "limitations":["仅公开近期数据，不等于多年历史","没有已核验的历史可用时间",
                           "没有授权 Level-2","公开图表延迟未校准，不能直接用于可执行信号"]}
    write_json(output_dir/"public-capture-report.json",report)
    return report
