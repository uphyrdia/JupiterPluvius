import { motion, useTransform, type MotionValue } from "motion/react";
import { THEME_AT, THEME_STOPS, themeValues } from "../lib/theme";

/**
 * The layer behind everything: the page colour (which drifts from paper-white to deep blue as you
 * scroll), dot grids, a soft glow, grain, and the orbital HUD that appears on the dark pages.
 */
export function Backdrop({ progress, busy }: { progress: MotionValue<number>; busy: boolean }) {
  const bg = useTransform(progress, THEME_AT, themeValues(THEME_STOPS.bg));
  const paper = useTransform(progress, [0, 1, 1.28, 1.6], [1, 1, 0.6, 0]); // light pages: vignette + ink dots
  const night = useTransform(progress, [1.4, 1.75], [0, 1]); // dark pages: light dots
  const glow = useTransform(progress, [1.4, 2, 3], [0, 1, 0.5]);
  const orbit = useTransform(progress, [1.45, 2, 2.6, 3], [0, 1, 0.35, 0.2]);
  const orbitScale = useTransform(progress, [1, 2, 3], [0.82, 1, 1.3]);
  const orbitX = useTransform(progress, [1, 2, 3], ["8vw", "0vw", "-14vw"]);

  return (
    <motion.div className={`backdrop${busy ? " is-busy" : ""}`} style={{ backgroundColor: bg }} aria-hidden="true">
      <motion.div className="bd-paper" style={{ opacity: paper }} />
      <motion.div className="bd-dots bd-dots-ink" style={{ opacity: paper }} />
      <motion.div className="bd-dots bd-dots-light" style={{ opacity: night }} />
      <motion.div className="bd-glow" style={{ opacity: glow }} />
      <motion.div className="bd-orbit" style={{ opacity: orbit, scale: orbitScale, x: orbitX }}>
        <OrbitHud />
      </motion.div>
      <div className="bd-grain" />
    </motion.div>
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
