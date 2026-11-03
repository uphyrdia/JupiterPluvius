import { motion, useTransform, type MotionStyle, type MotionValue } from "motion/react";
import { PAGES, RANGES } from "../config";
import type { Pager } from "../hooks/usePager";
import { useNow } from "../hooks/useNow";
import type { Telemetry } from "../hooks/useTelemetry";
import { fmtClock, pad2, utcOffset } from "../lib/format";
import { linkStatus } from "../lib/status";
import { Icon } from "./Icon";
import { ScrambleText } from "./ScrambleText";

interface Props {
  pager: Pager;
  telemetry: Telemetry;
  hours: number;
  onHours: (h: number) => void;
  includeTest: boolean;
  onIncludeTest: (v: boolean) => void;
}

/** Everything that stays put while the pages move: top bar, section rail, bottom bar, corner marks. */
export function Chrome({ pager, telemetry, hours, onHours, includeTest, onIncludeTest }: Props) {
  const { progress, index, goTo, pull } = pager;
  // The compact brand and the filters fade in once you leave the overview, which has its own big brand.
  const away = useTransform(progress, [0.35, 0.9], [0, 1]);
  const awayEvents = useTransform(progress, (p) => (p > 0.5 ? "auto" : "none"));

  return (
    <>
      <motion.header className="topbar" style={{ "--away": away } as unknown as MotionStyle}>
        <motion.button
          type="button"
          className="mini-brand"
          style={{ opacity: away, pointerEvents: awayEvents }}
          onClick={() => goTo(0)}
          aria-label="JupiterPluvius: back to the overview"
        >
          <Icon name="infinity" size={22} />
          <span className="mini-name">JUPITER PLUVIUS</span>
          <span className="mini-sub">TELEMETRY OS</span>
        </motion.button>

        <div className="topbar-right">
          <motion.div className="filters" style={{ opacity: away, pointerEvents: awayEvents }}>
            <div className="seg" role="radiogroup" aria-label="Time range">
              <span className="seg-label">RANGE</span>
              {RANGES.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={h === hours} onClick={() => onHours(h)}>
                  {h} H
                </button>
              ))}
            </div>
            <label className="switch">
              <input type="checkbox" checked={includeTest} onChange={(e) => onIncludeTest(e.target.checked)} />
              <span className="switch-track" aria-hidden="true" />
              <span className="switch-label">TEST DATA</span>
            </label>
          </motion.div>
          <LinkPill telemetry={telemetry} />
          <Clock />
        </div>
      </motion.header>

      <nav className="rail" aria-label="Sections">
        <ol>
          {PAGES.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                className={i === index ? "is-on" : undefined}
                aria-current={i === index ? "step" : undefined}
                onClick={() => goTo(i)}
              >
                <span className="rail-label">{p.label}</span>
                <span className="rail-tick" aria-hidden="true" />
                <span className="rail-num">{pad2(i + 1)}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <footer className="bottombar">
        <div className="keys" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> NAVIGATE
          </span>
          <span>
            <kbd>1</kbd>–<kbd>4</kbd> JUMP
          </span>
        </div>
        <p className="section-label">
          <i aria-hidden="true" />
          <ScrambleText text={`${pad2(index + 1)} · ${PAGES[index].label.toUpperCase()}`} play delay={250} />
        </p>
        <ScrollCue pull={pull} index={index} goTo={goTo} />
        <p className="page-count micro" aria-hidden="true">
          {pad2(index + 1)} / {pad2(PAGES.length)}
        </p>
      </footer>

      <div className="corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
    </>
  );
}

function LinkPill({ telemetry }: { telemetry: Telemetry }) {
  const now = useNow(1000);
  const s = linkStatus(telemetry, now);
  return (
    <div className={`link status status-${s.tone}`}>
      <span className={`dot${s.tone === "good" ? " is-pulsing" : ""}`} aria-hidden="true" />
      <span role="status" className="link-label">
        {s.label}
      </span>
      <span className="link-detail" title={s.detail}>
        {s.detail}
      </span>
    </div>
  );
}

function Clock() {
  const now = useNow(1000);
  return (
    <p className="clock">
      <time dateTime={new Date(now).toISOString()}>{fmtClock(now)}</time>
      <span>{utcOffset()}</span>
    </p>
  );
}

/** "Scroll" hint whose bar fills as a wheel/swipe gesture approaches the jump threshold. */
function ScrollCue({ pull, index, goTo }: { pull: MotionValue<number>; index: number; goTo: (i: number) => void }) {
  const last = index === PAGES.length - 1;
  const fill = useTransform(pull, (v) => Math.min(1, Math.abs(v)));
  return (
    <button type="button" className="cue" onClick={() => goTo(last ? 0 : index + 1)}>
      <span className="cue-text">{last ? "BACK TO TOP" : "SCROLL"}</span>
      <span className="cue-track" aria-hidden="true">
        <motion.span className="cue-fill" style={{ scaleX: fill }} />
      </span>
      <Icon name={last ? "up" : "down"} size={12} />
    </button>
  );
}
