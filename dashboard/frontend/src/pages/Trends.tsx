import { useMemo, useState, type CSSProperties } from "react";
import { ChartPanel } from "../charts/ChartPanel";
import { LineChart } from "../charts/LineChart";
import { PageFrame } from "../components/PageFrame";
import { PageHeader } from "../components/PageHeader";
import { PAGE_IDS, parentOf } from "../config";
import type { Pager } from "../hooks/usePager";
import type { Telemetry } from "../hooks/useTelemetry";
import { moisturePct } from "../lib/moisture";
import { gapMs, toPoints } from "../lib/series";

interface Props {
  telemetry: Telemetry;
  hours: number;
  includeTest: boolean;
  pager: Pager;
  active: boolean;
}

const INDEX = PAGE_IDS.indexOf("trends");

// Checked as a set for colour-blind separation; orange and aqua are under 3:1 contrast on the
// panels, which is why each chart also prints its value in the panel header (and the log has a table).
const COLORS = { moist: "#2b47e6", temp: "#eb6834", hum: "#1baf7a" };

/**
 * Soil moisture, temperature and humidity over the selected range, with a shared crosshair.
 * Opens from the overview's soil moisture window.
 */
export function Trends({ telemetry, hours, includeTest, pager, active }: Props) {
  const { rows, loading, updatedAt } = telemetry;
  const [hoverT, setHoverT] = useState<number | null>(null);

  const gap = useMemo(() => gapMs(rows), [rows]);
  const moist = useMemo(() => toPoints(rows, (r) => moisturePct(r.soil_adc_raw)), [rows]);
  const temp = useMemo(() => toPoints(rows, (r) => r.temperature), [rows]);
  const hum = useMemo(() => toPoints(rows, (r) => r.humidity), [rows]);
  const shared = { x0: updatedAt - hours * 3600e3, x1: updatedAt, gap, hoverT, onHover: setHoverT };

  return (
    <PageFrame index={INDEX} id="trends" pager={pager} active={active}>
      <div className="tr">
        <PageHeader
          id="trends" title="Trends" kicker={`Sensor history · last ${hours} h`} active={active}
          onBack={() => pager.goTo(parentOf(INDEX))}
        >
          <p className="ph-meta micro">
            {rows.length} readings{rows.length >= 1000 ? " (evenly thinned)" : ""} ·{" "}
            {includeTest ? "test data included" : "real readings only"}
          </p>
        </PageHeader>

        <div className={`tr-grid${loading ? " is-loading" : ""}`}>
          <ChartPanel
            className="tr-moist" delay={0.1} code="CH·01" title="Soil moisture" unit="%" digits={0}
            color={COLORS.moist} pts={moist} hoverT={hoverT} extra={(p) => `raw ${p.row.soil_adc_raw}`}
          >
            <LineChart pts={moist} {...shared} yDomain={[0, 100]} color={COLORS.moist} label="Soil moisture over time, in percent" />
          </ChartPanel>
          <ChartPanel
            className="tr-temp" delay={0.18} code="CH·02" title="Temperature" unit="°C" digits={1}
            color={COLORS.temp} pts={temp} hoverT={hoverT}
          >
            <LineChart pts={temp} {...shared} minSpan={4} color={COLORS.temp} label="Air temperature over time, in °C" />
          </ChartPanel>
          <ChartPanel
            className="tr-hum" delay={0.24} code="CH·03" title="Air humidity" unit="%" digits={0}
            color={COLORS.hum} pts={hum} hoverT={hoverT}
          >
            <LineChart pts={hum} {...shared} minSpan={10} color={COLORS.hum} label="Air humidity over time, in percent" />
          </ChartPanel>
        </div>

        <i className="tr-dots halftone reveal" style={{ "--d": 0.32 } as CSSProperties} aria-hidden="true" />
      </div>
    </PageFrame>
  );
}
