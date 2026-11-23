/**
 * The held-run half of `page publish`: the run the current session holds, the closing lock taken on it before the
 * page is written, and the `artifact` event that records the page as that run's deliverable.
 *
 * Split from `./publishRun.ts` along the seam the two already had: that file decides WHAT is published (lint, review,
 * the fold), this one decides WHICH RUN the page belongs to and keeps a settle, finish or close from racing it
 * (`../handover/closingLock.ts`).
 */
import { runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { acquireClosingLock } from "../handover/closingLock.js";
import { closedRunPageRefuses } from "../handover/uncardedPageGate.js";

/** How `page publish` learns which run the current session holds. A plain function, so a test passes a fake. */
export type HeldRunReader = ({ home }: { home: string }) => string | undefined;

/**
 * The reader for a caller that publishes outside any run: attaches nothing.
 *
 * @returns `undefined`, always — no run is held
 */
export const NO_HELD_RUN: HeldRunReader = () => undefined;

/** The held run's slug, and the release of the closing lock the publish holds on it. */
export interface HeldRunLock {
  readonly run: string;
  readonly release: () => void;
}

/**
 * Take the closing lock on the run the session holds, before anything is written. A run already CLOSED refuses the
 * publish (`closedRunPageRefuses`): its page would never meet a gate. With that refusal's hatch open the page is
 * published and recorded nowhere, which the hatch receipt says.
 *
 * @param heldRun which run the current session holds, if any
 * @param home the state home holding the lock and the journal
 * @param nowIso the instant the lock is stamped with
 * @param writeDiagnostic where a refusal is printed
 * @returns the held lock, `undefined` when there is no run to record on, or `"refused"` when nothing may be written
 */
export function lockHeldRun({
  heldRun,
  home,
  nowIso,
  writeDiagnostic,
}: {
  heldRun: HeldRunReader;
  home: string;
  nowIso: string;
  writeDiagnostic: (line: string) => void;
}): HeldRunLock | "refused" | undefined {
  const run = heldRun({ home });
  if (run === undefined) {
    return undefined;
  }
  const lock = acquireClosingLock({ home, nowIso, slug: run });
  if (lock.isErr()) {
    writeDiagnostic(
      `page publish: run ${run} is being settled, finished or closed, so nothing was written — ${lock.error}`,
    );
    writeDiagnostic("  re-run the same `page publish` once that close ends");
    return "refused";
  }
  const journal = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: run });
  const closed =
    journal.isOk() &&
    journal.value.events.length > 0 &&
    runStateOf({ events: journal.value.events }).phase === "closed";
  if (!closed) {
    return {
      release: () => {
        lock.value.release();
      },
      run,
    };
  }
  lock.value.release();
  return closedRunPageRefuses({ run, writeDiagnostic }) ? "refused" : undefined;
}

/**
 * Record the page as the held run's `artifact`, so `handover settle`, `finish` and `close` know the run's deliverable
 * is a page as a typed fact rather than from prose (`../../../handover/pageDelivery.ts`). The caller holds the run's
 * closing lock.
 *
 * The existing `artifact` kind rather than a new one, because every checkout on the machine reads this journal and
 * an older decoder already knows it. No held run is not a failure: a supervisor tick or a hand publish outside a run
 * attaches nothing, which is the honest answer.
 *
 * @param run the run the current session holds
 * @param home the state home whose runs directory holds the journal
 * @param nowIso the instant the event is stamped with
 * @param url the page's address, the pointer recorded
 * @param writeDiagnostic where the receipt or the failure is printed
 * @returns false when the journal would not take the event
 */
export function recordArtifact({
  run,
  home,
  nowIso,
  url,
  writeDiagnostic,
}: {
  run: string;
  home: string;
  nowIso: string;
  url: string;
  writeDiagnostic: (line: string) => void;
}): boolean {
  const written = applyRowEvent({
    event: { atIso: nowIso, kind: "artifact", url },
    // Checked again on the append's own read: a terminal write by anything that does not take the lock would leave
    // this artifact ungated, so the record refuses rather than lands after it.
    precondition: ({ events }) =>
      events.length > 0 && runStateOf({ events }).phase === "closed"
        ? `run ${run} closed while the page was being written, so the page never reached their Queue — put it there with \`slopweaver handover register --ask "<the decision> — <its console address>" …\``
        : undefined,
    runsDir: stateHomePaths({ home }).runs,
    slug: run,
  });
  if (written.isErr()) {
    writeDiagnostic(
      `page publish: the page is written, and recording it on run ${run} failed — ${written.error.message}`,
    );
    writeDiagnostic(
      "  re-run the same `page publish`: the page is unchanged and the artifact pointer is safe to repeat",
    );
    return false;
  }
  writeDiagnostic(
    `  recorded as run ${run}'s artifact — \`handover settle\` and \`finish\` refuse until it reaches their Queue`,
  );
  return true;
}
