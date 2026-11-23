/**
 * The park half of `session close-done`: a run seat nothing calls done, closed when it proves PARKED.
 *
 * A session that is parked leaves the fleet immediately: parked sessions are not kept, they are closed, their
 * state is tracked somewhere, and they are resumed on demand. Parked is a seat that looks frozen and runs no shell that will complete. Four reads have
 * to agree before one closes, and each one that cannot be had keeps the seat:
 *
 * 1. its screen proves Claude Code at rest with no background shell or Monitor counted
 *    (`../../../handover/parkPolicy.ts`'s `parkSeatRefusal`);
 * 2. ONE registry session runs in its process tree, bound to its process and reading `idle`
 *    (`../../../sessions/parkSeat.ts`);
 * 3. that session holds the run — or is the seat a park already journalled and left open;
 * 4. the Slack draft register reads whole, so the checkpoint's draft copy is complete.
 *
 * And then a fifth, off the machine, only for a seat the four already proved parked: GitHub reads no OPEN pull
 * request on the run's own branches — landing one is the seat's work (`ownPullRequestHold`).
 *
 * Then `handover park`'s order (`../handover/parkRun.ts`): all four read again and agreeing with the first look
 * (`./closeDoneParkLook.ts`) — on the close-only path too — the checkpoint appended, THEN the workspace closed, so
 * a close that fails leaves a journalled park and a seat still open, never a closed seat with no record. The
 * worktree is NOT reclaimed: the reseat reopens it.
 */
import type { ParsedLedger } from "../../../handover/ledger.js";
import { readParkedDrafts } from "../../../handover/parkDraftsRead.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";
import { journalMovedReason, parkRunTree, parkSeatHost } from "../../../handover/parkPolicy.js";
import type { RunWriter } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import type { CloseDoneOutcome } from "../../../sessions/closeDoneOutcome.js";
import { ownPullRequestKeep, type SeatIdentity } from "../../../sessions/parkSeat.js";
import { appendSessionEvent } from "../../../sessions/sessionStore.js";
import { fireSteerAtRiskIfSteered } from "../handover/steerRiskCard.js";
import {
  appendCloseDonePark,
  closeDoneParkedEvent,
  journalShortfall,
  type ReliedCheckpoint,
} from "./closeDoneParkJournal.js";
import {
  checkpointOrdinal,
  identify,
  journalSize,
  type Observation,
  observe,
  type ParkCandidate,
  type ParkDeps,
  reobserve,
  sameIdentity,
  screenAtRest,
} from "./closeDoneParkLook.js";

/**
 * Park one candidate if it proves parked, else keep it and say why.
 *
 * @param deps the sweep's environment, its run journals' directory included
 * @param item the candidate
 * @returns the outcome
 */
export async function parkCandidate({
  deps,
  item,
}: {
  deps: ParkDeps;
  item: ParkCandidate;
}): Promise<CloseDoneOutcome> {
  const first = await observe({ deps, item });
  if (first.kind === "kept") {
    return first.outcome;
  }
  switch (first.action.kind) {
    case "keep":
      return { item, kind: "park-kept", reason: first.action.reason };
    case "close-only":
      return closePredecessor({ deps, first, item });
    case "record":
      return recordThenClose({ deps, first, holder: first.action.holder, item });
    default: {
      const exhaustive: never = first.action;
      return exhaustive;
    }
  }
}

/**
 * Close the seat a park already journalled and left open — once the last look agrees, and only when that
 * checkpoint carries every draft the seat still holds. A park older than the `drafts` field, or a draft recorded
 * after it, keeps the seat: closing it would leave a parked entry missing a message.
 */
