/*
 * The window zoom: how the overview's two windows open their pages, after rhine-lock's unlock and lock
 * animations (https://github.com/tmc5csxr9m-cpu/rhine-lock, App.svelte and lib/transition.ts), with the
 * same timings in milliseconds.
 *
 * Opening (rhine-lock's unlock): the window turns into a small picture of its page, which flies out
 * along a curve until it fills the screen, while the rest of the overview fades away and the ∞ peels
 * apart. Closing (rhine-lock's lock): the page shrinks back into its window and the ∞ draws itself again.
 *
 * Everything here is a pure function of the time since the zoom started; usePager runs the clock.
 */

export type ZoomDir = "open" | "close";

/** How long each direction takes (ms). */
export const ZOOM_MS: Record<ZoomDir, number> = { open: 1230, close: 1350 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** 0 before `a`, 1 after `b`, smooth in between. */
export const smooth = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);

/** Everything that changes during a zoom, `t` ms after it started. */
export interface ZoomFrame {
  ui: number; // the rest of the overview: 1 shown, 0 gone
  slide: number; // opening only: the other window slides off the screen (0..1)
  tile: number; // the window being opened or closed into: 1 shown
  e: number; // where the page is: 0 full screen, 1 shrunk into its window
  card: number; // the page's opacity
  paper: number; // the page's own copy of the paper (it hands over to the real one at the end of an opening)
  desat: number; // 1 = washed out, like rhine-lock's specimen card
  corners: number; // the orange viewfinder corners
  caption: number; // the caption under the page
  scan: number; // the lime scan line's way down the page (outside 0..1: not shown)
}

export function zoomFrame(dir: ZoomDir, t: number): ZoomFrame {
  if (dir === "open") {
    const exit = smooth(180, 600, t);
    return {
      ui: 1 - exit,
      slide: exit,
      tile: 1 - smooth(420, 620, t),
      e: 1 - easeInOutCubic(clamp01((t - 560) / 660)),
      card: smooth(380, 600, t),
      paper: 1 - smooth(1050, 1230, t),
      desat: 1 - smooth(600, 1150, t),
      corners: smooth(700, 950, t) * (1 - smooth(1120, 1220, t)),
      caption: smooth(600, 760, t) * (1 - smooth(1000, 1150, t)),
      scan: -1,
    };
  }
  return {
    ui: outCubic(clamp01((t - 480) / (1350 - 480))),
    slide: 0,
    tile: smooth(880, 1150, t),
    e: easeInOutCubic(clamp01(t / 1050)),
    card: 1 - smooth(950, 1200, t),
    paper: smooth(0, 100, t),
    desat: smooth(60, 600, t),
    corners: 1 - smooth(560, 860, t),
    caption: smooth(150, 350, t) * (1 - smooth(760, 960, t)),
    scan: (t - 80) / 440,
  };
}

export interface CardPose {
  cx: number; // centre (px)
  cy: number;
  s: number; // scale of the full-screen page
  tilt: number; // rotateY (deg)
  radius: number; // corner radius on screen (px)
  arc: number; // 0 at either end, 1 mid-flight (shadow strength)
}

/**
 * rhine-lock's SnapCard.pose(): `e` = 0 is the whole screen, 1 is `target`. Log-scale shrink (so it
 * looks even), a quadratic curve bowing up between the two centres, and tilt, corner radius and shadow
 * peaking mid-flight. Opening and closing follow the same path, so they mirror each other exactly.
 */
export function cardPose(e: number, target: Rect, vw: number, vh: number): CardPose {
  const sT = Math.min(target.w / vw, target.h / vh);
  const s = Math.exp(Math.log(sT) * e);
  const p0 = { x: vw / 2, y: vh / 2 };
  const p2 = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const p1 = { x: p0.x * 0.55 + p2.x * 0.45, y: Math.min(p0.y, p2.y) - vh * 0.16 };
  const u = 1 - e;
  const cx = u * u * p0.x + 2 * u * e * p1.x + e * e * p2.x;
  const cy = u * u * p0.y + 2 * u * e * p1.y + e * e * p2.y;
  const arc = Math.sin(Math.PI * e);
  // rhine-lock's tile is on the left of the screen; a window on the right tilts the other way
  const side = p2.x <= vw / 2 ? 1 : -1;
  return { cx, cy, s, tilt: -13 * arc * side, radius: 18 * arc, arc };
}
