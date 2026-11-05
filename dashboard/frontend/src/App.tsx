import { useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Backdrop } from "./components/Backdrop";
import { Chrome } from "./components/Chrome";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GlitchBurst } from "./components/GlitchBurst";
import { ZoomExtras } from "./components/ZoomExtras";
import { DEFAULT_HOURS, PAGE_IDS } from "./config";
import { useAiCheckup } from "./hooks/useAiCheckup";
import { useCompact } from "./hooks/useCompact";
import { HIDDEN, usePageOffset, usePager } from "./hooks/usePager";
import { useTelemetry } from "./hooks/useTelemetry";
import { Analysis } from "./pages/Analysis";
import { Log } from "./pages/Log";
import { Overview } from "./pages/Overview";
import { Trends } from "./pages/Trends";

// The 3D scene (three.js and its post-processing, the biggest dependencies) is a separate file loaded
// after the first paint.
const Scene = lazy(() => import("./scene/Scene"));

// Development-only helpers (stripped from production builds):
//   ?p=0.5#trends  freeze the view halfway from the overview to the page in the hash
//   ?still         skip the fade-ins and the ∞ drawing itself in (for screenshots)
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
  const overview = usePageOffset(pager, 0); // the 3D scene and the top bar follow the overview

  const first = useRef(pager.index); // the page the URL opened
  useEffect(() => {
    if (!DEBUG?.has("p") || first.current === 0) return;
    pager.slots.set(PAGE_IDS.map((_, i) => (i === 0 ? 0 : i === first.current ? 1 : HIDDEN)));
    pager.pos.set(Number(DEBUG.get("p")));
  }, [pager.slots, pager.pos]);

  const { index, turn } = pager;
  const still = DEBUG?.has("still") ?? false;

  return (
    <div ref={rootRef} className={`app${still ? " is-still" : ""}`}>
      <Backdrop pager={pager} busy={ai.state.phase === "running"} />
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <Scene offset={overview} zoom={pager.zoom} zt={pager.zt} compact={compact} reduceMotion={reduceMotion} still={still} />
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
        <ZoomExtras pager={pager} />
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
      {/* Every page change by scrolling (or the rail) plays a glitch burst; the windows zoom instead */}
      {!reduceMotion && !turn.zoom && <GlitchBurst key={turn.n} seed={turn.n} />}
    </div>
  );
}
