import { motion, useTransform } from "motion/react";
import { PAGE_IDS } from "../config";
import { presence, usePageOffset, type Pager } from "../hooks/usePager";
import { zoomFrame } from "../lib/zoom";

const ANALYSIS = PAGE_IDS.indexOf("analysis");
const LOG = PAGE_IDS.indexOf("log");

/**
 * The layer behind everything (the same paper on every page): a vignette, a dot grid, grain, and
 * the orbital HUD that turns behind the analysis and, fainter and larger, the log.
 * When the analysis zooms out of its window, the HUD only comes on as the page lands (and goes off
 * as it leaves), so it never shows around the flying page.
 */
export function Backdrop({ pager, busy }: { pager: Pager; busy: boolean }) {
  const analysis = usePageOffset(pager, ANALYSIS);
  const log = usePageOffset(pager, LOG);
  const { zoom, zt } = pager;
  const shown = () => {
    const a = presence(analysis.get());
    const t = zt.get();
    return zoom?.page === ANALYSIS ? 1 - zoomFrame(zoom.dir, t).paper : a;
  };
  const orbit = useTransform(() => Math.max(shown(), 0.28 * presence(log.get())));
  const onAnalysis = () => shown() >= presence(log.get());
  const orbitScale = useTransform(() => (onAnalysis() ? 0.86 + 0.14 * shown() : 1.3));
  const orbitX = useTransform(() => (onAnalysis() ? "0vw" : "-14vw"));

  return (
    <div className={`backdrop${busy ? " is-busy" : ""}`} aria-hidden="true">
      <div className="bd-paper" />
      <div className="bd-dots" />
      <motion.div className="bd-orbit" style={{ opacity: orbit, scale: orbitScale, x: orbitX }}>
        <OrbitHud />
      </motion.div>
      <div className="bd-grain" />
    </div>
  );
}

const TICKS = Array.from({ length: 72 }, (_, i) => i * 5);
const NESTED = [22, 44, 66, 88, 110, 132];

/** Concentric orbits, crosshairs and tangent circles, after the trailer's analysis screen. */
function OrbitHud() {
  return (
    <svg className="orbit" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
      <g className="orbit-lines">
        <line x1="40" y1="300" x2="960" y2="300" />
        <line x1="500" y1="40" x2="500" y2="560" />
        {/* left: two overlapping circles */}
        <circle cx="300" cy="300" r="150" />
        <circle cx="262" cy="300" r="122" className="faint" />
        {/* right: a family of circles touching at one point */}
        {NESTED.map((r) => (
          <circle key={r} cx={730 + r} cy="300" r={r} className="faint" />
        ))}
        {/* centre: rings */}
        <circle cx="500" cy="300" r="228" className="bright" />
        <circle cx="500" cy="300" r="150" />
        <circle cx="500" cy="300" r="70" className="faint" />
        <circle cx="500" cy="300" r="7" className="solid" />
      </g>
      <g className="orbit-spin slow">
        <circle cx="500" cy="300" r="112" className="dash" />
        <circle cx="500" cy="72" r="5" className="solid" />
        <circle cx="661" cy="461" r="3.5" className="solid" />
        {TICKS.map((a) => (
          <line
            key={a}
            x1="500" y1={300 - 240} x2="500" y2={300 - (a % 30 === 0 ? 252 : 246)}
            transform={`rotate(${a} 500 300)`}
          />
        ))}
      </g>
      <g className="orbit-spin fast">
        <circle cx="500" cy="150" r="4" className="solid" />
        <circle cx="430" cy="364" r="3" className="solid" />
        <path d="M 500 230 A 70 70 0 0 1 570 300" className="bright" />
      </g>
    </svg>
  );
}
