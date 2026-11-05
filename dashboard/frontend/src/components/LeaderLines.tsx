import { useAnimationFrame } from "motion/react";
import { useRef, type CSSProperties } from "react";
import { ANCHORS, anchorBus } from "../scene/anchors";

/**
 * Thin lines from each overview callout (its `data-pin` dot) to a point on the 3D infinity.
 * Both ends move every frame (the sculpture rocks, the page slides), so the SVG is updated
 * directly in an animation-frame loop rather than through React state. A line only shows once the
 * band is there at its point (the ∞ draws itself in, and peels away when a window opens).
 */
export function LeaderLines() {
  const svgRef = useRef<SVGSVGElement>(null);
  const pins = useRef(new Map<string, HTMLElement>());

  useAnimationFrame(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.style.visibility = anchorBus.visible ? "visible" : "hidden";
    if (!anchorBus.visible) return;
    const box = svg.getBoundingClientRect();
    ANCHORS.forEach(({ id }, j) => {
      let pin = pins.current.get(id);
      if (!pin?.isConnected) {
        pin = svg.parentElement?.querySelector<HTMLElement>(`[data-pin="${id}"]`) ?? undefined;
        if (!pin) return;
        pins.current.set(id, pin);
      }
      const r = pin.getBoundingClientRect();
      const x1 = r.left + r.width / 2 - box.left;
      const y1 = r.top + r.height / 2 - box.top;
      const x2 = anchorBus.xy[2 * j] - box.left;
      const y2 = anchorBus.xy[2 * j + 1] - box.top;
      const g = svg.querySelector<SVGGElement>(`[data-line="${id}"]`);
      if (!g) return;
      g.style.opacity = String(anchorBus.drawn[j]);
      const [line, dot, ring] = g.children;
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      for (const c of [dot, ring]) {
        c.setAttribute("cx", String(x2));
        c.setAttribute("cy", String(y2));
      }
    });
  });

  return (
    <svg ref={svgRef} className="leaders reveal" style={{ "--d": 0.3 } as CSSProperties} aria-hidden="true">
      {ANCHORS.map(({ id }) => (
        <g key={id} data-line={id}>
          <line />
          <circle r="3" className="leader-dot" />
          <circle r="9" className="leader-ring" />
        </g>
      ))}
    </svg>
  );
}
