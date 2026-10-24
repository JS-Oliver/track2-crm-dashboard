"""Track2 분양 CRM 데이터 정리 스크립트.

data/raw/*.csv  (원본 복사본, 수정하지 않음)
  -> data/clean/*.csv          DB 적재용 정리본 (UTF-8)
  -> reports/정리결과_*.xlsx    정리결과 / 이상치 / 검토필요 / 매핑표 / 처리로그 시트
  -> reports/처리로그.md        전체 요약

처리 원칙
- 마스터 테이블(고객)은 행을 빼지 않는다. 문제 값만 비우고 dq_flags 로 표시한다.
- 이력 테이블(상담·계약)은 행 자체가 성립하지 않는 경우(없는 ID 참조, 미래 날짜, 날짜 깨짐)
  본표에서 빼서 '이상치' 시트로 옮긴다. 값 하나만 이상하면 그 값만 비우고 행은 유지한다.
- 판단이 애매한 건은 임의로 확정하지 않고 '검토필요' 시트에 원본 값과 함께 남긴다.
"""
import re
from datetime import date
from pathlib import Path

import pandas as pd
from openpyxl.styles import Font, PatternFill

ROOT = Path(__file__).resolve().parent.parent
RAW, CLEAN, REPORTS = ROOT / "data/raw", ROOT / "data/clean", ROOT / "reports"
TODAY = date(2026, 10, 25)  # 작업 기준일: 이 날짜보다 뒤면 '미래 날짜'

CLEAN.mkdir(parents=True, exist_ok=True)
REPORTS.mkdir(parents=True, exist_ok=True)


def read_raw(name):
    df = pd.read_csv(RAW / f"{name}.csv", dtype=str, encoding="utf-8-sig", keep_default_na=False)
    df.insert(0, "원본행", range(2, len(df) + 2))  # 엑셀에서 연 원본 파일의 행 번호(헤더=1행)
    return df


def parse_date(s):
    """4가지 포맷을 YYYY-MM-DD 로 통일. (값, 문제사유) 반환."""
    s = s.strip()
    if m := re.fullmatch(r"(\d{4})[-/](\d{2})[-/](\d{2})", s):
        y, mo, d = m.groups()
    elif m := re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s):
        y, mo, d = m.groups()
    elif m := re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", s):
        # MM-DD-YYYY: 앞자리가 12를 넘는 값이 0건, 가운데가 12를 넘는 값이 다수 → 월-일-연 순서로 확정
        mo, d, y = m.groups()
    else:
        return None, "날짜 형식 깨짐"
    try:
        v = date(int(y), int(mo), int(d))
    except ValueError:
        return None, "존재하지 않는 날짜"
    if v > TODAY:
        return v.isoformat(), f"미래 날짜(기준일 {TODAY} 이후)"
    return v.isoformat(), None


def add_flag(df, mask, flag):
    df.loc[mask, "dq_flags"] = df.loc[mask, "dq_flags"].map(lambda f: f"{f}; {flag}" if f else flag)


def mapping_table(raw_series, mapped_series, field, notes=None):
    notes = notes or {}
    t = (pd.DataFrame({"원본값": raw_series, "표준값": mapped_series})
         .value_counts().reset_index(name="건수").sort_values(["표준값", "건수"], ascending=[True, False]))
    t.insert(0, "컬럼", field)
    t["원본값"] = t["원본값"].map(lambda v: f"'{v}'")  # 앞뒤 공백이 보이도록 따옴표 표시
    t["비고"] = t["표준값"].map(lambda v: notes.get(v, ""))
    return t


def write_book(path, sheets):
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        for name, df in sheets.items():
            (df if len(df) else pd.DataFrame({"내용": ["해당 없음"]})).to_excel(xw, sheet_name=name, index=False)
            ws = xw.sheets[name]
            ws.freeze_panes = "A2"
            for cell in ws[1]:
                cell.font = Font(bold=True)
                cell.fill = PatternFill("solid", fgColor="E8EEF7")
            for col in ws.columns:
                width = max(len(str(c.value or "")) for c in col[:200])
                ws.column_dimensions[col[0].column_letter].width = min(max(8, width * 1.6), 60)


def log_df(rows):
    df = pd.DataFrame(rows, columns=["단계", "내용", "건수"])
    df["건수"] = df["건수"].astype("Int64")
    return df


