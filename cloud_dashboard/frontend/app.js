"use strict";
const $ = id => document.getElementById(id);
const state = {device: "", range: "10m", snapshot: null, polling: false, requesting: false, generation: 0};
const readable = value => value ? value.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase()) : "Unavailable";
const stamp = value => value ? new Date(value).toLocaleString("en-SG", {timeZone: "Asia/Singapore", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false}) : "—";
const timeOnly = value => new Date(value).toLocaleTimeString("en-SG", {timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false});
const text = (id, value) => { $(id).textContent = value; };

async function api(path, method="GET", body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/v1" + path, {method, signal: controller.signal,
      headers: body === undefined ? {} : {"Content-Type": "application/json"},
      body: body === undefined ? undefined : JSON.stringify(body)});
    if (!response.ok) {
      let message = "The dashboard request could not be completed.";
      try { const result = await response.json(); if (typeof result.detail === "string") message = result.detail; } catch (_) {}
      throw new Error(message);
    }
    return response.status === 204 ? null : await response.json();
  } finally { clearTimeout(timeout); }
}

function notice(message) { text("notice", message); $("notice").hidden = !message; }
function number(id, value, unit="") {
  const element = $(id);
  element.replaceChildren();
  element.classList.toggle("unavailable", value === null || value === undefined);
  if (value === null || value === undefined) { element.textContent = "Unavailable"; return; }
  element.append(document.createTextNode(typeof value === "number" ? Number(value.toFixed(1)).toString() : value));
  if (unit) { const small = document.createElement("small"); small.textContent = unit; element.append(small); }
}

function indexReading(id, label, index, raw, description) {
  if (index !== null && index !== undefined) { number(id, index, "/100"); text(label, description); }
  else if (raw !== null && raw !== undefined) { number(id, raw, "ADC"); text(label, "Raw reading · calibration pending"); }
  else { number(id, null); text(label, description); }
}

function renderSnapshot(snap) {
  state.snapshot = snap;
  const d = snap.telemetry || {};
  document.querySelector("main").classList.toggle("stale", !snap.fresh);
  const hasFault = d.faults?.length > 0 || d.reservoir_state === "LOW";
  text("connection-badge", snap.fresh ? hasFault ? "Needs attention" : "Receiving readings" : "Readings stale");
  $("connection-badge").className = "badge" + (!snap.fresh ? " warning" : hasFault ? " error" : "");
  text("source-badge", snap.simulated ? "Simulated data" : d.test_data ? "Live board · test data" : "Live device");
  text("hero-title", !snap.fresh ? "Waiting for fresh readings" : hasFault ? "Your greenhouse needs a check" : "Your greenhouse is connected");
  text("hero-copy", !snap.fresh ? "The last readings are shown for reference. Profile delivery is paused." : snap.simulated ? "Explore a working prototype with simulated sensors and local system states." : d.test_data ? "Your test board is connected. These sensor readings are illustrative; no hardware application is claimed." : "Fresh readings from your device. Immediate control stays on MCXC444.");
  text("last-update", snap.received_at ? "Updated " + stamp(snap.received_at) + " · sample age " + snap.age_seconds + "s" : "No readings yet");
  number("temperature-value", d.temperature_c, "°C"); number("humidity-value", d.humidity_percent, "%");
  indexReading("soil-value", "soil-unit", d.soil_moisture_index, d.soil_adc_raw, "Calibrated moisture index");
  indexReading("light-value", "light-unit", d.light_index, d.light_adc_raw, "Calibrated light index");
  number("reservoir-value", {OK: "Available", LOW: "Low water", UNKNOWN: "Unknown"}[d.reservoir_state] || null);
  $("reservoir-value").style.color = d.reservoir_state === "LOW" ? "var(--red)" : "";
  text("watering-state", d.watering_active === true ? "Active" : d.watering_active === false ? "Off" : "Unavailable");
  text("led-value", d.led_brightness === null || d.led_brightness === undefined ? "Unavailable" : `${d.led_brightness} / 255`);
  $("led-bar").style.width = d.led_brightness === null || d.led_brightness === undefined ? "0%" : (d.led_brightness / 255 * 100) + "%";
  text("active-profile", readable(d.active_profile));
  text("faults", d.faults?.length ? d.faults.map(readable).join(" · ") : "No reported faults");
  $("faults").classList.toggle("has-faults", !!d.faults?.length);
  $("simulator-panel").hidden = !snap.simulation?.enabled;
  if (snap.simulation) {
    if (document.activeElement !== $("scenario")) $("scenario").value = snap.simulation.scenario;
    text("pause-button", snap.simulation.paused ? "Resume readings" : "Pause readings");
  }
  renderAdvice(snap);
  renderEvents(snap.events, snap.simulated);
}

