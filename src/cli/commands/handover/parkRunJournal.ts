/**
 * What `handover park` reads and writes on its run's journal: the plan it acts on, the last read before the append
 * (the writer unmoved, the held drafts copied off it), the checkpoint it appends and the lines that say what was
 * journalled. The socket stays in `./parkRun.ts`, the close in `./parkCloseSeat.ts`.
 */

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { readParkedDrafts } from "../../../handover/parkDraftsRead.js";
import { PARK_NO_BRANCH, type ParkedDraft, type ParkedEvent, parkScreenTail } from "../../../handover/parkedEvent.js";
import { journalMovedReason, parkedWorktree } from "../../../handover/parkPolicy.js";
import { type ParkWake, parkWakePhrase } from "../../../handover/parkWake.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import type { RunWriter } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { standingSessionInForce, standingSessionLine } from "../../../handover/standingSession.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { SupervisorHost } from "../../../supervisor/session.js";
import type { ParkFailure } from "./parkFailure.js";

/** What the journal says the act parks, read before anything touches cmux. */
export interface ParkPlan {
  /** Undecodable lines this read proceeded over under the stale-journal hatch; any line beyond them is new. */
  readonly ambiguousLines: readonly number[];
  /** The owner's open question, when the seat waits on the owner. */
  readonly question: string | undefined;
  /** The clock or CI the seat waits on instead, when it named one. */
  readonly wake: ParkWake | undefined;
  readonly writer: RunWriter;
  readonly runTree: string | undefined;
  /** The current writer's host — never the releasing session's — which is all the idle proof may trust. */
  readonly seatHost: SupervisorHost | undefined;
  /** Whether `SLOPWEAVER_ALLOW_PARK_STANDING_SESSION=1` lets the park past the owner's standing-session ruling. */
  readonly standingHatchOpen: boolean;
}

/**
 * The refusal a park meets on a row whose seat the owner ruled stays open between their turns — asked of the plan's read and
 * again of the last read before the append, so a ruling recorded mid-park still stops it.
 *
 * @param events the run's journal events, as just read
 * @param hatchOpen whether the operator opened the standing-session hatch
 * @param nowIso the instant the ruling's bound is judged against
 * @returns the failure, or `undefined` when no standing session stops the park
 */
export function standingSessionRefusal({
  events,
  hatchOpen,
  nowIso,
}: {
  events: readonly RunEvent[];
  hatchOpen: boolean;
  nowIso: string;
}): ParkFailure | undefined {
  const standing = standingSessionInForce({ events, nowIso });
  if (standing === undefined || hatchOpen) {
    return undefined;
  }
  return { kind: "standing-session", why: standingSessionLine({ ruling: standing }) };
}

/**
 * Append the checkpoint, judging the owner's standing-session ruling on the append's OWN read — the last one before
 * the parked line lands: `unmovedDrafts` read earlier, and a ruling landing between the two would park
 * the seat.
 *
 * Residue, stated: `applyRowEvent` reads, judges, then appends with no lock, so a ruling landing in
 * that gap still puts a `parked` line after it. The append's read-back then counts one event too many and refuses, so
 * the seat is never closed off it, and every later look reads the ruling before acting, so nothing closes it after:
 * the journal says parked while the seat stays live, and reconcile sees that workspace occupying its row.
 *
 * @param atIso the instant the park judged its bound at, so every read judges the same one
 * @param hatchOpen whether the operator opened the standing-session hatch
 * @returns where the checkpoint was appended, or why it was not
 */
export function appendParked({
  atIso,
  event,
  hatchOpen,
  runsDir,
  slug,
}: {
  atIso: string;
  event: ParkedEvent;
  hatchOpen: boolean;
  runsDir: string;
  slug: string;
}): Result<{ readonly path: string }, ParkFailure> {
  const judged: { standing: ParkFailure | undefined } = { standing: undefined };
  const appended = applyRowEvent({
    event,
    precondition: ({ events }) => {
      judged.standing = standingSessionRefusal({ events, hatchOpen, nowIso: atIso });
      return judged.standing?.kind === "standing-session" ? judged.standing.why : undefined;
    },
    runsDir,
    slug,
  });
  if (appended.isErr()) {
    if (judged.standing !== undefined) {
      return err(judged.standing);
    }
    return err({ kind: "journal", message: appended.error.message });
  }
  return ok({ path: appended.value.path });
}

/**
 * One more journal read after the parked line lands, the last before the close: a standing-session
 * ruling recorded in between leaves the seat OPEN, and reconcile reads that parked standing row ready to reseat if it
 * closes anyway. A window from this read to cmux's close remains — cmux has no atomic check-and-close.
 *
 * @param atIso the instant the park judged its bound at, so both reads judge the same one
 * @param hatchOpen whether the operator opened the standing-session hatch
 * @returns the failure that keeps the seat open, or `undefined` when the close may go ahead
 */
