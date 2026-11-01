import { CONFIG } from "../config";

/** One row of the Supabase `readings` table (see dashboard/sql_1.txt). */
export interface Reading {
  id: number;
  created_at: string; // ISO timestamp, UTC
  device_id: string;
  temperature: number | null; // °C
  humidity: number | null; // % relative humidity
  soil_adc_raw: number | null; // 0-4095, LOWER means WETTER
  light_state: boolean | null; // false = dark
  reservoir_state: boolean | null; // false = water level low
  led_state: boolean | null; // true = grow LED on
  faults: string[] | null;
  test_data: boolean;
}

/** A reading plus its timestamp parsed once (ms since epoch); charts and filters use it a lot. */
export interface Row extends Reading {
  t: number;
}

// PostgREST sends microseconds ("…:44.123456+00:00"); trim to milliseconds so every browser parses it.
export const toRow = (r: Reading): Row => ({ ...r, t: Date.parse(r.created_at.replace(/(\.\d{3})\d+/, "$1")) });

export type AiStatus = "good" | "attention" | "urgent";
export type AiPriority = "info" | "warning" | "urgent";

/** What POST /api/insights returns: DeepSeek's JSON plus a few fields the backend adds. */
export interface AiResult {
  status?: AiStatus;
  headline?: string;
  summary?: string[];
  advice?: { priority: AiPriority; text: string }[];
  raw?: string; // set instead when the model didn't return the JSON shape we asked for
  model: string;
  readings: number;
  tokens?: number | null;
}

/** An HTTP error from the backend; `detail` is FastAPI's error message. */
export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

/** Call the backend and return its JSON. Throws ApiError for HTTP errors, TypeError if unreachable. */
export async function api<T>(path: string, params: Params = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = new URL(CONFIG.API_BASE + path, window.location.href);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text; // FastAPI errors are {"detail": "..."}
    } catch {
      /* not JSON: keep the text */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

/** A short, human-readable message for anything `api()` can throw. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.detail || `HTTP ${e.status}`;
  if (e instanceof TypeError) return "Backend unreachable";
  return e instanceof Error ? e.message : String(e);
}
