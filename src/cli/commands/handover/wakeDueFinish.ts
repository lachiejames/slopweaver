/**
 * The finish half of one DUE park on a `handover wake` run: a due park on a MERGED pull request is first offered to
 * the real `handover finish` (`./wakeFinish.ts`) and spends no attempt when that closes its run. What it does not
 * settle goes on to its reseat, `./wakeDueRow.ts`'s `reseatDueRow`, carrying the sentence saying why.
 */
import { existsSync } from "node:fs";

import { parkMoved, type WakeCandidate } from "../../../handover/wakeCandidates.js";
import { claimWakePark } from "../../../handover/wakeJournalStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { heldByGuard } from "./wakeDueRow.js";
import { finishMergedPark } from "./wakeFinish.js";
import type { DueJudgement } from "./wakeJudge.js";
import { reparkGuard } from "./wakeReseat.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** What offering a merged park to `handover finish` came to: a row it settled, or the reseat it goes on to. */
export type FinishStep =
  | { readonly kind: "settled"; readonly row: WakeRowReport; readonly asked: boolean }
  | { readonly kind: "reseat"; readonly why: string; readonly asked: boolean };

/**
 * The park re-read and the re-park guard a finish passes, before its claim and again under it.
 *
 * @returns the settled step when the park moved or the guard held it, else `undefined`
 */
function finishHeld({
  base,
  candidate,
  home,
  judgement,
}: {
  base: Pick<WakeRowReport, "judgement" | "slug" | "wake">;
  candidate: WakeCandidate;
  home: string;
  judgement: DueJudgement;
}): FinishStep | undefined {
  const { parkIndex, slug } = candidate;
  const moved = parkMoved({ parkIndex, runsDir: stateHomePaths({ home }).runs, slug });
  if (moved !== undefined) {
    return { asked: false, kind: "settled", row: { ...base, action: "none", detail: moved } };
  }
  // The repark guard holds a finish exactly as it holds a reseat: a seat that re-parked on the merge
  // its last reseat already acted on chose to park, not to finish, and stays held until the condition moves.
  const guard = reparkGuard({ candidate, home, observed: judgement.observed });
  if (guard.isErr()) {
    return { asked: false, kind: "settled", row: { ...base, action: "wake-journal-failed", detail: guard.error } };
  }
  if (guard.value.kind === "acted") {
    return { asked: false, kind: "settled", row: heldByGuard({ base, reason: guard.value.reason }) };
  }
  return undefined;
}

/**
 * Offer one due merged park to `handover finish`, past the same re-read and re-park guard a reseat passes, and
 * under the same per-park wake claim (`../../../handover/wakeJournalStore.ts`): a claim another wake holds is a
 * reseat of this park in flight, so this wake asks nothing and reports `reseat-in-flight`.
 * Under the claim the park and the guard are read again, since the holder this wake followed may have just moved
 * it. A dry run takes no claim — it writes nothing, and `handover finish --dry-run` writes nothing either.
 *
 * @param allowNoLessons whether the finish child may force past the lesson question — a park the reconcile classed
 *   `landed` only (`./wakeFinish.ts`'s `wakeFinishEnv`)
 * @returns the row when the park moved, the guard held it, another wake holds it or finish closed its run; else
 *   the sentence its reseat carries
 */
