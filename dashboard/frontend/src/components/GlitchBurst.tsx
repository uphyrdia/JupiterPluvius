import { useMemo } from "react";

const START_MS = 240; // the tear hits while the jump is gathering speed, not at the first frame

/**
 * The digital "tear" that flashes across the screen mid-transition: horizontal slices that invert
 * whatever is under them (mix-blend-mode: difference), plus a few halftone blocks. Each page change
 * renders a fresh burst (new `seed` -> new random bars -> the CSS animation plays once).
 */
export function GlitchBurst({ seed }: { seed: number }) {
  const parts = useMemo(() => {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const bars = Array.from({ length: 18 }, () => ({
      top: rnd() * 100,
      height: 0.3 + rnd() ** 2 * 4.5,
      left: -10 + rnd() * 70,
      width: 15 + rnd() * 75,
      delay: rnd() * 260,
      dx: (rnd() - 0.5) * 120,
      kind: rnd() < 0.7 ? "slice" : "thin",
    }));
    const blocks = Array.from({ length: 4 }, () => ({
      top: 8 + rnd() * 80,
      left: 4 + rnd() * 88,
      size: 28 + rnd() * 70,
      delay: 60 + rnd() * 240,
    }));
    return { bars, blocks };
  }, [seed]);

  if (seed === 0) return null;
  return (
    <div className="glitch" aria-hidden="true">
      {parts.bars.map((b, i) => (
        <i
          key={i}
          className={`glitch-${b.kind}`}
          style={{
            top: `${b.top}%`, height: `${b.height}%`, left: `${b.left}%`, width: `${b.width}%`,
            animationDelay: `${START_MS + b.delay}ms`, ["--dx" as string]: `${b.dx}px`,
          }}
        />
      ))}
      {parts.blocks.map((b, i) => (
        <b
          key={i}
          className="glitch-block halftone"
          style={{ top: `${b.top}%`, left: `${b.left}%`, width: b.size, height: b.size * 0.7, animationDelay: `${START_MS + b.delay}ms` }}
        />
      ))}
    </div>
  );
}
