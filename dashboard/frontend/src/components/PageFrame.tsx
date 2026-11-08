import { motion, useTransform, type MotionValue } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { presence, usePageOffset, type Pager } from "../hooks/usePager";
import { cardPose, clamp01, zoomFrame, type CardPose, type ZoomFrame } from "../lib/zoom";

/** The flying page's state this frame (null when the page isn't flying). */
type Card = MotionValue<{ f: ZoomFrame; c: CardPose } | null>;

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
 *
 * During a window zoom (see lib/zoom.ts) the page that opens or closes is the flying "card": it
 * shrinks into its window on the overview, with its own copy of the paper so nothing behind shows
 * through, while the overview stays put and fades its content (--dir 0: no slide).
 */
export function PageFrame({ index, id, pager, active, className = "", children }: Props) {
  const offset = usePageOffset(pager, index);
  const { zoom, zt } = pager;
  const role = !zoom ? null : zoom.page === index ? "card" : index === 0 ? "under" : null;

  const p = useTransform(() => {
    const o = offset.get();
    const t = zt.get();
    if (role === "card") return 1;
    if (role === "under" && zoom) return zoomFrame(zoom.dir, t).ui;
    return presence(o);
  });
  const dir = useTransform(() => (role ? 0 : offset.get() >= 0 ? 1 : -1));
  const y = useTransform(() => (role ? "0vh" : `${offset.get() * 12}vh`));
  const visibility = useTransform(() => (role || Math.abs(offset.get()) < 1 ? "visible" : "hidden"));

  // The card: rhine-lock's specimen card, flying between the whole screen and the window
  const pose: Card = useTransform(() => {
    const t = zt.get();
    if (role !== "card" || !zoom) return null;
    const f = zoomFrame(zoom.dir, t);
    return { f, c: cardPose(f.e, zoom.rect, window.innerWidth, window.innerHeight) };
  });
  const transform = useTransform(() => {
    const q = pose.get();
    if (!q) return "none";
    const { cx, cy, s, tilt } = q.c;
    const vw = window.innerWidth, vh = window.innerHeight;
    return `translate(${cx - vw / 2}px, ${cy - vh / 2}px) perspective(1800px) rotateY(${tilt}deg) scale(${s})`;
  });
  const borderRadius = useTransform(() => {
    const q = pose.get();
    return q ? `${q.c.radius / q.c.s}px` : "0px";
  });
  const opacity = useTransform(() => pose.get()?.f.card ?? 1);
  const filter = useTransform(() => {
    const q = pose.get();
    return q ? `saturate(${1 - 0.55 * q.f.desat}) brightness(${1 + 0.04 * q.f.desat})` : "none";
  });

  return (
    <motion.section
      id={id}
      data-page={index}
      className={`page page-${id} ${role ? `is-${role}` : ""} ${className}`}
      aria-labelledby={`${id}-title`}
      inert={!active}
      style={{ "--p": p, "--dir": dir, y, visibility } as unknown as CSSProperties}
    >
      <motion.div className="page-card" style={{ transform, borderRadius, opacity, filter }}>
        {role === "card" && <CardPaper pose={pose} />}
        <div className="page-scroll" data-scroller>
          <div className="page-inner">{children}</div>
        </div>
        {role === "card" && <CardMarks pose={pose} scanning={zoom?.dir === "close"} />}
      </motion.div>
    </motion.section>
  );
}

/** The card's own copy of the paper (the same layers as the Backdrop), so the overview doesn't show through. */
function CardPaper({ pose }: { pose: Card }) {
  const opacity = useTransform(() => pose.get()?.f.paper ?? 0);
  return (
    <motion.div className="card-paper" style={{ opacity }} aria-hidden="true">
      <div className="bd-paper" />
      <div className="bd-dots" />
      <div className="bd-grain" />
    </motion.div>
  );
}

/** Over the card: a wash of paper while it's washed out, the scan line, and the viewfinder corners. */
function CardMarks({ pose, scanning }: { pose: Card; scanning: boolean }) {
  const shade = useTransform(() => 0.12 * (pose.get()?.f.desat ?? 0));
  const scanOpacity = useTransform(() => {
    const sc = pose.get()?.f.scan ?? -1;
    return sc < 0 || sc > 1 ? 0 : Math.sin(Math.PI * sc);
  });
  const scanTransform = useTransform(() => {
    const q = pose.get();
    if (!q) return "none";
    return `translateY(${clamp01(q.f.scan) * window.innerHeight}px) scaleY(${1 / q.c.s})`;
  });
  const corners = useTransform(() => pose.get()?.f.corners ?? 0);
  const unscale = useTransform(() => `scale(${1 / (pose.get()?.c.s ?? 1)})`);
  return (
    <div className="card-marks" aria-hidden="true">
      <motion.div className="card-shade" style={{ opacity: shade }} />
      {scanning && <motion.div className="card-scan" style={{ opacity: scanOpacity, transform: scanTransform }} />}
      {(["tl", "tr", "bl", "br"] as const).map((c) => (
        <motion.i key={c} className={`card-vf ${c}`} style={{ opacity: corners, transform: unscale }} />
      ))}
    </div>
  );
}
