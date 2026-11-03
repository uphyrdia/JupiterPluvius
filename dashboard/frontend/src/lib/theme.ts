/**
 * Per-page colours. As you move between pages, the page background, the ink and the 3D ribbon's
 * haze all interpolate between these stops (one per page), so the whole scene changes smoothly:
 * paper-white overview -> cool grey trends -> deep ultramarine analysis -> night-blue log.
 */
export const THEME_STOPS = {
  bg: ["#ebeae6", "#e3e4e7", "#13249c", "#0a1238"],
  ink: ["#141414", "#121318", "#f4f6ff", "#eef1ff"],
  ink2: ["#4b4b48", "#464a53", "#c9d1f8", "#b9c1e2"],
  ink3: ["#8b8a85", "#83878f", "#94a0dc", "#7e88b0"],
  rule: ["rgba(20,20,20,0.16)", "rgba(18,19,24,0.16)", "rgba(255,255,255,0.24)", "rgba(255,255,255,0.18)"],
  panel: ["rgba(255,255,255,0.46)", "rgba(244,245,247,0.8)", "rgba(11,24,118,0.8)", "rgba(9,15,56,0.78)"],
  accent: ["#2b47e6", "#2b47e6", "#b3c3ff", "#9db1ff"],
  chip: ["#141414", "#121318", "#f4f6ff", "#eef1ff"], // tag background
  chipInk: ["#f4f4f2", "#f2f3f5", "#13249c", "#0a1238"], // tag text
} as const;

/*
 * Light -> dark happens in the middle of the jump from page 2 to page 3 (scroll position 1.28-1.72)
 * rather than spread over the whole jump, so it reads like the trailer's inversion and text never
 * sits mid-grey on a mid-grey background for long.
 */
export const THEME_AT = [0, 1, 1.28, 1.72, 2, 3];
export const themeValues = <T,>(stops: readonly T[]) => [stops[0], stops[1], stops[1], stops[2], stops[2], stops[3]];

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A hex colour list from THEME_STOPS, interpolated at scroll position `p`, as [r, g, b] 0-255. */
export function rgbAt(stops: readonly string[], p: number): [number, number, number] {
  const values = themeValues(stops);
  const x = Math.max(THEME_AT[0], Math.min(THEME_AT[THEME_AT.length - 1], p));
  let i = 0;
  while (i < THEME_AT.length - 2 && x > THEME_AT[i + 1]) i++;
  const f = (x - THEME_AT[i]) / (THEME_AT[i + 1] - THEME_AT[i]);
  const a = hex(values[i]), b = hex(values[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
