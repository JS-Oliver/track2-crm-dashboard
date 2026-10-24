# Supabase 적재 기록

- 프로젝트: `JSO's Project` (wymbtosqaxdzvjlecogs, ap-southeast-1)
- 기존 리버파크 테이블(customers/units/…)과 섞이지 않도록 `crm_` 접두어 테이블 사용

| 테이블 | 행 수 | 원본 |
|---|---:|---|
| crm_units | 220 | data/clean/units.csv |
| crm_customers | 600 | data/clean/customers.csv |
| crm_consultations | 2,199 | data/clean/consultations.csv |
| crm_contracts | 330 | data/clean/contracts.csv |
| crm_ad_spend | 144 | data/clean/ad_spend.csv |
| crm_cleaning_log | 42 | reports/정리결과_*.xlsx 처리로그 시트 |

## 적용한 마이그레이션 (순서대로)
1. `track2_crm_tables` — 테이블·PK·FK·인덱스 생성, RLS 활성화
2. `track2_temp_load_policies` — 적재용 anon insert 임시 정책 (적재 후 3번에서 제거)
3. `track2_readonly_access` — 임시 정책 제거, 쓰기 권한 회수, anon/authenticated 는 SELECT 만 허용
   - `crm_customers` 의 name·phone·phone_alt·email 은 공개 API 로 조회 불가(컬럼 권한 미부여)

## 재적재
`py -X utf8 scripts/load_supabase.py <URL> <KEY>` — 2번 정책을 다시 연 상태에서만 동작
