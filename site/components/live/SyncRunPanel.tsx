"use client";

/**
 * One corpus sync run, drawn whole: where it stands, what it is reading now, the rates it measured, and what it found
 * per channel, repository or project — including the ones it read and found nothing new in.
 *
 * Built to be EMBEDDED, not only shown on the Automations page: onboarding's sync wait draws this same panel over
 * the same `automation status` reading, so it takes one run and nothing about the page around it.
 *
 * Every figure is the ledger's (`src/syncRun/fold.ts`). A rate is an amount over a span the run itself measured,
 * shown as that; nothing here projects when a run will finish, and nothing should — a guessed finish time is the
 * progress bar that cannot say whether it is moving, with a clock on it.
 */
import type { ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { type PlainReason, plainReasonOf } from "../../lib/plainReason";
import { syncRunLeadOf } from "../../lib/syncRunLead";
import { cn } from "../../lib/utils";
import { RawFold } from "../console/RawFold";
import { StaleMark } from "../console/StaleMark";
import { ROW_DETAIL, ROW_FIELD } from "./Row";
import type { MeasuredRate, SyncContainer, SyncRun } from "./readAutomationsSyncRun";

/** How many containers with new rows the panel lists before the rest fold away. */
const CONTAINERS_SHOWN = 8;

/** A run state → its chip colour. */
const STATE_TONE: Readonly<Partial<Record<string, string>>> = {
  "ended-unfinished": "border-warning/60 text-warning",
  failed: "border-danger/60 text-danger",
  finished: "border-success/60 text-success",
  running: "border-info/60 text-info",
  unreadable: "border-danger/60 text-danger",
};

/** The chip colour for a run state; a state this page has no colour for is drawn neutral. */
function stateTone({ state }: { state: string }): string {
  const tone = STATE_TONE[state];
  if (tone === undefined) {
    return "border-border text-muted-foreground";
  }
  return tone;
}

/** A row kind as a person says it, where the stored kind name is not. */
const KIND_WORDS: Readonly<Partial<Record<string, string>>> = { comment: "replies", message: "threads and messages" };

/** One kind's spoken name, or the kind itself when it reads plainly. */
function kindWord({ kind }: { kind: string }): string {
  const word = KIND_WORDS[kind];
  if (word === undefined) {
    return kind;
  }
  return word;
}

/**
 * An elapsed span in a unit a glance reads. Measured, never projected.
 *
 * @returns the span
 */
export function spanWords({ ms }: { ms: number }): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return `${String(minutes)}m`;
  }
  return `${(minutes / 60).toFixed(1)}h`;
}

/** A measured rate per minute, with the span it was measured over. */
function rateWords({ rate }: { rate: MeasuredRate }): string {
  const perMinute = (rate.amount / rate.overMs) * 60_000;
  return `${perMinute.toFixed(perMinute < 10 ? 1 : 0)} ${rate.unit}/min over ${spanWords({ ms: rate.overMs })}`;
}

