import { useEffect, useState } from "react";
import { CONFIG } from "../config";
import { api, errorText, toRow, type Reading, type Row } from "../lib/api";

export interface Telemetry {
  rows: Row[]; // readings in the selected window, oldest first (at most ~1000, thinned by the backend)
  latest: Row | null; // newest reading overall (may be older than the window)
  error: string | null; // set while the backend can't be reached
  loading: boolean; // a full (re)load is in flight
  loaded: boolean; // the first load has finished (successfully or not)
  updatedAt: number; // when we last heard from the backend; charts use it as "now"
}

/**
 * Loads the readings for the last `hours`, then polls every POLL_MS for new ones.
 * Changing `hours` or `includeTest` starts over (the effect re-runs and the old one is ignored).
 */
export function useTelemetry(hours: number, includeTest: boolean): Telemetry {
  const [state, setState] = useState<Telemetry>({
    rows: [], latest: null, error: null, loading: true, loaded: false, updatedAt: Date.now(),
  });

  useEffect(() => {
    let alive = true; // false once this effect is cleaned up: late responses are then ignored
    let busy = false; // never run two requests at once
    let rows: Row[] = [];
    let latest: Row | null = null;
    const filters = { hours, include_test: includeTest };

    setState((s) => ({ ...s, loading: true }));

    async function load() {
      busy = true;
      try {
        const [fresh, newest] = await Promise.all([
          api<Reading[]>("/api/readings", filters),
          api<Reading | null>("/api/latest", { include_test: includeTest }),
        ]);
        if (!alive) return;
        rows = fresh.map(toRow);
        latest = newest && toRow(newest);
        setState({ rows, latest, error: null, loading: false, loaded: true, updatedAt: Date.now() });
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
          const fresh = await api<Reading[]>("/api/readings", { ...filters, after_id: afterId });
          if (!alive) return;
          next = [...rows, ...fresh.map(toRow)];
          latest = toRow(newest);
        }
        // Drop rows that slid out of the window.
        const since = Date.now() - hours * 3600e3;
        if (next.length && next[0].t < since) next = next.filter((r) => r.t >= since);
        rows = next;
        setState({ rows, latest, error: null, loading: false, loaded: true, updatedAt: Date.now() });
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
