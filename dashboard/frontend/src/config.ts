/** Settings: tweak these to match your hardware. */
export const CONFIG = {
  /** "" = the server that serves this page. Set VITE_API_BASE at build time if the API lives elsewhere. */
  API_BASE: (import.meta.env.VITE_API_BASE as string | undefined) ?? "",
  SOIL_DRY_RAW: 1900, // soil ADC reading in dry air        -> 0 %
  SOIL_WET_RAW: 500, // soil ADC reading when fully wet     -> 100 %
  POLL_MS: 5000, // how often to check for new readings
  STALE_AFTER_S: 180, // no reading for this long -> "device offline"
  GAP_MS: 5 * 60 * 1000, // break chart lines across gaps longer than this
};

/** Time ranges offered by the range switch, in hours. */
export const RANGES = [1, 24] as const;
export const DEFAULT_HOURS = 24;

/** The dashboard's full-screen "pages", in scroll order. `id` doubles as the URL hash (#trends). */
export const PAGES = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "analysis", label: "Analysis" },
  { id: "log", label: "Log" },
] as const;
