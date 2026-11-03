// Formatting helpers. Times are shown in the browser's local time zone, 24-hour clock.

const clockFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const hmFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const stampFmt = new Intl.DateTimeFormat([], {
  month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export const fmtClock = (t: number) => clockFmt.format(t); // 14:02:33
export const fmtHM = (t: number) => hmFmt.format(t); // 14:02
export const fmtStamp = (t: number) => stampFmt.format(t); // Nov 02, 14:02:33

export const fmtNum = (v: number | null | undefined, digits = 1) => (v == null ? "—" : v.toFixed(digits));

export function ago(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h ago`;
  return `${(seconds / 86400).toFixed(1)} days ago`;
}

/** "UTC+08:00" for the browser's current time zone. */
export function utcOffset(): string {
  const off = -new Date().getTimezoneOffset();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