# ---------------------------------------------------------------------------
# 1. 고객명단
# ---------------------------------------------------------------------------
GRADE_MAP = {"VVIP": "VVIP", "VIP": "VIP", "vip": "VIP", "Vip": "VIP", "일반": "일반", "신규": "신규"}
GRADE_UNRESOLVED = {"관심고객"}  # 신규/일반 중 어디인지 원본만으로 판단 불가 → 값 유지 + 보고

REGION_MAP = {"서울시": "서울", "seoul": "서울", "Seoul": "서울", "부산시": "부산", "Busan": "부산",
              "경기도": "경기", "Gyeonggi": "경기"}
SIDO = {"서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원",
        "충북", "충남", "전북", "전남", "경북", "경남", "제주"}

LEAD_MAP = {"블로그": "블로그", "Blog": "블로그"}
# 유입경로 → ad_spend 채널 대응 (광고 성과 분석용). 확실하지 않은 대응은 비고에 '추정' 표기
AD_CHANNEL = {"블로그": "블로그", "SNS": "SNS광고", "광고(네이버)": "포털검색광고", "지인소개": "지인추천이벤트",
              "온라인전시관": "전시관행사", "방문": "", "전화문의": "", "광고": ""}
AD_CHANNEL_NOTE = {"전시관행사": "추정: 온라인전시관 ↔ 전시관행사", "포털검색광고": "추정: 네이버 = 포털검색",
                   "": "광고비 집행 채널 없음(방문·전화) 또는 매체 불명('광고')"}


def clean_name(s):
    return re.sub(r"\s*(고객님|님|씨)$", "", s.strip())


