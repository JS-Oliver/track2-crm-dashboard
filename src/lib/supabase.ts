import "server-only";

// Supabase REST(PostgREST) 조회. 공개 키에는 crm_* 테이블 SELECT 권한만 있고,
// 고객 이름·연락처·이메일 컬럼은 권한이 없으므로 select 컬럼을 명시한다.

export type Unit = {
  unit_id: string;
  building: number;
  floor: number;
  type: string;
  price_10k_krw: number;
  status: string;
};

export type Customer = {
  customer_id: string;
  grade: string;
  lead_source: string;
  ad_channel: string | null;
  interest_type: string;
  region: string;
  status: string;
};

export type Consultation = {
  consult_id: string;
  customer_id: string;
  consultant: string;
  channel: string;
  consult_date: string;
  duration_min: number | null;
  outcome: string;
};

export type Contract = {
  contract_id: string;
  customer_id: string;
  unit_id: string;
  contract_date: string;
  price_10k_krw: number | null;
  status: string;
  sales_rep: string;
};

export type AdSpend = {
  month: string;
  channel: string;
  spend_10k_krw: number;
  impressions: number;
  clicks: number;
  leads: number;
};

export type CleaningLog = {
  id: number;
  dataset: string;
  step: string;
  description: string;
  count: number | null;
};

const PAGE = 1000; // PostgREST 기본 최대 행 수

async function selectAll<T>(table: string, columns: string, order: string): Promise<T[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 환경변수가 없습니다.");

  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${columns}&order=${order}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`${table} 조회 실패: ${res.status} ${await res.text()}`);
    const page: T[] = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function loadTables() {
  const [units, customers, consultations, contracts, adSpend, cleaningLog] = await Promise.all([
    selectAll<Unit>("crm_units", "unit_id,building,floor,type,price_10k_krw,status", "unit_id"),
    selectAll<Customer>(
      "crm_customers",
      "customer_id,grade,lead_source,ad_channel,interest_type,region,status",
      "customer_id",
    ),
    selectAll<Consultation>(
      "crm_consultations",
      "consult_id,customer_id,consultant,channel,consult_date,duration_min,outcome",
      "consult_id",
    ),
    selectAll<Contract>(
      "crm_contracts",
      "contract_id,customer_id,unit_id,contract_date,price_10k_krw,status,sales_rep",
      "contract_id",
    ),
    selectAll<AdSpend>("crm_ad_spend", "*", "month,channel"),
    selectAll<CleaningLog>("crm_cleaning_log", "*", "id"),
  ]);
  return { units, customers, consultations, contracts, adSpend, cleaningLog };
}
