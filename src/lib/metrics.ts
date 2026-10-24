import "server-only";
import { cacheLife } from "next/cache";
import { loadTables, type CleaningLog } from "./supabase";

// 지표 정의
// - 전환 고객: 해지가 아닌(완료·진행중) 계약이 1건 이상인 고객
// - 분양률: 세대 마스터 status = 계약완료 비율
// - 계약 매출: 완료 계약의 계약 분양가 합(만원)

const VALID = new Set(["완료", "진행중"]);

const rate = (num: number, den: number) => (den ? num / den : 0);
const countBy = <T,>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return m;
};

function monthRange(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

export type Insight = {
  title: string;
  finding: string;
  evidence: { label: string; value: string }[];
  actions: string[];
};

export async function getDashboard() {
  "use cache";
  cacheLife("hours");

  const { units, customers, consultations, contracts, adSpend, cleaningLog } = await loadTables();

  // ── 고객 단위 집계 ───────────────────────────────────────────
  const converted = new Set(contracts.filter((c) => VALID.has(c.status)).map((c) => c.customer_id));
  const consultCount = countBy(consultations, (c) => c.customer_id);
  const conv = (ids: Iterable<string>) => {
    let n = 0;
    let hit = 0;
    for (const id of ids) {
      n += 1;
      if (converted.has(id)) hit += 1;
    }
    return { n, converted: hit, rate: rate(hit, n) };
  };
  const convByCustomerField = (field: "grade" | "interest_type" | "ad_channel") => {
    const groups = new Map<string, string[]>();
    for (const c of customers) {
      const k = c[field];
      if (!k) continue;
      groups.set(k, [...(groups.get(k) ?? []), c.customer_id]);
    }
    return [...groups].map(([key, ids]) => ({ key, ...conv(ids) }));
  };

  // ── KPI ─────────────────────────────────────────────────────
  const validContracts = contracts.filter((c) => VALID.has(c.status));
  const doneContracts = contracts.filter((c) => c.status === "완료");
  const soldUnits = units.filter((u) => u.status === "계약완료").length;
  const totalSpend = adSpend.reduce((s, a) => s + a.spend_10k_krw, 0);
  const totalLeads = adSpend.reduce((s, a) => s + a.leads, 0);
  const kpis = {
    customers: customers.length,
    consultations: consultations.length,
    validContracts: validContracts.length,
    conversionRate: rate(converted.size, customers.length),
    salesRate: rate(soldUnits, units.length),
    soldUnits,
    totalUnits: units.length,
    revenue10k: doneContracts.reduce((s, c) => s + (c.price_10k_krw ?? 0), 0),
    cancelRate: rate(contracts.filter((c) => c.status === "해지").length, contracts.length),
    cpl: rate(totalSpend * 10000, totalLeads),
  };

  // ── 월별 추이 ────────────────────────────────────────────────
  const dates = [...consultations.map((c) => c.consult_date), ...contracts.map((c) => c.contract_date)].sort();
  const months = monthRange(dates[0].slice(0, 7), dates[dates.length - 1].slice(0, 7));
  const consultByMonth = countBy(consultations, (c) => c.consult_date.slice(0, 7));
  const contractByMonth = countBy(validContracts, (c) => c.contract_date.slice(0, 7));
  const monthly = months.map((m) => ({
    month: m,
    consultations: consultByMonth.get(m) ?? 0,
    contracts: contractByMonth.get(m) ?? 0,
  }));

  // ── 영업 퍼널 ────────────────────────────────────────────────
  const consulted = new Set(consultations.map((c) => c.customer_id));
  const hopeful = new Set(consultations.filter((c) => c.outcome === "계약희망").map((c) => c.customer_id));
  const hopefulConverted = [...hopeful].filter((id) => converted.has(id));
  const done = new Set(doneContracts.map((c) => c.customer_id));
  const funnel = [
    { stage: "전체 고객", value: customers.length },
    { stage: "상담 이력 있음", value: consulted.size },
    { stage: "계약희망 표명", value: hopeful.size },
    { stage: "그중 유효 계약", value: hopefulConverted.length },
    { stage: "그중 계약 완료", value: hopefulConverted.filter((id) => done.has(id)).length },
  ];

  // ── 타입별 분양 현황 × 관심 고객 ─────────────────────────────
  const typeConv = new Map(convByCustomerField("interest_type").map((t) => [t.key, t]));
  const types = [...new Set(units.map((u) => u.type))]
    .map((type) => {
      const us = units.filter((u) => u.type === type);
      const sold = us.filter((u) => u.status === "계약완료").length;
      const tc = typeConv.get(type);
      return {
        type,
        units: us.length,
        sold,
        unsold: us.filter((u) => u.status === "미계약").length,
        salesRate: rate(sold, us.length),
        interested: tc?.n ?? 0,
        interestedConvRate: tc?.rate ?? 0,
      };
    })
    .sort((a, b) => b.salesRate - a.salesRate);

  // ── 광고 채널 효율 ───────────────────────────────────────────
  const channelConv = new Map(convByCustomerField("ad_channel").map((c) => [c.key, c]));
  const channels = [...new Set(adSpend.map((a) => a.channel))]
    .map((channel) => {
      const rows = adSpend.filter((a) => a.channel === channel);
      const spend10k = rows.reduce((s, a) => s + a.spend_10k_krw, 0);
      const leads = rows.reduce((s, a) => s + a.leads, 0);
      const cc = channelConv.get(channel);
      return {
        channel,
        spend10k,
        leads,
        cpl: rate(spend10k * 10000, leads),
        crmCustomers: cc?.n ?? 0,
        crmConverted: cc?.converted ?? 0,
        crmConvRate: cc?.rate ?? null,
        costPerConversion10k: cc?.converted ? spend10k / cc.converted : null,
      };
    })
    .sort((a, b) => a.cpl - b.cpl);

  // ── 상담 횟수 구간별 전환율 ──────────────────────────────────
  const bins = [
    { label: "0회", min: 0, max: 0 },
    { label: "1–2회", min: 1, max: 2 },
    { label: "3–4회", min: 3, max: 4 },
    { label: "5–6회", min: 5, max: 6 },
    { label: "7회 이상", min: 7, max: Infinity },
  ];
  const consultBins = bins.map((b) => ({
    label: b.label,
    ...conv(
      customers
        .filter((c) => {
          const n = consultCount.get(c.customer_id) ?? 0;
          return n >= b.min && n <= b.max;
        })
        .map((c) => c.customer_id),
    ),
  }));

  // ── 상담사별 전환율(담당한 고유 고객 기준) ───────────────────
  const byConsultant = new Map<string, Set<string>>();
  for (const c of consultations) {
    byConsultant.set(c.consultant, (byConsultant.get(c.consultant) ?? new Set()).add(c.customer_id));
  }
  const consultants = [...byConsultant]
    .map(([name, ids]) => ({ name, ...conv(ids) }))
    .sort((a, b) => b.rate - a.rate);

  const grades = convByCustomerField("grade").sort((a, b) => b.rate - a.rate);

  // ── 인사이트(발견 → 근거 → 액션). 수치는 모두 위 집계에서 계산 ──
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const pp = (a: number, b: number) => `${((a - b) * 100).toFixed(1)}%p`;
  const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
  const man = (v10k: number) => `${Math.round(v10k).toLocaleString("ko-KR")}만원`;

  const missedHope = hopeful.size - hopefulConverted.length;
  const worstType = types[types.length - 1];
  const channelsWithConv = channels.filter((c) => c.costPerConversion10k !== null);
  const bestCh = [...channelsWithConv].sort((a, b) => a.costPerConversion10k! - b.costPerConversion10k!)[0];
  const worstCh = [...channelsWithConv].sort((a, b) => b.costPerConversion10k! - a.costPerConversion10k!)[0];
  const binsWithData = consultBins.filter((b) => b.n >= 30);
  const peakBin = [...binsWithData].sort((a, b) => b.rate - a.rate)[0];
  const lastBin = consultBins[consultBins.length - 1];
  const topC = consultants[0];
  const lowC = consultants[consultants.length - 1];
  const vip = grades.find((g) => g.key === "VIP");
  const topGrade = grades[0];

  const insights: Insight[] = [
    {
      title: `계약희망 고객의 ${pct(rate(missedHope, hopeful.size))}가 아직 계약하지 않았다`,
      finding: `상담에서 '계약희망'을 밝힌 고객 ${hopeful.size}명 중 ${missedHope}명(${pct(
        rate(missedHope, hopeful.size),
      )})이 아직 유효 계약이 없습니다. 이미 구매 의사를 밝힌 고객이라 가장 확보하기 쉬운 매출입니다.`,
      evidence: [
        { label: "계약희망 표명 고객", value: `${hopeful.size}명` },
        { label: "그중 유효 계약", value: `${hopefulConverted.length}명 (${pct(rate(hopefulConverted.length, hopeful.size))})` },
        { label: "미전환 고객", value: `${missedHope}명` },
      ],
      actions: [
        "미전환 계약희망 고객을 '우선 콜 리스트'로 분리해 매주 상담사에게 배정",
        "계약희망 상담 후 7일 안에 계약 조건(계약금·대출) 안내를 재접촉 SLA로 지정",
      ],
    },
    {
      title: `${worstType.type} 타입은 관심 고객이 많은데 가장 안 팔린다`,
      finding: `${worstType.type} 분양률은 ${pct(worstType.salesRate)}로 전체 평균 ${pct(
        kpis.salesRate,
      )}보다 크게 낮습니다. 그런데 이 타입에 관심을 둔 고객은 ${worstType.interested}명이나 되고, 이들의 전환율은 ${pct(
        worstType.interestedConvRate,
      )}에 그칩니다. 수요는 있는데 계약 단계에서 막히고 있습니다.`,
      evidence: [
        { label: `${worstType.type} 분양률`, value: `${pct(worstType.salesRate)} (${worstType.sold}/${worstType.units}세대)` },
        { label: "전체 분양률", value: pct(kpis.salesRate) },
        { label: `${worstType.type} 관심 고객 / 전환율`, value: `${worstType.interested}명 / ${pct(worstType.interestedConvRate)}` },
      ],
      actions: [
        `${worstType.type} 관심 고객 대상으로 가격·옵션 맞춤 프로모션 진행 후 전환율 비교`,
        `${worstType.type} 거절·보류 상담 메모를 모아 가격·층향 중 무엇이 걸림돌인지 확인`,
      ],
    },
    {
      title: "광고는 리드 단가가 아니라 계약 1건당 비용으로 봐야 한다",
      finding: `리드당 비용(CPL)만 보면 채널 간 차이가 크지 않습니다. 그런데 고객명단에서 실제 계약까지 이어진 고객 수로 나누면, ${bestCh.channel}은 계약 1건당 약 ${man(
        bestCh.costPerConversion10k!,
      )}, ${worstCh.channel}은 약 ${man(worstCh.costPerConversion10k!)}로 차이가 벌어집니다. (24개월 광고비 ÷ 고객명단상 해당 경로 계약 고객 수로 추정)`,
      evidence: [
        { label: `${bestCh.channel} CPL / 계약 전환율`, value: `${won(bestCh.cpl)} / ${pct(bestCh.crmConvRate ?? 0)}` },
        { label: `${worstCh.channel} CPL / 계약 전환율`, value: `${won(worstCh.cpl)} / ${pct(worstCh.crmConvRate ?? 0)}` },
        {
          label: "계약 1건당 광고비",
          value: `${man(bestCh.costPerConversion10k!)} vs ${man(worstCh.costPerConversion10k!)} (${(
            worstCh.costPerConversion10k! / bestCh.costPerConversion10k!
          ).toFixed(1)}배)`,
        },
      ],
      actions: [
        `다음 분기 ${worstCh.channel} 예산 일부를 ${bestCh.channel}로 옮기고 계약 단가 변화를 추적`,
        "유입경로가 '광고'로만 적힌 고객이 매체별로 기록되도록 상담 입력 양식 수정",
      ],
    },
    {
      title: `상담은 ${peakBin.label}까지가 효과적이고, 그 뒤로는 전환율이 떨어진다`,
      finding: `상담 횟수별 전환율은 ${peakBin.label} 구간에서 ${pct(peakBin.rate)}로 가장 높고, ${lastBin.label} 구간은 ${pct(
        lastBin.rate,
      )}로 떨어집니다. 상담을 반복해도 결정을 못 하는 고객에게 같은 방식의 상담을 계속하는 것은 효율이 낮습니다.`,
      evidence: [
        { label: `${peakBin.label} 고객 전환율`, value: `${pct(peakBin.rate)} (n=${peakBin.n})` },
        { label: `${lastBin.label} 고객 전환율`, value: `${pct(lastBin.rate)} (n=${lastBin.n})` },
        { label: "차이", value: pp(peakBin.rate, lastBin.rate) },
      ],
      actions: [
        "상담 6회를 넘긴 고객은 팀장 동석 상담이나 조건 제시 같은 '결정 지원' 단계로 전환",
        "상담 횟수가 많은 고객 목록을 주간으로 뽑아 보류 사유별로 대응",
      ],
    },
    {
      title: `상담사에 따라 전환율이 최대 ${pp(topC.rate, lowC.rate)} 차이 난다`,
      finding: `담당 고객 기준 전환율이 가장 높은 ${topC.name}(${pct(topC.rate)})과 가장 낮은 ${lowC.name}(${pct(
        lowC.rate,
      )})의 차이가 ${pp(topC.rate, lowC.rate)}입니다. 고객을 무작위에 가깝게 배정한다고 보면 상담 방식의 차이일 수 있습니다.`,
      evidence: [
        { label: `최고 ${topC.name}`, value: `${pct(topC.rate)} (담당 ${topC.n}명)` },
        { label: `최저 ${lowC.name}`, value: `${pct(lowC.rate)} (담당 ${lowC.n}명)` },
        { label: "상담사 수", value: `${consultants.length}명` },
      ],
      actions: [
        "상위 상담사의 상담 스크립트·후속 연락 주기를 정리해 팀 전체에 공유",
        "하위 상담사는 상위 상담사와 2주간 페어 상담 후 전환율 재측정",
      ],
    },
    {
      title: "고객 등급이 실제 계약 가능성을 반영하지 못한다",
      finding: `VIP 고객의 전환율은 ${pct(vip?.rate ?? 0)}로, 가장 높은 ${topGrade.key} 등급(${pct(
        topGrade.rate,
      )})보다 낮습니다. 지금의 등급으로 상담 우선순위를 정하면 계약 가능성이 높은 고객을 놓칠 수 있습니다.`,
      evidence: grades.map((g) => ({ label: `${g.key} (n=${g.n})`, value: pct(g.rate) })),
      actions: [
        "등급을 상담 이력(횟수·계약희망 여부)과 예산을 반영한 계약가능성 점수로 재설계",
        "'관심고객' 등급의 정의를 정해 신규·일반 중 하나로 통일",
      ],
    },
  ];

  return {
    kpis,
    monthly,
    funnel,
    types,
    channels,
    consultBins,
    consultants,
    insights,
    cleaningLog: cleaningLog satisfies CleaningLog[],
    period: { from: months[0], to: months[months.length - 1] },
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
