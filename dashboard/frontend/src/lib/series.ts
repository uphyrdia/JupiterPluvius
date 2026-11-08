import { bisector } from "d3-array";
import { CONFIG } from "../config";
import type { Row } from "./api";

/** A chart point: time, value, and the reading it came from (for tooltips). */
export interface Pt {
  t: number;
  v: number;
  row: Row;
  afterMissing?: boolean; // readings without this value came just before it: the line breaks here
}

/** What counts as "missing data": GAP_MS, or 3x the average spacing for thinned long ranges. */
export function gapMs(rows: Row[]): number {
  if (rows.length < 2) return CONFIG.GAP_MS;
  const spacing = (rows[rows.length - 1].t - rows[0].t) / (rows.length - 1);
  return Math.max(CONFIG.GAP_MS, 3 * spacing);
}

/**
 * Rows -> points, skipping readings where the value is missing (e.g. the sensor was unavailable).
 * The point after such readings is marked, so the line breaks there however short the outage was.
 */
export function toPoints(rows: Row[], pick: (r: Row) => number | null): Pt[] {
  const out: Pt[] = [];
  let missing = false;
  for (const row of rows) {
    const v = pick(row);
    if (v == null || !Number.isFinite(v)) {
      missing = true;
      continue;
    }
    out.push(missing ? { t: row.t, v, row, afterMissing: true } : { t: row.t, v, row });
    missing = false;
  }
  return out;
}

/**
 * Split points into runs, so lines break (instead of bridging) where data is missing: where
 * readings lacked the value, or where no readings arrived for longer than `gap`.
 */
export function splitAtGaps(pts: Pt[], gap: number): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (const p of pts) {
    if (run.length && (p.afterMissing || p.t - run[run.length - 1].t > gap)) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}

export function stats(pts: Pt[]): { min: number; max: number; mean: number } | null {
  if (!pts.length) return null;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const { v } of pts) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / pts.length };
}

const byTime = bisector((p: Pt) => p.t).center;

/** The point closest in time to `t` (null if there are none). */
export function nearest(pts: Pt[], t: number): Pt | null {
  if (!pts.length) return null;
  return pts[byTime(pts, t)];
}
