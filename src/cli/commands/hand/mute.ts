/**
 * `slopweaver hand mute list|add <kind>|remove <kind|subject>` — the note's "Never for this kind" answer, read and
 * reversed.
 *
 * The note's More… page records a mute by marker (`../../../monitor/kindAnswerPresses.ts`); this verb records the
 * same answer from a terminal or the console, names every mute, every "When it gets worse" hold and every press a
 * store would not take, and reverses each. A mute keeps a kind's NOTE down and nothing else
 * (`../../../monitor/noteMutes.ts`).
 */
import { consumeKindAnswerMarker, kindAnswerLabel, readKindAnswerMarkers } from "../../../hand/kindAnswers.js";
import { isHandStepId } from "../../../hand/step.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { forgetEscalationHold, readEscalationHolds } from "../../../monitor/escalationHolds.js";
import { monitorOfStepId } from "../../../monitor/noteAnswers.js";
import { forgetNoteMute, type NoteMute, readNoteMutes, recordNoteMute } from "../../../monitor/noteMutes.js";
import { isMonitorId, monitorDefinition, occurrenceBase } from "../../../monitor/registry.js";
import type { MonitorId } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { MUTE_USAGE, parseHandMuteArgs, VERB_ARG_OFFSET } from "./core.js";
import { type HandDeps, productionHandDeps, reportUnparsed, resolvedHomeOf } from "./deps.js";
import { recordAndReportKindPresses } from "./kindPresses.js";
import { listMutes } from "./muteList.js";

/** What the positionals asked for. */
type MuteAction =
  | { readonly kind: "list" }
  | { readonly kind: "add"; readonly monitorId: MonitorId }
  | { readonly kind: "remove"; readonly monitorId: MonitorId }
  | { readonly kind: "release"; readonly base: string };

/**
 * A monitor card's step id as `hand mute list` prints it: a step id under `mon-`, in the ONE grammar the press reader
 * also applies (`isHandStepId`), so every press it lists is removable by the id it is listed under. That grammar has
 * no path separator or whitespace: the id names one file inside the marker or hold directory, nothing else.
 *
 * @returns true when `remove` reads the id as a subject to release
 */
function isMonitorStepId({ id }: { id: string }): boolean {
  return id.startsWith("mon-") && isHandStepId({ id });
}

/**
 * The action the positionals name, or the refusal saying what is wrong with them. `remove` takes a monitor kind,
 * which unmutes it, or a held subject's step id as `hand mute list` prints it, which releases that hold.
 *
 * @param positionals the argv's positionals after `hand mute`
 * @returns the action, or why it is not one
 */
export function muteActionOf({
  positionals,
}: {
  positionals: readonly string[];
}): MuteAction | { readonly problem: string } {
  const [action, kind, ...extra] = positionals;
  if (action === "list" && kind === undefined) {
    return { kind: "list" };
  }
  if ((action === "add" || action === "remove") && kind !== undefined && extra.length === 0) {
    if (isMonitorId(kind)) {
      return { kind: action, monitorId: kind };
    }
    if (action === "remove" && isMonitorStepId({ id: kind })) {
      return { base: occurrenceBase({ id: kind }), kind: "release" };
    }
    if (action === "remove") {
      return {
        problem: `${kind} is no declared monitor kind nor a held subject's step id — \`slopweaver hand mute list\` names both`,
      };
    }
    return { problem: `${kind} is no declared monitor kind — \`slopweaver monitor list\` names them` };
  }
  return { problem: "name list, or add or remove with exactly one kind" };
}

/**
 * Run `hand mute` against injected seams.
 *
 * @param rest the argv tail after `hand mute`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code: 3 when `remove` names a kind that was not muted
 */