export async function finishDueRow({
  allowNoLessons,
  candidate,
  deps,
  dryRun,
  home,
  judgement,
}: {
  allowNoLessons: boolean;
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  judgement: DueJudgement;
}): Promise<FinishStep> {
  const { parkIndex, parked, slug } = candidate;
  const base = { judgement, slug, wake: parked.wake };
  const held = finishHeld({ base, candidate, home, judgement });
  if (held !== undefined) {
    return held;
  }
  if (dryRun) {
    return askFinish({ allowNoLessons, base, besideQuestion: false, candidate, deps, dryRun, home, judgement });
  }
  const claim = claimWakePark({ home, nowIso: deps.now().toISOString(), parkIndex, parkedAtIso: parked.atIso, slug });
  if (claim.isErr()) {
    return {
      asked: false,
      kind: "settled",
      row: { ...base, action: "wake-journal-failed", detail: claim.error.message },
    };
  }
  if (claim.value.kind === "in-flight") {
    const detail = `another wake is reseating this park now, so this one asks no finish (${claim.value.reason})`;
    return { asked: false, kind: "settled", row: { ...base, action: "reseat-in-flight", detail } };
  }
  try {
    const heldNow = finishHeld({ base, candidate, home, judgement });
    if (heldNow !== undefined) {
      return heldNow;
    }
    return await askFinish({ allowNoLessons, base, besideQuestion: false, candidate, deps, dryRun, home, judgement });
  } finally {
    claim.value.release();
  }
}

/**
 * Whether the owner's open question is ALL a merged park's run still waits on: the real `handover finish --dry-run
 * --beside-question`, writing nothing. It is EXACTLY the finish the finish pass asks a landed
 * park with no question, so the lesson question is forced loud here too (`SLOPWEAVER_ALLOW_NO_LESSONS=1`, as the
 * reconcile's own child carries): a merged seat that closed before answering it is never reseated for it on main
 * either, so it is not work a reseat would do. Every other gate — probes, pages, the checks read —
 * still decides. Branch, repository and commit identity prove the merge was the run's own; only finish's own gates
 * prove nothing else is left.
 *
 * @returns `undefined` when finish would close the run but for the question, else why not
 */
export async function finishReadyBesideQuestion({
  candidate,
  deps,
  home,
  judgement,
}: {
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  home: string;
  judgement: DueJudgement;
}): Promise<string | undefined> {
  const base = { judgement, slug: candidate.slug, wake: candidate.parked.wake };
  const step = await askFinish({
    allowNoLessons: true,
    base,
    besideQuestion: true,
    candidate,
    deps,
    dryRun: true,
    home,
    judgement,
  });
  return step.kind === "settled" ? undefined : step.why;
}

/**
 * Run the finish in the parked seat's own worktree and say what it came to.
 *
 * @param besideQuestion whether the dry run sets the open question aside ({@link finishReadyBesideQuestion} only)
 * @returns the settled row when finish closed the run (or would, on a dry run), else the sentence its reseat carries
 */
async function askFinish({
  allowNoLessons,
  base,
  besideQuestion,
  candidate,
  deps,
  dryRun,
  home,
  judgement,
}: {
  allowNoLessons: boolean;
  base: Pick<WakeRowReport, "judgement" | "slug" | "wake">;
  besideQuestion: boolean;
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  judgement: DueJudgement;
}): Promise<FinishStep> {
  const { docRepo, parkIndex, parked, slug } = candidate;
  const worktreeExists = existsSync(parked.worktree);
  // A path that exists is no proof finish reads it: one that is no linked worktree of the doc's repo falls back to
  // that repo exactly as the state home does, so the wake asks finish's own classification —
  // and a doc naming no repo leaves nothing to classify against, so it proves nothing either.
  const probesDocRepo =
    !worktreeExists || docRepo === undefined || deps.probeTreeOf({ cwd: parked.worktree, docRepo }) === "doc-repo";
  const finished = await finishMergedPark({
    allowNoLessons,
    besideQuestion,
    docRepo,
    dryRun,
    finish: deps.finish,
    home,
    mergeCommitOid: judgement.mergeCommitOid,
    mergeProof: deps.mergeProof,
    parkIndex,
    parkedAtIso: parked.atIso,
    probesDocRepo,
    reason: judgement.reason,
    runsDir: stateHomePaths({ home }).runs,
    slug,
    worktree: parked.worktree,
    worktreeExists,
  });
  if (finished.kind === "finished") {
    const action = dryRun ? "would-finish" : "finished";
    return { asked: true, kind: "settled", row: { ...base, action, detail: finished.detail } };
  }
  return { asked: finished.launched, kind: "reseat", why: finished.why };
}
