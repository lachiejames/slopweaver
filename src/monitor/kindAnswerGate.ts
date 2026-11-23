/**
 * THE KIND ANSWERS, APPLIED — whether an AUTOMATIC raise of one step's note is kept down by the owner's mute of its kind
 * (`./noteMutes.ts`) or the owner's "When it gets worse" hold on its subject (`./escalationHolds.ts`), and where a note
 * stands once those count.
 *
 * Asked by every automatic raise: a floating monitor's arrival (`monitor check`), a lost notice's re-raise, `hand
 * push`'s arrival note and `hand wake`'s lapsed snooze. Never by `hand show` or `hand post`, which the owner or a session
 * asked for by name. Nothing here touches the card: it is posted, on the Queue and in `hand list` either way.
 */
import { type HandStepError, HandStepErrors } from "../hand/errors.js";
import { type KindAnswerMarker, kindAnswerLabel, readKindAnswerMarkers } from "../hand/kindAnswers.js";
import { type NoteStanding, noteStanding } from "../hand/note/raise.js";
import type { HandStep } from "../hand/step.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { escalationHeld, readEscalationHolds } from "./escalationHolds.js";
import { monitorOfStep, monitorOfStepId } from "./noteAnswers.js";
import { kindMuted, readNoteMutes } from "./noteMutes.js";
import type { NoteRaiser } from "./passPost.js";
import { occurrenceBase } from "./registry.js";
import type { MonitorId } from "./types.js";

/**
 * Why an automatic raise of this step's note is kept down, or `undefined` when nothing the owner said keeps it down.
 *
 * @param home the state home both stores live under
 * @param step the step an automatic raise is about to draw
 * @returns the phrase a pass or a push prints in place of the note, or undefined
 */
export function noteKeptDown({ home, step }: { home: string; step: HandStep }): string | undefined {
  const definition = monitorOfStep({ step });
  // A notice's note is its only delivery — it sits on no list — so no record, however it came to stand, keeps it down.
  if (definition === undefined || definition.notice !== undefined) {
    return undefined;
  }
  if (kindMuted({ home, monitorId: definition.id })) {
    return `kept down — you muted ${definition.id}'s note (\`slopweaver hand mute remove ${definition.id}\` brings it back); the card stands`;
  }
  if (escalationHeld({ base: occurrenceBase({ id: step.id }), home })) {
    return "kept down until it reads worse — you asked to be told only then; the card stands";
  }
  const pending = pendingPressFor({ base: occurrenceBase({ id: step.id }), home, monitorId: definition.id });
  // A marker directory that will not list may hold the owner's press, and a raise would clear it: fail closed, like a store.
  if (pending.isErr()) {
    return `kept down — ${pending.error.message}, and a press of yours may stand there (\`slopweaver hand mute list\` names it); the card stands`;
  }
  if (pending.value !== undefined) {
    return `kept down — your ${kindAnswerLabel({ answer: pending.value.answer })} on ${pending.value.id} is not recorded yet (\`slopweaver hand mute list\` says why); the card stands`;
  }
  return undefined;
}

/**
 * A kind-answer press still in the marker directory that speaks for this note: a Never on any card of its kind, or a
 * When it gets worse on any card of its subject. A press stays there only while its store would not take it, and a
 * raise clears its own step's markers, so a gate that ignored it would let the next raise erase the owner's answer.
 *
 * @param home the state home
 * @param monitorId the note's monitor kind
 * @param base the note's occurrence base
 * @returns the press, undefined when none waits, or why the marker directory would not list — one may stand there
 */
function pendingPressFor({
  home,
  monitorId,
  base,
}: {
  home: string;
  monitorId: MonitorId;
  base: string;
}): Result<KindAnswerMarker | undefined, HandStepError> {
  return readKindAnswerMarkers({ markerDir: stateHomePaths({ home }).handNoteDismiss }).map((markers) =>
    markers.find((marker) => {
      if (marker.answer === "mute-kind") {
        return monitorOfStepId({ id: marker.id })?.id === monitorId;
      }
      return occurrenceBase({ id: marker.id }) === base;
    }),
  );
}

/**
 * An automatic raiser that asks {@link noteKeptDown} first: a note the owner muted or holds until worse answers `ok` with
 * why it stayed down, so the pass's row says so and never reads as a failed raise.
 *
 * @param home the state home both stores live under
 * @param raiseNote the raw raiser it wraps
 * @returns the gated raiser
 */
export function keptDownRaiser({ home, raiseNote }: { home: string; raiseNote: NoteRaiser }): NoteRaiser {
  return ({ step, level }) => {
    const keptDown = noteKeptDown({ home, step });
    if (keptDown !== undefined) {
      return ok(keptDown);
    }
    return raiseNote({ level, step });
  };
}

/**
 * Where one step's note stands with the owner's kind answers counted: {@link noteStanding}, except that a note ABSENT
 * because the owner muted its kind or holds it until worse reads `dismissed` — the owner took it down, so nothing should raise it
 * again or refuse a tick for its absence. Resolved by the id's prefix alone: every caller asks about a monitor card.
 *
 * @param id the step's id
 * @param home the state home
 * @param clock the instant the note's beat is judged at
 * @returns the standing, or the failure to read the note's files
 */
export function monitorNoteStanding({
  id,
  home,
  clock,
}: {
  id: string;
  home: string;
  clock: () => string;
}): Result<NoteStanding, HandStepError> {
  const standing = noteStanding({ clock, home, id });
  if (standing.isErr() || standing.value !== "absent") {
    return standing;
  }
  const definition = monitorOfStepId({ id });
  if (definition === undefined || definition.notice !== undefined) {
    return standing;
  }
  // A store that will not read keeps the note down, fail closed — but a reader judging where the note stands must
  // NAME that, never pass it off as the owner's dismissal: the suppression may stand behind the failure, or may not.
  const [problem] = [...readNoteMutes({ home }).problems, ...readEscalationHolds({ home }).problems];
  if (problem !== undefined) {
    return err(HandStepErrors.storeUnreadable({ cause: problem.cause, path: problem.path }));
  }
  const base = occurrenceBase({ id });
  // The marker directory the same: a press may stand behind a list it refuses, so that is named too.
  const pending = pendingPressFor({ base, home, monitorId: definition.id });
  if (pending.isErr()) {
    return err(pending.error);
  }
  const keptDown =
    kindMuted({ home, monitorId: definition.id }) || escalationHeld({ base, home }) || pending.value !== undefined;
  return keptDown ? ok("dismissed") : standing;
}
