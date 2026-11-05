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

/**
 * The dashboard's full-screen "pages". `id` doubles as the URL hash (#trends). Pages without a
 * `parent` form the scroll (overview <-> log); the others open from a window on their parent page
 * and come back to it. Earlier pages in this list sit above later ones when the view slides.
 */
export const PAGES: readonly { id: string; label: string; parent?: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends", parent: "overview" }, // the soil moisture window
  { id: "analysis", label: "Analysis", parent: "overview" }, // the AI check-up window
  { id: "log", label: "Log" },
];
export const PAGE_IDS = PAGES.map((p) => p.id);
/** Index of the page a detail page returns to, or -1 for the pages on the scroll. */
export const parentOf = (i: number) => PAGE_IDS.indexOf(PAGES[i]?.parent ?? "");
