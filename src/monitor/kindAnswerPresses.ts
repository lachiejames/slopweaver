/**
 * THE OWNER'S KIND ANSWERS, RECORDED — each `<id>.mute-kind` or `<id>.when-worse` press the note left
 * (`../hand/kindAnswers.ts`) becomes a mute (`./noteMutes.ts`) or a pending escalation hold
 * (`./escalationHolds.ts`), and only then is the marker removed. A store that will not write keeps the marker, so
 * the press is retried next pass and its note reads dismissed meanwhile (`markerPaths` counts it).
 *
 * Run beside the reconcile by every verb that may raise a note automatically — `monitor check --fire`, `hand push`,
 * `hand wake` — and by `hand mute`, so a press is honoured before any of them asks whether to raise.
 */
import type { HandStepError } from "../hand/errors.js";
import { consumeKindAnswerMarker, type KindAnswerMarker, readKindAnswerMarkers } from "../hand/kindAnswers.js";
import type { HandStep } from "../hand/step.js";
import { stateHomePaths } from "../stateHome.js";

import { type MonitorError, MonitorErrors } from "./errors.js";
import { recordEscalationHold } from "./escalationHolds.js";
import { monitorOfStep, monitorOfStepId } from "./noteAnswers.js";
import { recordNoteMute } from "./noteMutes.js";
import { occurrenceBase } from "./registry.js";

/** What one press came to. */
export type KindPressOutcome =
  | { readonly kind: "muted"; readonly stepId: string; readonly monitorId: string }
  | { readonly kind: "held"; readonly stepId: string; readonly base: string }
  | { readonly kind: "refused"; readonly stepId: string; readonly why: string }
  | { readonly kind: "moot"; readonly stepId: string; readonly why: string };

/** Every press this pass read, what each came to, and every failure met. */
export interface KindPressReport {
  readonly outcomes: readonly KindPressOutcome[];
  readonly problems: readonly (HandStepError | MonitorError)[];
}

/**
 * Record every kind-answer press waiting in the marker directory.
 *
 * A mute is about the KIND, so it stands even when the step it was pressed on has settled since: that step is then
 * resolved by its id's prefix. A hold is about the SUBJECT, so a press on a step no longer open is moot — the subject
 * it would hold is gone. Every refusal is reported and its marker consumed: a press this lane will never honour must
 * not hold the note down forever.
 *
 * @param home the state home
 * @param open every step the register carries open
 * @returns what each press came to
 */
export function recordKindAnswerPresses({ home, open }: { home: string; open: readonly HandStep[] }): KindPressReport {
  const markers = readKindAnswerMarkers({ markerDir: stateHomePaths({ home }).handNoteDismiss });
  if (markers.isErr()) {
    return { outcomes: [], problems: [markers.error] };
  }
  const openById = new Map(open.map((step) => [step.id, step]));
  const outcomes: KindPressOutcome[] = [];
  const problems: (HandStepError | MonitorError)[] = [];
  for (const marker of markers.value) {
    const pressed = pressOutcome({ home, marker, step: openById.get(marker.id) });
    if (pressed.kind === "kept") {
      problems.push(pressed.problem);
      continue;
    }
    if (pressed.outcome.kind === "refused") {
      problems.push(MonitorErrors.kindAnswerRefused({ subject: marker.id, why: pressed.outcome.why }));
    }
    outcomes.push(pressed.outcome);
    const consumed = consumeKindAnswerMarker({ marker });
    if (consumed.isErr()) {
      problems.push(MonitorErrors.kindAnswerStore({ cause: consumed.error.join("; "), path: marker.path }));
    }
  }
  return { outcomes, problems };
}

/** One press, decided: an outcome whose marker may go, or a store failure that keeps it. */
type Pressed =
  | { readonly kind: "decided"; readonly outcome: KindPressOutcome }
  | { readonly kind: "kept"; readonly problem: MonitorError };

/**
 * Decide and record one press.
 *
 * @param home the state home
 * @param marker the press
 * @param step the open step it names, if it is still open
 * @returns what it came to
 */
function pressOutcome({
  home,
  marker,
  step,
}: {
  home: string;
  marker: KindAnswerMarker;
  step: HandStep | undefined;
}): Pressed {
  const stepId = marker.id;
  const refused = ({ why }: { why: string }): Pressed => ({
    kind: "decided",
    outcome: { kind: "refused", stepId, why },
  });
  // A press whose file would not READ is still the owner's press: kept, like a store that would not write, never refused.
  if (marker.unreadable !== undefined) {
    return {
      kind: "kept",
      problem: MonitorErrors.kindAnswerStore({
        cause: `the press would not read: ${marker.unreadable}`,
        path: marker.path,
      }),
    };
  }
  if (Number.isNaN(Date.parse(marker.pressedIso))) {
    return refused({ why: "the press carries no instant this lane can read" });
  }
  if (marker.answer === "mute-kind") {
    return pressMute({ home, marker, refused, step });
  }
  if (step === undefined) {
    return { kind: "decided", outcome: { kind: "moot", stepId, why: "the card is no longer open" } };
  }
  const definition = monitorOfStep({ step });
  if (definition?.worsens === undefined) {
    return refused({ why: "no monitor declares what worse means for this card" });
  }
  const base = occurrenceBase({ id: stepId });
  const written = recordEscalationHold({
    hold: { base, monitorId: definition.id, pressedIso: marker.pressedIso, state: { kind: "pending" }, stepId },
    home,
  });
  if (written.isErr()) {
    return { kind: "kept", problem: written.error };
  }
  return { kind: "decided", outcome: { base, kind: "held", stepId } };
}

/**
 * Decide and record one "Never for this kind" press. It stands whether or not its card is still open, since the
 * answer is about the kind, never the card.
 *
 * @param marker the press
 * @param refused builds a refusal of this press
 * @param step the open step it names, if it is still open
 * @returns what it came to
 */
function pressMute({
  home,
  marker,
  refused,
  step,
}: {
  home: string;
  marker: KindAnswerMarker;
  refused: (options: { why: string }) => Pressed;
  step: HandStep | undefined;
}): Pressed {
  const stepId = marker.id;
  const definition = step === undefined ? monitorOfStepId({ id: stepId }) : monitorOfStep({ step });
  if (definition === undefined) {
    return refused({ why: "the step is no monitor's card, so it names no kind to mute" });
  }
  if (definition.notice !== undefined) {
    return refused({ why: `${definition.id} is a notice, whose note is its only delivery — it is never muted` });
  }
  const written = recordNoteMute({
    home,
    mute: { from: { kind: "note", stepId }, monitorId: definition.id, mutedIso: marker.pressedIso },
  });
  if (written.isErr()) {
    return { kind: "kept", problem: written.error };
  }
  return { kind: "decided", outcome: { kind: "muted", monitorId: definition.id, stepId } };
}
