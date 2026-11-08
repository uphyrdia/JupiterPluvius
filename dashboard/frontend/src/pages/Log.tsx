import { useMemo, type CSSProperties } from "react";
import { ReadingsTable } from "../charts/ReadingsTable";
import { StatesTimeline } from "../charts/StatesTimeline";
import { PageFrame } from "../components/PageFrame";
import { PageHeader } from "../components/PageHeader";
import { PAGE_IDS } from "../config";
import type { Pager } from "../hooks/usePager";
import type { Telemetry } from "../hooks/useTelemetry";
import { gapMs } from "../lib/series";

interface Props {
  telemetry: Telemetry;
  hours: number;
  pager: Pager;
  active: boolean;
}

const INDEX = PAGE_IDS.indexOf("log");
const d = (delay: number) => ({ "--d": delay }) as CSSProperties;

/**
 * The page below the overview: on/off states over time (from the possibly thinned window), and the
 * latest readings as a table (every reading, never thinned).
 */
export function Log({ telemetry, hours, pager, active }: Props) {
  const { rows, updatedAt } = telemetry;
  const recent = useMemo(() => telemetry.recent.slice().reverse(), [telemetry.recent]);
  const gap = useMemo(() => gapMs(rows), [rows]);

  return (
    <PageFrame index={INDEX} id="log" pager={pager} active={active}>
      <div className="lg">
        <PageHeader id="log" title="Log" kicker="States over time · recent readings" active={active} />

        <section className="panel lg-panel reveal" style={d(0.1)} aria-labelledby="states-title">
          <header className="panel-head">
            <span className="tag">TL·01</span>
            <h3 id="states-title">States over time</h3>
            <span className="micro">Last {hours} h · hover a band for its times · share of readings on the right</span>
          </header>
          <StatesTimeline rows={rows} x0={updatedAt - hours * 3600e3} x1={updatedAt} gap={gap} />
        </section>

        <section className="panel lg-panel reveal" style={d(0.18)} aria-labelledby="table-title">
          <header className="panel-head">
            <span className="tag">TB·01</span>
            <h3 id="table-title">Recent readings</h3>
            <span className="micro">
              Newest first · latest {recent.length} in {hours} h
            </span>
          </header>
          <ReadingsTable rows={recent} />
        </section>

        <p className="lg-end micro reveal" style={d(0.26)}>
          <i aria-hidden="true" /> End of transmission · JupiterPluvius · CG2271
        </p>
      </div>
    </PageFrame>
  );
}
