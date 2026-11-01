// ---------------------------------------------------------------------------
// Settings — tweak these to match your hardware.
// ---------------------------------------------------------------------------
const CONFIG = {
  API_BASE: "",          // "" = same server that serves this page; or e.g. "https://jupiterpluvius-api.onrender.com"
  SOIL_DRY_RAW: 1900,    // soil ADC reading in dry air        -> 0 %
  SOIL_WET_RAW: 1200,    // soil ADC reading in a wet tissue   -> 100 %
  POLL_MS: 5000,         // how often to check for new readings
  STALE_AFTER_S: 180,    // no reading for this long -> "device offline"
  GAP_MS: 5 * 60 * 1000, // break chart lines across gaps longer than this
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Soil ADC is inversely related to moisture: map [dry, wet] raw -> [0, 1]. */
function moistureFraction(raw) {
  if (raw == null) return null;
  return clamp01((CONFIG.SOIL_DRY_RAW - raw) / (CONFIG.SOIL_DRY_RAW - CONFIG.SOIL_WET_RAW));
}
function moistureWord(f) {
  if (f == null) return "No data";
  if (f < 0.15) return "Very dry — needs water";
  if (f < 0.4) return "Dry";
  if (f < 0.7) return "Moist";
  return "Wet";
}
function mixHex(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return "#" + pa.map((v, i) => Math.round(lerp(v, pb[i], t)).toString(16).padStart(2, "0")).join("");
}
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtShort = (d, hours) =>
  hours > 24
    ? d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function ago(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h ago`;
  return `${(seconds / 86400).toFixed(1)} days ago`;
}
const fmtNum = (v, digits = 1) => (v == null ? "—" : Number(v).toFixed(digits));

async function api(path, params = {}, method = "GET") {
  const url = new URL(CONFIG.API_BASE + path, location.href);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { method });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try { detail = JSON.parse(text).detail ?? text; } catch {} // FastAPI errors are {"detail": "..."}
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// Plant scene
// ---------------------------------------------------------------------------
const LEAVES = [ // position along the stem (0 = soil, 1 = top), side, size
  { t: 0.28, side: 1, s: 1.05 }, { t: 0.42, side: -1, s: 1.0 },
  { t: 0.58, side: 1, s: 0.9 }, { t: 0.72, side: -1, s: 0.8 },
  { t: 0.86, side: 1, s: 0.65 }, { t: 0.97, side: -1, s: 0.55 },
];
const LEAF_PATH = "M0,0 C9,-13 30,-14 42,-2 C30,9 10,9 0,0 Z";
// Fixed "random" droplet spots inside the soil window.
const DROPS = Array.from({ length: 14 }, (_, i) => ({
  x: 122 + ((i * 37) % 58), y: 186 + ((i * 23) % 46), r: 2 + (i % 3) * 0.7,
}));

(function buildScene() {
  const leaves = $("leaves");
  leaves.innerHTML = LEAVES.map(() => `<path d="${LEAF_PATH}"/>`).join("");
  $("drops").innerHTML = DROPS.map((d) => `<ellipse class="drop" cx="${d.x}" cy="${d.y}" rx="${d.r * 0.8}" ry="${d.r}"/>`).join("");
})();

let shownMoisture = 0.5;
function drawPlant(m) {
  // Stem: perky and straight when wet, bent over when dry.
  const p0 = [150, 160], p1 = [150, 112];
  const p2 = [150 + (1 - m) * 34, 66 + (1 - m) * 30];
  $("stem").setAttribute("d", `M${p0} Q${p1} ${p2}`);
  const leafColor = mixHex("#b9a646", "#3f9a3a", m);
  $("stem").setAttribute("stroke", mixHex("#9a8a3a", "#2f7a2c", m));

  [...$("leaves").children].forEach((leaf, i) => {
    const { t, side, s } = LEAVES[i];
    const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    const angle = lerp(55, -28, m); // droops down when dry
    leaf.setAttribute("transform", `translate(${x} ${y}) scale(${side * s} ${s}) rotate(${angle})`);
    leaf.setAttribute("fill", leafColor);
  });

  $("soil").setAttribute("fill", mixHex("#d6b47c", "#4b3020", m));
  const visible = Math.round(m * DROPS.length);
  [...$("drops").children].forEach((d, i) => d.style.display = i < visible ? "" : "none");
}

function animatePlant(target) {
  const from = shownMoisture, start = performance.now();
  (function step(now) {
    const k = Math.min(1, (now - start) / 700);
    shownMoisture = lerp(from, target, 1 - (1 - k) ** 3);
    drawPlant(shownMoisture);
    if (k < 1) requestAnimationFrame(step);
  })(start);
}

function renderScene(r) {
  const scene = $("scene");
  scene.classList.toggle("night", r.light_state === false);
  scene.classList.toggle("led-on", r.led_state === true);
  scene.classList.toggle("res-low", r.reservoir_state === false);
  const level = r.reservoir_state == null ? 0 : r.reservoir_state ? 0.75 : 0.12;
  $("tank-water").setAttribute("y", 242 - 110 * level);
  $("tank-water").setAttribute("height", 110 * level);
  $("tank-label").textContent = r.reservoir_state == null ? "—" : r.reservoir_state ? "OK" : "LOW";
  const f = moistureFraction(r.soil_adc_raw);
  if (f != null) animatePlant(f);
}
drawPlant(shownMoisture);

// ---------------------------------------------------------------------------
// Overview + tiles
// ---------------------------------------------------------------------------
function renderLatest(r) {
  if (!r) return;
  renderScene(r);
  const f = moistureFraction(r.soil_adc_raw);
  $("moist-pct").textContent = f == null ? "—" : Math.round(f * 100);
  $("moist-word").textContent = moistureWord(f);
  $("moist-bar").style.width = `${(f ?? 0) * 100}%`;
  $("moist-raw").textContent = r.soil_adc_raw ?? "—";

  $("t-temp").textContent = fmtNum(r.temperature);
  $("t-hum").textContent = fmtNum(r.humidity);
  $("t-light").innerHTML = r.light_state == null ? "—" : r.light_state ? "☀️ Bright" : "🌙 Dark";
  $("t-led").innerHTML = r.led_state == null ? "—" : r.led_state ? "💡 On" : "○ Off";
  $("t-res").innerHTML = r.reservoir_state == null ? "—"
    : r.reservoir_state ? `<span class="status-good">✓ OK</span>` : `<span class="status-bad">⚠ Low — refill</span>`;
  const faults = r.faults || [];
  $("t-faults").innerHTML = faults.length
    ? faults.map((f) => `<span class="chip">⚠ ${String(f).replace(/</g, "&lt;")}</span>`).join("")
    : `<span class="status-good">✓ None</span>`;
}

function renderConnection() {
  const pill = $("conn"), text = $("conn-text");
  if (state.error) {
    pill.className = "pill pill-bad"; text.textContent = "Backend unreachable";
    return;
  }
  if (!state.latest) {
    pill.className = "pill pill-muted"; text.textContent = "No readings yet";
    $("last-seen").textContent = "Waiting for the first reading…";
    return;
  }
  const age = (Date.now() - new Date(state.latest.created_at)) / 1000;
  const stale = age > CONFIG.STALE_AFTER_S;
  pill.className = stale ? "pill pill-warn" : "pill pill-good";
  text.textContent = stale ? `Device offline · ${ago(age)}` : "Live";
  $("last-seen").textContent = `Last reading ${ago(age)} (${new Date(state.latest.created_at).toLocaleString()})`;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
const crosshair = {
  id: "crosshair",
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements();
    if (!active?.length) return;
    const { ctx, chartArea: { top, bottom } } = chart;
    ctx.save();
    ctx.strokeStyle = css("--axis");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(active[0].element.x, top);
    ctx.lineTo(active[0].element.x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

const charts = {};
function makeChart(id, colorVar, { yMin, yMax, label, tooltip }) {
  const color = css(colorVar);
  return new Chart($(id), {
    type: "line",
    data: { datasets: [{
      label, data: [], borderColor: color, backgroundColor: color + "22", fill: "start",
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
      pointHoverBorderColor: css("--surface"), pointHoverBackgroundColor: color,
      tension: 0.25, spanGaps: false,
    }] },
    options: {
      animation: false, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text-2"),
          borderColor: css("--border"), borderWidth: 1, padding: 10,
          callbacks: { title: (items) => new Date(items[0].parsed.x).toLocaleString(), label: tooltip },
        },
      },
      scales: {
        x: {
          type: "time",
          grid: { color: css("--grid") }, border: { color: css("--axis") },
          ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 24 },
          time: { displayFormats: { minute: "HH:mm", hour: "HH:mm", day: "EEE d" } },
        },
        y: {
          min: yMin, max: yMax, grace: "10%",
          grid: { color: css("--grid") }, border: { display: false },
          ticks: { color: css("--muted"), maxTicksLimit: 5 },
        },
      },
    },
    plugins: [crosshair],
  });
}

function buildCharts() {
  Object.values(charts).forEach((c) => c.destroy());
  charts.moist = makeChart("c-moist", "--s-moist", {
    yMin: 0, yMax: 100, label: "Soil moisture",
    tooltip: (it) => `Moisture ${Math.round(it.parsed.y)} %  ·  raw ADC ${it.raw.raw}`,
  });
  charts.temp = makeChart("c-temp", "--s-temp", { label: "Temperature", tooltip: (it) => `${it.parsed.y.toFixed(1)} °C` });
  charts.hum = makeChart("c-hum", "--s-hum", { label: "Humidity", tooltip: (it) => `${it.parsed.y.toFixed(1)} %` });
}

/** What counts as "missing data": GAP_MS, or 3x the average spacing for thinned long ranges. */
function gapMs(rows) {
  if (rows.length < 2) return CONFIG.GAP_MS;
  const spacing = (new Date(rows[rows.length - 1].created_at) - new Date(rows[0].created_at)) / (rows.length - 1);
  return Math.max(CONFIG.GAP_MS, 3 * spacing);
}

/** Turn rows into {x, y} points, inserting a null to break the line where data is missing. */
function series(rows, pick) {
  const out = [], gap = gapMs(rows);
  let prevT = null;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (prevT != null && t - prevT > gap) out.push({ x: prevT + 1, y: null });
    const v = pick(r);
    out.push({ x: t, y: v, raw: r.soil_adc_raw });
    prevT = t;
  }
  return out;
}

function renderCharts() {
  const now = Date.now(), min = now - state.hours * 3600e3;
  const sets = {
    moist: series(state.rows, (r) => { const f = moistureFraction(r.soil_adc_raw); return f == null ? null : f * 100; }),
    temp: series(state.rows, (r) => r.temperature),
    hum: series(state.rows, (r) => r.humidity),
  };
  for (const [key, chart] of Object.entries(charts)) {
    chart.data.datasets[0].data = sets[key];
    chart.options.scales.x.min = min;
    chart.options.scales.x.max = now;
    chart.update("none");
  }
}

// ---------------------------------------------------------------------------
// States timeline (light / LED / reservoir as coloured bands)
// ---------------------------------------------------------------------------
const TRACKS = [
  { key: "light_state", label: "Ambient light", color: "--s-light", when: true, on: "Bright", off: "Dark" },
  { key: "led_state", label: "Grow LED", color: "--s-led", when: true, on: "On", off: "Off" },
  { key: "reservoir_state", label: "Reservoir low", color: "--critical", when: false, on: "Low", off: "OK" },
];

function renderTimeline() {
  const now = Date.now(), min = now - state.hours * 3600e3, span = now - min;
  const pct = (t) => ((Math.max(t, min) - min) / span) * 100;
  const rows = state.rows, gap = gapMs(rows);

  const tracks = TRACKS.map((tr) => {
    const segs = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][tr.key] !== tr.when) continue;
      const start = new Date(rows[i].created_at).getTime();
      let end = i + 1 < rows.length ? new Date(rows[i + 1].created_at).getTime() : now;
      end = Math.min(end, start + gap); // don't paint across data gaps
      const last = segs[segs.length - 1];
      if (last && start - last.end < 1000) last.end = end; else segs.push({ start, end });
    }
    const html = segs.map((s) => {
      const tip = `${tr.label}: ${tr.on} · ${fmtShort(new Date(s.start), state.hours)}–${fmtShort(new Date(s.end), state.hours)}`;
      return `<div class="tl-seg" title="${tip}" style="left:${pct(s.start)}%;width:${Math.max(0.4, pct(s.end) - pct(s.start))}%;background:var(${tr.color})"></div>`;
    }).join("");
    return `<div class="tl-row"><span class="tl-label">${tr.label}</span><div class="tl-track">${html}</div></div>`;
  }).join("");

  const ticks = Array.from({ length: 5 }, (_, i) => `<span>${fmtShort(new Date(min + (span * i) / 4), state.hours)}</span>`).join("");
  const legend = TRACKS.map((tr) => `<span><i style="background:var(${tr.color})"></i>${tr.label === "Reservoir low" ? "Reservoir low" : `${tr.label}: ${tr.on.toLowerCase()}`}</span>`).join("")
    + `<span><i style="background:var(--grid)"></i>off / no data</span>`;
  $("timeline").innerHTML = tracks + `<div class="tl-axis">${ticks}</div><div class="tl-legend">${legend}</div>`;
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------
const yesNo = (v, yes, no) => (v == null ? "—" : v ? yes : no);
function renderTable() {
  const last = state.rows.slice(-15).reverse();
  $("rows").innerHTML = last.length ? last.map((r) => {
    const f = moistureFraction(r.soil_adc_raw);
    return `<tr>
      <td>${new Date(r.created_at).toLocaleString()}${r.test_data ? ' <span class="muted">(test)</span>' : ""}</td>
      <td class="num">${f == null ? "—" : Math.round(f * 100) + " %"}</td>
      <td class="num">${r.soil_adc_raw ?? "—"}</td>
      <td class="num">${fmtNum(r.temperature)}</td>
      <td class="num">${fmtNum(r.humidity)}</td>
      <td>${yesNo(r.light_state, "Bright", "Dark")}</td>
      <td>${yesNo(r.led_state, "On", "Off")}</td>
      <td>${yesNo(r.reservoir_state, "OK", '<span class="status-bad">⚠ Low</span>')}</td>
      <td>${(r.faults || []).join(", ").replace(/</g, "&lt;") || "—"}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="9" class="muted">No readings in this time range</td></tr>`;
  $("count").textContent = `${state.rows.length} readings shown`;
}

function renderHistory() {
  renderCharts();
  renderTimeline();
  renderTable();
}

// ---------------------------------------------------------------------------
// Data loading: full load on start / filter change, then poll for new rows.
// ---------------------------------------------------------------------------
const state = { hours: 1, includeTest: true, rows: [], latest: null, error: null, loadToken: 0 };

async function loadAll() {
  const token = ++state.loadToken;
  document.body.classList.add("loading");
  try {
    const params = { hours: state.hours, include_test: state.includeTest };
    const [rows, latest] = await Promise.all([api("/api/readings", params), api("/api/latest", { include_test: state.includeTest })]);
    if (token !== state.loadToken) return; // a newer load superseded this one
    state.rows = rows;
    state.latest = latest;
    state.error = null;
    renderLatest(latest);
    renderHistory();
  } catch (e) {
    state.error = e;
    console.error(e);
  } finally {
    if (token === state.loadToken) document.body.classList.remove("loading");
    renderConnection();
  }
}

async function poll() {
  const token = state.loadToken;
  try {
    const latest = await api("/api/latest", { include_test: state.includeTest });
    if (token !== state.loadToken) return;
    state.error = null;
    if (latest && latest.id !== state.latest?.id) {
      const lastId = state.rows.length ? state.rows[state.rows.length - 1].id : undefined;
      const fresh = await api("/api/readings", { hours: state.hours, include_test: state.includeTest, after_id: lastId });
      if (token !== state.loadToken) return;
      state.rows.push(...fresh);
      state.latest = latest;
      renderLatest(latest);
    }
    // Drop rows that slid out of the window, then redraw (the time axis moves too).
    const min = Date.now() - state.hours * 3600e3;
    state.rows = state.rows.filter((r) => new Date(r.created_at).getTime() >= min);
    renderHistory();
  } catch (e) {
    state.error = e;
    console.error(e);
  }
  renderConnection();
}

// ---------------------------------------------------------------------------
// AI check-up (DeepSeek, via the backend)
// ---------------------------------------------------------------------------
const AI_STATUS = {
  good: ["status-good", "✓", "All good"],
  attention: ["status-warn", "⚠", "Needs attention"],
  urgent: ["status-bad", "⛔", "Urgent"],
};
const AI_PRIORITY = { info: "ℹ️", warning: "⚠️", urgent: "⛔" };

function renderAi(r, seconds) {
  const meta = `<p class="ai-meta">${esc(r.model)} · ${r.readings} readings · ${seconds.toFixed(1)} s`
    + `${r.tokens ? ` · ${r.tokens.toLocaleString()} tokens` : ""} · ${new Date().toLocaleTimeString()}</p>`;
  if (r.raw != null) { // the model didn't return the JSON shape we asked for
    $("ai-out").innerHTML = `<p class="ai-raw">${esc(r.raw)}</p>${meta}`;
    return;
  }
  const [cls, icon, label] = AI_STATUS[r.status] || AI_STATUS.attention;
  const summary = (r.summary || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const advice = (r.advice || []).map((a) =>
    `<li><span aria-hidden="true">${AI_PRIORITY[a.priority] || "•"}</span> ${esc(a.text)}</li>`).join("");
  $("ai-out").innerHTML = `
    <p class="ai-headline"><span class="ai-badge ${cls}">${icon} ${label}</span> ${esc(r.headline || "")}</p>
    ${summary ? `<h3>Summary</h3><ul>${summary}</ul>` : ""}
    <h3>Advice</h3>${advice ? `<ul class="ai-advice">${advice}</ul>` : `<p>No action needed.</p>`}
    ${meta}`;
}

async function runAi() {
  const btn = $("ai-btn"), started = performance.now();
  btn.disabled = true;
  const tick = () => $("ai-out").innerHTML =
    `<p class="muted small"><span class="spinner"></span>Analysing ${state.hours} h of readings… ${((performance.now() - started) / 1000).toFixed(0)} s</p>`;
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const r = await api("/api/insights", {
      hours: state.hours, include_test: state.includeTest,
      tz_offset_min: -new Date().getTimezoneOffset(),
      soil_dry_raw: CONFIG.SOIL_DRY_RAW, soil_wet_raw: CONFIG.SOIL_WET_RAW,
    }, "POST");
    renderAi(r, (performance.now() - started) / 1000);
  } catch (e) {
    $("ai-out").innerHTML = `<p class="status-bad">⚠ ${esc(e.message)}</p>`;
  } finally {
    clearInterval(timer);
    btn.disabled = false;
  }
}
const updateAiButton = () => $("ai-btn").textContent = `✨ Analyse last ${state.hours} h`;
$("ai-btn").addEventListener("click", runAi);

// Filters
$("range").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-hours]");
  if (!btn) return;
  $("range").querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b === btn));
  state.hours = Number(btn.dataset.hours);
  updateAiButton();
  loadAll();
});
$("include-test").addEventListener("change", (e) => {
  state.includeTest = e.target.checked;
  loadAll();
});

// Rebuild charts with the right colours when the OS theme flips.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { buildCharts(); renderHistory(); });

$("cal-dry").textContent = CONFIG.SOIL_DRY_RAW;
$("cal-wet").textContent = CONFIG.SOIL_WET_RAW;
buildCharts();
loadAll();
setInterval(poll, CONFIG.POLL_MS);
setInterval(renderConnection, 1000); // keeps "x s ago" ticking