function renderAdvice(snap) {
  const {analysis, recommendation: rec, acknowledgement: ack, cooldown_seconds: cooldown} = snap.ai;
  const running = analysis?.status === "RUNNING";
  const button = $("analyze-button");
  button.disabled = state.requesting || running || cooldown > 0 || !snap.fresh || !snap.ai_configured;
  button.querySelector("span").textContent = state.requesting || running ? "Analyzing…" : !snap.ai_configured ? "Configure SoCLaaS" : cooldown > 0 ? `Ready in ${cooldown}s` : "Analyze readings";
  text("recommended-profile", rec ? readable(rec.care_profile) + " profile" : running ? "Reading the conditions…" : "Ready when you are");
  text("advice-reason", rec ? rec.reason : "Analyze recent readings for a prototype care recommendation and a short explanation.");
  text("advice-expiry", rec ? rec.expired ? "Expired" : "Valid until " + timeOnly(rec.expires_at) : "");
  text("advice-time", rec ? "Analyzed " + stamp(rec.created_at) : "No analysis yet");
  text("advice-status", rec ? readable(rec.advisory_code) + " · " + snap.delivery.reason : !snap.ai_configured ? "Load your local .env configuration to enable the adviser." : "Generic prototype context. All watering limits remain on the local controller.");
  text("ack-status", ack ? (ack.origin === "SIMULATED" ? "Simulated acknowledgement: " : "MCXC444 acknowledgement: ") + readable(ack.result) + (ack.reason ? " · " + ack.reason : "") : rec ? "Waiting for controller acknowledgement" : "No acknowledgement");
  text("ai-error", analysis?.status === "FAILED" ? analysis.error || "Analysis failed." : "");
  $("ai-error").hidden = analysis?.status !== "FAILED";
}

function renderEvents(events, simulated) {
  const list = $("events"); list.replaceChildren();
  if (!events.length) { const item = document.createElement("li"); item.className = "empty-state"; item.textContent = "Events will appear as readings arrive."; list.append(item); return; }
  for (const event of events) {
    const item = document.createElement("li");
    const dot = document.createElement("span"); dot.className = "event-dot " + (event.kind === "FAULT" || event.kind === "DISCONNECTED" ? event.kind : "");
    const message = document.createElement("span"); message.className = "event-message"; message.textContent = event.message;
    const time = document.createElement("time"); time.dateTime = event.created_at; time.textContent = timeOnly(event.created_at); time.title = stamp(event.created_at) + (simulated ? " · simulated device" : "");
    item.append(dot, message, time); list.append(item);
  }
}

