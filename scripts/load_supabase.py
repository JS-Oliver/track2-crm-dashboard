"""data/clean/*.csv 와 처리로그를 Supabase REST(PostgREST)로 적재한다.

사용: py scripts/load_supabase.py <SUPABASE_URL> <API_KEY>
적재 중에만 crm_* 테이블에 insert 정책을 열어두고, 끝나면 정책을 제거한다.
"""
import json
import sys
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
URL, KEY = sys.argv[1].rstrip("/"), sys.argv[2]
INT_COLS = {"building", "floor", "area_m2", "price_10k_krw", "budget_10k_krw", "duration_min",
            "down_payment_10k_krw", "loan_amount_10k_krw", "spend_10k_krw", "impressions", "clicks", "leads", "count"}
TABLES = [("crm_units", "units"), ("crm_customers", "customers"), ("crm_ad_spend", "ad_spend"),
          ("crm_consultations", "consultations"), ("crm_contracts", "contracts")]


def records(df):
    out = []
    for r in df.to_dict("records"):
        out.append({k: (None if v == "" else int(v) if k in INT_COLS else v) for k, v in r.items()})
    return out


def post(table, rows):
    for start in range(0, len(rows), 500):
        body = json.dumps(rows[start:start + 500], ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(f"{URL}/rest/v1/{table}", data=body, method="POST", headers={
            "apikey": KEY, "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json", "Prefer": "return=minimal"})
        urllib.request.urlopen(req).read()
    print(f"{table}: {len(rows)}행 적재")


for table, name in TABLES:
    post(table, records(pd.read_csv(ROOT / f"data/clean/{name}.csv", dtype=str, keep_default_na=False)))

logs = []
for dataset in ["고객명단", "상담이력", "계약이력"]:
    log = pd.read_excel(ROOT / f"reports/정리결과_{dataset}.xlsx", sheet_name="처리로그", dtype=str).fillna("")
    log.columns = ["step", "description", "count"]
    log.insert(0, "dataset", dataset)
    logs.append(log)
post("crm_cleaning_log", records(pd.concat(logs)))
