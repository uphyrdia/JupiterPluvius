import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useId, useMemo, type KeyboardEvent, type PointerEvent } from "react";
import { useSize } from "../hooks/useSize";
import { fmtHM } from "../lib/format";
import { nearest, splitAtGaps, stats, type Pt } from "../lib/series";

interface Props {
  pts: Pt[];
  x0: number; // start of the time window (ms)
  x1: number; // end of the time window ("now")
  yDomain?: [number, number]; // fixed y range (e.g. 0-100 %); otherwise fitted to the data
  minSpan?: number; // a fitted y range is at least this tall, so sensor noise doesn't look dramatic
  color: string;
  gap: number; // break the line where readings are further apart than this (ms)
  hoverT: number | null; // time under the crosshair, shared by all charts on the page
  onHover: (t: number | null) => void;
  label: string; // accessible description
  tick?: (v: number) => string;
}

const M = { top: 14, right: 16, bottom: 26, left: 40 }; // margins for the axes

/**
 * A time-series line chart drawn with plain SVG. d3-scale maps values to pixels and d3-shape
 * builds the path strings; React renders the elements.
 */
export function LineChart({ pts, x0, x1, yDomain, minSpan = 2, color, gap, hoverT, onHover, label, tick = String }: Props) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const id = useId();
  const iw = Math.max(1, width - M.left - M.right);
  const ih = Math.max(1, height - M.top - M.bottom);

  const x = useMemo(() => scaleTime().domain([x0, x1]).range([0, iw]), [x0, x1, iw]);
  const y = useMemo(() => {
    let lo = 0, hi = 1;
    if (yDomain) [lo, hi] = yDomain;
    else {
      const s = stats(pts);
      if (s) [lo, hi] = [s.min, s.max];
      if (hi - lo < minSpan) [lo, hi] = [(lo + hi - minSpan) / 2, (lo + hi + minSpan) / 2];
    }
    return scaleLinear().domain([lo, hi]).nice(4).range([ih, 0]);
  }, [pts, yDomain, minSpan, ih]);

  const paths = useMemo(() => {
    const runs = splitAtGaps(pts, gap);
    const l = line<Pt>().x((p) => x(p.t)).y((p) => y(p.v)).curve(curveMonotoneX);
    const a = area<Pt>().x((p) => x(p.t)).y0(ih).y1((p) => y(p.v)).curve(curveMonotoneX);
    return { line: runs.map((r) => l(r) ?? "").join(""), area: runs.map((r) => a(r) ?? "").join("") };
  }, [pts, gap, x, y, ih]);

  const xTicks = x.ticks(iw < 360 ? 3 : iw < 640 ? 4 : 6);
  const hover = hoverT == null ? null : nearest(pts, hoverT);
  const last = pts.length ? pts[pts.length - 1] : null;

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onHover(nearest(pts, x.invert(e.clientX - box.left).getTime())?.t ?? null);
  };
  const step = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Escape") return onHover(null);
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = hover ? pts.indexOf(hover) : pts.length;
    const next = pts[Math.max(0, Math.min(pts.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)))];
    onHover(next?.t ?? null);
  };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={step} onBlur={() => onHover(null)}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.14 }} />
              <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
            </linearGradient>
            <clipPath id={`${id}-clip`}>
              <rect x={-6} y={-6} width={iw + 12} height={ih + 12} />
            </clipPath>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            {y.ticks(4).map((v) => (
              <g key={v} transform={`translate(0,${y(v)})`}>
                <line className="grid" x2={iw} />
                <text className="tick" x={-10} dy="0.32em" textAnchor="end">
                  {tick(v)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={+t} className="tick" x={x(t)} y={ih + 18} textAnchor="middle">
                {fmtHM(+t)}
              </text>
            ))}
            <line className="axis" y1={ih} y2={ih} x2={iw} />
            <g clipPath={`url(#${id}-clip)`}>
              <path d={paths.area} style={{ fill: `url(#${id}-fill)` }} />
              <path d={paths.line} className="line" style={{ stroke: color }} />
              {last && !hover && <circle className="mark" cx={x(last.t)} cy={y(last.v)} r={4} style={{ fill: color }} />}
              {hover && (
                <>
                  <line className="crosshair" x1={x(hover.t)} x2={x(hover.t)} y1={0} y2={ih} />
                  <circle className="mark" cx={x(hover.t)} cy={y(hover.v)} r={4.5} style={{ fill: color }} />
                </>
              )}
            </g>
            <rect
              className="hit"
              width={iw}
              height={ih}
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={() => onHover(null)}
            />
          </g>
        </svg>
      )}
      {width > 0 && pts.length === 0 && <p className="chart-empty micro">No readings in this range</p>}
    </div>
  );
}
