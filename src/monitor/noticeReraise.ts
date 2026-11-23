/**
 * A floating notice is raised again on a fired pass once its note is gone without the owner's press — at its monitor's own
 * window level, in front of every note already up.
 *
 * A pass raises a note only when it POSTS a card, and a notice is on no list (`../hand/step.ts`'s
 * `waitingHandSteps`), so neither `hand push` nor `tick close` ever raises one again. A notice whose raise failed,
 * or whose panel died, would then stay down for good: `meeting-prep-due`'s note gone in the hour before the meeting
 * is the incident this monitor exists to end.
 *
 * So each fired pass raises it again, for exactly the open card of a firing notice monitor — or of a floating monitor
 * that declares `keepsNoteUp`, whose note is the delivery (`./registry.ts`) — that this pass neither
 * posted nor settled, and only when its note reads `absent`. A note still up is left alone, and a note that went down
 * without the owner's press leaves no marker (`../hand/note/panel.ts`), so `absent` is exactly that one.
 *
 * The owner's presses are not undone. Done settles the card in the check's reconcile, before the pass reads it. A snooze
 * holds until its time: a notice that came back on the next tick would be a nag the owner could not stop. Whichever reader
 * consumes the snooze marker first — the console's `hand list` poll, an earlier fired check in the same tick —
 * writes the press to the snooze store (`../hand/snoozeStore.ts`), and the note's standing reads an active snooze,
 * like an entry in the older Later ledger (`../hand/laterPresses.ts`), as `dismissed`.
 */
import type { NoteLevel } from "../hand/note/panel.js";
import type { NoteStanding } from "../hand/note/raise.js";
import type { HandStep } from "../hand/step.js";
import type { Result } from "../lib/result.js";

import { monitorNoteLevel, type NoteRaiser, type PassOutcome } from "./pass.js";
import type { PassAction } from "./passSettle.js";
import { handStepId, monitorDefinition, occurrenceBase } from "./registry.js";

/**
 * The open notice cards a fired pass owes a fresh raise if their note is gone: a firing monitor that floats a notice,
 * its card for a subject it still reads, which this pass took no action on.
 *
 * Every floating notice is owed one, whatever its level: `recipe-repairing`'s notice once went down on the tick it
 * posted, and nothing ever raised it again, so a repair the owner was promised a notice for reached them no way at all.
 *
 * @param outcome the pass that just ran
 * @param open the open steps read before it
 * @returns the steps whose note to look at, each with the window level its raise draws at
 */
export function noticesToReraise({
  outcome,
  open,
}: {
  outcome: PassOutcome;
  open: readonly HandStep[];
}): readonly { monitorId: string; step: HandStep; level: NoteLevel }[] {
  const actedOn = new Set(outcome.actions.map((action) => action.stepId));
  return outcome.readings.flatMap((reading) => {
    if (reading.state !== "firing") {
      return [];
    }
    const definition = monitorDefinition({ monitorId: reading.monitorId });
    const keepsNoteUp = definition.notice !== undefined || definition.keepsNoteUp === true;
    if (!keepsNoteUp || definition.floats !== true) {
      return [];
    }
    const level = monitorNoteLevel({ definition });
    const subjectIds = new Set(reading.subjects.map((subject) => handStepId({ prefix: definition.prefix, subject })));
    return open
      .filter((step) => subjectIds.has(occurrenceBase({ id: step.id })) && !actedOn.has(step.id))
      .map((step) => ({ level, monitorId: reading.monitorId, step }));
  });
}

/**
 * Raise each owed notice whose note is gone, and say what happened to each.
 *
 * @param owed the cards {@link noticesToReraise} picked
 * @param standing where one step's note stands now, or why it could not be read
 * @param raiseNote draws the note at the level each owed card carries
 * @returns one row per note raised or refused; nothing for a note still up or one the owner closed with Done or Later
 */
export function reraiseLostNotices({
  owed,
  standing,
  raiseNote,
}: {
  owed: readonly { monitorId: string; step: HandStep; level: NoteLevel }[];
  standing: (options: { id: string }) => Result<NoteStanding, string>;
  raiseNote: NoteRaiser;
}): readonly PassAction[] {
  return owed.flatMap(({ monitorId, step, level }): PassAction[] => {
    const where = standing({ id: step.id });
    if (where.isErr()) {
      return [{ detail: `its note could not be read: ${where.error}`, kind: "refused", monitorId, stepId: step.id }];
    }
    if (where.value !== "absent") {
      return [];
    }
    const raised = raiseNote({ level, step });
    if (raised.isErr()) {
      return [
        { detail: `the floating note did not come back: ${raised.error}`, kind: "refused", monitorId, stepId: step.id },
      ];
    }
    return [
      {
        detail: `raised again, its note was not on screen — ${raised.value}`,
        kind: "noted",
        monitorId,
        stepId: step.id,
      },
    ];
  });
}
