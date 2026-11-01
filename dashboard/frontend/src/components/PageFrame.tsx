import { motion, useTransform, type MotionValue } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  index: number;
  id: string;
  progress: MotionValue<number>;
  active: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * One full-screen page. From the scroll `progress` it derives:
 *  --p   (CSS variable) its presence: 1 when it's the current page, 0 when most of a page away.
 *        Elements with class "reveal" fade and slide in from it, each delayed by its own --d.
 *  --dir +1 if the page is below the current position (enters from below), -1 if above.
 * Inactive pages are `inert` (not focusable, invisible to screen readers).
 */
export function PageFrame({ index, id, progress, active, className = "", children }: Props) {
  // Fully gone 0.82 pages away, so the next page stays hidden while a scroll gesture only creeps.
  const presence = useTransform(progress, (p) => Math.max(0, 1 - Math.abs(index - p) / 0.82));
  const dir = useTransform(progress, (p) => (index >= p ? 1 : -1));
  const y = useTransform(progress, (p) => `${(index - p) * 12}vh`);
  const visibility = useTransform(progress, (p) => (Math.abs(index - p) < 1 ? "visible" : "hidden"));

  return (
    <motion.section
      id={id}
      data-page={index}
      className={`page page-${id} ${className}`}
      aria-labelledby={`${id}-title`}
      inert={!active}
      style={{ "--p": presence, "--dir": dir, y, visibility } as unknown as CSSProperties}
    >
      <div className="page-scroll" data-scroller>
        <div className="page-inner">{children}</div>
      </div>
    </motion.section>
  );
}
