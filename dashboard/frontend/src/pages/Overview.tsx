import { motion, useTransform } from "motion/react";
import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { Icon, type IconName } from "../components/Icon";
import { LeaderLines } from "../components/LeaderLines";
import { PageFrame } from "../components/PageFrame";
import { CONFIG, PAGE_IDS } from "../config";
import type { AiState } from "../hooks/useAiCheckup";
import { useNow } from "../hooks/useNow";
import type { Pager } from "../hooks/usePager";
import type { Telemetry } from "../hooks/useTelemetry";
import { ago, fmtClock, fmtHM } from "../lib/format";
import { moistureFraction, moistureWord } from "../lib/moisture";
import { stats, toPoints } from "../lib/series";
import { AI_STATUS, linkStatus, type Tone } from "../lib/status";
import { zoomFrame } from "../lib/zoom";
import type { AnchorId } from "../scene/anchors";

interface Props {
  telemetry: Telemetry;
  hours: number;
  ai: AiState;
  pager: Pager;
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
export function Overview({ telemetry, hours, ai, pager, active, compact }: Props) {
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

  // During a window zoom (see lib/zoom.ts): --tile fades the window whose page opens or closes,
  // --slide sends the other window off the screen as a page opens
  const { zoom, zt } = pager;
  const tile = useTransform(() => {
    const t = zt.get();
    return zoom ? zoomFrame(zoom.dir, t).tile : 1;
  });
  const slide = useTransform(() => {
    const t = zt.get();
    return zoom ? zoomFrame(zoom.dir, t).slide : 0;
  });
  const zoomRole = (page: string) => (!zoom ? undefined : PAGE_IDS[zoom.page] === page ? "origin" : "other");

  return (
    <PageFrame index={0} id="overview" pager={pager} active={active}>
      <motion.div
        className="ov"
        data-zoom={zoom?.dir}
        style={{ "--tile": tile, "--slide": slide } as unknown as CSSProperties}
      >
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
            {CONFIG.SOIL_WET_RAW} or lower as 100 %.
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

        {/* Two black windows, each opening its own page: soil moisture left of the infinity, and
            the AI check-up in the top right corner */}
        <div className="ov-moisture">
          <Window
            page="trends" tab="Soil moisture" label="Sensor · soil ADC" go="Trends" delay={0.08} pager={pager}
            zoom={zoomRole("trends")} side={-1}
            dot={<span className={`hero-dot status-${link.tone}`} title={link.label} />}
          >
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
          </Window>
        </div>
        <div className="ov-corner">
          <AiWindow ai={ai} hours={hours} readings={rows.length} pager={pager} zoom={zoomRole("analysis")} />
        </div>

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
      </motion.div>
    </PageFrame>
  );
}

type ZoomRole = "origin" | "other" | undefined;

/**
 * A black window with a tab on top. The whole window is a link to its page: a plain click zooms the
 * page out of the window (see lib/zoom.ts); a middle or Ctrl click still opens the page in a new tab.
 * `zoom` says what it does during a zoom; `side` is where it slides off to when the other one opens.
 */
function Window({ page, tab, label, dot, go, delay, pager, zoom, side, children }: {
  page: string; tab: string; label: string; dot: ReactNode; go: string; delay: number; pager: Pager;
  zoom: ZoomRole; side: number; children: ReactNode;
}) {
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    pager.goTo(PAGE_IDS.indexOf(page), e.currentTarget);
  };
  return (
    <a
      className={`win win-${page} reveal${zoom ? ` is-${zoom}` : ""}`}
      style={{ ...d(delay), "--side": side } as CSSProperties}
      href={`#${page}`}
      data-window={page}
      onClick={open}
    >
      <span className="hero-tab">{tab}</span>
      <div className="hero-card">
        <div className="hero-top">
          <span className="micro">{label}</span>
          <span className="win-go micro">
            {go}
            <Icon name="right" size={12} />
          </span>
          {dot}
        </div>
        {children}
      </div>
    </a>
  );
}

/** The AI check-up window: the latest report's verdict, or what's happening instead. */
function AiWindow({ ai, hours, readings, pager, zoom }: {
  ai: AiState; hours: number; readings: number; pager: Pager; zoom: ZoomRole;
}) {
  let tone: Tone = "muted";
  let icon: IconName | null = null;
  let title = "No report yet";
  let text = `Open it to have DeepSeek read the last ${hours} h of readings.`;
  let report = "—";
  let advice = "—";
  let read = String(readings);

  if (ai.phase === "running") {
    title = "Analysing…";
    text = `DeepSeek is reading the last ${ai.hours} h.`;
    report = advice = "…";
  } else if (ai.phase === "error") {
    const wait = /wait/i.test(ai.message);
    tone = wait ? "warning" : "critical";
    icon = wait ? "alert" : "stop";
    title = wait ? "Cooling down" : "Request failed";
    text = ai.message;
  } else if (ai.phase === "done") {
    const { result } = ai;
    const status = AI_STATUS[result.status ?? "attention"] ?? AI_STATUS.attention;
    tone = status.tone;
    icon = status.icon;
    title = status.label;
    text = result.headline ?? result.summary?.[0] ?? result.raw ?? "";
    report = fmtHM(ai.at);
    advice = result.advice ? String(result.advice.length) : "—";
    read = String(result.readings);
  }

  return (
    <Window
      page="analysis" tab="AI check-up" label={`DeepSeek · last ${ai.phase === "idle" ? hours : ai.hours} h`}
      go="Analysis" delay={0.14} pager={pager} zoom={zoom} side={1}
      dot={<span className={`hero-dot status-${tone}${ai.phase === "running" ? " is-pulsing" : ""}`} />}
    >
      <p className={`ai-win-title status-${tone}`}>
        {ai.phase === "running" ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={20} />}
        {title}
      </p>
      <p className="ai-win-text">{text}</p>
      <dl className="hero-meta">
        <div>
          <dt>Report</dt>
          <dd>{report}</dd>
        </div>
        <div>
          <dt>Advice</dt>
          <dd>{advice}</dd>
        </div>
        <div>
          <dt>Readings</dt>
          <dd>{read}</dd>
        </div>
      </dl>
    </Window>
  );
}