def clean_customers():
    raw = read_raw("customers_raw")
    df = raw.copy()
    df["dq_flags"] = ""
    log, review, anomalies = [], [], []
    log.append(("입력", "원본 행 수", len(raw)))

    # (2) 표기 통일
    df["name"] = df["name"].map(clean_name)
    log.append(("표기통일", "이름 앞뒤 공백·호칭(님/씨/고객님) 제거", int((df["name"] != raw["name"]).sum())))
    df["phone"] = df["phone"].str.replace(r"\D", "", regex=True)
    log.append(("표기통일", "연락처 숫자만 남김(하이픈·점·공백 제거)",
                int((df["phone"] != raw["phone"]).sum())))
    df["email"] = df["email"].str.strip()
    df["region"] = df["region"].str.strip().map(lambda v: REGION_MAP.get(v, v))
    log.append(("표기통일", "거주지역 시·도 표준명으로 통일(서울시/seoul/Seoul→서울 등)",
                int((df["region"] != raw["region"]).sum())))
    df["lead_source"] = df["lead_source"].str.strip().map(lambda v: LEAD_MAP.get(v, v))
    log.append(("표기통일", "유입경로 통일(블로그·'블로그 '·Blog→블로그)",
                int((df["lead_source"] != raw["lead_source"]).sum())))

    # (3) 등급 표준화
    g = df["grade"].str.strip()
    df["grade"] = g.map(lambda v: GRADE_MAP.get(v, v))
    log.append(("등급표준화", "VIP/vip/Vip→VIP, '일반 '/' 일반'→일반", int((df["grade"] != raw["grade"]).sum())))

    parsed = df["signup_date"].map(parse_date)
    df["signup_date"] = parsed.str[0]
    df["_date_issue"] = parsed.str[1]
    log.append(("표기통일", "가입일 YYYY-MM-DD 로 통일(YYYY/MM/DD·YYYYMMDD·MM-DD-YYYY)",
                int((df["signup_date"] != raw["signup_date"]).sum())))

    # (1) 중복 제거: 이름+연락처숫자 같으면 동일인. 원본은 같은 customer_id 끼리만 중복이 있음.
    df["_key"] = df["name"] + "|" + df["phone"]
    merged_rows, merge_cnt, same_id_diff_phone = [], 0, 0
    for cid, grp in df.groupby("customer_id", sort=False):
        if len(grp) == 1:
            merged_rows.append(grp.iloc[0].copy())
            continue
        grp = grp.sort_values("원본행")  # 가입일이 모두 같아 '가장 최근 행' = 파일상 뒤쪽 행
        base = grp.iloc[-1].copy()
        for _, other in grp.iloc[-2::-1].iterrows():
            for col in df.columns:
                if base[col] == "" and other[col] != "":
                    base[col] = other[col]
        phones = [p for p in grp["phone"].unique() if p]
        base["phone_alt"] = ", ".join(p for p in phones if p != base["phone"])
        merge_cnt += len(grp) - 1
        if grp["_key"].nunique() > 1:
            same_id_diff_phone += 1
            base["dq_flags"] = "동일ID·연락처상이 병합"
            for _, r in raw[raw["원본행"].isin(grp["원본행"])].iterrows():
                review.append({"사유": "같은 고객ID·이름·이메일인데 연락처가 다름 → 동일인으로 보고 병합(최근 행 연락처 유지, 다른 번호는 phone_alt)",
                               "판단포인트": "번호 변경이면 정상 병합 / 다른 사람이면 ID 분리 필요",
                               "customer_id": cid, **{f"원본_{k}": v for k, v in r.items()}})
        else:
            base["dq_flags"] = "완전중복 병합"
        merged_rows.append(base)
    df = pd.DataFrame(merged_rows).reset_index(drop=True)
    df["phone_alt"] = df.get("phone_alt", "").fillna("")
    cross = df[df["phone"] != ""].groupby("_key")["customer_id"].nunique()
    log.append(("중복제거", "같은 customer_id 그룹 병합(가장 최근 행 기준, 빈 칸은 다른 행 값으로 채움)", merge_cnt))
    log.append(("중복제거", " └ 그중 연락처가 서로 달라 검토필요로 보고한 고객 수", same_id_diff_phone))
    log.append(("중복제거", "서로 다른 ID인데 이름+연락처가 같은 그룹(추가 병합 대상)", int((cross > 1).sum())))

    # (4) 이상치: 마스터라 행은 유지하고 플래그 + 이상치 시트로 분리
    rawidx = raw.set_index("원본행")

    def anomaly(mask, reason, field, action):
        for _, r in df[mask].iterrows():
            anomalies.append({"사유": reason, "처리": action, "customer_id": r["customer_id"],
                              "원본행": r["원본행"], "컬럼": field, "원본값": rawidx.loc[r["원본행"], field],
                              "정리후값": r[field] if action.startswith("값 유지") else ""})
        add_flag(df, mask, reason)

    bad_phone = (df["phone"] != "") & ~df["phone"].str.fullmatch(r"010\d{8}")
    anomaly(bad_phone, "연락처 자릿수/형식 오류", "phone", "값 유지, 플래그")
    log.append(("이상치", "연락처 자릿수·형식 오류(010+8자리 아님)", int(bad_phone.sum())))

    future = df["_date_issue"].notna()
    anomaly(future, "가입일 미래/형식오류", "signup_date", "값 유지, 플래그")
    log.append(("이상치", f"가입일이 기준일({TODAY}) 이후이거나 형식 깨짐", int(future.sum())))

    budget = pd.to_numeric(df["budget_10k_krw"], errors="coerce")
    bad_budget = (budget <= 0) | (budget >= 500000) | budget.isna()
    anomaly(bad_budget, "예산 이상치(-1 / 999999 등 입력 불가값)", "budget_10k_krw", "값 비움(NULL)")
    df.loc[bad_budget, "budget_10k_krw"] = ""
    log.append(("이상치", "예산 -1·999999(5억 이상/0 이하) → 값 비움", int(bad_budget.sum())))

    # 검토필요: 매핑을 확정하지 않은 값
    for mask, why, point in [
        (df["grade"].isin(GRADE_UNRESOLVED), "등급 '관심고객': VIP/일반/신규 중 어디인지 판단 불가 → 원본값 유지",
         "신규로 볼지, 별도 등급으로 둘지 결정 필요"),
        (df["lead_source"] == "광고", "유입경로 '광고': 어떤 광고 매체인지 불명 → 광고채널 매핑 안 함",
         "포털/SNS/옥외 중 하나로 볼 근거가 있으면 알려주세요"),
    ]:
        add_flag(df, mask, why.split(":")[0])
        for _, r in df[mask].iterrows():
            review.append({"사유": why, "판단포인트": point, "customer_id": r["customer_id"],
                           **{f"원본_{k}": v for k, v in rawidx.loc[[r["원본행"]]].reset_index().iloc[0].items()}})
    log.append(("검토필요", "같은 ID인데 연락처가 달라 병합한 고객(원본 2행씩 보고)", same_id_diff_phone))
    log.append(("검토필요", "등급 '관심고객' — 매핑 미확정, 원본값 유지", int(df["grade"].isin(GRADE_UNRESOLVED).sum())))
    log.append(("검토필요", "유입경로 '광고' — 매체 불명, 광고채널 매핑 안 함", int((df["lead_source"] == "광고").sum())))
    unknown_region = ~df["region"].isin(SIDO)
    add_flag(df, unknown_region, "지역 검토필요")

    df["ad_channel"] = df["lead_source"].map(AD_CHANNEL).fillna("")
    miss_phone, miss_email = int((df["phone"] == "").sum()), int((df["email"] == "").sum())
    add_flag(df, df["phone"] == "", "연락처 결측")
    add_flag(df, df["email"] == "", "이메일 결측")
    log.append(("결측", "연락처 결측(채우지 않고 플래그)", miss_phone))
    log.append(("결측", "이메일 결측(채우지 않고 플래그)", miss_email))
    log.append(("표기통일", "거주지역 시·도로 판단 불가(검토필요)", int(unknown_region.sum())))
    log.append(("참고", "원본 지역이 시·도 단위뿐이라 시·군·구 레벨 통일은 불가 → 시·도 표준명으로 통일", None))
    log.append(("결과", f"원본 {len(raw)}행 → 정리 {len(df)}행", len(df)))

    cols = ["customer_id", "name", "phone", "phone_alt", "email", "grade", "lead_source", "ad_channel",
            "interest_type", "signup_date", "region", "budget_10k_krw", "status", "dq_flags"]
    out = df[cols].sort_values("customer_id").reset_index(drop=True)
    out.to_csv(CLEAN / "customers.csv", index=False, encoding="utf-8")

    maps = pd.concat([
        mapping_table(raw["grade"], raw["grade"].str.strip().map(lambda v: GRADE_MAP.get(v, v)), "grade",
                      {"관심고객": "미확정 — 검토필요 보고", "VVIP": "VIP와 별도 상위등급으로 유지"}),
        mapping_table(raw["region"], raw["region"].str.strip().map(lambda v: REGION_MAP.get(v, v)), "region"),
        mapping_table(raw["lead_source"], raw["lead_source"].str.strip().map(lambda v: LEAD_MAP.get(v, v)), "lead_source",
                      {"광고": "매체 불명 — 검토필요 보고"}),
        mapping_table(df["lead_source"], df["ad_channel"].replace("", "(매핑 없음)"), "lead_source→ad_channel",
                      {**{k: v for k, v in AD_CHANNEL_NOTE.items() if k}, "(매핑 없음)": AD_CHANNEL_NOTE[""]}),
    ])
    sheets = {"정리결과": out, "이상치": pd.DataFrame(anomalies), "검토필요": pd.DataFrame(review),
              "매핑표": maps, "처리로그": log_df(log)}
    write_book(REPORTS / "정리결과_고객명단.xlsx", sheets)
    return out, sheets