/** New rows by kind as one phrase, the reply kind named as a person says it. */
function kindWords({ counts }: { counts: Readonly<Record<string, number>> }): string {
  const parts = Object.entries(counts)
    .toSorted((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${n.toLocaleString()} ${kindWord({ kind })}`);
  if (parts.length === 0) {
    return "nothing new";
  }
  return parts.join(", ");
}

/** The state chip. */
function StateChip({ state }: { state: string }): ReactElement {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-[0.05rem] font-mono text-[0.66rem] tracking-[0.03em] uppercase",
        stateTone({ state }),
      )}
    >
      {state}
    </span>
  );
}

/** What it is reading now, when it said — or, once the run is over, the last thing it read. */
function ProgressLine({ run }: { run: SyncRun }): ReactElement | null {
  const { progress } = run;
  if (progress === undefined) {
    return null;
  }
  let label = "last read";
  if (run.state === "running") {
    label = "reading";
  }
  let counted = "";
  if (progress.done !== undefined) {
    const outOf = progress.total === undefined ? "" : ` of ${progress.total.toLocaleString()}`;
    counted = ` ${progress.done.toLocaleString()}${outOf}`;
  }
  return (
    <p className={ROW_FIELD}>
      <span>{label}</span> {progress.phase}
      {counted}
      {progress.item === undefined ? "" : `: ${progress.item}`}
    </p>
  );
}

/** One container row: its name and its new rows by kind. */
function ContainerLine({ container }: { container: SyncContainer }): ReactElement {
  const written: Record<string, number> = {};
  for (const [kind, tally] of Object.entries(container.kinds)) {
    if (tally.written > 0) {
      written[kind] = tally.written;
    }
  }
  return (
    <li>
      <b className="text-foreground">{container.label}</b> +{container.written.toLocaleString()} ·{" "}
      {kindWords({ counts: written })}
    </li>
  );
}

/** The containers with new rows, the first few open and the rest behind a fold. */
function Containers({ containers }: { containers: readonly SyncContainer[] }): ReactElement | null {
  if (containers.length === 0) {
    return null;
  }
  const shown = containers.slice(0, CONTAINERS_SHOWN);
  const rest = containers.slice(CONTAINERS_SHOWN);
  return (
    <>
      <ul className={ROW_DETAIL}>
        {shown.map((container) => (
          <ContainerLine container={container} key={container.container} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="text-[0.72rem]">
          <summary className="cursor-pointer text-muted-foreground">{rest.length} more with new rows</summary>
          <ul className={ROW_DETAIL}>
            {rest.map((container) => (
              <ContainerLine container={container} key={container.container} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** The containers read with nothing new, folded — a claim distinct from "never read". */
function QuietContainers({ containers }: { containers: readonly SyncContainer[] }): ReactElement | null {
  if (containers.length === 0) {
    return null;
  }
  return (
    <details className="text-[0.72rem]">
      <summary className="cursor-pointer text-muted-foreground">{containers.length} read with nothing new</summary>
      <p className="m-0 font-mono text-[0.68rem] text-muted-foreground">
        {containers.map((container) => container.label).join(", ")}
      </p>
    </details>
  );
}

/**
 * Anything the run says went wrong with it, or with its own record. A stored error is a raw provider or ingest
 * record, so each is said plainly with the raw message folded under it (`plainReasonOf`); the panel's own sentences
 * about gaps and ledger rows are already words.
 */
function RunProblems({ run }: { run: SyncRun }): ReactElement | null {
  const lines: PlainReason[] = run.errors.map((error) => plainReasonOf({ why: error }));
  if (run.gaps > 0) {
    lines.push({ plain: `${String(run.gaps)} coverage gap(s); its cursor was held back`, raw: undefined });
  }
  if (run.ledgerFailures > 0) {
    lines.push({
      plain: `${String(run.ledgerFailures)} ledger row(s) could not be written, so this record under-counts the run`,
      raw: undefined,
    });
  }
  const unread = run.malformedLines > 0;
  if (lines.length === 0 && !unread) {
    return null;
  }
  return (
    <>
      {unread && (
        <StaleMark
          facts={[
            {
              subject: `${String(run.malformedLines)} ledger line(s)`,
              why: "they did not parse, so this run is short",
            },
          ]}
          className="self-start"
        />
      )}
      {lines.length > 0 && (
        <ul className={cn(ROW_DETAIL, "text-danger")}>
          {lines.map((line, index) => (
            <li key={`${String(index)}:${line.plain}`}>
              {line.plain}
              {line.raw === undefined ? null : <RawFold raw={line.raw} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * One sync run.
 *
 * @param run the run, as `readSyncRun` read it
 * @returns the panel
 */
export function SyncRunPanel({ run }: { run: SyncRun }): ReactElement {
  const started = run.startedAtIso === undefined ? "start not recorded" : `started ${ageOf({ iso: run.startedAtIso })}`;
  const elapsed = run.elapsedMs === undefined ? "" : ` · ${spanWords({ ms: run.elapsedMs })} elapsed`;
  const { chip, lead, raw } = syncRunLeadOf({ errors: run.errors, state: run.state, why: run.why });
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 text-[0.76rem]">
      <p className="m-0 flex flex-wrap items-baseline gap-2">
        <StateChip state={chip} />
        <b>{run.source}</b>
        <span className="text-muted-foreground">
          {started}
          {elapsed}
        </span>
      </p>
      <div className="m-0">
        {lead}
        {raw === undefined ? null : <RawFold raw={raw} />}
      </div>
      {run.stalled && run.quietForMs !== undefined && (
        <p className="m-0 font-semibold text-warning">
          quiet for {spanWords({ ms: run.quietForMs })}: it has stopped saying anything
        </p>
      )}
      <ProgressLine run={run} />
      <p className={ROW_FIELD}>
        <span>new</span>{" "}
        {run.state === "unreadable" ? (
          <StaleMark facts={[{ subject: "the run file", why: "it would not parse" }]} />
        ) : (
          kindWords({ counts: run.newByKind })
        )}
      </p>
      {run.writtenRate !== undefined && (
        <p className={ROW_FIELD}>
          <span>rate</span> {rateWords({ rate: run.writtenRate })}
          {run.progressRate === undefined ? "" : ` · ${rateWords({ rate: run.progressRate })}`}
        </p>
      )}
      <Containers containers={run.containers} />
      <QuietContainers containers={run.quietContainers} />
      <RunProblems run={run} />
    </div>
  );
}
