import { animate, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { PAGE_IDS, parentOf } from "../config";

/*
 * Full-screen "pages" and how you move between them.
 *
 * The overview and the log form a short scroll. Instead of scrolling freely, the wheel (or a swipe)
 * first makes the view creep a little toward the next page, like pulling against a spring. Once the
 * gesture passes a threshold, the dashboard jumps to that page in one smooth animation; if the
 * gesture stops short, it springs back. Trends and Analysis are not on the scroll: they open from
 * the overview's two windows with the same jump, and go back with Esc, the back button or by
 * scrolling up.
 *
 * Every page has a "slot" on a vertical line and the view sits at `pos` on that line: a page whose
 * slot is 1 while `pos` is 0 waits one screen below. A jump puts the target page one slot below (or
 * above) the current one and animates `pos` there, so any two pages can swap directly; pages that
 * take no part are parked out of sight (HIDDEN). Both are Motion values, so the pages, the
 * background and the 3D ribbon follow them 60 times a second without re-rendering React.
 */

const WHEEL_THRESHOLD = 320; // px of wheel travel that triggers a jump (about 3 mouse-wheel notches)
const WHEEL_CREEP = 0.07; // how far (in pages) the view creeps toward the next page before the jump
const TOUCH_CREEP = 0.16; // a swipe follows the finger a little further
const SETTLE_MS = 260; // wheel quiet this long without reaching the threshold -> spring back
const LOCK_MS = 900; // after a jump, ignore the wheel for this long...
const LOCK_MAX_MS = 2000; // ...or longer while a trackpad's inertia keeps scrolling, up to this
const INNER_PAUSE_MS = 280; // after scrolling a panel inside a page, pause this long before paging
export const HIDDEN = 1000; // the slot of pages that take no part in the current move

export const JUMP_S = 1.25;
const JUMP = { duration: JUMP_S, ease: [0.76, 0, 0.18, 1] as const };

export interface Pager {
  pos: MotionValue<number>; // where the view is on the line of slots
  slots: MotionValue<number[]>; // each page's slot (HIDDEN = out of sight)
  pull: MotionValue<number>; // -1..1: how close the current gesture is to the threshold
  index: number; // the page we're on (or heading to)
  goTo: (i: number) => void;
}

/** The pages on the scroll, in order (the ones without a parent). */
export const SCROLL = PAGE_IDS.map((_, i) => i).filter((i) => parentOf(i) < 0);

/** The page a scroll gesture in direction `dir` (+1 down, -1 up) leads to from page `i`, or -1. */
export function neighbour(i: number, dir: number): number {
  const parent = parentOf(i);
  if (parent >= 0) return dir < 0 ? parent : -1; // scrolling up on a detail page goes back
  return SCROLL[SCROLL.indexOf(i) + dir] ?? -1;
}

/** How far page `i` is from the view, in pages: 0 = on screen, +1 = a screen below, -1 = above. */
export function usePageOffset(pager: Pick<Pager, "pos" | "slots">, i: number): MotionValue<number> {
  return useTransform(() => pager.slots.get()[i] - pager.pos.get());
}

/** A page's presence for its offset: 1 on screen, 0 from 0.82 pages away (so a creeping gesture keeps the next page hidden). */
export const presence = (offset: number) => Math.max(0, 1 - Math.abs(offset) / 0.82);

const wheelPx = (e: WheelEvent) =>
  e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;

const canScroll = (el: HTMLElement, dy: number) =>
  el.scrollHeight > el.clientHeight + 1 &&
  (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);

/** A scrollable panel between `el` and `root` that can still scroll in direction `dy`, if any. */
function scrollableAncestor(el: Element | null, root: Element, dy: number): HTMLElement | null {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (!(n instanceof HTMLElement) || !canScroll(n, dy)) continue;
    const { overflowY } = getComputedStyle(n);
    if (overflowY === "auto" || overflowY === "scroll") return n;
  }
  return null;
}