export function standingAfterPark({
  atIso,
  hatchOpen,
  runsDir,
  slug,
}: {
  atIso: string;
  hatchOpen: boolean;
  runsDir: string;
  slug: string;
}): ParkFailure | undefined {
  const read = readRunJournal({ runsDir, slug });
  if (read.isErr()) {
    return { kind: "journal", message: `the journal could not be read again before the close: ${read.error.message}` };
  }
  const late = standingSessionRefusal({ events: read.value.events, hatchOpen, nowIso: atIso });
  if (late?.kind !== "standing-session") {
    return undefined;
  }
  return {
    kind: "standing-session",
    why: `${late.why}, recorded after the park was journalled — the seat is left open`,
  };
}

/**
 * The journal read right before the append: the writer must not have moved since the plan, and the seat's held
 * drafts are copied off this same read.
 *
 * @returns the drafts the checkpoint carries, or why the park stops here
 */
export function unmovedDrafts({
  home,
  nowIso,
  plan,
  runsDir,
  slug,
}: {
  home: string;
  /** The instant a standing-session ruling's bound is judged against — the one the checkpoint is stamped with. */
  nowIso: string;
  plan: ParkPlan;
  runsDir: string;
  slug: string;
}): Result<readonly ParkedDraft[], ParkFailure> {
  const now = readRunJournal({ runsDir, slug });
  if (now.isErr()) {
    return err({ kind: "journal", message: now.error.message });
  }
  const planned = { runTree: plan.runTree, seatHost: plan.seatHost, sessionId: plan.writer.sessionId };
  const moved = journalMovedReason({ ambiguousLines: plan.ambiguousLines, journal: now.value, planned });
  if (moved !== undefined) {
    return err({ kind: "journal", message: moved });
  }
  const standing = standingSessionRefusal({ events: now.value.events, hatchOpen: plan.standingHatchOpen, nowIso });
  if (standing !== undefined) {
    return err(standing);
  }
  const drafts = readParkedDrafts({ events: now.value.events, home, slug });
  if (drafts.isErr()) {
    return err({ kind: "journal", message: drafts.error.join("; ") });
  }
  return ok(drafts.value);
}

/**
 * The branch the parked event names: the one the run recorded at `start`. A run that recorded none still parks,
 * and says so, because the worktree is what the reseat finds first.
 *
 * @param recorded the branch the journal recorded, when it did
 * @returns the branch, or a sentence saying none was recorded
 */
export function branchOf({ recorded }: { recorded: string | undefined }): string {
  if (recorded === undefined) {
    return PARK_NO_BRANCH;
  }
  return recorded;
}

/**
 * The checkpoint the park appends: the plan's question or wake, the drafts copied off the last read, the seat's
 * screen as read right before the append, and the worktree a reseat reopens.
 *
 * @param recordedBranch the branch the journal recorded at `start`, when it did
 * @param screen the seat's raw screen from the fresh read, cut to its tail here
 * @returns the `parked` event, not yet appended
 */
export function parkedEventOf({
  atIso,
  drafts,
  plan,
  recordedBranch,
  screen,
  seat,
}: {
  atIso: string;
  drafts: readonly ParkedDraft[];
  plan: ParkPlan;
  recordedBranch: string | undefined;
  screen: string;
  seat: CmuxWorkspaceSummary;
}): ParkedEvent {
  return {
    atIso,
    branch: branchOf({ recorded: recordedBranch }),
    kind: "parked",
    ...(plan.question === undefined ? {} : { question: plan.question }),
    ...(plan.wake === undefined ? {} : { wake: plan.wake }),
    ...(drafts.length === 0 ? {} : { drafts }),
    screenTail: parkScreenTail({ screen }),
    sessionId: plan.writer.sessionId,
    workspaceRef: seat.workspaceRef,
    worktree: parkedWorktree({ seat, writerWorktree: plan.runTree }),
  };
}

/**
 * The lines that say what was journalled — printed before the close, which may end this process.
 *
 * @param journalPath where the checkpoint was appended
 */
export function printParked({
  event,
  journalPath,
  slug,
}: {
  event: ParkedEvent;
  journalPath: string;
  slug: string;
}): void {
  const { wake } = event;
  const on = wake === undefined ? "on its open question" : parkWakePhrase({ wake });
  logger.out({ line: `handover park: parked ${slug} ${on}` });
  if (event.question !== undefined) {
    logger.out({ line: `  question: ${event.question}` });
  }
  logger.out({ line: `  seat: ${event.workspaceRef} in ${event.worktree} on ${event.branch}` });
  if (event.drafts !== undefined) {
    logger.out({ line: `  unsent drafts kept on the checkpoint: ${String(event.drafts.length)}` });
  }
  logger.out({ line: `  journal: ${journalPath}` });
  logger.out({
    line:
      wake === undefined
        ? `  reseat once the owner answers: slopweaver cmux spawn ${slug}`
        : `  reseats itself: the supervisor tick's handover wake runs cmux spawn ${slug} once the wake is due`,
  });
}
