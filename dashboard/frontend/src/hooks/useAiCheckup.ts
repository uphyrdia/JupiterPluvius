import { useCallback, useRef, useState } from "react";
import { CONFIG } from "../config";
import { api, errorText, type AiResult } from "../lib/api";

export type AiState =
  | { phase: "idle" }
  | { phase: "running"; startedAt: number; hours: number; includeTest: boolean }
  | { phase: "done"; result: AiResult; seconds: number; hours: number; includeTest: boolean; at: number }
  | { phase: "error"; message: string; hours: number };

/** The "AI check-up": asks the backend (which asks DeepSeek) to summarise the readings in range. */
export function useAiCheckup(hours: number, includeTest: boolean) {
  const [state, setState] = useState<AiState>({ phase: "idle" });
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const startedAt = performance.now();
    setState({ phase: "running", startedAt, hours, includeTest });
    try {
      const result = await api<AiResult>(
        "/api/insights",
        {
          hours,
          include_test: includeTest,
          tz_offset_min: -new Date().getTimezoneOffset(), // so the model quotes times in your time zone
          soil_dry_raw: CONFIG.SOIL_DRY_RAW,
          soil_wet_raw: CONFIG.SOIL_WET_RAW,
        },
        "POST",
      );
      const seconds = (performance.now() - startedAt) / 1000;
      setState({ phase: "done", result, seconds, hours, includeTest, at: Date.now() });
    } catch (e) {
      setState({ phase: "error", message: errorText(e), hours });
    } finally {
      running.current = false;
    }
  }, [hours, includeTest]);

  return { state, run };
}