export function usePager(rootRef: RefObject<HTMLElement | null>, reduceMotion: boolean): Pager {
  const count = PAGE_IDS.length;
  const [index, setIndex] = useState(() => Math.max(0, PAGE_IDS.indexOf(window.location.hash.slice(1))));
  const pos = useMotionValue(0);
  const slots = useMotionValue<number[]>(PAGE_IDS.map((_, i) => (i === index ? 0 : HIDDEN)));
  const pull = useMotionValue(0);

  // Gesture bookkeeping changes on every wheel event, so it lives in a ref (no re-renders).
  const g = useRef({
    index,
    acc: 0, // accumulated wheel travel of the current gesture (px)
    lastWheel: 0,
    lockStart: 0,
    lockUntil: 0,
    innerUntil: 0,
    animEnd: 0, // when the current jump animation finishes
    settle: 0, // timer id
    anim: null as { stop(): void } | null,
  });

  /** Park page `target` next to the current page (below it if it comes later in PAGES), the rest out of sight. */
  const place = useCallback(
    (target: number) => {
      const cur = g.current.index;
      const now = slots.get();
      const base = now[cur];
      const want = target === cur ? base : base + (target > cur ? 1 : -1);
      if (now.every((v, i) => v === (i === cur ? base : i === target ? want : HIDDEN))) return;
      slots.set(now.map((_, i) => (i === cur ? base : i === target ? want : HIDDEN)));
    },
    [slots],
  );

  const goTo = useCallback(
    (i: number) => {
      const s = g.current;
      const target = Math.max(0, Math.min(count - 1, i));
      const now = performance.now();
      window.clearTimeout(s.settle);
      s.acc = 0;
      animate(pull, 0, { duration: 0.25 });
      s.anim?.stop();
      place(target);
      const opts = reduceMotion ? { duration: 0.35, ease: "easeOut" as const } : JUMP;
      s.anim = animate(pos, slots.get()[target], opts);
      s.animEnd = now + opts.duration * 1000;
      s.lockStart = now;
      s.lockUntil = now + LOCK_MS;
      if (target !== s.index) {
        s.index = target;
        setIndex(target);
      }
    },
    [count, place, pos, slots, pull, reduceMotion],
  );

  /** Move part of the way toward the neighbouring page (`v` in -1..1 is the gesture's progress). */
  const creep = useCallback(
    (v: number, amount: number) => {
      const s = g.current;
      s.anim?.stop();
      s.anim = null;
      pull.set(v);
      const next = neighbour(s.index, Math.sign(v));
      if (next >= 0) place(next);
      const eased = Math.sign(v) * (1 - (1 - Math.abs(v)) ** 2);
      pos.set(slots.get()[s.index] + eased * amount);
    },
    [place, pos, slots, pull],
  );

  const springBack = useCallback(() => {
    const s = g.current;
    s.acc = 0;
    animate(pull, 0, { duration: 0.35, ease: "easeOut" });
    if (performance.now() < s.animEnd) return; // a jump is still gliding to the right place
    s.anim?.stop();
    s.anim = animate(pos, slots.get()[s.index], { type: "spring", stiffness: 240, damping: 26 });
  }, [pos, slots, pull]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = g.current;
    const atEdge = (dir: number) => neighbour(s.index, dir) < 0;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // trackpad pinch-zoom
      const dy = wheelPx(e);
      if (Math.abs(e.deltaX) > Math.abs(dy)) return; // sideways scrolling (wide tables)
      const now = performance.now();
      if (scrollableAncestor(e.target as Element, root, dy)) {
        s.innerUntil = now + INNER_PAUSE_MS; // let the panel scroll natively
        return;
      }
      e.preventDefault();
      const quietFor = now - s.lastWheel;
      s.lastWheel = now;
      if (now < s.innerUntil) {
        s.innerUntil = now + INNER_PAUSE_MS; // the panel just hit its end: wait for a pause first
        return;
      }
      if (now < s.lockUntil) {
        // Trackpads keep firing decaying "inertia" events after a flick: swallow them.
        if (quietFor < 100) s.lockUntil = Math.min(now + 140, s.lockStart + LOCK_MAX_MS);
        return;
      }
      s.acc = Math.max(-WHEEL_THRESHOLD, Math.min(WHEEL_THRESHOLD, s.acc + dy));
      const dir = Math.sign(s.acc);
      if (dir && !atEdge(dir) && Math.abs(s.acc) >= WHEEL_THRESHOLD) {
        goTo(neighbour(s.index, dir));
        return;
      }
      const v = s.acc / WHEEL_THRESHOLD;
      if (now >= s.animEnd) creep(atEdge(dir) ? v * 0.3 : v, WHEEL_CREEP);
      else pull.set(v);
      window.clearTimeout(s.settle);
      s.settle = window.setTimeout(springBack, SETTLE_MS);
    };

    let touch: { x: number; y: number; lastY: number; lastT: number; vel: number; mode: "?" | "native" | "page" } | null =
      null;
    const onTouchStart = (e: TouchEvent) => {
      const p = e.touches[0];
      touch = e.touches.length === 1 ? { x: p.clientX, y: p.clientY, lastY: p.clientY, lastT: performance.now(), vel: 0, mode: "?" } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touch || e.touches.length !== 1) return;
      const p = e.touches[0];
      const dy = touch.y - p.clientY; // > 0: the finger moved up, i.e. "scroll down"
      if (touch.mode === "?") {
        if (Math.abs(dy) < 8 && Math.abs(p.clientX - touch.x) < 8) return;
        const sideways = Math.abs(p.clientX - touch.x) > Math.abs(dy);
        const inner = scrollableAncestor(e.target as Element, root, dy);
        touch.mode = sideways || inner || performance.now() < s.animEnd ? "native" : "page";
      }
      if (touch.mode !== "page") return;
      e.preventDefault();
      const now = performance.now();
      touch.vel = (touch.lastY - p.clientY) / Math.max(1, now - touch.lastT);
      touch.lastY = p.clientY;
      touch.lastT = now;
      const v = Math.max(-1, Math.min(1, dy / (window.innerHeight * 0.4)));
      creep(atEdge(Math.sign(dy)) ? v * 0.3 : v, TOUCH_CREEP);
    };
    const onTouchEnd = () => {
      if (touch?.mode === "page") {
        const v = pull.get();
        const dir = Math.sign(v);
        const flick = Math.abs(touch.vel) > 0.5 && Math.sign(touch.vel) === dir;
        if (dir && !atEdge(dir) && (Math.abs(v) > 0.35 || flick)) goTo(neighbour(s.index, dir));
        else springBack();
      }
      touch = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "Escape") {
        if (parentOf(s.index) >= 0) goTo(parentOf(s.index));
        return;
      }
      let dir = 0;
      if (e.key === "ArrowDown" || e.key === "PageDown") dir = 1;
      else if (e.key === "ArrowUp" || e.key === "PageUp") dir = -1;
      else if (e.key === " ") {
        if (target.closest("button, a, [role='button']")) return; // Space presses the focused button
        dir = e.shiftKey ? -1 : 1;
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        goTo(e.key === "Home" ? SCROLL[0] : SCROLL[SCROLL.length - 1]);
        return;
      }
      if (!dir) return;
      e.preventDefault();
      // A page taller than the screen scrolls first; at its end, the next press turns the page.
      const scroller = root.querySelector<HTMLElement>(`[data-page="${s.index}"] [data-scroller]`);
      if (scroller && canScroll(scroller, dir)) {
        const step = e.key.startsWith("Arrow") ? 120 : scroller.clientHeight * 0.85;
        scroller.scrollBy({ top: dir * step, behavior: reduceMotion ? "auto" : "smooth" });
        return;
      }
      if (!atEdge(dir)) goTo(neighbour(s.index, dir));
    };

    const onHash = () => {
      const i = PAGE_IDS.indexOf(window.location.hash.slice(1));
      if (i >= 0) goTo(i);
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
      window.clearTimeout(s.settle);
    };
  }, [rootRef, goTo, creep, springBack, pull, reduceMotion]);

  // Keep the URL in sync (#trends, #analysis, …) so a reload or a shared link opens the same page.
  useEffect(() => {
    const url = index === 0 ? window.location.pathname + window.location.search : `#${PAGE_IDS[index]}`;
    window.history.replaceState(null, "", url);
  }, [index]);

  return { pos, slots, pull, index, goTo };
}