# ---------------------------------------------------------------------------
# 2. 상담 이력
# ---------------------------------------------------------------------------
CHANNEL_MAP = {"전화": "전화", "Phone": "전화", "phone": "전화", "방문": "방문", "방문상담": "방문",
               "SNS": "SNS", "온라인": "온라인"}


def clean_consultations(customer_ids, unit_ids):
    raw = read_raw("consultations_raw")
    df = raw.copy()
    df["dq_flags"] = ""
    log, review, anomalies = [("입력", "원본 행 수", len(raw))], [], []

    df["channel"] = df["channel"].str.strip().map(lambda v: CHANNEL_MAP.get(v, v))
    log.append(("표기통일", "채널 통일(전화/'전화 '/Phone/phone→전화, 방문상담→방문)",
                int((df["channel"] != raw["channel"]).sum())))
    df["outcome"] = df["outcome"].str.strip()
    log.append(("표기통일", "상담결과 앞뒤 공백 제거('계약희망 '→계약희망)", int((df["outcome"] != raw["outcome"]).sum())))
    df["notes"] = df["notes"].str.strip()
    parsed = df["consult_date"].map(parse_date)
    df["consult_date"], df["_date_issue"] = parsed.str[0], parsed.str[1]
    log.append(("표기통일", "상담일 YYYY-MM-DD 로 통일", int((df["consult_date"] != raw["consult_date"]).sum())))

    # 행 단위 이상치 → 본표에서 제외
    reasons = pd.Series("", index=df.index)
    for mask, why in [(~df["customer_id"].isin(customer_ids), "고객명단에 없는 customer_id"),
                      (~df["unit_id"].isin(unit_ids), "세대 마스터에 없는 unit_id"),
                      (df["_date_issue"].notna(), None)]:
        why_s = df["_date_issue"].fillna("") if why is None else pd.Series(why, index=df.index)
        reasons[mask] = (reasons[mask] + "; " + why_s[mask]).str.lstrip("; ")
        log.append(("이상치(행 제외)", why or f"상담일 미래(기준일 {TODAY} 이후)·형식오류", int(mask.sum())))
    drop = reasons != ""
    for i in df[drop].index:
        anomalies.append({"사유": reasons[i], "처리": "본표 제외", **raw.loc[i].to_dict()})
    log.append(("이상치(행 제외)", "위 사유 중 1개 이상 해당 → 본표에서 제외(중복 해당 포함 실제 행 수)", int(drop.sum())))
    df = df[~drop].copy()

    # 값 단위 이상치 → 값만 비우고 행 유지
    dur = pd.to_numeric(df["duration_min"], errors="coerce")
    bad = dur <= 0
    for i in df[bad].index:
        anomalies.append({"사유": f"상담시간 {raw.loc[i, 'duration_min']}분(0 이하)", "처리": "값 비움(행 유지)",
                          **raw.loc[i].to_dict()})
    add_flag(df, bad, "상담시간 0이하")
    long = dur >= 240
    for i in df[long].index:
        review.append({"사유": "상담시간 240분: 일반 상담(10~90분) 대비 극단값. 입력 오류로 보고 값 비움",
                       "판단포인트": "장시간 현장 방문상담이면 정상 → 값 복원", "처리": "값 비움(행 유지)",
                       **raw.loc[i].to_dict()})
    add_flag(df, long, "상담시간 240분(검토)")
    df.loc[bad | long, "duration_min"] = ""
    log.append(("이상치(값 비움)", "상담시간 음수·0분 → 값 비움", int(bad.sum())))
    log.append(("검토필요(값 비움)", "상담시간 240분 → 값 비움, 원본은 검토필요 시트", int(long.sum())))
    log.append(("결측", "상담메모 비어있음(그대로 둠)", int((df["notes"] == "").sum())))
    log.append(("결과", f"원본 {len(raw)}행 → 정리 {len(df)}행 (제외 {int(drop.sum())}행)", len(df)))

    cols = ["consult_id", "customer_id", "unit_id", "consultant", "channel", "consult_date",
            "duration_min", "outcome", "notes", "dq_flags"]
    out = df[cols].reset_index(drop=True)
    out.to_csv(CLEAN / "consultations.csv", index=False, encoding="utf-8")
    maps = pd.concat([mapping_table(raw["channel"], raw["channel"].str.strip().map(lambda v: CHANNEL_MAP.get(v, v)), "channel"),
                      mapping_table(raw["outcome"], raw["outcome"].str.strip(), "outcome")])
    sheets = {"정리결과": out, "이상치": pd.DataFrame(anomalies), "검토필요": pd.DataFrame(review),
              "매핑표": maps, "처리로그": log_df(log)}
    write_book(REPORTS / "정리결과_상담이력.xlsx", sheets)
    return out, sheets


