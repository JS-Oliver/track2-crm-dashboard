"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// ── 공통: 컨테이너 폭 측정 + 툴팁 ─────────────────────────────

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type Tip = { x: number; y: number; w: number; content: ReactNode } | null;

// 차트 가장자리 근처에서는 툴팁이 카드 밖으로 나가지 않도록 기준점을 바꾼다
function tipStyle(x: number, y: number, w: number) {
  const shift = x < w * 0.25 ? "0%" : x > w * 0.75 ? "-100%" : "-50%";
  return { left: x, top: y, transform: `translate(${shift}, calc(-100% - 12px))` };
}

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, content });
  };
  const showAt = (el: Element, content: ReactNode) => {
    const r = box.current?.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    if (r) setTip({ x: t.left + t.width / 2 - r.left, y: t.top - r.top, w: r.width, content });
  };
  const node = tip && (
    <div className="tooltip" style={tipStyle(tip.x, tip.y, tip.w)} role="status">
      {tip.content}
    </div>
  );
  return [box, { show, showAt, hide: () => setTip(null), node }] as const;
}

const fmt = (v: number) => v.toLocaleString("ko-KR");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// ── 가로 막대(단일 계열) ──────────────────────────────────────

export function BarList({
  rows,
  max,
  format = pct,
  highlight,
  detail,
}: {
  rows: { label: string; value: number }[];
  max?: number;
  format?: (v: number) => string;
  highlight?: string[];
  detail?: (label: string) => ReactNode;
}) {
  const [box, tip] = useTip();
  const top = max ?? Math.max(...rows.map((r) => r.value));
  return (
    <div className="chart" ref={box} onMouseLeave={tip.hide}>
      <ul className="barlist">
        {rows.map((r) => {
          const content = (
            <>
              <strong>{r.label}</strong>
              <span>{format(r.value)}</span>
              {detail?.(r.label)}
            </>
          );
          return (
            <li
              key={r.label}
              tabIndex={0}
              onMouseMove={(e) => tip.show(e, content)}
              onFocus={(e) => tip.showAt(e.currentTarget, content)}
              onBlur={tip.hide}
            >
              <span className="barlist-label">{r.label}</span>
              <span className="barlist-track">
                <span
                  className={`bar ${highlight && !highlight.includes(r.label) ? "bar-muted" : ""}`}
                  style={{ width: `${(r.value / top) * 100}%` }}
                />
              </span>
              <span className="barlist-value">{format(r.value)}</span>
            </li>
          );
        })}
      </ul>
      {tip.node}
    </div>
  );
}

// ── 퍼널(순서형 램프) ─────────────────────────────────────────

export function Funnel({ stages }: { stages: { stage: string; value: number }[] }) {
  const [box, tip] = useTip();
  const first = stages[0].value;
  return (
    <div className="chart" ref={box} onMouseLeave={tip.hide}>
      <ol className="funnel">
        {stages.map((s, i) => {
          const prev = i ? stages[i - 1].value : s.value;
          const content = (
            <>
              <strong>{s.stage}</strong>
              <span>{fmt(s.value)}명</span>
              <span className="muted">전체 대비 {pct(s.value / first)}</span>
              {i > 0 && <span className="muted">이전 단계 대비 {pct(s.value / prev)}</span>}
            </>
          );
          return (
            <li
              key={s.stage}
              tabIndex={0}
              onMouseMove={(e) => tip.show(e, content)}
              onFocus={(e) => tip.showAt(e.currentTarget, content)}
              onBlur={tip.hide}
            >
              <span className="barlist-label">{s.stage}</span>
              <span className="barlist-track">
                <span className={`bar ramp-${i + 1}`} style={{ width: `${(s.value / first) * 100}%` }} />
              </span>
              <span className="barlist-value">
                {fmt(s.value)}
                {i > 0 && <small> {pct(s.value / prev)}</small>}
              </span>
            </li>
          );
        })}
      </ol>
      {tip.node}
    </div>
  );
}

// ── 세로 막대(구간) ───────────────────────────────────────────

export function Columns({
  rows,
  format = pct,
  note,
}: {
  rows: { label: string; value: number; n: number }[];
  format?: (v: number) => string;
  note?: (r: { label: string; value: number; n: number }) => string;
}) {
  const [box, tip] = useTip();
  const top = Math.max(...rows.map((r) => r.value));
  const peak = rows.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <div className="chart" ref={box} onMouseLeave={tip.hide}>
      <div className="columns">
        {rows.map((r) => {
          const content = (
            <>
              <strong>{r.label}</strong>
              <span>{format(r.value)}</span>
              <span className="muted">{note ? note(r) : `n=${r.n}`}</span>
            </>
          );
          return (
            <div
              key={r.label}
              className="column"
              tabIndex={0}
              onMouseMove={(e) => tip.show(e, content)}
              onFocus={(e) => tip.showAt(e.currentTarget, content)}
              onBlur={tip.hide}
            >
              <span className="column-value">{format(r.value)}</span>
              <span className="column-track">
                <span
                  className={`col ${r === peak ? "" : "bar-muted"}`}
                  style={{ height: `${(r.value / top) * 100}%` }}
                />
              </span>
              <span className="column-label">{r.label}</span>
              <span className="column-n">n={r.n}</span>
            </div>
          );
        })}
      </div>
      {tip.node}
    </div>
  );
}

// ── 꺾은선(단일 계열, 스몰 멀티플용) ───────────────────────────

const niceMax = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

