/**
 * `slopweaver hand show` — raise the floating note for one open step.
 *
 * The oldest open step unless an id names another, for the same reason `hand list` is ordered that way: a
 * pick by any other key would be a priority, and a wait on a person has none.
 */
import { HandStepErrors } from "../../../hand/errors.js";
import { kindAnswerLabel, readKindAnswerMarkers } from "../../../hand/kindAnswers.js";
import { macosOnly, raiseHandNote } from "../../../hand/note/raise.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import type { HandStep } from "../../../hand/step.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { kindAnswerOffer } from "../../../monitor/noteAnswers.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseHandShowArgs, SHOW_USAGE, VERB_ARG_OFFSET } from "./core.js";
import {
  bySession,
  type HandDeps,
  productionHandDeps,
  reportReconciled,
  reportUnparsed,
  resolvedHomeOf,
} from "./deps.js";
import { recordKindPressesAndCheckStores } from "./kindPresses.js";

/**
 * The step to draw: the one an id names, or the oldest open one.
 *
 * @param open every open step, oldest first
 * @param id the id the caller named, or `undefined`
 * @returns the step, or `undefined` when nothing matches
 */
export function stepToShow({ open, id }: { open: readonly HandStep[]; id: string | undefined }): HandStep | undefined {
  if (id === undefined) {
    return open[0];
  }
  return open.find((step) => step.id === id);
}

/**
 * Run `hand show` against injected seams.
 *
 * @param rest the argv tail after `hand show`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runHandShow({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SHOW_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandShowArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(SHOW_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const resolvedHome = resolvedHomeOf({ values });
  const reconciled = reconcileHandSteps({ bySession: bySession({ values }), home: resolvedHome, nowIso: deps.now() });
  if (reconciled.isErr()) {
    deps.writeDiagnostic(`hand show: ${reconciled.error.message}`);
    return EXIT_ERROR;
  }
  reportReconciled({ deps, outcome: reconciled.value, verb: "hand show" });
  const read = readOpenHandSteps({ home: resolvedHome });
  if (read.isErr()) {
    deps.writeDiagnostic(`hand show: ${read.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: read.value.unparsed, verb: "hand show" });
  // Recorded before the raise, which clears the step's markers: a press still on disk would be lost with them. A press
  // it met and could not honour may still keep a note down, so it fails the verb once the note it asked for is up.
  const pressFaulted =
    recordKindPressesAndCheckStores({
      home: resolvedHome,
      open: read.value.steps,
      verb: "hand show",
      writeDiagnostic: deps.writeDiagnostic,
    }) > 0;
  return drawPicked({
    deps,
    home: resolvedHome,
    json: values["json"] === true,
    named: parsed.value.positionals[0],
    open: read.value.steps,
    pressFaulted,
  });
}

/**
 * Draw the step `hand show` picked, once its presses are recorded.
 *
 * @param named the id the caller named, or `undefined` for the oldest open step
 * @param pressFaulted whether a press this run met could not be honoured — it fails the verb once the note is up
 * @returns the process exit code
 */
function drawPicked({
  deps,
  home,
  json,
  named,
  open,
  pressFaulted,
}: {
  deps: HandDeps;
  home: string;
  json: boolean;
  named: string | undefined;
  open: readonly HandStep[];
  pressFaulted: boolean;
}): number {
  const step = stepToShow({ id: named, open });
  if (step === undefined) {
    if (named !== undefined) {
      deps.writeDiagnostic(`hand show: ${HandStepErrors.unknownStep({ id: named }).message}`);
      return EXIT_ERROR;
    }
    deps.writeOut("hand show: nothing is waiting on the owner");
    return pressFaulted ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
  }
  const platform = macosOnly({ platform: deps.platform });
  if (platform !== undefined) {
    deps.writeOut(`hand show: ${platform.message}`);
    return pressFaulted ? EXIT_ERROR : EXIT_OK;
  }
  const standing = unrecordedPressesOf({ home, id: step.id });
  if (standing.length > 0) {
    standing.forEach((line) => {
      deps.writeDiagnostic(`hand show: ${line}`);
    });
    return EXIT_ERROR;
  }
  const shown = showStep({ deps, home, json, step });
  return pressFaulted ? EXIT_ERROR : shown;
}

/**
 * The kind-answer presses on one step that this run could not record, read AFTER it recorded what it could. The raise
 * clears every marker of its step, so drawing over one of these would silently lose the suppression it carries; the
 * verb names each with the remove that discards it instead. A marker directory that will not list is one line too —
 * what it holds cannot be told apart from nothing.
 *
 * @param home the state home
 * @param id the step about to be drawn
 * @returns one line per press still standing on that step, or why the directory would not list; empty when none
 */
function unrecordedPressesOf({ home, id }: { home: string; id: string }): readonly string[] {
  const pending = readKindAnswerMarkers({ markerDir: stateHomePaths({ home }).handNoteDismiss });
  if (pending.isErr()) {
    return [`${pending.error.message} — a press there may still keep ${id}'s note down, so it is not redrawn over`];
  }
  return pending.value
    .filter((marker) => marker.id === id)
    .map(
      (marker) =>
        `${kindAnswerLabel({ answer: marker.answer })} on ${marker.id} is not recorded and still keeps its note down — \`slopweaver hand mute remove ${marker.id}\` discards it, then \`slopweaver hand show ${marker.id}\` draws it`,
    );
}

/**
 * Raise one step's note and report it.
 *
 * `replace`: the owner asked for this note by name, often because the one up is where the owner cannot see it. The fresh note
 * draws in front, in its step's own cascade slot when that note is still up, and the old one closes once it has
 * drawn — so there is still one note per step. Notes of other steps stay where they are. It draws at the
 * ordinary level whatever raised it first: a monitor's notice redrawn by name sits among the owner's other notes.
 *
 * @param json print the raise as one JSON line instead of the sentence
 * @returns the exit code
 */
function showStep({ step, home, json, deps }: { step: HandStep; home: string; json: boolean; deps: HandDeps }): number {
  // Never gated by the owner's kind answers: the owner asked for this note by name, a muted kind's included.
  const raised = raiseHandNote({
    home,
    kindAnswers: kindAnswerOffer({ step }),
    level: "ordinary",
    nowIso: deps.now(),
    run: deps.run,
    step,
    whenLive: "replace",
  });
  if (raised.isErr()) {
    deps.writeDiagnostic(`hand show: ${raised.error.message}`);
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(JSON.stringify({ note: raised.value, step }));
    return EXIT_OK;
  }
  deps.writeOut(`hand show: ${step.id} floating, top right — ${step.what}`);
  return EXIT_OK;
}

/** `slopweaver hand show`. */
export const handShowCommand = defineCommand({
  run: (argv) => runHandShow({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
