import { animate, useMotionValue, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/*
 * Full-screen "pages" with a scroll threshold.
 *
 * Instead of scrolling freely, the wheel (or a swipe) first makes the view creep a little toward the
 * next page, like pulling against a spring. Once the gesture passes a threshold, the dashboard jumps
 * to the next page in one smooth animation; if the gesture stops short, it springs back.
 *
 * Everything that moves (pages, background, the 3D ribbon) is driven by one number, `progress`:
 * 0 = first page, 1 = second page, 1.5 = halfway between them. It is a Motion "MotionValue", which
 * can change 60 times a second without re-rendering React components.
 */

const WHEEL_THRESHOLD = 320; // px of wheel travel that triggers a jump (about 3 mouse-wheel notches)
const WHEEL_CREEP = 0.07; // how far (in pages) the view creeps toward the next page before the jump
const TOUCH_CREEP = 0.16; // a swipe follows the finger a little further
const SETTLE_MS = 260; // wheel quiet this long without reaching the threshold -> spring back
const LOCK_MS = 900; // after a jump, ignore the wheel for this long...
const LOCK_MAX_MS = 2000; // ...or longer while a trackpad's inertia keeps scrolling, up to this
const INNER_PAUSE_MS = 280; // after scrolling a panel inside a page, pause this long before paging

export const JUMP_S = 1.25;
const JUMP = { duration: JUMP_S, ease: [0.76, 0, 0.18, 1] as const };

export interface Pager {
  progress: MotionValue<number>; // continuous page position
  pull: MotionValue<number>; // -1..1: how close the current gesture is to the threshold
  index: number; // the page we're on (or heading to)
  goTo: (i: number) => void;
}

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

export function usePager(ids: readonly string[], rootRef: RefObject<HTMLElement | null>, reduceMotion: boolean): Pager {
  const count = ids.length;
  const [index, setIndex] = useState(() => Math.max(0, ids.indexOf(window.location.hash.slice(1))));
  const progress = useMotionValue(index);
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

  const goTo = useCallback(
    (i: number) => {
      const s = g.current;
      const target = Math.max(0, Math.min(count - 1, i));
      const now = performance.now();
      window.clearTimeout(s.settle);
      s.acc = 0;
      animate(pull, 0, { duration: 0.25 });
      s.anim?.stop();
      const opts = reduceMotion ? { duration: 0.35, ease: "easeOut" as const } : JUMP;
      s.anim = animate(progress, target, opts);
      s.animEnd = now + opts.duration * 1000;
      s.lockStart = now;
      s.lockUntil = now + LOCK_MS;
      if (target !== s.index) {
        s.index = target;
        setIndex(target);
      }
    },
    [count, progress, pull, reduceMotion],
  );

  /** Move part of the way toward the neighbouring page (`v` in -1..1 is the gesture's progress). */
  const creep = useCallback(
    (v: number, amount: number) => {
      const s = g.current;
      s.anim?.stop();
      s.anim = null;
      pull.set(v);
      const eased = Math.sign(v) * (1 - (1 - Math.abs(v)) ** 2);
      progress.set(s.index + eased * amount);
    },
    [progress, pull],
  );

  const springBack = useCallback(() => {
    const s = g.current;
    s.acc = 0;
    animate(pull, 0, { duration: 0.35, ease: "easeOut" });
    if (performance.now() < s.animEnd) return; // a jump is still gliding to the right place
    s.anim?.stop();
    s.anim = animate(progress, s.index, { type: "spring", stiffness: 240, damping: 26 });
  }, [progress, pull]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = g.current;
    const atEdge = (dir: number) => (dir < 0 && s.index === 0) || (dir > 0 && s.index === count - 1);

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
        goTo(s.index + dir);
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
        if (dir && !atEdge(dir) && (Math.abs(v) > 0.35 || flick)) goTo(s.index + dir);
        else springBack();
      }
      touch = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      let dir = 0;
      if (e.key === "ArrowDown" || e.key === "PageDown") dir = 1;
      else if (e.key === "ArrowUp" || e.key === "PageUp") dir = -1;
      else if (e.key === " ") {
        if (target.closest("button, a, [role='button']")) return; // Space presses the focused button
        dir = e.shiftKey ? -1 : 1;
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        goTo(e.key === "Home" ? 0 : count - 1);
        return;
      } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) {
        goTo(Number(e.key) - 1);
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
      goTo(s.index + dir);
    };

    const onHash = () => {
      const i = ids.indexOf(window.location.hash.slice(1));
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
  }, [rootRef, count, ids, goTo, creep, springBack, pull, reduceMotion]);

  // Keep the URL in sync (#trends, #analysis, …) so a reload or a shared link opens the same page.
  useEffect(() => {
    const url = index === 0 ? window.location.pathname + window.location.search : `#${ids[index]}`;
    window.history.replaceState(null, "", url);
  }, [index, ids]);

  return { progress, pull, index, goTo };
}
