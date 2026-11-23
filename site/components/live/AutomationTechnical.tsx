"use client";

/**
 * An open automation card's Technical detail fold (`./AutomationCard.tsx`): the verb's own records — what it is
 * doing and why, its kind, cadence and destination, its outcomes, firings and identifiers, and its sync runs. Nothing
 * here is what the owner reads first; the purpose sentence and the answers above it are.
 */
import type { ReactElement } from "react";

import { StaleMark } from "../console/StaleMark";
import { Field } from "./Row";
import type { Automation } from "./readAutomationsCard";
import { SyncRunPanel } from "./SyncRunPanel";

/**
 * What a firing field draws when the slot ledger did not read whole, so its absence is never a zero: a staleness mark
 * whose hover says why, never a sentence in the field's place.
 *
 * @returns the mark
 */
export function LedgerMark({ gap }: { gap: string }): ReactElement {
  return <StaleMark facts={[{ subject: "the slot ledger", why: gap }]} />;
}

/** When the row last succeeded, the ledger's staleness mark when it did not read whole, else not carried. */
function lastOkWords({ automation }: { automation: Automation }): string | ReactElement | undefined {
  if (automation.lastSucceededIso !== undefined) {
    return automation.lastSucceededIso;
  }
  if (automation.firingsGap !== undefined) {
    return <LedgerMark gap={automation.firingsGap} />;
  }
  return undefined;
}

/** Last ok and newest failure, each a staleness mark rather than none when the slot ledger did not read whole. */
function Outcomes({ automation }: { automation: Automation }): ReactElement {
  let newest: string | ReactElement = "none on record";
  if (automation.firingsGap !== undefined) {
    newest = <LedgerMark gap={automation.firingsGap} />;
  }
  if (automation.newestFailure !== undefined) {
    newest = `${automation.newestFailure.atIso}: ${automation.newestFailure.detail}`;
  }
  return (
    <>
      <Field label="last ok" value={lastOkWords({ automation })} />
      <Field label="newest failure" value={newest} />
    </>
  );
}

/** Who or what the row is waiting on, or that it waits on nothing. */
function waitingWords({ automation }: { automation: Automation }): string {
  if (automation.waitingOn === undefined) {
    return "nothing";
  }
  return automation.waitingOn;
}

/**
 * The identifiers and records behind the answers, folded: the fix's board row, the owner's recorded pause reason, the
 * row's own id, and the technical record the plain why was told from.
 */
function Records({ automation }: { automation: Automation }): ReactElement {
  const detail = automation.account?.detail;
  return (
    <>
      {automation.fixRow === undefined ? null : <Field label="fix row" value={automation.fixRow} />}
      {automation.pauseReason === undefined ? null : <Field label="paused because" value={automation.pauseReason} />}
      {detail === undefined ? null : <Field label="record" value={detail} />}
      <Field label="row" value={automation.recipeId} />
    </>
  );
}

/** The fold's firings tally; the firings themselves are the Recent runs timeline above. */
function Firings({ automation }: { automation: Automation }): ReactElement {
  const { firings } = automation;
  const mark = automation.firingsGap === undefined ? null : <LedgerMark gap={automation.firingsGap} />;
  if (firings.recorded === 0 && mark !== null) {
    return <Field label="firings" value={mark} />;
  }
  if (firings.recorded === 0) {
    return <Field label="firings" value="none read from the slot ledger" />;
  }
  return (
    <>
      <Field
        label="firings"
        value={
          <>
            {`${String(firings.recorded)} recorded since ${String(firings.sinceIso)}: ${String(firings.succeeded)} ok, ` +
              `${String(firings.failed)} failed, ${String(firings.dead)} dead, ${String(firings.deferred)} deferred, ` +
              `${String(firings.open)} open (one row per firing, its final stored outcome)`}{" "}
            {mark}
          </>
        }
      />
      {firings.unrun === undefined ? null : <Field label="never ran" value={unrunWords({ unrun: firings.unrun })} />}
    </>
  );
}

/** The scheduled times that went by with no run, said as a floor when the count stopped at its cap. */
function unrunWords({ unrun }: { unrun: NonNullable<Automation["firings"]["unrun"]> }): string {
  const floor = unrun.bound === "at-least" ? "at least " : "";
  return `${floor}${String(unrun.count)} scheduled time(s) since then went by with no run`;
}

/**
 * The fold's sync section: the newest run open, older ones folded, and a staleness mark when the sync-run ledger did
 * not read — beside whatever runs it did give.
 */
function SyncRuns({ automation }: { automation: Automation }): ReactElement | null {
  if (automation.syncSource === undefined) {
    return null;
  }
  const newest = automation.syncRuns.at(0);
  const older = automation.syncRuns.slice(1);
  let gapMark: ReactElement | null = null;
  if (automation.syncRunsGap !== undefined) {
    gapMark = (
      <StaleMark facts={[{ subject: "the sync-run ledger", why: automation.syncRunsGap }]} className="self-start" />
    );
  }
  if (newest === undefined && gapMark !== null) {
    return gapMark;
  }
  if (newest === undefined) {
    return (
      <Field
        label="syncs"
        value={`no ${automation.syncSource} run is in the sync-run ledger yet; it records from the first refresh on this build`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {gapMark}
      <SyncRunPanel run={newest} />
      {older.length > 0 && (
        <details className="text-[0.72rem]">
          <summary className="cursor-pointer text-muted-foreground">{older.length} earlier run(s)</summary>
          <div className="mt-2 flex flex-col gap-2">
            {older.map((run) => (
              <SyncRunPanel key={run.runId} run={run} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * The Technical detail fold, closed until the owner opens it.
 *
 * @returns the fold
 */
export function TechnicalDetail({ automation }: { automation: Automation }): ReactElement {
  return (
    <details className="text-[0.72rem]">
      <summary className="cursor-pointer text-muted-foreground">Technical detail</summary>
      <div className="mt-1 flex flex-col gap-1">
        <Field label="now" value={`${automation.nowDoing} · ${automation.why}`} />
        <Field label="asks" value={automation.what} />
        <Field label="kind" value={`${automation.kind} · ${automation.cadence} · to ${automation.destination}`} />
        <Field label="waiting on" value={waitingWords({ automation })} />
        <Outcomes automation={automation} />
        <Firings automation={automation} />
        <Records automation={automation} />
        {/* A sync run's own record carries the runner's framing, so it sits in the fold. */}
        <SyncRuns automation={automation} />
      </div>
    </details>
  );
}
