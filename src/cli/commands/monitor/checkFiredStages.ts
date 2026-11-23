/**
 * A FIRED `monitor check` pass's after-stages: each lost notice's note raised again, every "When it gets worse" hold
 * judged, and the fleet-health note's memory moved. A rehearsal runs none of them (`./check.ts`).
 */
import { macosOnly } from "../../../hand/note/raise.js";
import type { HandStep } from "../../../hand/step.js";
import { runFiredEscalations } from "../../../monitor/escalationStage.js";
import { recordFleetHealthShown } from "../../../monitor/fleetHealthShown.js";
import { monitorNoteStanding } from "../../../monitor/kindAnswerGate.js";
import { noticesToReraise, reraiseLostNotices } from "../../../monitor/noticeReraise.js";
import type { NoteRaiser, PassOutcome } from "../../../monitor/pass.js";
import type { PassAction } from "../../../monitor/passSettle.js";

/**
 * A fired pass's after-stages, appended to its rows.
 *
 * @param now the hand clock — every record the pass writes, a hold's baseline instant included, is stamped by it
 * @param platform the platform the note would draw on
 * @param passed the fired pass
 * @param open the open steps read before it
 * @param raiseNote the gated raiser every automatic raise goes through
 * @param rawRaiser the ungated raiser, for the escalation stage alone
 * @param stillHeld whether this pass still holds the fired-pass lease — an overtaken one judges no hold
 * @returns the pass with the after-stages' rows appended, and whether the escalation stage met a failure
 */
export function withFiredStages({
  home,
  now,
  open,
  passed,
  platform,
  raiseNote,
  rawRaiser,
  stillHeld,
  writeDiagnostic,
}: {
  home: string;
  now: () => string;
  open: readonly HandStep[];
  passed: PassOutcome;
  platform: string;
  raiseNote: NoteRaiser;
  rawRaiser: NoteRaiser;
  stillHeld: () => boolean;
  writeDiagnostic: (line: string) => void;
}): { outcome: PassOutcome; stageFaulted: boolean } {
  const reraised = reraisedNotices({ home, now, open, passed, platform, raiseNote });
  const escalated = runFiredEscalations({
    home,
    nowIso: now(),
    raiseNote: rawRaiser,
    readings: passed.readings,
    stillHeld,
    writeDiagnostic,
  });
  return {
    outcome: {
      ...passed,
      actions: [
        ...passed.actions,
        ...reraised,
        ...escalated.actions,
        ...recordFleetHealthShown({ home, outcome: passed }),
      ],
    },
    stageFaulted: escalated.faulted,
  };
}

/**
 * Each lost notice's note raised again after a fired pass (`../../../monitor/noticeReraise.ts`). The owner's Later reads as
 * `dismissed` in the note's standing, so it is left down. Off macOS there is no note to lose and a raise only reports
 * the platform, so every tick would claim a raise.
 *
 * @param passed the fired pass
 * @param open the open steps read before it
 * @param raiseNote the pass's own raiser
 * @returns one row per note raised again or refused
 */
function reraisedNotices({
  home,
  now,
  open,
  passed,
  platform,
  raiseNote,
}: {
  home: string;
  now: () => string;
  open: readonly HandStep[];
  passed: PassOutcome;
  platform: string;
  raiseNote: NoteRaiser;
}): readonly PassAction[] {
  if (macosOnly({ platform }) !== undefined) {
    return [];
  }
  return reraiseLostNotices({
    owed: noticesToReraise({ open, outcome: passed }),
    raiseNote,
    standing: ({ id }) => monitorNoteStanding({ clock: now, home, id }).mapErr((error) => error.message),
  });
}
