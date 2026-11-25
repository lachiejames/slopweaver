/**
 * The `lap` class's decision, split from `./pruneClassify.ts` the way `./pruneSnapshotClass.ts` is: a tree a
 * `github lap` minted is judged by its own provenance (`./lapTreeProvenance.ts`) before any ordinary rule, so its
 * own report directories cannot hold it forever and its detached HEAD cannot fall into the salvage chain.
 *
 * Two routes, and the difference is the whole safety argument. A MARKED tree names the process that minted it; once
 * that exact process is gone, the tree is spent, and the hourly apply takes it, pinning its HEAD under
 * `refs/slopweaver/pruned-lap/` first. An UNMARKED lap-shaped tree names nobody, so nothing proves its lap is over:
 * the hourly apply never takes one, and an explicit `--include-unmarked-lap` run takes one only when a kept ref
 * already contains its HEAD — a HEAD no kept ref holds is refused, and only the operator decides to pin it.
 */
import {
  LAP_OUTPUT_DIRS,
  type LapTreeFacts,
  type LapTreeMarkerV1,
  OPERATOR_LAP_REFS,
  unexpectedLapWork,
} from "./lapTreeProvenance.js";
import type { PruneVerdict, WorktreeFacts } from "./pruneClassify.js";

/** The removal evidence a `lap` verdict carries to the apply, which re-reads all of it before the tree goes. */
export type LapVerdictEvidence =
  | { readonly kind: "marked"; readonly marker: LapTreeMarkerV1 }
  | { readonly kind: "unmarked"; readonly witness: string };

/** A lap decision: the class, or the hold that keeps the tree. */
type LapDecision = Pick<PruneVerdict, "cls" | "deleteBranch" | "lap" | "reason" | "scannedHead">;

/**
 * A hold with this reason. PURE.
 *
 * @returns the hold verdict fields
 */
function held({ reason }: { reason: string }): LapDecision {
  return { cls: "hold", deleteBranch: false, reason };
}

/**
 * Why a lap tree's working tree keeps it, or `undefined` when it carries nothing but the lap's own outputs. PURE.
 *
 * Every `null` holds, as it does across the classifier: a fact that could not be read is not a clean one.
 *
 * @returns the reason, or `undefined`
 */
export function lapWorkHold({ facts }: { facts: WorktreeFacts }): string | undefined {
  if (facts.dirtyCount === null) {
    return "its working tree could not be read";
  }
  if (facts.hiddenFromStatus === null) {
    return "which files it hides from status could not be read";
  }
  if (facts.ignoredWork === null) {
    return "its ignored files could not be listed";
  }
  if (facts.stashes === null) {
    return "its stashes could not be listed";
  }
  if (facts.dirtyCount > 0) {
    return `${String(facts.dirtyCount)} uncommitted change(s)`;
  }
  if (facts.hiddenFromStatus > 0) {
    return `${String(facts.hiddenFromStatus)} file(s) hidden from status by --assume-unchanged or --skip-worktree`;
  }
  if (facts.stashes > 0) {
    return `${String(facts.stashes)} stash(es) made from it`;
  }
  const unexpected = unexpectedLapWork({ ignoredWork: facts.ignoredWork });
  if (unexpected.length > 0) {
    return `${String(unexpected.length)} ignored file(s) the lap does not write, such as ${unexpected[0]!} — only ${LAP_OUTPUT_DIRS.join(", ")} are a lap's own`;
  }
  return undefined;
}

/**
 * The line every unmarked tree's verdict ends in, held or not, so the operator's per-tree call reads off the plan:
 * its full HEAD, and the kept ref that admits it or that none does. PURE.
 *
 * @param head the tree's HEAD, `null` when it could not be read
 * @param witness the kept ref containing HEAD, `null` when none does, `undefined` when it could not be read
 * @returns the line
 */
export function unmarkedWitnessLine({
  head,
  witness,
}: {
  head: string | null;
  witness: string | null | undefined;
}): string {
  if (head === null) {
    return "HEAD unreadable, so no kept ref was asked";
  }
  if (witness === undefined) {
    return `HEAD ${head}, its kept refs could not be read`;
  }
  if (witness === null) {
    return `HEAD ${head}, admitted by no kept ref`;
  }
  return `HEAD ${head}, admitted by ${witness}`;
}

