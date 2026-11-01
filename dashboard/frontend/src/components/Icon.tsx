// A few line icons on a 16x16 grid, drawn with the current text colour.
const PATHS = {
  check: "M3.2 8.6l3 3 6.6-7.2",
  alert: "M8 2.2l6.3 11.3H1.7zM8 6.6v3.1M8 11.6v.2",
  stop: "M5.4 1.8h5.2l3.6 3.6v5.2l-3.6 3.6H5.4l-3.6-3.6V5.4zM8 5v3.7M8 10.9v.2",
  info: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM8 7.1v4.1M8 4.9v.2",
  down: "M8 2.4v11M3.6 9l4.4 4.4L12.4 9",
  up: "M8 13.6v-11M3.6 7L8 2.6 12.4 7",
  play: "M4.6 2.6l8.6 5.4-8.6 5.4z",
  sun: "M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1",
  moon: "M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.6 5.6 0 1 0 7 7z",
  infinity: "M8 8c-1.6-2.1-3-3.2-4.5-3.2C1.9 4.8.9 6.2.9 8s1 3.2 2.6 3.2C5 11.2 6.4 10.1 8 8s3-3.2 4.5-3.2c1.6 0 2.6 1.4 2.6 3.2s-1 3.2-2.6 3.2C11 11.2 9.6 10.1 8 8z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