export function LineChart({
  points,
  unit,
  series = 1,
}: {
  points: { x: string; y: number }[];
  unit: string;
  series?: 1 | 2;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const w = Math.max(width - pad.l - pad.r, 10);
  const h = H - pad.t - pad.b;
  const ymax = niceMax(Math.max(...points.map((p) => p.y)));
  const x = (i: number) => pad.l + (i / (points.length - 1)) * w;
  const y = (v: number) => pad.t + h - (v / ymax) * h;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.y)}`).join("");
  const ticks = [0, ymax / 2, ymax];
  const xLabels = points.map((p, i) => ({ p, i })).filter(({ p }) => p.x.endsWith("-01"));
  const last = points.length - 1;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * last);
    setHover(Math.min(Math.max(i, 0), last));
  };

  return (
    <div className="chart line-chart" ref={wrap}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`월별 ${unit} 추이`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xLabels.map(({ p, i }) => (
            <text key={p.x} className="tick" x={x(i)} y={H - 6} textAnchor="middle">
              {p.x.slice(0, 4)}
            </text>
          ))}
          <path d={`${path}L${x(last)},${y(0)}L${x(0)},${y(0)}Z`} className={`area s${series}`} />
          <path d={path} className={`line s${series}`} />
          <circle className={`dot s${series}`} cx={x(last)} cy={y(points[last].y)} r={4} />
          {hover !== null && (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} />
              <circle className={`dot s${series}`} cx={x(hover)} cy={y(points[hover].y)} r={5} />
            </g>
          )}
          <rect
            x={pad.l}
            y={pad.t}
            width={w}
            height={h}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="tooltip" style={tipStyle(x(hover), y(points[hover].y), width)}>
          <strong>{points[hover].x}</strong>
          <span>
            {fmt(points[hover].y)}
            {unit}
          </span>
        </div>
      )}
    </div>
  );
}

// ── 산점도(채널: x=CPL, y=전환율) ─────────────────────────────

export function Scatter({
  points,
}: {
  points: { label: string; x: number; y: number; detail: string }[];
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 260;
  const pad = { l: 44, r: 24, t: 16, b: 40 };
  const w = Math.max(width - pad.l - pad.r, 10);
  const h = H - pad.t - pad.b;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.floor(Math.min(...xs) / 1000) * 1000, Math.ceil(Math.max(...xs) / 1000) * 1000];
  const [y0, y1] = [Math.floor(Math.min(...ys) * 20) / 20, Math.ceil(Math.max(...ys) * 20) / 20];
  const x = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * w;
  const y = (v: number) => pad.t + h - ((v - y0) / (y1 - y0)) * h;
  const xTicks = [x0, (x0 + x1) / 2, x1];

  // 라벨 겹침 회피: 오른쪽 → 왼쪽 → 위/아래로 조금 이동 순으로 빈 자리를 찾는다
  const textW = (t: string) => [...t].reduce((s, c) => s + (c.charCodeAt(0) > 127 ? 12 : 7), 0);
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  const labels = points.map((p) => {
    const px = x(p.x);
    const py = y(p.y);
    const tw = textW(p.label);
    const preferLeft = px > pad.l + w * 0.7;
    const options = [
      { left: preferLeft, dy: 0 },
      { left: !preferLeft, dy: 0 },
      { left: preferLeft, dy: -14 },
      { left: preferLeft, dy: 14 },
      { left: !preferLeft, dy: -14 },
      { left: !preferLeft, dy: 14 },
    ];
    const box = (o: { left: boolean; dy: number }) => ({
      l: o.left ? px - 10 - tw : px + 10,
      r: o.left ? px - 10 : px + 10 + tw,
      t: py + o.dy - 7,
      b: py + o.dy + 7,
    });
    const fits = (bx: ReturnType<typeof box>) =>
      bx.l >= 0 && bx.r <= width && !placed.some((q) => bx.l < q.r && q.l < bx.r && bx.t < q.b && q.t < bx.b);
    const choice = options.find((o) => fits(box(o))) ?? options[0];
    placed.push(box(choice));
    return choice;
  });
  const yTicks = [y0, (y0 + y1) / 2, y1];

  return (
    <div className="chart" ref={wrap}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="광고 채널별 리드 단가와 계약 전환율">
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} className="tick" x={x(t)} y={pad.t + h + 16} textAnchor="middle">
              {fmt(Math.round(t))}원
            </text>
          ))}
          <text className="axis-title" x={pad.l + w} y={H - 4} textAnchor="end">
            리드당 비용(CPL) →
          </text>
          <text className="axis-title" x={pad.l} y={pad.t - 4}>
            ↑ 계약 전환율
          </text>
          {points.map((p, i) => {
            const lb = labels[i];
            return (
              <g
                key={p.label}
                tabIndex={0}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <circle cx={x(p.x)} cy={y(p.y)} r={14} fill="transparent" />
                <circle className="dot s1" cx={x(p.x)} cy={y(p.y)} r={hover === i ? 7 : 5} />
                <text
                  className="point-label"
                  x={x(p.x) + (lb.left ? -10 : 10)}
                  y={y(p.y) + lb.dy}
                  dy="0.32em"
                  textAnchor={lb.left ? "end" : "start"}
                >
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="tooltip" style={tipStyle(x(points[hover].x), y(points[hover].y), width)}>
          <strong>{points[hover].label}</strong>
          <span>CPL {fmt(Math.round(points[hover].x))}원</span>
          <span>전환율 {pct(points[hover].y)}</span>
          <span className="muted">{points[hover].detail}</span>
        </div>
      )}
    </div>
  );
}
