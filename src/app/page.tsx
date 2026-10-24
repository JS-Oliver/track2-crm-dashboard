import type { ReactNode } from "react";
import { BarList, Columns, Funnel, LineChart, Scatter } from "@/components/charts";
import { getDashboard, type Dashboard } from "@/lib/metrics";

const fmt = (v: number) => v.toLocaleString("ko-KR");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const eok = (v10k: number) => `${(v10k / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;

function Card({
  title,
  subtitle,
  children,
  table,
  wide,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  table: { head: string[]; rows: (string | number)[][] };
  wide?: boolean;
}) {
  return (
    <section className={`card ${wide ? "card-wide" : ""}`}>
      <header>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>
      {children}
      <details className="table-view">
        <summary>표로 보기</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Kpis({ k }: { k: Dashboard["kpis"] }) {
  const tiles = [
    { label: "고객 계약 전환율", value: pct(k.conversionRate), note: "유효 계약(완료·진행중)이 있는 고객 비율" },
    { label: "완료 계약 매출", value: eok(k.revenue10k), note: "계약 분양가 합계" },
    { label: "유효 계약", value: `${fmt(k.validContracts)}건`, note: `해지율 ${pct(k.cancelRate)}` },
    { label: "광고 리드당 비용", value: `${fmt(Math.round(k.cpl))}원`, note: "24개월 · 6개 채널 평균" },
  ];
  return (
    <section className="kpis" aria-label="핵심 지표">
      <div className="kpi kpi-hero">
        <span className="kpi-label">분양률</span>
        <span className="kpi-value">{pct(k.salesRate)}</span>
        <span className="kpi-note">
          {k.soldUnits} / {k.totalUnits}세대 계약완료
        </span>
        <span className="meter" aria-hidden>
          <span style={{ width: `${k.salesRate * 100}%` }} />
        </span>
      </div>
      {tiles.map((t) => (
        <div className="kpi" key={t.label}>
          <span className="kpi-label">{t.label}</span>
          <span className="kpi-value">{t.value}</span>
          <span className="kpi-note">{t.note}</span>
        </div>
      ))}
    </section>
  );
}

function Charts({ d }: { d: Dashboard }) {
  const worstType = d.types[d.types.length - 1].type;
  const topC = d.consultants[0].name;
  const lowC = d.consultants[d.consultants.length - 1].name;
  const scatter = d.channels
    .filter((c) => c.crmConvRate !== null)
    .map((c) => ({
      label: c.channel,
      x: c.cpl,
      y: c.crmConvRate!,
      detail: `고객명단 ${c.crmCustomers}명 중 ${c.crmConverted}명 계약`,
    }));
  const noConv = d.channels.filter((c) => c.crmConvRate === null).map((c) => c.channel);

  return (
    <div className="chart-grid">
      <Card
        wide
        title="월별 상담·유효 계약 추이"
        subtitle={`${d.period.from} ~ ${d.period.to}. 두 지표는 규모가 달라 따로 그렸습니다.`}
        table={{
          head: ["월", "상담(건)", "유효 계약(건)"],
          rows: d.monthly.map((m) => [m.month, m.consultations, m.contracts]),
        }}
      >
        <div className="multiples">
          <div>
            <h4>상담 건수</h4>
            <LineChart points={d.monthly.map((m) => ({ x: m.month, y: m.consultations }))} unit="건" />
          </div>
          <div>
            <h4>유효 계약 건수</h4>
            <LineChart points={d.monthly.map((m) => ({ x: m.month, y: m.contracts }))} unit="건" />
          </div>
        </div>
      </Card>

      <Card
        title="영업 퍼널"
        subtitle="고객 → 상담 → 계약희망 → 계약. 오른쪽 %는 이전 단계 대비 비율입니다."
        table={{
          head: ["단계", "고객 수", "이전 단계 대비"],
          rows: d.funnel.map((f, i) => [f.stage, f.value, i ? pct(f.value / d.funnel[i - 1].value) : "-"]),
        }}
      >
        <Funnel stages={d.funnel} />
      </Card>

      <Card
        title="타입별 분양률"
        subtitle={`세대 마스터 기준. 강조한 막대는 분양률이 가장 낮은 ${worstType}입니다.`}
        table={{
          head: ["타입", "세대", "계약완료", "미계약", "분양률", "관심 고객", "관심 고객 전환율"],
          rows: d.types.map((t) => [t.type, t.units, t.sold, t.unsold, pct(t.salesRate), t.interested, pct(t.interestedConvRate)]),
        }}
      >
        <BarList
          rows={d.types.map((t) => ({ label: t.type, value: t.salesRate }))}
          max={1}
          highlight={[worstType]}
        />
      </Card>

      <Card
        title="광고 채널: 리드 단가 vs 계약 전환율"
        subtitle={`왼쪽 위일수록 효율이 좋습니다. 전환율은 고객명단 유입경로 기준이고,${
          noConv.length ? ` ${noConv.join("·")}는 고객명단에 대응 경로가 없어 제외했습니다.` : ""
        }`}
        table={{
          head: ["채널", "광고비(만원)", "리드", "CPL(원)", "고객명단 고객", "계약 고객", "전환율", "계약 1건당 광고비(만원)"],
          rows: d.channels.map((c) => [
            c.channel,
            fmt(c.spend10k),
            fmt(c.leads),
            fmt(Math.round(c.cpl)),
            c.crmCustomers || "-",
            c.crmConverted || "-",
            c.crmConvRate === null ? "-" : pct(c.crmConvRate),
            c.costPerConversion10k === null ? "-" : fmt(Math.round(c.costPerConversion10k)),
          ]),
        }}
      >
        <Scatter points={scatter} />
      </Card>

      <Card
        title="상담 횟수별 계약 전환율"
        subtitle="고객 1명이 받은 상담 횟수 구간별 전환율. 강조한 막대가 가장 높은 구간입니다."
        table={{
          head: ["상담 횟수", "고객 수", "계약 고객", "전환율"],
          rows: d.consultBins.map((b) => [b.label, b.n, b.converted, pct(b.rate)]),
        }}
      >
        <Columns rows={d.consultBins.map((b) => ({ label: b.label, value: b.rate, n: b.n }))} />
      </Card>

      <Card
        title="상담사별 계약 전환율"
        subtitle="상담사가 한 번이라도 상담한 고유 고객 중 유효 계약 고객 비율입니다. 최고·최저를 강조했습니다."
        table={{
          head: ["상담사", "담당 고객", "계약 고객", "전환율"],
          rows: d.consultants.map((c) => [c.name, c.n, c.converted, pct(c.rate)]),
        }}
      >
        <BarList
          rows={d.consultants.map((c) => ({ label: c.name, value: c.rate }))}
          max={0.6}
          highlight={[topC, lowC]}
        />
      </Card>
    </div>
  );
}

function Insights({ items }: { items: Dashboard["insights"] }) {
  return (
    <ol className="insights">
      {items.map((it, i) => (
        <li key={it.title} className="insight">
          <h3>
            <span className="insight-no">{String(i + 1).padStart(2, "0")}</span>
            {it.title}
          </h3>
          <div className="insight-body">
            <div>
              <h4>발견</h4>
              <p>{it.finding}</p>
            </div>
            <div>
              <h4>근거 데이터</h4>
              <dl>
                {it.evidence.map((e) => (
                  <div key={e.label}>
                    <dt>{e.label}</dt>
                    <dd>{e.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h4>제안 액션</h4>
              <ul>
                {it.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DataQuality({ log }: { log: Dashboard["cleaningLog"] }) {
  const datasets = [...new Set(log.map((l) => l.dataset))];
  const rows = (ds: string, step: string) => log.filter((l) => l.dataset === ds && l.step.startsWith(step));
  const sum = (rs: { count: number | null }[]) => rs.reduce((s, r) => s + (r.count ?? 0), 0);
  const summary = datasets.map((ds) => {
    const raw = rows(ds, "입력")[0]?.count ?? 0;
    const clean = rows(ds, "결과")[0]?.count ?? 0;
    const merged = rows(ds, "중복제거")[0]?.count ?? 0;
    return {
      ds,
      raw,
      clean,
      merged,
      dropped: raw - clean - merged,
      normalized: sum(rows(ds, "표기통일")) + sum(rows(ds, "등급표준화")),
      flagged: sum(rows(ds, "이상치").filter((r) => !r.step.includes("행 제외"))),
      review: sum(rows(ds, "검토필요")),
    };
  });
  return (
    <>
      <div className="table-scroll">
        <table className="dq-table">
          <thead>
            <tr>
              <th>데이터</th>
              <th>원본(행)</th>
              <th>정리 후(행)</th>
              <th>중복 병합</th>
              <th>이상치로 제외</th>
              <th>표기 통일(값)</th>
              <th>이상치 값 비움·표시</th>
              <th>검토필요</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.ds}>
                <td>{r.ds}</td>
                <td>{fmt(r.raw)}</td>
                <td>{fmt(r.clean)}</td>
                <td>{fmt(r.merged)}</td>
                <td>{fmt(r.dropped)}</td>
                <td>{fmt(r.normalized)}</td>
                <td>{fmt(r.flagged)}</td>
                <td>{fmt(r.review)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="caveats">
        <li>기준일(2026-10-25) 이후 날짜의 상담·계약, 고객명단에 없는 ID를 참조한 상담은 집계에서 제외했습니다.</li>
        <li>상담시간 0분 이하·240분, 예산 -1·999999, 분양가 0원은 값을 비우고 행은 유지했습니다.</li>
        <li>계약서의 분양가는 세대 마스터 가격의 약 10% 수준이라, 매출 지표는 계약서 분양가 기준입니다.</li>
        <li>계약일이 고객 가입일보다 빠른 계약이 많아, 가입~계약 소요기간 분석은 하지 않았습니다.</li>
      </ul>
      <details className="table-view">
        <summary>전체 처리로그 보기</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>데이터</th>
                <th>단계</th>
                <th>내용</th>
                <th>건수</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td>{l.dataset}</td>
                  <td>{l.step}</td>
                  <td>{l.description}</td>
                  <td>{l.count ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export default async function Page() {
  const d = await getDashboard();
  return (
    <main>
      <header className="page-header">
        <p className="eyebrow">분양 CRM 대시보드</p>
        <h1>고객·상담·계약·광고 데이터로 본 분양 현황</h1>
        <p className="lede">
          고객 {fmt(d.kpis.customers)}명, 상담 {fmt(d.kpis.consultations)}건, 계약 {fmt(d.kpis.validContracts)}건(유효),
          세대 {d.kpis.totalUnits}개, 광고 24개월 데이터를 정리해 Supabase에 적재하고 분석했습니다.
        </p>
        <nav className="toc" aria-label="섹션">
          <a href="#kpi">핵심 지표</a>
          <a href="#charts">시각화</a>
          <a href="#insights">인사이트</a>
          <a href="#quality">데이터 정리</a>
        </nav>
      </header>

      <h2 id="kpi">핵심 지표</h2>
      <Kpis k={d.kpis} />

      <h2 id="charts">시각화</h2>
      <Charts d={d} />

      <h2 id="insights">인사이트</h2>
      <p className="section-lede">각 인사이트는 발견 → 근거 데이터 → 제안 액션 순서로 정리했습니다. 수치는 모두 위 데이터에서 계산합니다.</p>
      <Insights items={d.insights} />

      <h2 id="quality">데이터 정리 요약</h2>
      <DataQuality log={d.cleaningLog} />

      <footer className="page-footer">
        모든 데이터는 실습용 합성(가상) 데이터입니다. 데이터 출처: Supabase crm_* 테이블.
      </footer>
    </main>
  );
}
