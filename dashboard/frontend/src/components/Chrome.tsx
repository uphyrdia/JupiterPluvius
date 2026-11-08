import { motion, useTransform, type MotionStyle, type MotionValue } from "motion/react";
import { PAGES, parentOf, RANGES } from "../config";
import { neighbour, SCROLL, type Pager } from "../hooks/usePager";
import { useNow } from "../hooks/useNow";
import type { Telemetry } from "../hooks/useTelemetry";
import { fmtClock, utcOffset } from "../lib/format";
import { linkStatus } from "../lib/status";
import { Icon } from "./Icon";
import { ScrambleText } from "./ScrambleText";

interface Props {
  pager: Pager;
  overview: MotionValue<number>; // how far the overview is from the view, in pages
  telemetry: Telemetry;
  hours: number;
  onHours: (h: number) => void;
  includeTest: boolean;
  onIncludeTest: (v: boolean) => void;
}

/** Everything that stays put while the pages move: top bar, section rail, bottom bar, corner marks. */
export function Chrome({ pager, overview, telemetry, hours, onHours, includeTest, onIncludeTest }: Props) {
  const { index, goTo, pull } = pager;
  // The compact brand and the filters fade in once you leave the overview, which has its own big brand.
  const away = useTransform(overview, (o) => Math.min(1, Math.max(0, (Math.abs(o) - 0.35) / 0.55)));
  const awayEvents = useTransform(overview, (o) => (Math.abs(o) > 0.5 ? "auto" : "none"));
  // The rail lists the scroll (overview, log); a page opened from a window shows up under its parent.
  const detail = parentOf(index) >= 0;
  const rail = SCROLL.flatMap((i) => (detail && parentOf(index) === i ? [i, index] : [i]));

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
          {rail.map((i) => (
            <li key={PAGES[i].id} className={parentOf(i) >= 0 ? "is-sub" : undefined}>
              <button
                type="button"
                className={i === index ? "is-on" : undefined}
                aria-current={i === index ? "page" : undefined}
                onClick={() => goTo(i)}
              >
                <span className="rail-label">{PAGES[i].label}</span>
                <span className="rail-tick" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <footer className="bottombar">
        <div className="keys" aria-hidden="true">
          {detail ? (
            <span>
              <kbd>Esc</kbd> BACK
            </span>
          ) : (
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> NAVIGATE
            </span>
          )}
        </div>
        <p className="section-label">
          <i aria-hidden="true" />
          <ScrambleText text={PAGES[index].label.toUpperCase()} play delay={250} />
        </p>
        <ScrollCue pull={pull} index={index} goTo={goTo} />
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

/**
 * "Scroll" hint whose bar fills as a wheel/swipe gesture approaches the jump threshold. On the log it
 * leads back to the top, and on a page opened from the overview it leads back to the overview.
 */
function ScrollCue({ pull, index, goTo }: { pull: MotionValue<number>; index: number; goTo: (i: number) => void }) {
  const fill = useTransform(pull, (v) => Math.min(1, Math.abs(v)));
  const back = parentOf(index);
  const next = neighbour(index, 1);
  const [text, icon, to] =
    back >= 0 ? (["BACK", "up", back] as const)
    : next >= 0 ? (["SCROLL", "down", next] as const)
    : (["BACK TO TOP", "up", SCROLL[0]] as const);
  return (
    <button type="button" className="cue" onClick={() => goTo(to)}>
      <span className="cue-text">{text}</span>
      <span className="cue-track" aria-hidden="true">
        <motion.span className="cue-fill" style={{ scaleX: fill }} />
      </span>
      <Icon name={icon} size={12} />
    </button>
  );
}
