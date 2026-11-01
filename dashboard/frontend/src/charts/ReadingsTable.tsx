import { Icon } from "../components/Icon";
import type { Row } from "../lib/api";
import { fmtNum, fmtStamp } from "../lib/format";
import { moisturePct } from "../lib/moisture";

const yesNo = (v: boolean | null, yes: string, no: string) => (v == null ? "—" : v ? yes : no);

/** The latest readings, newest first: every value the charts show, as text. */
export function ReadingsTable({ rows }: { rows: Row[] }) {
  return (
    <div className="table-wrap">
      <table className="readings">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col" className="num">Moisture</th>
            <th scope="col" className="num">Raw ADC</th>
            <th scope="col" className="num">Temp °C</th>
            <th scope="col" className="num">Humidity %</th>
            <th scope="col">Light</th>
            <th scope="col">Grow LED</th>
            <th scope="col">Reservoir</th>
            <th scope="col">Faults</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = moisturePct(r.soil_adc_raw);
            return (
              <tr key={r.id} className={r.test_data ? "is-test" : undefined}>
                <td>
                  {fmtStamp(r.t)}
                  {r.test_data && <span className="tag is-outline">Test</span>}
                </td>
                <td className="num">{m == null ? "—" : `${Math.round(m)} %`}</td>
                <td className="num">{r.soil_adc_raw ?? "—"}</td>
                <td className="num">{fmtNum(r.temperature)}</td>
                <td className="num">{fmtNum(r.humidity)}</td>
                <td>{yesNo(r.light_state, "Bright", "Dark")}</td>
                <td>{yesNo(r.led_state, "On", "Off")}</td>
                <td>
                  {r.reservoir_state === false ? (
                    <span className="status-critical cell-status">
                      <Icon name="alert" size={13} /> Low
                    </span>
                  ) : (
                    yesNo(r.reservoir_state, "OK", "Low")
                  )}
                </td>
                <td>{r.faults?.length ? r.faults.join(", ") : "—"}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={9} className="empty">
                No readings in this range
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