# ---------------------------------------------------------------------------
# 3. 계약 이력
# ---------------------------------------------------------------------------
STATUS_MAP = {"완료": "완료", "complete": "완료", "Completed": "완료", "진행중": "진행중", "해지": "해지"}


def clean_contracts(customers, units):
    raw = read_raw("contracts_raw")
    df = raw.copy()
    df["dq_flags"] = ""
    log, review, anomalies = [("입력", "원본 행 수", len(raw))], [], []

    df["status"] = df["status"].str.strip().map(lambda v: STATUS_MAP.get(v, v))
    log.append(("표기통일", "상태 통일(완료/'완료 '/complete/Completed→완료)", int((df["status"] != raw["status"]).sum())))
    parsed = df["contract_date"].map(parse_date)
    df["contract_date"], df["_date_issue"] = parsed.str[0], parsed.str[1]
    log.append(("표기통일", "계약일 YYYY-MM-DD 로 통일", int((df["contract_date"] != raw["contract_date"]).sum())))

    orphan = ~df["customer_id"].isin(customers["customer_id"]) | ~df["unit_id"].isin(units["unit_id"])
    log.append(("참조검증", "고객·세대 마스터에 없는 ID", int(orphan.sum())))
    drop = df["_date_issue"].notna() | orphan
    for i in df[drop].index:
        anomalies.append({"사유": df.loc[i, "_date_issue"] or "없는 ID 참조", "처리": "본표 제외", **raw.loc[i].to_dict()})
    log.append(("이상치(행 제외)", f"계약일 미래(기준일 {TODAY} 이후)·형식오류", int(drop.sum())))
    df = df[~drop].copy()

    price = pd.to_numeric(df["price_10k_krw"], errors="coerce")
    zero = price <= 0
    for i in df[zero].index:
        anomalies.append({"사유": "분양가 0원(계약금·대출도 0)", "처리": "금액 3개 값 비움(행 유지)", **raw.loc[i].to_dict()})
    df.loc[zero, ["price_10k_krw", "down_payment_10k_krw", "loan_amount_10k_krw"]] = ""
    add_flag(df, zero, "분양가 0원")
    log.append(("이상치(값 비움)", "분양가 0원 → 분양가·계약금·대출 값 비움", int(zero.sum())))

    loan_missing = (df["loan_amount_10k_krw"] == "") & ~zero
    add_flag(df, loan_missing, "대출금액 결측")
    log.append(("결측", "대출금액 결측(임의로 채우지 않음 — 0원과 구분)", int(loan_missing.sum())))

    # 검토필요
    p = pd.to_numeric(df["price_10k_krw"], errors="coerce")
    dp = pd.to_numeric(df["down_payment_10k_krw"], errors="coerce")
    ln = pd.to_numeric(df["loan_amount_10k_krw"], errors="coerce")
    over = (dp + ln.fillna(0)) > p
    for i in df[over].index:
        review.append({"사유": "계약금+대출 > 분양가", "판단포인트": "금액 입력 오류 여부", **raw.loc[i].to_dict()})
    add_flag(df, over, "계약금+대출>분양가")
    log.append(("검토필요", "계약금+대출금액이 분양가보다 큼", int(over.sum())))

    signup = df["customer_id"].map(customers.set_index("customer_id")["signup_date"])
    before = df["contract_date"] < signup
    for i in df[before].index:
        review.append({"사유": "계약일이 고객 가입일보다 빠름", "판단포인트": "가입일 또는 계약일 오기 여부",
                       "고객가입일(정리후)": signup[i], **raw.loc[i].to_dict()})
    add_flag(df, before, "계약일<가입일")
    log.append(("검토필요", "계약일이 고객 가입일보다 빠름", int(before.sum())))

    live = df[df["status"] != "해지"]
    multi = live.groupby("unit_id")["contract_id"].transform("count") > 1
    multi_ids = set(live[multi]["contract_id"])
    for i in df[df["contract_id"].isin(multi_ids)].sort_values(["unit_id", "contract_date"]).index:
        review.append({"사유": "같은 세대에 해지되지 않은 계약이 2건 이상", "판단포인트": "실제 유효 계약 1건 확인 필요(이중계약 불가)",
                       **raw.loc[i].to_dict()})
    add_flag(df, df["contract_id"].isin(multi_ids), "세대 중복계약")
    log.append(("검토필요", f"한 세대에 유효(완료·진행중) 계약 2건 이상 — 세대 {live[multi]['unit_id'].nunique()}개",
                len(multi_ids)))

    ratio = (p / df["unit_id"].map(units.set_index("unit_id")["price_10k_krw"].astype(float))).median()
    log.append(("참고", f"계약 분양가가 세대 마스터 분양가의 약 {ratio:.0%} 수준(단위 불일치 가능) — 매출 지표는 계약 분양가 기준 사용", None))
    log.append(("결과", f"원본 {len(raw)}행 → 정리 {len(df)}행 (제외 {int(drop.sum())}행)", len(df)))

    cols = ["contract_id", "customer_id", "unit_id", "contract_date", "price_10k_krw", "down_payment_10k_krw",
            "loan_amount_10k_krw", "status", "sales_rep", "dq_flags"]
    out = df[cols].reset_index(drop=True)
    out.to_csv(CLEAN / "contracts.csv", index=False, encoding="utf-8")
    maps = mapping_table(raw["status"], raw["status"].str.strip().map(lambda v: STATUS_MAP.get(v, v)), "status")
    sheets = {"정리결과": out, "이상치": pd.DataFrame(anomalies), "검토필요": pd.DataFrame(review),
              "매핑표": maps, "처리로그": log_df(log)}
    write_book(REPORTS / "정리결과_계약이력.xlsx", sheets)
    return out, sheets