async function closePredecessor({
  deps,
  first,
  item,
}: {
  deps: ParkDeps;
  first: Observation;
  item: ParkCandidate;
}): Promise<CloseDoneOutcome> {
  const last = await reobserve({ deps, first, item });
  if (last.kind === "kept") {
    return last.outcome;
  }
  if (last.action.kind !== "close-only") {
    const why = `first look → close-only, last look → ${last.action.kind}`;
    return { item, kind: "park-kept", reason: "seat-moved", why };
  }
  const landing = await ownPullRequestHold({ deps, item });
  if (landing !== undefined) {
    return landing;
  }
  const recorded = last.action.checkpoint.drafts;
  return closeParked({
    deps,
    drafts: recorded === undefined ? 0 : recorded.length,
    how: "predecessor",
    item,
    journalled: false,
    relied: {
      atIso: last.action.checkpoint.atIso,
      ordinal: checkpointOrdinal({ checkpoint: last.action.checkpoint, events: last.journal.events }),
      size: journalSize({ journal: last.journal }),
    },
    seat: last.identity,
  });
}

/**
 * Journal the seat's checkpoint, its drafts included, then close it — taking the last look (`reobserve`) and
 * checking the writer has not moved right before the append, as `handover park` does.
 *
 * ACCEPTED RESIDUE: `applyRowEvent` reads, then appends, and the journal
 * takes no lock, so a claim landing between those two can still put a `parked` line under the claimer. Closing that
 * means serialising every row writer (`../../../handover/staleHolder.ts` states the same window). What this path
 * holds instead: the read-back counts one event too many and refuses, so the seat is NEVER closed off that append,
 * and `activeParkedCheckpoint` reads such a line as no park at all, so no later sweep closes the claimer's seat. A
 * line the read-back cannot decode is invisible to its count; `closeParked`'s last journal read refuses that one.
 * The owner's standing-session ruling landing in the same gap is held the same way: the read-back refuses, so
 * the seat stays open, and every later look reads the ruling before its close-only action, so none closes it.
 */
async function recordThenClose({
  deps,
  first,
  holder,
  item,
}: {
  deps: ParkDeps;
  first: Observation;
  holder: RunWriter;
  item: ParkCandidate;
}): Promise<CloseDoneOutcome> {
  const slug = item.row.slug;
  const events = first.journal.events;
  const planned = {
    runTree: parkRunTree({ events, holder }),
    seatHost: parkSeatHost({ events }),
    sessionId: holder.sessionId,
  };
  const last = await reobserve({ deps, first, item });
  if (last.kind === "kept") {
    return last.outcome;
  }
  const held = await holdBeforeAppend({ deps, item, journal: last.journal, planned });
  if (held !== undefined) {
    return held;
  }
  // Off the LAST journal read, right before the append: the open question's drafted message is the one now open.
  const drafts = readParkedDrafts({ events: last.journal.events, home: deps.home, slug });
  if (drafts.isErr()) {
    return { item, kind: "park-kept", reason: "drafts-unreadable", why: drafts.error.join("; ") };
  }
  const event = closeDoneParkedEvent({
    drafts: drafts.value,
    events: last.journal.events,
    item,
    nowIso: deps.nowIso,
    runTree: planned.runTree,
    screen: last.screen,
    sessionId: holder.sessionId,
  });
  if (!deps.dryRun) {
    const refused = appendCloseDonePark({ deps, event, item, lookSize: journalSize({ journal: last.journal }) });
    if (refused !== undefined) {
      return refused;
    }
    // A seat closed idle on a row the owner explicitly steered leaves nobody working the owner's deliverable: the note lands now,
    // before the seat closes and before any receipt, so neither can stop it.
    await fireSteerAtRiskIfSteered({ deps: deps.monitor, home: deps.home, slug, verb: "session close-done" });
  }
  return closeParked({
    deps,
    drafts: drafts.value.length,
    how: "recorded",
    item,
    journalled: !deps.dryRun,
    relied: appendedCheckpoint({ event, journal: last.journal }),
    seat: last.identity,
  });
}

/**
 * The keep that stops a park before its checkpoint is written: the writer moved since the plan, or the seat is
 * landing its own pull request, which journals no park at all.
 *
 * @returns the kept outcome, or `undefined` when the append may go on
 */
