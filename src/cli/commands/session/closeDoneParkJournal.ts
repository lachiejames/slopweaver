/**
 * The journal half of `session close-done`'s park: the checkpoint a close appends, and the last journal read that
 * may still refuse the close. The looks and the close itself stay in `./closeDonePark.ts`.
 */
import { type ParsedLedger, type RunEvent, runStateOf } from "../../../handover/ledger.js";
import { draftsMissingFrom } from "../../../handover/parkDrafts.js";
import { readParkedDrafts } from "../../../handover/parkDraftsRead.js";
import { type ParkedEvent, parkScreenTail } from "../../../handover/parkedEvent.js";
import { parkedWorktree } from "../../../handover/parkPolicy.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { standingSessionInForce, standingSessionLine } from "../../../handover/standingSession.js";
import { ownershipAmbiguousLines } from "../../../handover/unknownKind.js";
import type { CloseDoneOutcome } from "../../../sessions/closeDoneOutcome.js";
import { parkActionOf, type SeatIdentity } from "../../../sessions/parkSeat.js";
import { branchOf } from "../handover/parkRunJournal.js";
import { checkpointOrdinal, journalSize, type ParkCandidate, type ParkDeps } from "./closeDoneParkLook.js";

/**
 * Why the last journal read refused a close: it moved, grew a line nobody can decode, lacks a held draft, or now
 * carries the owner's standing-session ruling.
 */
export type JournalShortfall =
  | {
      readonly reason:
        "drafts-unreadable" | "drafts-unrecorded" | "journal-unreadable" | "seat-moved" | "standing-session";
      readonly why: string;
    }
  | undefined;

/** The checkpoint a close relies on: its instant, its place in the journal (`checkpointOrdinal`), and the journal's size. */
export interface ReliedCheckpoint {
  readonly atIso: string;
  /** Where it sits among the journal's decoded events, counted from 1 — the one found, or the one just appended. */
  readonly ordinal: number;
  /** The journal's `journalSize` once the checkpoint stood — any later line, decoded or not, refuses the close. */
  readonly size: number;
}

/**
 * Whether the last look's journal read still rests on the checkpoint `relied` names AS THIS SEAT'S, with no
 * line over which ownership cannot be proven, and that checkpoint carries every draft the seat holds now. Read LAST,
 * right before the close, so a draft recorded while the seat was checked is seen, and so is a
 * line landing after the append that `applyRowEvent`'s read-back cannot decode — a newer checkout's claim, say, which
 * its decoded-event count never sees.
 *
 * The journal is the one the last look bound the seat's session against, never a second read: the park action is
 * derived again off it for that seat, and it must name the relied-on checkpoint by instant AND journal place: a later
 * park stamped the same instant never closes the seat.
 *
 * @param relied the checkpoint the close relies on, by instant and journal place
 * @param journal the last look's one journal read
 * @param seat the seat's session as the last look bound it, against that same read
 * @returns the shortfall, or `undefined` when the checkpoint stands and carries every held draft
 */
export function journalShortfall({
  deps,
  item,
  journal,
  relied,
  seat,
}: {
  relied: ReliedCheckpoint;
  deps: ParkDeps;
  item: ParkCandidate;
  journal: ParsedLedger;
  seat: SeatIdentity & { readonly kind: "identified" };
}): JournalShortfall {
  const slug = item.row.slug;
  const ambiguous = ownershipAmbiguousLines({ journal });
  if (ambiguous.length > 0) {
    const why = `journal line(s) ${ambiguous.join(", ")} do not decode, so whose run it is cannot be proven before the close`;
    return { reason: "journal-unreadable", why };
  }
  // The owner's standing-session ruling, landed after the reobserve's own read, still keeps the seat.
  const standing = standingSessionInForce({ events: journal.events, nowIso: deps.nowIso });
  if (standing !== undefined) {
    return { reason: "standing-session", why: standingSessionLine({ ruling: standing }) };
  }
  const size = journalSize({ journal });
  if (size !== relied.size) {
    const why = `its journal moved before the close (${String(size)} lines, ${String(relied.size)} at the look)`;
    return { reason: "seat-moved", why };
  }
  const action = parkActionOf({ events: journal.events, identity: seat, nowIso: deps.nowIso });
  if (action.kind !== "close-only") {
    return { reason: "seat-moved", why: `its run's park moved before the close (now ${action.kind})` };
  }
  const checkpoint = action.checkpoint;
  const ordinal = checkpointOrdinal({ checkpoint, events: journal.events });
  if (checkpoint.atIso !== relied.atIso || ordinal !== relied.ordinal) {
    const now = `close-only on ${checkpoint.atIso} as journal event ${String(ordinal)}`;
    const was = `${relied.atIso} as event ${String(relied.ordinal)}`;
    return { reason: "seat-moved", why: `its run's park moved before the close (now ${now}, relied on ${was})` };
  }
  const held = readParkedDrafts({ events: journal.events, home: deps.home, slug });
  if (held.isErr()) {
    return { reason: "drafts-unreadable", why: held.error.join("; ") };
  }
  const missing = draftsMissingFrom({ held: held.value, recorded: checkpoint.drafts });
  if (missing.length === 0) {
    return undefined;
  }
  const named = missing.map((draft) => (draft.kind === "slack-draft" ? draft.id : "the open question's message"));
  return {
    reason: "drafts-unrecorded",
    why: `its park's checkpoint does not carry ${named.join(", ")}, so closing it would leave the parked entry without them`,
  };
}

