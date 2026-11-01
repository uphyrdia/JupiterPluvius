import type { MotionValue } from "motion/react";
import { useMemo, type CSSProperties } from "react";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { Icon, type IconName } from "../components/Icon";
import { LeaderLines } from "../components/LeaderLines";
import { PageFrame } from "../components/PageFrame";
import { CONFIG } from "../config";
import { useNow } from "../hooks/useNow";
import type { Telemetry } from "../hooks/useTelemetry";
import { ago, fmtClock } from "../lib/format";
import { moistureFraction, moistureWord } from "../lib/moisture";
import { stats, toPoints } from "../lib/series";
import { linkStatus, type Tone } from "../lib/status";
import type { AnchorId } from "../scene/anchors";

interface Props {
  telemetry: Telemetry;
  hours: number;
  progress: MotionValue<number>;
  active: boolean;
  compact: boolean;
}

interface Callout {
  id: AnchorId; // which slat on the infinity its leader line points at
  side: "top" | "bottom"; // above or below the infinity (where its line leaves from)
  tag: string;
  title: string;
  value: string;
  sub: string;
  icon?: IconName;
  tone?: Tone;
}

const d = (delay: number) => ({ "--d": delay }) as CSSProperties;

/** Page 1: the live state of the plant, arranged around the 3D infinity. */
export function Overview({ telemetry, hours, progress, active, compact }: Props) {
  const { latest, rows } = telemetry;
  const now = useNow(1000);
  const link = linkStatus(telemetry, now);
  const f = moistureFraction(latest?.soil_adc_raw);

  const temp = useMemo(() => stats(toPoints(rows, (r) => r.temperature)), [rows]);
  const hum = useMemo(() => stats(toPoints(rows, (r) => r.humidity)), [rows]);
  const testCount = useMemo(() => rows.filter((r) => r.test_data).length, [rows]);
  const faults = latest?.faults ?? [];
  const light = latest?.light_state ?? null;
  const led = latest?.led_state ?? null;
  const reservoir = latest?.reservoir_state ?? null;

  const span = (s: ReturnType<typeof stats>, unit: string, digits: number) =>
    s ? `${hours} h range ${s.min.toFixed(digits)}–${s.max.toFixed(digits)} ${unit}` : `No readings in ${hours} h`;

  const callouts: Callout[] = [
    {
      id: "temp", side: "top", tag: "Climate", title: "Temperature",
      value: latest?.temperature == null ? "—" : `${latest.temperature.toFixed(1)} °C`, sub: span(temp, "°C", 1),
    },
    {
      id: "humidity", side: "top", tag: "Climate", title: "Air humidity",
      value: latest?.humidity == null ? "—" : `${latest.humidity.toFixed(0)} %`, sub: span(hum, "%", 0),
    },
    {
      id: "light", side: "bottom", tag: "Photonics", title: "Ambient light",
      value: light == null ? "—" : light ? "Bright" : "Dark", icon: light == null ? undefined : light ? "sun" : "moon",
      sub: `Grow LED ${led == null ? "—" : led ? "on" : "off"}`,
    },
    {
      id: "reservoir", side: "bottom", tag: "Hydraulics", title: "Water reservoir",
      value: reservoir == null ? "—" : reservoir ? "OK" : "Low",
      icon: reservoir == null ? undefined : reservoir ? "check" : "alert",
      tone: reservoir == null ? undefined : reservoir ? "good" : "critical",
      sub: reservoir === false ? "Refill it: the pump has no water" : "The pump has water",
    },
    {
      id: "faults", side: "bottom", tag: "Diagnostics", title: "Faults",
      value: !latest ? "—" : faults.length ? `${faults.length} active` : "None",
      icon: !latest ? undefined : faults.length ? "alert" : "check",
      tone: !latest ? undefined : faults.length ? "serious" : "good",
      sub: faults.length ? faults.join(" · ") : "All systems nominal",
    },
  ];

  const feed = [
    `Link · ${link.label}`,
    latest ? `Last packet · ${fmtClock(latest.t)} · #${latest.id}` : "Last packet · —",
    `Device · ${latest?.device_id ?? "—"}`,
    `Window · ${hours} h · ${rows.length} readings`,
    `Test data · ${testCount} of ${rows.length}`,
    `Faults · ${faults.length ? faults.join(", ") : "none"}`,
  ];

  return (
    <PageFrame index={0} id="overview" progress={progress} active={active}>
      <div className="ov">
        <div className="ov-brand reveal" style={d(0)}>
          <h1 id="overview-title" className="brand">
            <span className="brand-name">JUPITER PLUVIUS</span>
            <span className="brand-sub">AUTO-WATERING PLANT</span>
            <span className="brand-os">
              <span>TELEMETRY</span> <b>OS</b>
            </span>
          </h1>
          <p className="micro brand-motto">Iuppiter Pluvius · giver of rain</p>
        </div>

        <div className="ov-ribbon-space" aria-hidden="true" />

        <section className="ov-dossier reveal" style={d(0.16)} aria-label="About the device">
          <span className="tag">Device dossier</span>
          <p className="micro">
            An MCXC444 reads the soil probe and relays it over UART to an ESP32, which uploads every reading
            to Supabase. The raw ADC falls as the soil gets wetter: {CONFIG.SOIL_DRY_RAW} in dry air reads as 0 %,{" "}
            {CONFIG.SOIL_WET_RAW} in a wet tissue as 100 %.
          </p>
        </section>

        <section className="ov-feed reveal" style={d(0.24)} aria-label="Event feed">
          <span className="tag">Event feed</span>
          <ul className="micro">
            {feed.map((line) => (
              <li key={line.split(" · ")[0]}>{line}</li>
            ))}
            <li className="cursor" aria-hidden="true" />
          </ul>
        </section>

        <div className="ov-divider reveal" style={d(0.05)} aria-hidden="true" />

        <section className="hero reveal" style={d(0.08)} aria-label="Soil moisture">
          <span className="hero-tab">Soil moisture</span>
          <div className="hero-card">
            <div className="hero-top">
              <span className="micro">Sensor · soil ADC</span>
              <span className={`hero-dot status-${link.tone}`} title={link.label} />
            </div>
            <p className="hero-value">
              <AnimatedNumber value={f == null ? null : f * 100} />
              <span className="hero-unit">%</span>
            </p>
            <p className="hero-word">{moistureWord(f)}</p>
            <div
              className="meter"
              role="meter"
              aria-label="Soil moisture"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={f == null ? undefined : Math.round(f * 100)}
              style={{ "--f": f ?? 0 } as CSSProperties}
            >
              <div className="meter-track">
                <div className="meter-fill" />
              </div>
              <div className="meter-scale" aria-hidden="true">
                <span>Dry</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>Wet</span>
              </div>
            </div>
            <dl className="hero-meta">
              <div>
                <dt>Raw ADC</dt>
                <dd>{latest?.soil_adc_raw ?? "—"}</dd>
              </div>
              <div>
                <dt>Dry / wet</dt>
                <dd>
                  {CONFIG.SOIL_DRY_RAW} / {CONFIG.SOIL_WET_RAW}
                </dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{latest ? ago((now - latest.t) / 1000) : "—"}</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="ov-callouts">
          {callouts.map((c, i) => (
            <section
              key={c.id}
              className={`callout callout-${c.id} is-${c.side} reveal`}
              style={d(0.12 + i * 0.05)}
              aria-label={c.title}
            >
              <i className="pin" data-pin={c.id} aria-hidden="true" />
              <span className="tag">{c.tag}</span>
              <p className={`callout-value${c.tone ? ` status-${c.tone}` : ""}`}>
                {c.icon && <Icon name={c.icon} size={20} />}
                {c.value}
              </p>
              <h3 className="callout-title">{c.title}</h3>
              <p className="callout-sub micro">{c.sub}</p>
            </section>
          ))}
        </div>

        {!compact && <LeaderLines />}
      </div>
    </PageFrame>
  );
}