async function holdBeforeAppend({
  deps,
  item,
  journal,
  planned,
}: {
  deps: ParkDeps;
  item: ParkCandidate;
  journal: Observation["journal"];
  planned: Parameters<typeof journalMovedReason>[0]["planned"];
}): Promise<CloseDoneOutcome | undefined> {
  const moved = journalMovedReason({ ambiguousLines: [], journal, planned });
  if (moved !== undefined) {
    return { item, kind: "park-kept", reason: "journal-unreadable", why: moved };
  }
  return ownPullRequestHold({ deps, item });
}

/**
 * The keep for a seat whose run's own pull request is still open, or `undefined` when GitHub holds none — asked
 * after the last local look, so only a seat every other read proved parked costs a GitHub call
 * (`../../../sessions/parkSeat.ts`'s `ownPullRequestKeep` carries the measurement). The residue is the gap from this
 * read to the close: a pull request opened inside it is not seen, the same window `closeParked` states for cmux.
 *
 * @returns the kept outcome, or `undefined` when the park may go on
 */
async function ownPullRequestHold({
  deps,
  item,
}: {
  deps: ParkDeps;
  item: ParkCandidate;
}): Promise<CloseDoneOutcome | undefined> {
  const answer = await deps.parkSeat.ownPullRequests({ slug: item.row.slug });
  const keep = ownPullRequestKeep({ answer });
  if (keep === undefined) {
    return undefined;
  }
  return { item, kind: "park-kept", reason: keep.reason, why: keep.why };
}

/**
 * The checkpoint a close just appended, as it relies on it: the line right after the last look's read, since the
 * append refused any journal that had grown since (`appendCloseDonePark`).
 *
 * @param journal the last look's journal read, which the checkpoint was appended to
 * @returns that checkpoint by instant, journal place and the journal's size with it
 */
function appendedCheckpoint({ event, journal }: { event: ParkedEvent; journal: ParsedLedger }): ReliedCheckpoint {
  return { atIso: event.atIso, ordinal: journal.events.length + 1, size: journalSize({ journal }) + 1 };
}

/** Why the last look refused a close: the outcome before any checkpoint was written, and the one after. */
interface LastLookRefusal {
  /** The keep, when nothing was journalled. */
  readonly kept: CloseDoneOutcome;
  /** The failure's reason, when the checkpoint was journalled and the seat is left open. */
  readonly failed: string;
}

/**
 * The refusal when the run journal cannot be read right before the close.
 *
 * @param message the read's own error
 * @returns the keep, and the failure if a checkpoint was already journalled
 */
function unreadableJournal({ item, message }: { item: ParkCandidate; message: string }): LastLookRefusal {
  const why = `its journal could not be read right before the close — ${message}`;
  return {
    failed: `${why}; the seat is left open`,
    kept: { item, kind: "park-kept", reason: "journal-unreadable", why },
  };
}

/**
 * The last look before a close, in `closeParked`'s order: screen, session, then journal.
 *
 * @param seat the seat's session as the last look named it
 * @param unwritten a dry run's record path, which wrote no checkpoint for the journal check to find
 * @returns why the close is refused, or `undefined` when every read still agrees
 */
