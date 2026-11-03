import { useMemo, type CSSProperties, type ReactNode } from "react";
import { fmtClock } from "../lib/format";
import { nearest, stats, type Pt } from "../lib/series";

interface Props {
  className: string;
  delay: number;
  code: string;
  title: string;
  unit: string;
  digits: number;
  color: string;
  pts: Pt[];
  hoverT: number | null;
  extra?: (p: Pt) => string; // more detail for the readout, e.g. the raw ADC value
  children: ReactNode;
}

/**
 * Glass panel around a chart. Its header is the chart's readout: the latest value, or the value
 * under the crosshair while you hover any chart on the page, plus min/avg/max for the window.
 */
export function ChartPanel({ className, delay, code, title, unit, digits, color, pts, hoverT, extra, children }: Props) {
  const s = useMemo(() => stats(pts), [pts]);
  const hovered = hoverT == null ? null : nearest(pts, hoverT);
  const shown = hovered ?? (pts.length ? pts[pts.length - 1] : null);

  return (
    <section className={`panel chart-panel ${className} reveal`} style={{ "--d": delay } as CSSProperties} aria-label={title}>
      <header className="cp-head">
        <div className="cp-title">
          <p>
            <span className="tag">{code}</span>
          </p>
          <h3>{title}</h3>
          <p className="micro">
            {s
              ? `Min ${s.min.toFixed(digits)} · avg ${s.mean.toFixed(digits)} · max ${s.max.toFixed(digits)} ${unit}`
              : "No data in range"}
          </p>
        </div>
        <div className="cp-read" aria-live="off">
          <p className="cp-value">
            <i className="cp-key" style={{ background: color }} aria-hidden="true" />
            {shown ? shown.v.toFixed(digits) : "—"}
            <span>{unit}</span>
          </p>
          <p className="micro">
            {shown ? `${hovered ? "At" : "Latest ·"} ${fmtClock(shown.t)}${extra ? ` · ${extra(shown)}` : ""}` : "—"}
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}
