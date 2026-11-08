import type { CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { PageFrame } from "../components/PageFrame";
import { PageHeader } from "../components/PageHeader";
import { PAGE_IDS, parentOf } from "../config";
import type { AiState } from "../hooks/useAiCheckup";
import { useNow } from "../hooks/useNow";
import type { Pager } from "../hooks/usePager";
import { fmtClock, pad2 } from "../lib/format";
import { AI_PRIORITY, AI_STATUS } from "../lib/status";

interface Props {
  ai: AiState;
  onRun: () => void;
  hours: number;
  includeTest: boolean;
  readings: number;
  pager: Pager;
  active: boolean;
}

const INDEX = PAGE_IDS.indexOf("analysis");
const d = (delay: number) => ({ "--d": delay }) as CSSProperties;

/**
 * The AI check-up: DeepSeek (via the backend) summarises the readings in range.
 * Opens from the overview's AI check-up window.
 */
export function Analysis({ ai, onRun, hours, includeTest, readings, pager, active }: Props) {
  const running = ai.phase === "running";
  return (
    <PageFrame index={INDEX} id="analysis" pager={pager} active={active}>
      <div className="an">
        <PageHeader
          id="analysis" title="Analysis" kicker="AI check-up · DeepSeek" active={active}
          onBack={() => pager.goTo(parentOf(INDEX))}
        />

        <div className="an-grid">
          <aside className="an-side reveal" style={d(0.12)}>
            <p className="an-lede">
              DeepSeek reads every reading in the selected range and tells you, in plain words, what needs attention.
            </p>
            <dl className="an-scope">
              <div>
                <dt>Range</dt>
                <dd>Last {hours} h</dd>
              </div>
              <div>
                <dt>Readings</dt>
                <dd>{readings}</dd>
              </div>
              <div>
                <dt>Test data</dt>
                <dd>{includeTest ? "Included" : "Left out"}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>DeepSeek V4.1 Flash</dd>
              </div>
            </dl>
            <button type="button" className={`run${running ? " is-running" : ""}`} onClick={onRun} disabled={running}>
              <span className="run-icon" aria-hidden="true">
                {running ? <span className="spinner" /> : <Icon name="play" size={16} />}
              </span>
              <span className="run-text">
                <b>{running ? "Analysing…" : "Run analysis"}</b>
                <small>Last {hours} h</small>
              </span>
            </button>
            <p className="micro an-note">About 10–15 s for 24 h · one request per 15 s · times in your time zone</p>
          </aside>

          <section className="an-report panel reveal" style={d(0.2)} aria-live="polite" aria-busy={running}>
            {ai.phase === "idle" && (
              <div className="ai-idle">
                <p className="ai-idle-title">No report yet</p>
                <p className="micro">
                  Press <b>Run analysis</b> for a short summary and advice<span className="cursor" aria-hidden="true" />
                </p>
              </div>
            )}
            {ai.phase === "running" && <Running startedAt={ai.startedAt} hours={ai.hours} includeTest={ai.includeTest} />}
            {ai.phase === "error" && (
              <div className="ai-error">
                <p className={`status status-${/wait/i.test(ai.message) ? "warning" : "critical"}`}>
                  <Icon name={/wait/i.test(ai.message) ? "alert" : "stop"} size={16} />
                  {/wait/i.test(ai.message) ? "Cooling down" : "Request failed"}
                </p>
                <p className="ai-error-text">{ai.message}</p>
              </div>
            )}
            {ai.phase === "done" && <Report state={ai} />}
          </section>
        </div>
      </div>
    </PageFrame>
  );
}

function Running({ startedAt, hours, includeTest }: { startedAt: number; hours: number; includeTest: boolean }) {
  useNow(250); // re-render a few times a second to tick the counter
  const seconds = (performance.now() - startedAt) / 1000;
  const sentAt = Date.now() - seconds * 1000;
  return (
    <div className="ai-running">
      <div className="scanner" aria-hidden="true" />
      <ul className="ai-log micro">
        <li>&gt; Scope · last {hours} h · test data {includeTest ? "included" : "left out"}</li>
        <li>&gt; Request sent · {fmtClock(sentAt)}</li>
        <li>
          &gt; Waiting for DeepSeek · {seconds.toFixed(0)} s<span className="cursor" aria-hidden="true" />
        </li>
      </ul>
    </div>
  );
}

function Report({ state }: { state: Extract<AiState, { phase: "done" }> }) {
  const { result, seconds, hours, at } = state;
  const meta = [
    result.model,
    `${result.readings} readings`,
    `last ${hours} h`,
    `${seconds.toFixed(1)} s`,
    result.tokens ? `${result.tokens.toLocaleString()} tokens` : null,
  ].filter(Boolean).join(" · ");

  if (result.raw != null) {
    // The model didn't return the JSON shape we asked for: show its text as is.
    return (
      <div className="ai-report">
        <p className="ai-raw">{result.raw}</p>
        <p className="ai-meta micro">{meta}</p>
      </div>
    );
  }

  const status = AI_STATUS[result.status ?? "attention"] ?? AI_STATUS.attention;
  const summary = result.summary ?? [];
  const advice = result.advice ?? [];
  return (
    <div className="ai-report">
      <header className="ai-head">
        <p className={`status status-${status.tone}`}>
          <Icon name={status.icon} size={16} />
          {status.label}
        </p>
        <p className="micro">Report · {fmtClock(at)}</p>
      </header>
      {result.headline && <h3 className="ai-headline">{result.headline}</h3>}
      <div className="ai-cols">
        <section>
          <h4 className="eyebrow">Summary</h4>
          <ol className="ai-summary">
            {summary.map((s, i) => (
              <li key={i}>
                <span className="ai-n">{pad2(i + 1)}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h4 className="eyebrow">Advice</h4>
          {advice.length ? (
            <ul className="ai-advice">
              {advice.map((a, i) => {
                const p = AI_PRIORITY[a.priority] ?? AI_PRIORITY.info;
                return (
                  <li key={i} className={`status-${p.tone}`}>
                    <Icon name={p.icon} size={16} />
                    <span>
                      <span className="sr-only">{p.label}: </span>
                      {a.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ai-none">No action needed.</p>
          )}
        </section>
      </div>
      <p className="ai-meta micro">{meta}</p>
    </div>
  );
}
