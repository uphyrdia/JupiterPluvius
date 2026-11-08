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