# ---------------------------------------------------------------------------
# 4. 정돈된 파일(units, ad_spend): 검증만 하고 복사
# ---------------------------------------------------------------------------
def check_tidy():
    units = read_raw("units").drop(columns="원본행")
    ad = read_raw("ad_spend").drop(columns="원본행")
    n = lambda s: pd.to_numeric(s, errors="coerce")
    checks = [
        ("units", "unit_id 중복", int(units["unit_id"].duplicated().sum())),
        ("units", "가격 0 이하/숫자 아님", int((n(units["price_10k_krw"]).fillna(0) <= 0).sum())),
        ("units", "동+층+호 중복", int(units.duplicated(["building", "floor", "unit_no"]).sum())),
        ("units", "타입 숫자와 면적 차이 2㎡ 초과",
         int(((units["type"].str.extract(r"(\d+)")[0].astype(int) - n(units["area_m2"])).abs() > 2).sum())),
        ("ad_spend", "월×채널 중복", int(ad.duplicated(["month", "channel"]).sum())),
        ("ad_spend", "클릭 > 노출", int((n(ad["clicks"]) > n(ad["impressions"])).sum())),
        ("ad_spend", "리드 > 클릭", int((n(ad["leads"]) > n(ad["clicks"])).sum())),
        ("ad_spend", "음수 값", int((ad[["spend_10k_krw", "impressions", "clicks", "leads"]].apply(n) < 0).sum().sum())),
    ]
    units.to_csv(CLEAN / "units.csv", index=False, encoding="utf-8")
    ad.to_csv(CLEAN / "ad_spend.csv", index=False, encoding="utf-8")
    return units, ad, checks