async function lastLookRefusal({
  deps,
  item,
  relied,
  seat,
  unwritten,
}: {
  relied: ReliedCheckpoint;
  deps: ParkDeps;
  item: ParkCandidate;
  seat: SeatIdentity & { readonly kind: "identified" };
  unwritten: boolean;
}): Promise<LastLookRefusal | undefined> {
  const atRest = await screenAtRest({ deps, item });
  if (atRest.kind === "kept") {
    const screen = atRest.outcome.kind === "park-kept" ? atRest.outcome.reason : atRest.outcome.kind;
    return {
      failed: `its screen read ${screen} right before the close, so the seat is left open`,
      kept: atRest.outcome,
    };
  }
  // The session is bound against a journal read of its own, taken now, so the Codex threads it is asked about are
  // the run's current ones rather than an earlier look's.
  const journal = readRunJournal({ runsDir: deps.runsDir, slug: item.row.slug });
  if (journal.isErr()) {
    return unreadableJournal({ item, message: journal.error.message });
  }
  const now = await identify({ atRest, deps, events: journal.value.events, item });
  if (now.kind !== "identified" || !sameIdentity({ now, was: seat }) || now.status !== "idle") {
    const read = now.kind === "identified" ? `pid ${String(now.pid)} reads ${now.status}` : now.why;
    const why = `its session changed right before the close (${read}), so the seat is left open`;
    return { failed: why, kept: { item, kind: "park-kept", reason: "seat-moved", why } };
  }
  // Read again AFTER the awaited session read, so a line landing during it is seen.
  // `journalShortfall` holds this read's size to the look's, and the journal only grows, so an equal size holds every
  // line with content the session was just bound against; a blank line parses to nothing and is not counted.
  const settled = readRunJournal({ runsDir: deps.runsDir, slug: item.row.slug });
  if (settled.isErr()) {
    return unreadableJournal({ item, message: settled.error.message });
  }
  const shortfall = unwritten ? undefined : journalShortfall({ deps, item, journal: settled.value, relied, seat: now });
  if (shortfall === undefined) {
    return undefined;
  }
  return {
    failed: `${shortfall.why}; the seat is left open`,
    kept: { item, kind: "park-kept", reason: shortfall.reason, why: shortfall.why },
  };
}

/**
 * Close a parked seat's workspace and its ledger row — the ROW's ref, which a cmux restart may have renumbered.
 *
 * Its screen and its session are read once more right before the close, in `observe`'s order: the screen must
 * still be at rest with no background work (a Monitor shows only in the footer), and the
 * session the same idle process the last look saw. A turn or a Monitor begun while the drafts were read and the
 * checkpoint appended keeps the seat open. Last, the journal must still rest on that checkpoint with no line it
 * cannot decode, and the checkpoint carry every draft the seat now holds (`journalShortfall`).
 * What remains is the gap from that last read to the close call itself — cmux has no atomic close-if-idle and the
 * journal takes no lock — the residue `handover park` states too. A dry run's record path wrote no checkpoint, so its drafts are not checked against one.
 */
async function closeParked({
  deps,
  drafts,
  how,
  item,
  journalled,
  relied,
  seat,
}: {
  deps: ParkDeps;
  drafts: number;
  how: "recorded" | "predecessor";
  item: ParkCandidate;
  journalled: boolean;
  /** The checkpoint this close relies on — the one it found, or the one it just wrote — by instant and cycle. */
  relied: ReliedCheckpoint;
  /** The seat's session as the last look named it. */
  seat: SeatIdentity & { readonly kind: "identified" };
}): Promise<CloseDoneOutcome> {
  const refused = await lastLookRefusal({
    deps,
    item,
    relied,
    seat,
    unwritten: deps.dryRun && how === "recorded",
  });
  if (refused !== undefined) {
    return journalled ? { item, journalled, kind: "park-failed", reason: refused.failed } : refused.kept;
  }
  if (!deps.dryRun) {
    // Forced: the last look just proved the seat at rest, and cmux 0.65.2 refuses an idle `claude` unforced
    // (`../../../sessions/closeForce.ts`).
    const closed = await deps.client.closeWorkspace({ force: true, workspaceId: item.workspace.workspaceId });
    if (closed.isErr()) {
      return { item, journalled, kind: "park-failed", reason: closed.error.message };
    }
    appendSessionEvent({
      event: {
        kind: "closed",
        sessionKey: item.row.sessionKey,
        tsIso: deps.nowIso,
        workspaceRef: item.row.workspaceRef!,
      },
      home: deps.home,
    });
  }
  return { drafts, how, item, kind: "parked" };
}
