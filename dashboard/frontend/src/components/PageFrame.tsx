import { motion, useTransform } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { presence, usePageOffset, type Pager } from "../hooks/usePager";

interface Props {
  index: number;
  id: string;
  pager: Pager;
  active: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * One full-screen page. From its offset to the view (see usePager) it derives:
 *  --p   (CSS variable) its presence: 1 when it's the current page, 0 when most of a page away.
 *        Elements with class "reveal" fade and slide in from it, each delayed by its own --d.
 *  --dir +1 if the page is below the view (enters from below), -1 if above.
 * Inactive pages are `inert` (not focusable, invisible to screen readers).
 */
export function PageFrame({ index, id, pager, active, className = "", children }: Props) {
  const offset = usePageOffset(pager, index);
  const p = useTransform(offset, presence);
  const dir = useTransform(offset, (o) => (o >= 0 ? 1 : -1));
  const y = useTransform(offset, (o) => `${o * 12}vh`);
  const visibility = useTransform(offset, (o) => (Math.abs(o) < 1 ? "visible" : "hidden"));

  return (
    <motion.section
      id={id}
      data-page={index}
      className={`page page-${id} ${className}`}
      aria-labelledby={`${id}-title`}
      inert={!active}
      style={{ "--p": p, "--dir": dir, y, visibility } as unknown as CSSProperties}
    >
      <div className="page-scroll" data-scroller>
        <div className="page-inner">{children}</div>
      </div>
    </motion.section>
  );
}
