/**
 * One due park's reseat under the wake journal — the guard against a re-park on a condition a reseat already acted
 * on, the per-park claim held across the spawn, and the attempt and settlement rows either side of it. Kept apart
 * from the row loop in `./wakeRows.ts`, which decides WHETHER a due row is reseated this run at all.
 *
 * The order is the contract:
 *
 * 1. **The guard reads first**, outside any claim and on a dry run too — it only reads.
 * 2. **The claim** (`../../../handover/wakeJournalStore.ts`) is taken per park. A live holder is another wake
 *    mid-reseat on this exact park, so this one does nothing: `reseat-in-flight`, never a second spawn.
 * 3. **Under the claim, the park and the guard are read again** — the holder this wake waited behind may have just
 *    reseated it — and only then is the attempt appended, durably, BEFORE `cmux spawn` runs.
 * 4. **The settlement** records how the spawn ended and, for a backoff deferral, when the backoff opens: what
 *    `handover wake --retry <nonce>` waits for.
 *
 * **Residue, stated**: the claim orders WAKES only. `cmux spawn` takes no wake claim and refuses no
 * dispatched park, so a seat something else boots between the last park read and this wake's own spawn is not
 * excluded — narrowed to that read, which runs after the attempt is journalled, and closed only by `cmux spawn`
 * refusing a park another seat already cleared. It predates the journal: the row loop always read then spawned.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { WakeObservation } from "../../../handover/parkWake.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { parkMoved, type WakeCandidate } from "../../../handover/wakeCandidates.js";
import { foldWakeJournal, reparkedOnActedCondition, type WakeAttemptRow } from "../../../handover/wakeJournal.js";
import { appendWakeJournalRow, claimWakePark, readWakeJournal } from "../../../handover/wakeJournalStore.js";
import { lastReseatedParkBefore } from "../../../handover/wakeProofs.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** What the guard found: a new condition, or the earlier reseat the park re-parked on. */
type GuardVerdict = { readonly kind: "new" } | { readonly kind: "acted"; readonly reason: string };

/**
 * Whether the park re-parked on the very condition an earlier reseat of its row acted on.
 *
 * @param observed what the park's wake would act on now
 * @returns a new condition, the earlier reseat's reason, or why either journal did not read
 */
export function reparkGuard({
  candidate,
  home,
  observed,
}: {
  candidate: WakeCandidate;
  home: string;
  observed: WakeObservation;
}): Result<GuardVerdict, string> {
  const rows = readWakeJournal({ home });
  if (rows.isErr()) {
    return err(rows.error.message);
  }
  const run = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: candidate.slug });
  if (run.isErr()) {
    return err(`the run journal did not re-read: ${run.error.message}`);
  }
  const acted = reparkedOnActedCondition({
    actedPark: lastReseatedParkBefore({ events: run.value.events, parkIndex: candidate.parkIndex }),
    attempts: foldWakeJournal({ rows: rows.value }),
    observed,
    slug: candidate.slug,
  });
  if (acted === undefined) {
    return ok({ kind: "new" });
  }
  return ok({ kind: "acted", reason: actedReason({ acted }) });
}

/** The line a guarded park reads: which reseat already acted on what it waits on, and what would wake it. */
function actedReason({ acted }: { acted: WakeAttemptRow }): string {
  const next =
    acted.observed.kind === "at" ? "a new wake instant" : "a new head's checks, a re-run, a merge or a close";
  return (
    `re-parked on the condition its reseat at ${acted.atIso} (park of ${acted.parkedAtIso}) already acted on — ` +
    `it waits for ${next}`
  );
}

/** How one `cmux spawn` ended, as `./wakeRows.ts` believes it off the run journal. */
export interface SpawnOutcome {
  readonly action: "spawned" | "spawn-failed" | "spawn-deferred";
  readonly detail: string;
}

/** A row's outcome, as `./wakeRows.ts` reports it, plus a judgement replaced when the guard held the park. */
type ReseatOutcome = Pick<WakeRowReport, "action" | "detail" | "attemptNonce" | "retryAfterIso"> & {
  readonly guarded?: string;
};

/**
 * Reseat one due park under its claim, journalling the attempt before the spawn and the settlement after.
 *
 * @param observed what the park's wake acts on, recorded on the attempt
 * @param launch runs `cmux spawn` and believes it only off the run journal (`./wakeRows.ts`)
 * @returns the row's outcome
 */
