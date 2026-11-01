import { animate } from "motion/react";
import { useEffect, useRef } from "react";

/**
 * A number that counts to its new value instead of jumping (the first value counts up from 0).
 * It writes to the DOM directly while animating, so the count doesn't re-render React 60x/s.
 */
export function AnimatedNumber({ value, digits = 0 }: { value: number | null; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value == null) {
      el.textContent = "—";
      shown.current = null;
      return;
    }
    const controls = animate(shown.current ?? 0, value, {
      duration: 1.1,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = v.toFixed(digits);
      },
    });
    return () => controls.stop();
  }, [value, digits]);

  return <span ref={ref}>{value == null ? "—" : value.toFixed(digits)}</span>;
}
