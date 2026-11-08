import { useEffect, useState } from "react";
import { CONFIG } from "../config";
import { api, errorText, toRow, type Reading, type Row } from "../lib/api";

export interface Telemetry {
  rows: Row[]; // readings in the selected window, oldest first (at most ~MAX_ROWS, evenly thinned)
  thinned: boolean; // whether `rows` is a thinned sample of the window rather than every reading
  recent: Row[]; // the newest RECENT_ROWS readings in the window, oldest first, never thinned (for the log)
  latest: Row | null; // newest reading overall (may be older than the window)
  error: string | null; // set while the backend can't be reached
  loading: boolean; // a full (re)load is in flight
  loaded: boolean; // the first load has finished (successfully or not)
  updatedAt: number; // when we last heard from the backend; charts use it as "now"
}

/** The backend thins a window to this many readings (MAX_ROWS in backend/config.py). */
const MAX_ROWS = 1000;
/** How many of the latest readings the log's table shows. */
const RECENT_ROWS = 20;

/** In a thinned window, kept readings are at least this far apart: the backend's spacing. */
const spacing = (hours: number) => (hours * 3600e3) / MAX_ROWS;

/**
 * Thin `rows` (oldest first) to about MAX_ROWS evenly spread over the window: keep a reading once
 * it is at least `spacing` after the last one kept, and always keep the newest reading.
 */
function thinRows(rows: Row[], hours: number): Row[] {
  const min = spacing(hours);
  const out: Row[] = [];
  for (const r of rows) {
    if (!out.length || r.t - out[out.length - 1].t >= min) out.push(r);
  }
  const newest = rows[rows.length - 1];
  if (newest && out[out.length - 1] !== newest) out.push(newest);
  return out;
}

/**
 * Add new readings to a thinned window at the same density as the rest. The last reading stays
 * only as "the newest" until it is `spacing` after the one before it: until then, each new
 * reading replaces it.
 */
function appendThinned(rows: Row[], fresh: Row[], hours: number): Row[] {
  const min = spacing(hours);
  const out = rows.slice();
  for (const r of fresh) {
    const n = out.length;
    if (n >= 2 && out[n - 1].t - out[n - 2].t < min) out[n - 1] = r;
    else out.push(r);
  }
  return out;
}

/**
 * Loads the readings for the last `hours`, then polls every POLL_MS for new ones.
 * Changing `hours` or `includeTest` starts over (the effect re-runs and the old one is ignored).
 */
export function useTelemetry(hours: number, includeTest: boolean): Telemetry {
  const [state, setState] = useState<Telemetry>({
    rows: [], thinned: false, recent: [], latest: null, error: null, loading: true, loaded: false,
    updatedAt: Date.now(),
  });

  useEffect(() => {
    let alive = true; // false once this effect is cleaned up: late responses are then ignored
    let busy = false; // never run two requests at once
    let rows: Row[] = [];
    let thinned = false;
    let recent: Row[] = [];
    let latest: Row | null = null;
    const filters = { hours, include_test: includeTest };
    const fetchRecent = async () =>
      (await api<Reading[]>("/api/recent", { ...filters, limit: RECENT_ROWS })).map(toRow);

    setState((s) => ({ ...s, loading: true }));

    async function load() {
      busy = true;
      try {
        const [fresh, newest, last] = await Promise.all([
          api<Reading[]>("/api/readings", filters),
          api<Reading | null>("/api/latest", { include_test: includeTest }),
          fetchRecent(),
        ]);
        if (!alive) return;
        rows = fresh.map(toRow);
        thinned = rows.length >= MAX_ROWS; // the backend returns exactly MAX_ROWS when it thinned
        recent = last;
        latest = newest && toRow(newest);
        setState({ rows, thinned, recent, latest, error: null, loading: false, loaded: true, updatedAt: Date.now() });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: errorText(e), loading: false, loaded: true }));
      } finally {
        busy = false;
      }
    }

    async function poll() {
      if (busy) return;
      busy = true;
      try {
        const newest = await api<Reading | null>("/api/latest", { include_test: includeTest });
        if (!alive) return;
        let next = rows;
        if (newest && newest.id !== latest?.id) {
          // Something new: fetch only the rows after the last one we have.
          const afterId = rows.length ? rows[rows.length - 1].id : undefined;
          const fresh = (await api<Reading[]>("/api/readings", { ...filters, after_id: afterId })).map(toRow);
          // Polled readings are every new reading, unless there were so many that the backend
          // thinned them (e.g. the tab slept): then ask for the latest ones again.
          // (`recent` was fetched separately, so it may already hold some of them.)
          const lastId = recent.length ? recent[recent.length - 1].id : -Infinity;
          const last = fresh.length >= MAX_ROWS
            ? await fetchRecent()
            : [...recent, ...fresh.filter((r) => r.id > lastId)].slice(-RECENT_ROWS);
          if (!alive) return;
          // New readings arrive at full rate: in a thinned window, add them as sparsely as the rest.
          next = thinned ? appendThinned(rows, fresh, hours) : [...rows, ...fresh];
          recent = last;
          latest = toRow(newest);
        }
        // Drop rows that slid out of the window.
        const since = Date.now() - hours * 3600e3;
        if (next.length && next[0].t < since) next = next.filter((r) => r.t >= since);
        if (recent.length && recent[0].t < since) recent = recent.filter((r) => r.t >= since);
        // A full-rate window that grew past MAX_ROWS is thinned from now on, as the backend would.
        if (!thinned && next.length > MAX_ROWS) {
          next = thinRows(next, hours);
          thinned = true;
        }
        rows = next;
        setState({ rows, thinned, recent, latest, error: null, loading: false, loaded: true, updatedAt: Date.now() });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: errorText(e) }));
      } finally {
        busy = false;
      }
    }

    load();
    const timer = window.setInterval(poll, CONFIG.POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [hours, includeTest]);

  return state;
}