/**
 * The verdict for a lap-shaped tree, or `undefined` for every other tree. An unmarked tree's verdict always ends in
 * {@link unmarkedWitnessLine}.
 *
 * Order: a marker that is not one holds; an unmarked tree outside an explicit run holds; then a live reference, a
 * git lock and — for a marked tree — the minting process still being that process; then an unreadable or moved HEAD,
 * and any work beyond the lap's own outputs; last, an unmarked tree needs a kept ref already containing its HEAD.
 *
 * @param facts the gathered facts
 * @param includeUnmarkedLap whether this is the explicit run that may take an unmarked tree
 * @returns the `lap` verdict or its hold, or `undefined` when the tree is not lap-shaped
 */
export function lapDecision({
  facts,
  includeUnmarkedLap,
}: {
  facts: WorktreeFacts;
  includeUnmarkedLap: boolean;
}): LapDecision | undefined {
  const lap = facts.lapTree;
  if (lap === undefined || facts.isMainCheckout || facts.missing) {
    return undefined;
  }
  const decided = judgeLap({ facts, includeUnmarkedLap, lap });
  if (lap.kind !== "unmarked") {
    return decided;
  }
  return { ...decided, reason: `${decided.reason} — ${unmarkedWitnessLine(lap)}` };
}

/**
 * {@link lapDecision} for a tree already known to be lap-shaped. PURE.
 *
 * @param lap the tree's provenance
 * @returns the `lap` verdict or its hold
 */
function judgeLap({
  facts,
  includeUnmarkedLap,
  lap,
}: {
  facts: WorktreeFacts;
  includeUnmarkedLap: boolean;
  lap: LapTreeFacts;
}): LapDecision {
  if (lap.kind === "invalid") {
    return held({ reason: `a lap tree whose marker is not a readable one (${lap.reason}) — never removed as a lap` });
  }
  if (lap.kind === "unmarked" && !includeUnmarkedLap) {
    return held({
      reason:
        "a lap-shaped tree with no provenance marker — the hourly prune never removes one; review it with `worktree prune --include-unmarked-lap`",
    });
  }
  if (facts.liveRefs.length > 0) {
    return held({ reason: `referenced by ${facts.liveRefs.join(", ")}` });
  }
  if (facts.locked) {
    return held({ reason: "locked by `git worktree lock`" });
  }
  if (lap.kind === "marked" && lap.holderLive) {
    return held({ reason: `its minting lap, pid ${String(lap.marker.pid)}, is still running` });
  }
  const head = lap.head;
  if (head === null) {
    return held({ reason: "its HEAD could not be read" });
  }
  if (lap.kind === "marked" && head !== lap.marker.mintedHead) {
    return held({
      reason: `its HEAD ${head.slice(0, 10)} moved off ${lap.marker.mintedHead.slice(0, 10)}, the commit the lap minted it at`,
    });
  }
  const work = lapWorkHold({ facts });
  if (work !== undefined) {
    return held({ reason: work });
  }
  if (lap.kind === "marked") {
    return {
      cls: "lap",
      deleteBranch: false,
      lap: { kind: "marked", marker: lap.marker },
      reason: `a lap tree its minting lap (pid ${String(lap.marker.pid)}) left behind at HEAD ${head.slice(0, 10)}, pinned before removal`,
      scannedHead: head,
    };
  }
  return unmarkedWitnessDecision({ head, witness: lap.witness });
}

/**
 * An unmarked tree that cleared every other check: taken only on a kept ref's word. PURE.
 *
 * @param witness the kept ref containing HEAD, `null` when none does, `undefined` when it could not be read
 * @returns the `lap` verdict naming the ref that admitted it, or the hold naming that none did
 */
function unmarkedWitnessDecision({ head, witness }: { head: string; witness: string | null | undefined }): LapDecision {
  if (witness === undefined) {
    return held({ reason: "which kept refs contain its HEAD could not be read" });
  }
  if (witness === null) {
    return held({
      reason: `no kept ref contains its HEAD, so nothing could recreate this tree — to take it, pin it as ${OPERATOR_LAP_REFS}${head} first`,
    });
  }
  return {
    cls: "lap",
    deleteBranch: false,
    lap: { kind: "unmarked", witness },
    reason: "an unmarked lap tree a kept ref already holds, its HEAD pinned before removal",
    scannedHead: head,
  };
}