export async function reseatClaimed({
  candidate,
  deps,
  home,
  launch,
  observed,
}: {
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  home: string;
  launch: () => Promise<SpawnOutcome>;
  observed: WakeObservation;
}): Promise<ReseatOutcome> {
  const { parkIndex, parked, slug } = candidate;
  const claim = claimWakePark({ home, nowIso: deps.now().toISOString(), parkIndex, parkedAtIso: parked.atIso, slug });
  if (claim.isErr()) {
    return { action: "wake-journal-failed", detail: claim.error.message };
  }
  if (claim.value.kind === "in-flight") {
    return {
      action: "reseat-in-flight",
      detail: `another wake is reseating this park now, so this one does nothing (${claim.value.reason})`,
    };
  }
  try {
    const moved = parkMoved({ parkIndex, runsDir: stateHomePaths({ home }).runs, slug });
    if (moved !== undefined) {
      return { action: "none", detail: moved };
    }
    const guard = reparkGuard({ candidate, home, observed });
    if (guard.isErr()) {
      return { action: "wake-journal-failed", detail: guard.error };
    }
    if (guard.value.kind === "acted") {
      return { action: "none", detail: guard.value.reason, guarded: guard.value.reason };
    }
    return await attemptAndSettle({ candidate, deps, home, launch, observed });
  } finally {
    claim.value.release();
  }
}

/** Append the attempt, spawn, and settle it — the part of {@link reseatClaimed} that runs only under the claim. */
async function attemptAndSettle({
  candidate,
  deps,
  home,
  launch,
  observed,
}: {
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  home: string;
  launch: () => Promise<SpawnOutcome>;
  observed: WakeObservation;
}): Promise<ReseatOutcome> {
  const { parkIndex, parked, slug } = candidate;
  const nonce = deps.nonce();
  const attempt = appendWakeJournalRow({
    home,
    row: {
      atIso: deps.now().toISOString(),
      kind: "attempt",
      nonce,
      observed,
      parkIndex,
      parkedAtIso: parked.atIso,
      slug,
    },
  });
  if (attempt.isErr()) {
    return { action: "wake-journal-failed", detail: `${attempt.error.message}; nothing was spawned` };
  }
  // The last read before the launch: a seat booted by something other than a wake — the owner's answer, a hand
  // spawn — takes no wake claim, so it can clear the park after the read above. The attempt stays unsettled and is
  // credited to whichever seat came up, which saw the same condition.
  const movedSinceAttempt = parkMoved({ parkIndex, runsDir: stateHomePaths({ home }).runs, slug });
  if (movedSinceAttempt !== undefined) {
    return { action: "none", attemptNonce: nonce, detail: `${movedSinceAttempt}; nothing was spawned` };
  }
  return settleLaunch({ deps, home, nonce, spawned: await launch() });
}

/** Journal how the launch ended, with the backoff's opening instant when it deferred, and report the row. */
function settleLaunch({
  deps,
  home,
  nonce,
  spawned,
}: {
  deps: HandoverWakeDeps;
  home: string;
  nonce: string;
  spawned: SpawnOutcome;
}): ReseatOutcome {
  const settledAtIso = deps.now().toISOString();
  const notes: string[] = [];
  let retryAfterIso: string | undefined;
  if (spawned.action === "spawn-deferred") {
    const opensAt = deps.retryAfter({ home, nowIso: settledAtIso });
    if (opensAt.isOk()) {
      retryAfterIso = opensAt.value;
    } else {
      notes.push(`the spawn backoff did not read, so no retry instant: ${opensAt.error.join("; ")}`);
    }
  }
  const settled = appendWakeJournalRow({
    home,
    row: {
      action: spawned.action,
      atIso: settledAtIso,
      kind: "settled",
      nonce,
      ...(retryAfterIso === undefined ? {} : { retryAfterIso }),
    },
  });
  if (settled.isErr()) {
    notes.push(`the settlement did not write: ${settled.error.message}`);
  }
  return {
    action: spawned.action,
    attemptNonce: nonce,
    detail: [spawned.detail, ...notes].join("; "),
    ...(retryAfterIso === undefined ? {} : { retryAfterIso }),
  };
}