/**
 * Why the append's own read refuses the checkpoint: the journal grew since the last look, or the owner's standing-session
 * ruling is now in force.
 *
 * @param journal the append's own read of the journal
 * @param lookSize the last look's `journalSize`
 * @returns the refusal, or `undefined` when the checkpoint may land
 */
function appendRefusal({
  journal,
  lookSize,
  nowIso,
}: {
  journal: Pick<ParsedLedger, "events" | "unreadable">;
  lookSize: number;
  nowIso: string;
}): JournalShortfall {
  const size = journalSize({ journal });
  if (size !== lookSize) {
    const why = `its journal moved between the last look and the park (${String(size)} lines, ${String(lookSize)} at the look)`;
    return { reason: "seat-moved", why };
  }
  const standing = standingSessionInForce({ events: journal.events, nowIso });
  if (standing === undefined) {
    return undefined;
  }
  return { reason: "standing-session", why: standingSessionLine({ ruling: standing }) };
}

/**
 * Append the checkpoint, judging the owner's standing-session ruling on the append's OWN read — the last before the
 * checkpoint lands: a ruling landing after the reobserve keeps the seat with nothing journalled. On that
 * same read the journal must still hold exactly the events the last look read, so a second `close-done` that already
 * appended its park, or any other line since, keeps this one with nothing journalled. What
 * survives is `applyRowEvent`'s own read-then-append, which no lock closes — `recordThenClose`'s accepted residue.
 *
 * @param event the checkpoint, built off the last look
 * @param lookSize the last look's `journalSize`, every line counted whether it decoded or not
 * @returns the outcome that stops the close, or `undefined` when the checkpoint landed
 */
export function appendCloseDonePark({
  deps,
  event,
  item,
  lookSize,
}: {
  deps: ParkDeps;
  event: ParkedEvent;
  item: ParkCandidate;
  lookSize: number;
}): CloseDoneOutcome | undefined {
  const judged: { refusal: JournalShortfall } = { refusal: undefined };
  const appended = applyRowEvent({
    event,
    precondition: (now) => {
      judged.refusal = appendRefusal({ journal: now, lookSize, nowIso: deps.nowIso });
      return judged.refusal?.why;
    },
    runsDir: deps.runsDir,
    slug: item.row.slug,
  });
  if (appended.isOk()) {
    return undefined;
  }
  if (judged.refusal !== undefined) {
    return { item, kind: "park-kept", reason: judged.refusal.reason, why: judged.refusal.why };
  }
  return { item, journalled: false, kind: "park-failed", reason: appended.error.message };
}

/**
 * The checkpoint a close journals, built off the LAST journal read so its open question and drafts are the ones
 * now open.
 *
 * @param events the last journal read's events, which name the open question and the recorded branch
 * @param runTree the holder's worktree, when the journal names one
 * @param screen the seat's raw screen from the last look, cut to its tail here
 * @returns the `parked` event, not yet appended
 */
export function closeDoneParkedEvent({
  drafts,
  events,
  item,
  nowIso,
  runTree,
  screen,
  sessionId,
}: {
  drafts: NonNullable<ParkedEvent["drafts"]>;
  events: readonly RunEvent[];
  item: ParkCandidate;
  nowIso: string;
  runTree: string | undefined;
  screen: string;
  sessionId: string;
}): ParkedEvent {
  const run = runStateOf({ events });
  const question = run.openQuestion;
  return {
    atIso: nowIso,
    branch: branchOf({ recorded: run.branch }),
    kind: "parked",
    ...(question === undefined ? {} : { question }),
    ...(drafts.length === 0 ? {} : { drafts }),
    screenTail: parkScreenTail({ screen }),
    sessionId,
    workspaceRef: item.workspace.workspaceRef,
    worktree: parkedWorktree({ seat: item.workspace, writerWorktree: runTree }),
  };
}
