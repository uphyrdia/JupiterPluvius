import { CONFIG } from "../config";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Soil ADC is inversely related to moisture: map raw [dry, wet] -> [0, 1]. */
export function moistureFraction(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  return clamp01((CONFIG.SOIL_DRY_RAW - raw) / (CONFIG.SOIL_DRY_RAW - CONFIG.SOIL_WET_RAW));
}

export const moisturePct = (raw: number | null | undefined) => {
  const f = moistureFraction(raw);
  return f == null ? null : f * 100;
};

export function moistureWord(f: number | null): string {
  if (f == null) return "No data";
  if (f < 0.15) return "Very dry";
  if (f < 0.4) return "Dry";
  if (f < 0.7) return "Moist";
  return "Wet";
}

// The ribbon (and the moisture meter) go from white-ish blue (dry) to deep ultramarine (wet).
export const MOISTURE_STOPS = ["#dfe7f7", "#3354e6", "#0a1c74"] as const; // dry, mid, wet
export const NO_DATA_COLOR = "#c9ccd4";

type RGB = [number, number, number];
const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
export const mixHex = (a: string, b: string, t: number) => {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => pa[i] + (pb[i] - pa[i]) * t) as RGB);
};

/** Colour of the slats for a moisture fraction (null = no data). */
export function moistureColor(f: number | null): string {
  if (f == null) return NO_DATA_COLOR;
  const [dry, mid, wet] = MOISTURE_STOPS;
  return f < 0.5 ? mixHex(dry, mid, f / 0.5) : mixHex(mid, wet, (f - 0.5) / 0.5);
}

/** Edge lines: blue on pale (dry) slats, white on dark (wet) ones, so they always stand out. */
export function moistureEdge(f: number | null): string {
  if (f == null) return "#8b919d";
  const k = clamp01((f - 0.32) / 0.3);
  return mixHex("#2b47e0", "#e4eaff", k);
}
