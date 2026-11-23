/**
 * Every line the sweep PRINTS about one ask it judged, and nothing that decides one.
 *
 * Its own module for the reason `./abandoned.ts`, `./sweepCard.ts` and `./reviewSurface.ts` are:
 * `./dispatchSweep.ts` sits at the file-size ratchet, and rendering is a real seam — nothing here reads
 * state it was not handed, and nothing here writes any. `../../../live/turn/unroutedReport.ts` is the same
 * split for the unrouted pass's lines, and `../../../live/turn/sweepIgnored.ts` for the entrance gate's.
 */
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import { uncarriedAnswerDetail } from "../../../live/turn/dispatch.js";
import type { FreshVisibleSessionRef } from "../../../live/turn/tier.js";
import { readCurrentGenerationTurnMarker } from "../../../live/turn/turnMarkerStore.js";

/**
 * The sweep's own line for a dispatch that has reported ready — its answer path, plus how long that answer
 * has been sitting uncarried once that is worth saying.
 *
 * @param answerPath the answer file the session named
 * @param entry the ask this dispatch is for
 * @param home the resolved state home, for reading the durable marker's own recorded time
 * @param nowIso the current instant
 * @returns the line to write
 */
export function readySweepLine({
  answerPath,
  entry,
  home,
  nowIso,
}: {
  answerPath: string;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
}): string {
  const marker = readCurrentGenerationTurnMarker({ askIdentity: entry, home });
  const uncarried = uncarriedAnswerDetail({
    nowIso,
    recordedAtIso: marker?.kind === "ready" ? marker.recordedAtIso : undefined,
  });
  return `ready: ${entry.channel}/${entry.messageTs} — ${answerPath}${uncarried === undefined ? "" : ` (${uncarried})`}`;
}

/**
 * How one live session is ADDRESSED, for a human reading the sweep: the name `ListAgents` shows it under, and
 * the workspace ref that name belongs to.
 *
 * A record written before workers were named carries no name at all, and says so — inventing one would be
 * worse than the ref alone, because a supervisor would then address a name nothing answers to.
 *
 * @param session the party's own locator, as its record holds it
 * @returns the address text
 */
function sessionAddress({ session }: { session: FreshVisibleSessionRef }): string {
  // Spelled as an `if` rather than a `??`, per `no-silent-fallback`: the absence IS the finding here — a
  // record predating named workers cannot be addressed by name, and a reader has to be told that rather
  // than handed a parenthetical that reads like the name.
  if (session.sessionName === undefined) {
    return `(unnamed — this record predates named workers) (${session.workspaceRef})`;
  }
  return `${session.sessionName} (${session.workspaceRef})`;
}

/**
 * The sweep's line for a dispatch that is still working: BOTH sessions one ask can have open, each named the
 * way a supervisor would address it.
 *
 * Still-working used to write no line at all, which is what made the two addressable. Measured: a
 * correction meant for a worker most likely reached the REVIEWER of that worker's own answer instead, because
 * the two had booted two minutes apart in one checkout and only start time told them apart. Naming the
 * reviewer here — and saying plainly that it must not be messaged — is what removes the guess.
 *
 * The `reviewerDone` arm is the sweep half of splitting `turn review --poll` from `turn review --close`: a
 * reviewer that has written its own verdict is finished and its workspace is now the caller's to release, and
 * with the close no longer riding on the read there has to be somewhere a forgotten one becomes visible. This
 * is that place — the same board the supervisor already reads, rather than a new one.
 *
 * @param entry the ask this dispatch is for
 * @param reviewer the reviewer of this ask's answer, when one is open
 * @param reviewerDone whether that reviewer has already written its own verdict, so its workspace is owed a
 *   `turn review --close`
 * @param worker the session that owns the ask
 * @returns the line to write
 */
export function workingSweepLine({
  entry,
  reviewer,
  reviewerDone,
  worker,
}: {
  entry: AskIdentity;
  reviewer: FreshVisibleSessionRef | undefined;
  reviewerDone: boolean;
  worker: FreshVisibleSessionRef;
}): string {
  const reviewerPart = reviewerSweepPart({ reviewer, reviewerDone });
  return (
    `still working: ${entry.channel}/${entry.messageTs} — ` +
    `worker ${sessionAddress({ session: worker })}; ${reviewerPart}`
  );
}

/** The reviewer half of {@link workingSweepLine}: absent, mid-verdict, or finished and still holding a workspace. */
function reviewerSweepPart({
  reviewer,
  reviewerDone,
}: {
  reviewer: FreshVisibleSessionRef | undefined;
  reviewerDone: boolean;
}): string {
  if (reviewer === undefined) {
    return "no reviewer open";
  }
  return reviewerDone
    ? `reviewer ${sessionAddress({ session: reviewer })} — verdict WRITTEN and its workspace still open; release it with slopweaver turn review --close`
    : `reviewer ${sessionAddress({ session: reviewer })} — mid-verdict, never message it`;
}
