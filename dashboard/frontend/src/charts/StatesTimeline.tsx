import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { Row } from "../lib/api";
import { fmtHM, fmtStamp } from "../lib/format";

interface Track {
  key: string;
  label: string; // what a filled band means
  test: (r: Row) => boolean;
  color: string;
}

const TRACKS: Track[] = [
  { key: "data", label: "Readings received", test: () => true, color: "rgba(238, 241, 255, 0.55)" },
  { key: "light", label: "Ambient light · bright", test: (r) => r.light_state === true, color: "#eda100" },
  { key: "led", label: "Grow LED · on", test: (r) => r.led_state === true, color: "#9085e9" },
  { key: "reservoir", label: "Reservoir · low", test: (r) => r.reservoir_state === false, color: "var(--critical)" },
  { key: "faults", label: "Faults · active", test: (r) => (r.faults?.length ?? 0) > 0, color: "var(--serious)" },
  { key: "test", label: "Test data", test: (r) => r.test_data, color: "#7f8fd6" },
];

interface Seg {
  start: number;
  end: number;
}

/** One row of coloured bands per state; a band spans the time that state was reported. */
export function StatesTimeline({ rows, x0, x1, gap }: { rows: Row[]; x0: number; x1: number; gap: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const span = x1 - x0;
  const pct = (t: number) => ((Math.min(Math.max(t, x0), x1) - x0) / span) * 100;

  const tracks = useMemo(
    () =>
      TRACKS.map((tr) => {
        const segs: Seg[] = [];
        let on = 0;
        rows.forEach((r, i) => {
          if (!tr.test(r)) return;
          on++;
          const next = i + 1 < rows.length ? rows[i + 1].t : x1;
          const end = Math.min(next, r.t + gap); // don't paint across gaps in the data
          const last = segs[segs.length - 1];
          if (last && r.t - last.end < 1000) last.end = end;
          else segs.push({ start: r.t, end });
        });
        return { ...tr, segs, share: rows.length ? on / rows.length : 0 };
      }),
    [rows, x1, gap],
  );

  const ticks = Array.from({ length: 5 }, (_, i) => x0 + (span * i) / 4);

  const showTip = (e: PointerEvent, text: string) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };

  return (
    <div className="tl" ref={box} onPointerLeave={() => setTip(null)}>
      {tracks.map((tr) => (
        <div className="tl-row" key={tr.key}>
          <span className="tl-label micro">{tr.label}</span>
          <div className="tl-track" role="img" aria-label={`${tr.label}: ${Math.round(tr.share * 100)} % of readings`}>
            {tr.segs.map((s) => (
              <span
                key={s.start}
                className="tl-seg"
                style={{ left: `${pct(s.start)}%`, width: `max(2px, ${pct(s.end) - pct(s.start)}%)`, background: tr.color }}
                onPointerMove={(e) => showTip(e, `${tr.label} · ${fmtStamp(s.start)} – ${fmtHM(s.end)}`)}
              />
            ))}
          </div>
          <span className="tl-share micro">{rows.length ? `${Math.round(tr.share * 100)} %` : "—"}</span>
        </div>
      ))}
      <div className="tl-row tl-axis" aria-hidden="true">
        <span />
        <div className="tl-ticks micro">
          {ticks.map((t) => (
            <span key={t}>{fmtHM(t)}</span>
          ))}
        </div>
        <span />
      </div>
      {tip && (
        <div className="tl-tip micro" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
