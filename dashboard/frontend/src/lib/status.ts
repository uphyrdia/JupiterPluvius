import type { IconName } from "../components/Icon";
import { CONFIG } from "../config";
import type { Telemetry } from "../hooks/useTelemetry";
import type { AiPriority, AiStatus } from "./api";
import { ago } from "./format";

/** Status tones map to the fixed status colours in base.css (always shown with an icon or label). */
export type Tone = "good" | "warning" | "serious" | "critical" | "muted";

export interface LinkStatus {
  tone: Tone;
  label: string;
  detail: string;
}

/** Is the backend reachable, and is the device still sending readings? */
export function linkStatus(t: Telemetry, now: number): LinkStatus {
  if (t.error) return { tone: "critical", label: "Link lost", detail: t.error };
  if (!t.loaded) return { tone: "muted", label: "Connecting", detail: "Waking the server…" };
  if (!t.latest) return { tone: "muted", label: "No data", detail: "No readings yet" };
  const age = (now - t.latest.t) / 1000;
  if (age > CONFIG.STALE_AFTER_S) return { tone: "warning", label: "Device offline", detail: `Last reading ${ago(age)}` };
  return { tone: "good", label: "Live", detail: `Last reading ${ago(age)}` };
}

export const AI_STATUS: Record<AiStatus, { tone: Tone; icon: IconName; label: string }> = {
  good: { tone: "good", icon: "check", label: "All good" },
  attention: { tone: "warning", icon: "alert", label: "Needs attention" },
  urgent: { tone: "critical", icon: "stop", label: "Urgent" },
};

export const AI_PRIORITY: Record<AiPriority, { tone: Tone; icon: IconName; label: string }> = {
  info: { tone: "muted", icon: "info", label: "Info" },
  warning: { tone: "warning", icon: "alert", label: "Warning" },
  urgent: { tone: "critical", icon: "stop", label: "Urgent" },
};
