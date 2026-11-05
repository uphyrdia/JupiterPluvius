import { useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Backdrop } from "./components/Backdrop";
import { Chrome } from "./components/Chrome";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GlitchBurst } from "./components/GlitchBurst";
import { DEFAULT_HOURS, PAGE_IDS } from "./config";
import { useAiCheckup } from "./hooks/useAiCheckup";
import { useCompact } from "./hooks/useCompact";
import { HIDDEN, usePageOffset, usePager } from "./hooks/usePager";
import { useTelemetry } from "./hooks/useTelemetry";
import { moistureFraction } from "./lib/moisture";
import { Analysis } from "./pages/Analysis";
import { Log } from "./pages/Log";
import { Overview } from "./pages/Overview";
import { Trends } from "./pages/Trends";

// The 3D scene (three.js, the biggest dependency) is a separate file loaded after the first paint.
const Scene = lazy(() => import("./scene/Scene"));

// Development-only helpers (stripped from production builds):
//   ?p=0.5#trends  freeze the view halfway from the overview to the page in the hash
//   ?m=0.2         pretend the soil moisture is 20 %
//   ?still         skip the fade-ins (for screenshots)
const DEBUG = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;

export default function App() {
  // Filters, shared by every page
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [includeTest, setIncludeTest] = useState(true);

  // Data: readings (polled every few seconds) and the AI check-up
  const telemetry = useTelemetry(hours, includeTest);
  const ai = useAiCheckup(hours, includeTest);

  // Navigation and look
  const rootRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const compact = useCompact();
  const pager = usePager(rootRef, reduceMotion);
  const overview = usePageOffset(pager, 0); // the 3D ribbon and the top bar follow the overview
  const burst = useCountChanges(pager.index);

  const first = useRef(pager.index); // the page the URL opened
  useEffect(() => {
    if (!DEBUG?.has("p") || first.current === 0) return;
    pager.slots.set(PAGE_IDS.map((_, i) => (i === 0 ? 0 : i === first.current ? 1 : HIDDEN)));
    pager.pos.set(Number(DEBUG.get("p")));
  }, [pager.slots, pager.pos]);

  const moisture = DEBUG?.has("m") ? Number(DEBUG.get("m")) : moistureFraction(telemetry.latest?.soil_adc_raw);
  const { index } = pager;

  return (
    <div ref={rootRef} className={`app${DEBUG?.has("still") ? " is-still" : ""}`}>
      <Backdrop pager={pager} busy={ai.state.phase === "running"} />
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <Scene offset={overview} moisture={moisture} compact={compact} reduceMotion={reduceMotion} />
        </Suspense>
      </ErrorBoundary>

      <main className="pages">
        <Overview telemetry={telemetry} hours={hours} ai={ai.state} pager={pager} active={index === 0} compact={compact} />
        <Trends telemetry={telemetry} hours={hours} includeTest={includeTest} pager={pager} active={index === 1} />
        <Analysis
          ai={ai.state}
          onRun={ai.run}
          hours={hours}
          includeTest={includeTest}
          readings={telemetry.rows.length}
          pager={pager}
          active={index === 2}
        />
        <Log telemetry={telemetry} hours={hours} pager={pager} active={index === 3} />
      </main>

      <Chrome
        pager={pager}
        overview={overview}
        telemetry={telemetry}
        hours={hours}
        onHours={setHours}
        includeTest={includeTest}
        onIncludeTest={setIncludeTest}
      />
      {!reduceMotion && <GlitchBurst key={burst} seed={burst} />}
    </div>
  );
}

/** Counts how many times `value` has changed; each new count plays one glitch burst. */
function useCountChanges(value: number) {
  const [count, setCount] = useState(0);
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current === value) return;
    seen.current = value;
    setCount((c) => c + 1);
  }, [value]);
  return count;
}
