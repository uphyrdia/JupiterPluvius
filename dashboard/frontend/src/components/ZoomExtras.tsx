import { motion, useTransform } from "motion/react";
import { useMemo, useRef } from "react";
import { PAGES } from "../config";
import type { Pager } from "../hooks/usePager";
import { fmtClock } from "../lib/format";
import { cardPose, smooth, zoomFrame } from "../lib/zoom";

/**
 * The parts of the window zoom that sit on the screen rather than on the flying page (see PageFrame):
 * the page's shadow, strongest mid-flight, and a small caption under it, as in rhine-lock.
 */
export function ZoomExtras({ pager }: { pager: Pager }) {
  const { zoom, zt } = pager;
  const state = useTransform(() => {
    const t = zt.get();
    if (!zoom) return null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const f = zoomFrame(zoom.dir, t);
    const c = cardPose(f.e, zoom.rect, vw, vh);
    return { f, c, w: vw * c.s, h: vh * c.s };
  });

  const width = useTransform(() => state.get()?.w ?? 0);
  const height = useTransform(() => state.get()?.h ?? 0);
  const shadowTransform = useTransform(() => {
    const q = state.get();
    return q ? `translate(${q.c.cx - q.w / 2}px, ${q.c.cy - q.h / 2}px) perspective(1800px) rotateY(${q.c.tilt}deg)` : "none";
  });
  const borderRadius = useTransform(() => `${state.get()?.c.radius ?? 0}px`);
  const boxShadow = useTransform(() => {
    const arc = state.get()?.c.arc ?? 0;
    return arc > 0.01 ? `0 26px 70px rgba(44, 36, 24, ${0.34 * arc})` : "none";
  });
  const shadowOpacity = useTransform(() => state.get()?.f.card ?? 0);
  const captionRef = useRef<HTMLDivElement>(null);
  const captionTransform = useTransform(() => {
    const q = state.get();
    if (!q) return "none";
    // under the page's left edge, but never off the screen (it's wider than a phone's page)
    const room = window.innerWidth - (captionRef.current?.offsetWidth ?? 0) - 8;
    return `translate(${Math.max(8, Math.min(room, q.c.cx - q.w / 2))}px, ${q.c.cy + q.h / 2 + 14}px)`;
  });
  // (it gives way before it would run into the bottom bar, once the page is nearly full screen)
  const captionOpacity = useTransform(() => {
    const q = state.get();
    if (!q) return 0;
    const top = q.c.cy + q.h / 2 + 14, vh = window.innerHeight;
    return q.f.caption * (1 - smooth(vh - 130, vh - 90, top));
  });

  const caption = useMemo(() => {
    if (!zoom) return "";
    const name = PAGES[zoom.page].label.toUpperCase();
    return zoom.dir === "open"
      ? `PERMISSION AUTHORIZED · OPENING ${name}`
      : `SNAPSHOT · ${name} SEALED ${fmtClock(Date.now())}`;
  }, [zoom]);

  if (!zoom) return null;
  return (
    <>
      <motion.div
        className="zoom-shadow"
        aria-hidden="true"
        style={{ width, height, transform: shadowTransform, borderRadius, boxShadow, opacity: shadowOpacity }}
      />
      <motion.div
        ref={captionRef}
        className="zoom-caption"
        aria-hidden="true"
        style={{ transform: captionTransform, opacity: captionOpacity }}
      >
        {caption}
      </motion.div>
    </>
  );
}