function renderChart(id, samples, key, color, min, max, label) {
  const target = $(id), now = Date.now(), seconds = {"10m": 600, "1h": 3600, "24h": 86400}[state.range];
  const start = now - seconds * 1000;
  const points = samples.map(s => ({t: Date.parse(s.sampled_at), v: s.sample_age_ms > 30000 ? null : s[key]}))
    .filter(p => p.t >= start && p.t <= now).sort((a,b) => a.t-b.t);
  const valid = points.filter(p => typeof p.v === "number" && Number.isFinite(p.v));
  if (!valid.length) { target.replaceChildren(); const empty = document.createElement("div"); empty.className = "chart-empty"; empty.textContent = "No readings in this window.\nUnavailable values are left blank."; target.append(empty); return; }
  if (min === undefined) { min = Math.floor(Math.min(...valid.map(p=>p.v))-2); max = Math.ceil(Math.max(...valid.map(p=>p.v))+2); }
  const W=490, H=140, L=32, R=12, T=8, B=24;
  const x = t => L + (t-start)/(now-start)*(W-L-R);
  const y = v => T+(max-v)/(max-min)*(H-T-B);
  const paths=[]; let current=[];
  for (const p of points) {
    if (typeof p.v !== "number" || !Number.isFinite(p.v)) { if(current.length) paths.push(current); current=[]; }
    else current.push(p);
  }
  if (current.length) paths.push(current);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} recorded trend"><defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".16"/><stop offset="100%" stop-color="${color}" stop-opacity=".01"/></linearGradient></defs>`;
  for (let i=0;i<3;i++) { const value=min+(max-min)*i/2; const yy=y(value); svg+=`<line class="grid-line" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-7}" y="${yy+3}" text-anchor="end">${Math.round(value)}</text>`; }
  for (const path of paths) {
    const line=path.map((p,i)=>`${i?"L":"M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    if(path.length>1) svg+=`<path d="${line} L${x(path.at(-1).t).toFixed(1)},${H-B} L${x(path[0].t).toFixed(1)},${H-B} Z" fill="url(#${id}-fill)"/>`;
    svg+=`<path class="plot" d="${line}" stroke="${color}"/>`;
    if(path.length===1) svg+=`<circle cx="${x(path[0].t).toFixed(1)}" cy="${y(path[0].v).toFixed(1)}" r="3" fill="${color}"/>`;
  }
  for(let i=0;i<3;i++) { const time=start+(now-start)*i/2; svg+=`<text x="${x(time)}" y="${H-3}" text-anchor="${i===0?"start":i===2?"end":"middle"}">${timeOnly(time)}</text>`; }
  // Only static labels, fixed colors, validated numbers, and formatted dates enter this SVG.
  target.innerHTML=svg+"</svg>";
}

function renderHistory(history) {
  const samples=history.samples;
  renderChart("chart-temperature", samples, "temperature_c", "#c39372", undefined, undefined, "Temperature");
  renderChart("chart-humidity", samples, "humidity_percent", "#80a7b6", 0, 100, "Humidity");
  for(const [name,index,raw,color] of [["soil","soil_moisture_index","soil_adc_raw","#87a76c"],["light","light_index","light_adc_raw","#c0aa65"]]) {
    const latest=state.snapshot?.telemetry || {};
    const useRaw=latest[index] == null && latest[raw] != null;
    text(`chart-${name}-unit`, useRaw ? "Raw ADC / 4095" : "Index / 100");
    renderChart(`chart-${name}`, samples, useRaw?raw:index, color, 0, useRaw?4095:100, name === "soil" ? "Soil moisture" : "Ambient light");
  }
}

async function poll() {
  if(state.polling) return;
  state.polling=true;
  const generation=state.generation;
  try {
    const devices=await api("/devices");
    if(generation!==state.generation) return;
    const select=$("device-select"), names=devices.map(d=>d.device_id);
    if([...select.options].map(o=>o.value).join("|")!==names.join("|")) {
      select.replaceChildren(...devices.map(d=>new Option(d.device_id + (d.simulated?" · simulation":" · live"),d.device_id)));
    }
    if(!names.includes(state.device)) state.device=names[0] || "";
    select.value=state.device;
    if(!state.device) { notice("No devices yet. Enable the simulator or upload your first ESP32 reading."); $("analyze-button").disabled=true; return; }
    const device=state.device, range=state.range;
    const [snap,history]=await Promise.all([api(`/devices/${encodeURIComponent(device)}/dashboard`),api(`/devices/${encodeURIComponent(device)}/history?range=${range}`)]);
    if(generation!==state.generation || device!==state.device || range!==state.range) return;
    renderSnapshot(snap); renderHistory(history); notice("");
  } catch (_) {
    notice("The backend is unreachable. Last displayed readings are historical; reconnect before using a recommendation.");
    text("connection-badge","Backend disconnected"); $("connection-badge").className="badge warning";
    text("advice-status","Backend connection lost. Profile availability cannot be confirmed.");
    if(state.snapshot?.received_at) text("last-update","Last confirmed update " + stamp(state.snapshot.received_at));
    document.querySelector("main").classList.add("stale"); $("analyze-button").disabled=true;
  } finally { state.polling=false; }
}

$("device-select").addEventListener("change",()=>{
  state.device=$("device-select").value;state.generation++;state.snapshot=null;
  // Do not show the previous device's advice beneath a newly selected device label.
  document.querySelector("main").classList.add("stale");
  for(const id of ["temperature-value","humidity-value","soil-value","light-value","reservoir-value"]) number(id,null);
  text("connection-badge","Loading device");text("source-badge","—");
  text("hero-title","Loading selected device");text("hero-copy","Fetching this device's readings and advice.");text("last-update","Waiting for readings");
  for(const id of ["watering-state","led-value","active-profile"]) text(id,"Unavailable");
  $("led-bar").style.width="0%";text("faults","Waiting for device state");
  text("recommended-profile","Loading advice");text("advice-reason","Waiting for this device's analysis history.");
  text("advice-expiry","");text("advice-time","—");text("ack-status","No acknowledgement loaded");text("advice-status","");
  $("ai-error").hidden=true;$("analyze-button").disabled=true;renderEvents([],false);renderHistory({samples:[]});poll();
});
document.querySelectorAll("[data-range]").forEach(button=>button.addEventListener("click",()=>{
  state.range=button.dataset.range;state.generation++;
  document.querySelectorAll("[data-range]").forEach(b=>{b.classList.toggle("selected",b===button);b.setAttribute("aria-pressed",String(b===button));});poll();
}));
$("analyze-button").addEventListener("click",async()=>{
  if(!state.device || state.requesting) return;
  state.requesting=true; $("analyze-button").disabled=true;
  try { await api(`/devices/${encodeURIComponent(state.device)}/analyze`,"POST"); notice(""); }
  catch(error) { notice(error.name==="AbortError"?"The analysis request could not be confirmed. Refresh its status before trying again.":error.message); }
  finally { state.requesting=false;poll(); }
});
$("scenario").addEventListener("change",async()=>{try{await api("/simulation","POST",{scenario:$("scenario").value});poll();}catch(error){notice(error.message);}});
$("pause-button").addEventListener("click",async()=>{try{await api("/simulation","POST",{paused:!state.snapshot?.simulation?.paused});poll();}catch(error){notice(error.message);}});
document.querySelectorAll(".nav-item").forEach(item=>item.addEventListener("click",()=>{document.querySelectorAll(".nav-item").forEach(a=>a.classList.toggle("active",a===item));}));
text("today",new Date().toLocaleDateString("en-SG",{timeZone:"Asia/Singapore",day:"numeric",month:"long",year:"numeric"}));
poll();setInterval(poll,2000);
