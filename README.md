# 분양 CRM 대시보드 (Track 2)

고객·세대·상담·계약·광고 원본 데이터를 정리해 Supabase에 적재하고, 핵심 지표·시각화·인사이트를 담은 대시보드로 배포하는 프로젝트입니다. 모든 데이터는 실습용 합성 데이터입니다.

## 구성

| 경로 | 내용 |
|---|---|
| `data/raw/` | 원본 CSV 복사본(수정하지 않음) |
| `scripts/clean.py` | 정리 스크립트 — 중복·표기 불일치·결측·이상치 처리 |
| `data/clean/` | 정리된 CSV (DB 적재용) |
| `reports/정리결과_*.xlsx` | 파일별 정리결과 / 이상치 / 검토필요 / 매핑표 / 처리로그 시트 |
| `reports/처리로그.md` | 전체 처리 요약 |
| `scripts/load_supabase.py` | 정리본을 Supabase REST로 적재 |
| `supabase/README.md` | 테이블·권한 구성과 마이그레이션 기록 |
| `src/` | Next.js 대시보드 |

## 대시보드

- **핵심 지표**: 분양률, 고객 계약 전환율, 완료 계약 매출, 유효 계약·해지율, 광고 리드당 비용
- **시각화**: 월별 상담·계약 추이, 영업 퍼널, 타입별 분양률, 광고 채널 CPL × 전환율, 상담 횟수별 전환율, 상담사별 전환율 (모든 차트에 표 보기 제공)
- **인사이트**: 발견 → 근거 데이터 → 제안 액션 3단 구조, 수치는 Supabase 데이터에서 계산
- **데이터 정리 요약**: 처리로그 테이블(`crm_cleaning_log`) 기반

데이터는 서버에서 Supabase REST로 읽고(`use cache`, 1시간 재검증), 클라이언트에는 집계값만 전달합니다. 공개 키에는 `crm_*` 테이블 읽기 권한만 있고 고객 이름·연락처·이메일 컬럼은 조회할 수 없습니다.

## 실행

```bash
cp .env.example .env.local   # SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY 입력
npm install
npm run dev
```

데이터 정리를 다시 돌리려면 Python 3 + pandas, openpyxl 이 필요합니다.

```bash
py -X utf8 scripts/clean.py
```

## 배포 (Vercel)

환경변수 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` 를 Vercel 프로젝트에 등록한 뒤 GitHub 저장소를 연결하면 됩니다.