export function runHandMute({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(MUTE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandMuteArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(MUTE_USAGE);
    return EXIT_USAGE;
  }
  const action = muteActionOf({ positionals: parsed.value.positionals });
  if ("problem" in action) {
    deps.writeDiagnostic(`hand mute: ${action.problem}`);
    deps.writeDiagnostic(MUTE_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolvedHomeOf({ values });
  const json = values["json"] === true;
  // A press the note left and no pass has recorded yet is the owner's answer too, so it is recorded before anything is read.
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    deps.writeDiagnostic(`hand mute: ${open.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: open.value.unparsed, verb: "hand mute" });
  // A release DISCARDS its subject's unrecorded presses — the remove `list` prints for one — so it runs before this
  // run records presses: recorded first, the press it names would become the very mute it was asked to discard.
  const released = action.kind === "release" ? releaseHold({ base: action.base, deps, home, json }) : undefined;
  if (released === EXIT_ERROR) {
    return released;
  }
  const pressProblems = recordAndReportKindPresses({
    home,
    open: open.value.steps,
    verb: "hand mute",
    writeDiagnostic: deps.writeDiagnostic,
  });
  if (action.kind === "list") {
    return listMutes({ deps, home, json, pressProblems });
  }
  // A release already ran above, before the presses were recorded, so `released` is set exactly when it is one.
  const code = action.kind === "release" ? released! : actOnMute({ action, deps, home, json });
  if (code === EXIT_ERROR) {
    return code;
  }
  // Read AFTER the act, so a remove that reversed the suppression it names leaves nothing here and keeps its exit.
  const residual = residualSuppressions({ home });
  residual.forEach((line) => {
    deps.writeDiagnostic(`hand mute: ${line}`);
  });
  return residual.length > 0 ? EXIT_ERROR : code;
}

/**
 * Perform one add or remove — a release runs before the presses are recorded, in the verb itself.
 *
 * @param action the parsed action, never `list` or `release`
 * @param json print one JSON line instead of the sentence
 * @returns the action's own exit code
 */
function actOnMute({
  action,
  deps,
  home,
  json,
}: {
  action: Extract<MuteAction, { kind: "add" | "remove" }>;
  deps: HandDeps;
  home: string;
  json: boolean;
}): number {
  switch (action.kind) {
    case "add":
      return addMute({ deps, home, json, monitorId: action.monitorId });
    case "remove":
      return removeMute({ deps, home, json, monitorId: action.monitorId });
  }
}

/**
 * Whatever may still hold a note down that `hand mute list` cannot show whole once an act is done: a press no pass
 * could honour (every honoured one is consumed, so any left is one), a store failure, or a marker directory that will
 * not list. Each is one line naming it; empty when nothing stands.
 *
 * @param home the state home
 * @returns one line per residual suppression or failure
 */
function residualSuppressions({ home }: { home: string }): readonly string[] {
  const pending = pendingPresses({ home });
  const pressLines = pending.isErr()
    ? [`${pending.error.message} — a press there may still keep a note down`]
    : pending.value.map(
        (marker) =>
          `${kindAnswerLabel({ answer: marker.answer })} on ${marker.id} is not recorded and still keeps its note down — \`slopweaver hand mute remove ${marker.id}\` discards it`,
      );
  const storeLines = [...readNoteMutes({ home }).problems, ...readEscalationHolds({ home }).problems].map(
    (problem) => `${problem.message} — \`slopweaver hand mute list\` names what it holds down`,
  );
  return [...pressLines, ...storeLines];
}

/**
 * Every kind-answer press still waiting in the marker directory — read AFTER this run recorded what it could, so
 * each one is a press a store would not take, keeping its step's note down until it is recorded or discarded.
 *
 * @param home the state home
 * @returns the presses, or why the marker directory would not list
 */
function pendingPresses({ home }: { home: string }): ReturnType<typeof readKindAnswerMarkers> {
  return readKindAnswerMarkers({ markerDir: stateHomePaths({ home }).handNoteDismiss });
}

/**
 * Release one subject by hand: forget its "When it gets worse" hold, and discard any kind-answer press on one of its
 * cards a store would not take, so its note comes back on the next pass that posts it.
 *
 * @param base the subject's occurrence base
 * @param json print one JSON line instead of the sentence
 * @returns 0 when a hold or a press was released, 3 when that subject had neither
 */
function releaseHold({
  base,
  deps,
  home,
  json,
}: {
  base: string;
  deps: HandDeps;
  home: string;
  json: boolean;
}): number {
  const pending = pendingPresses({ home });
  if (pending.isErr()) {
    deps.writeDiagnostic(`hand mute: ${pending.error.message}`);
    return EXIT_ERROR;
  }
  const presses = pending.value.filter((marker) => occurrenceBase({ id: marker.id }) === base);
  const forgotten = forgetEscalationHold({ base, home });
  if (forgotten.isErr()) {
    deps.writeDiagnostic(`hand mute: ${forgotten.error.message}`);
    return EXIT_ERROR;
  }
  const stuck = presses.flatMap((marker) => {
    const consumed = consumeKindAnswerMarker({ marker });
    return consumed.isErr() ? consumed.error : [];
  });
  if (stuck.length > 0) {
    stuck.forEach((why) => {
      deps.writeDiagnostic(`hand mute: ${why} — its note stays down until it does`);
    });
    return EXIT_ERROR;
  }
  const released = forgotten.value || presses.length > 0;
  // A press whose mute was recorded but whose marker would not go leaves BOTH: discarding the marker lifts nothing.
  const kindLines = released ? kindStillDown({ base, home }) : [];
  if (kindLines.length > 0) {
    kindLines.forEach((line) => {
      deps.writeDiagnostic(`hand mute: ${line}`);
    });
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(JSON.stringify({ base, discardedPresses: presses.length, released }));
    return released ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  }
  if (!released) {
    deps.writeOut(`hand mute: ${base} was not held until it gets worse`);
    return EXIT_EXPECTED_EMPTY;
  }
  deps.writeOut(
    `hand mute: ${base} is no longer held — its note comes back from the next pass that posts one, and \`slopweaver hand show <id>\` draws an open card now`,
  );
  return EXIT_OK;
}

/**
 * Why a released subject's note may still stay down for its KIND: the kind's own mute, or a mute store that will not
 * read, so whether one stands cannot be told — each named, never a store failure passed off as a mute.
 *
 * @param base the released subject
 * @returns one line per reason; empty when its kind is no monitor's or stands unmuted
 */
function kindStillDown({ base, home }: { base: string; home: string }): readonly string[] {
  const kind = monitorOfStepId({ id: base });
  if (kind === undefined) {
    return [];
  }
  const mutes = readNoteMutes({ home });
  const problems = mutes.problems.map(
    (problem) =>
      `${base} is released, but ${problem.message} — a mute of ${kind.id} there may still keep its note down`,
  );
  const muted =
    mutes.records.some((mute) => mute.monitorId === kind.id) || mutes.unreadable.some((key) => key === kind.id);
  const mutedLine = `${base} is released, but its kind ${kind.id} is muted, so its note stays down — \`slopweaver hand mute remove ${kind.id}\` lifts that`;
  return muted ? [...problems, mutedLine] : problems;
}

/**
 * Mute one kind from the command line. A notice kind is refused: its note is its only delivery.
 *
 * @param monitorId the kind to mute
 * @param json print one JSON line instead of the sentence
 * @returns the exit code
 */
function addMute({
  deps,
  home,
  json,
  monitorId,
}: {
  deps: HandDeps;
  home: string;
  json: boolean;
  monitorId: MonitorId;
}): number {
  if (monitorDefinition({ monitorId }).notice !== undefined) {
    deps.writeDiagnostic(
      `hand mute: ${monitorId} is a notice — it appears on no list, so its note is its only delivery and it is never muted`,
    );
    return EXIT_ERROR;
  }
  const mute: NoteMute = { from: { kind: "command" }, monitorId, mutedIso: deps.now() };
  const written = recordNoteMute({ home, mute });
  if (written.isErr()) {
    deps.writeDiagnostic(`hand mute: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(JSON.stringify({ muted: mute }));
    return EXIT_OK;
  }
  deps.writeOut(
    `hand mute: ${monitorId}'s note will not be raised again — its cards still post; \`slopweaver hand mute remove ${monitorId}\` reverses it`,
  );
  return EXIT_OK;
}

/**
 * Remove one kind's mute.
 *
 * @param monitorId the kind to unmute
 * @param json print one JSON line instead of the sentence
 * @returns 0 when a mute was removed, 3 when the kind was not muted
 */
function removeMute({
  deps,
  home,
  json,
  monitorId,
}: {
  deps: HandDeps;
  home: string;
  json: boolean;
  monitorId: MonitorId;
}): number {
  const removed = forgetNoteMute({ home, monitorId });
  if (removed.isErr()) {
    deps.writeDiagnostic(`hand mute: ${removed.error.message}`);
    return EXIT_ERROR;
  }
  // A "Never for this kind" press no pass could record mutes the kind as surely as a record does, so the kind is not
  // unmuted while one stands: each is named with the remove that discards it, and the verb fails.
  const stillPressed = pressesMuting({ home, monitorId });
  if (stillPressed.length > 0) {
    stillPressed.forEach((line) => {
      deps.writeDiagnostic(`hand mute: ${line}`);
    });
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(JSON.stringify({ monitorId, removed: removed.value }));
    return removed.value ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  }
  if (!removed.value) {
    deps.writeOut(`hand mute: ${monitorId} was not muted`);
    return EXIT_EXPECTED_EMPTY;
  }
  deps.writeOut(
    `hand mute: ${monitorId}'s notes come back from the next pass that posts one; a card of it already open stays on the Queue, and \`slopweaver hand show <id>\` draws it`,
  );
  return EXIT_OK;
}

/**
 * Every unrecorded "Never for this kind" press that still mutes one kind, as the line naming it — or the one line
 * saying the marker directory would not list, since then a press may stand unseen.
 *
 * @param home the state home
 * @param monitorId the kind being unmuted
 * @returns one line per press still muting it, empty when none stands
 */
function pressesMuting({ home, monitorId }: { home: string; monitorId: MonitorId }): readonly string[] {
  const pending = pendingPresses({ home });
  if (pending.isErr()) {
    return [`${pending.error.message} — a press there may still keep ${monitorId}'s note down`];
  }
  return pending.value
    .filter((marker) => marker.answer === "mute-kind" && monitorOfStepId({ id: marker.id })?.id === monitorId)
    .map(
      (marker) =>
        `${kindAnswerLabel({ answer: marker.answer })} on ${marker.id} is not recorded and still keeps ${monitorId}'s note down — \`slopweaver hand mute remove ${marker.id}\` discards it`,
    );
}

/** `slopweaver hand mute`. */
export const handMuteCommand = defineCommand({
  run: (argv) => runHandMute({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
