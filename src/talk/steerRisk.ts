/**
 * Which of the owner's explicitly steered deliverables is at risk right now, as the console voice says it — the open
 * `steer-at-risk` notes in the hand register, each with the sentence its note already carries.
 *
 * A steered deliverable at risk gets a floating note AND a voice cut-in the minute it is
 * known. The note is the monitor's (`../monitor/steerAtRisk.ts`); this is what the console's `steer-risk` route reads
 * (`site/app/api/talk/call/[id]/steer-risk/route.ts`) so the voice names the same row for the same reason. The note is
 * the source, so the voice can never say a risk the owner's screen does not show, and a note the owner answered — Done, Later, or a
 * snooze still running — is never said.
 *
 * Pure: open steps in, notices out. The read is `../cli/commands/talk/steerRiskRun.ts`.
 */
import type { NoteMarker } from "../hand/note/markers.js";
import { activeSnoozes, type SnoozeRecord } from "../hand/snoozeStore.js";
import type { HandStep } from "../hand/step.js";
import { steerRiskReasonOf } from "../monitor/steerAtRisk.js";

/**
 * Every step the owner has answered on its note and that answer still holds: a Done or Later press not yet reconciled (its
 * marker), a reconciled Later (the ledger keeps it until the note is raised again), a snooze not yet lapsed, and a
 * snooze entry that would not read, held down as `hand push` holds it. A snooze is judged by each step's NEWEST
 * press, reconciled or not, exactly as the reconcile writes it; a lapsed one is the owner's note due again, so it is not
 * among them, and a snooze marker holds nothing by itself.
 *
 * @param markers the answer markers the note wrote, not yet settled; a snooze marker arrives in `snoozes` instead
 * @param laterIds the Later ledger's step ids
 * @param snoozes the snooze store's records beside every unreconciled press's record (`pendingSnoozeRecords`)
 * @param unreadableSnoozes the step ids whose snooze entry would not read
 * @param nowIso the instant a snooze is judged at
 * @returns the step ids the voice holds back
 */
export function answeredStepIds({
  laterIds,
  markers,
  nowIso,
  snoozes,
  unreadableSnoozes,
}: {
  laterIds: ReadonlySet<string>;
  markers: readonly NoteMarker[];
  nowIso: string;
  snoozes: readonly SnoozeRecord[];
  unreadableSnoozes: readonly string[];
}): ReadonlySet<string> {
  return new Set([
    ...markers.filter((marker) => marker.answer !== "snooze").map((marker) => marker.id),
    ...laterIds,
    ...activeSnoozes({ nowIso, records: newestPerStep({ snoozes }) }).keys(),
    ...unreadableSnoozes,
  ]);
}

/**
 * Each step's newest snooze press, the one that stands.
 *
 * @param snoozes every press, stored or pending
 * @returns one record per step
 */
function newestPerStep({ snoozes }: { snoozes: readonly SnoozeRecord[] }): readonly SnoozeRecord[] {
  const newest = new Map<string, SnoozeRecord>();
  for (const record of snoozes) {
    const held = newest.get(record.id);
    if (held === undefined || Date.parse(record.pressedIso) > Date.parse(held.pressedIso)) {
      newest.set(record.id, record);
    }
  }
  return [...newest.values()];
}

/** One steer note as the voice says it. */
interface SteerRiskNotice {
  /** The note's hand-step id, which the console claims the line under so it is said once. */
  readonly stepId: string;
  /** The note's one sentence, naming the row: "Your steered sup-4293 is at risk". */
  readonly what: string;
  /**
   * Why it is at risk, read off the note: "its seat closed until …, so nobody is working it", or the whole "waiting on
   * you: <the question> — answer it on your Queue" when the row is stopped on the owner's question.
   */
  readonly why: string;
}

/** What `talk steer-risk --json` prints. */
export interface SteerRiskAnswer {
  readonly notices: readonly SteerRiskNotice[];
}

/**
 * Every open steer note the owner has not answered, oldest first, as the voice says it. A note the owner answered can still be open
 * in the register — a Done until a reconcile settles it, a Later or a snooze by design — and the voice never says one.
 *
 * @param steps the open hand steps
 * @param stepIds the ids among them that are `steer-at-risk` notes
 * @param answered the ids whose answer still holds, from `answeredStepIds`
 * @returns one notice per note
 */
export function steerRiskNoticesOf({
  answered,
  steps,
  stepIds,
}: {
  answered: ReadonlySet<string>;
  steps: readonly HandStep[];
  stepIds: ReadonlySet<string>;
}): SteerRiskAnswer {
  const notices = steps
    .filter((step) => stepIds.has(step.id) && !answered.has(step.id))
    .toSorted((a, b) => a.postedIso.localeCompare(b.postedIso))
    .map((step) => ({ stepId: step.id, what: step.what, why: steerRiskReasonOf({ unblocks: step.unblocks }) }));
  return { notices };
}