def main():
    units, ad, checks = check_tidy()
    customers, cs = clean_customers()
    consults, ss = clean_consultations(set(customers["customer_id"]), set(units["unit_id"]))
    contracts, ks = clean_contracts(customers, units)

    md = [f"# 데이터 정리 처리로그\n\n- 작업 기준일: {TODAY} (이후 날짜는 '미래 날짜'로 처리)",
          "- 원본은 `data/raw/` 에 복사본으로 보존, 정리본은 `data/clean/`, 시트별 상세는 `reports/정리결과_*.xlsx`\n",
          "## 요약\n", "| 파일 | 원본 | 정리 | 이상치 시트 | 검토필요 시트 |", "|---|---:|---:|---:|---:|"]
    for name, rawname, (out, sh) in [("고객명단", "customers_raw", (customers, cs)),
                                    ("상담이력", "consultations_raw", (consults, ss)),
                                    ("계약이력", "contracts_raw", (contracts, ks))]:
        md.append(f"| {name} | {len(read_raw(rawname))} | {len(out)} | {len(sh['이상치'])} | {len(sh['검토필요'])} |")
    md.append(f"| 세대(units) | {len(units)} | {len(units)} | - | - |")
    md.append(f"| 광고비(ad_spend) | {len(ad)} | {len(ad)} | - | - |\n")
    for name, sh in [("고객명단", cs), ("상담이력", ss), ("계약이력", ks)]:
        md += [f"## {name}\n", "| 단계 | 내용 | 건수 |", "|---|---|---:|"]
        md += [f"| {a} | {b} | {'' if pd.isna(c) else c} |" for a, b, c in sh["처리로그"].itertuples(index=False)]
        md.append("")
    md += ["## 정돈된 파일 검증 (units / ad_spend)\n", "| 파일 | 점검 항목 | 위반 건수 |", "|---|---|---:|"]
    md += [f"| {a} | {b} | {c} |" for a, b, c in checks]
    (REPORTS / "처리로그.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
