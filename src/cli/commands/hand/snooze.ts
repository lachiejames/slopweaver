/**
 * `slopweaver hand snooze <id> --for 1h|3h|tomorrow` — take a note down UNTIL a time the owner chose.
 *
 * The same answer the note's Not now… band gives, for every surface that is not the note: the console, a
 * terminal. There is no bare dismiss — the owner never presses one, because a more
 * specific button already answers that question. So the verb records the snooze straight into the store
 * (`../../../hand/snoozeStore.ts`) AND writes the note's own marker, which is what closes a running panel; the
 * next reconcile reads that marker and records the same snooze again, idempotently. It writes no register row:
 * the step stays open, and `hand wake` raises its note once the time passes.
 */
import { HandStepErrors } from "../../../hand/errors.js";
import { snoozeHandNote } from "../../../hand/note/markers.js";
import {
  isSnoozeChoice,
  SNOOZE_CHOICES,
  type SnoozeChoice,
  snoozeUntil,
  snoozeWakeLabel,
} from "../../../hand/snooze.js";
import { recordSnooze, type SnoozeRecord } from "../../../hand/snoozeStore.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseHandSnoozeArgs, SNOOZE_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { type HandDeps, productionHandDeps, reportUnparsed, resolvedHomeOf } from "./deps.js";

/**
 * The one step and the one answer a `hand snooze` names, or undefined once it has said which is wrong.
 *
 * @param positionals the step ids the argv carried
 * @param value what `--for` carried
 * @param deps the verb's seams, for the diagnostic
 * @returns the step id and its snooze choice
 */
function snoozeTarget({
  positionals,
  value,
  deps,
}: {
  positionals: readonly string[];
  value: unknown;
  deps: HandDeps;
}): { id: string; choice: SnoozeChoice } | undefined {
  const [id, ...extra] = positionals;
  if (id === undefined || extra.length > 0) {
    deps.writeDiagnostic("hand snooze: name exactly one step id");
    return undefined;
  }
  if (typeof value !== "string" || !isSnoozeChoice(value)) {
    deps.writeDiagnostic(`hand snooze: --for must be one of ${SNOOZE_CHOICES.join(", ")}`);
    return undefined;
  }
  return { choice: value, id };
}

/**
 * Record the owner's snooze and close its note: the record FIRST, because a marker with no record would close the note and
 * leave every list unaware it was snoozed until the next reconcile, while a record with no marker is a snooze whose
 * note is still up — visible, honest.
 *
 * What this does NOT close: two of these racing on one step write the same two paths unlocked, so the slower one's
 * earlier instant can stand — a wake off by the gap between the two presses, never a lost snooze. A per-step lock
 * around both writes would close it; review judged it not worth one.
 *
 * @param home the state home
 * @param record the snooze to store
 * @param deps the verb's seams, for the diagnostic a failed write prints
 * @returns true once both landed
 */
function writeSnooze({ home, record, deps }: { home: string; record: SnoozeRecord; deps: HandDeps }): boolean {
  const recorded = recordSnooze({ home, record });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`hand snooze: ${recorded.error.message}`);
    return false;
  }
  const marker = snoozeHandNote({ choice: record.choice, home, id: record.id, nowIso: record.pressedIso });
  if (marker.isErr()) {
    deps.writeDiagnostic(
      `hand snooze: the snooze is recorded but its note could not be told to close — ${marker.error.message}`,
    );
    return false;
  }
  return true;
}

/**
 * Run `hand snooze` against injected seams.
 *
 * @param rest the argv tail after `hand snooze`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runHandSnooze({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SNOOZE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandSnoozeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(SNOOZE_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const target = snoozeTarget({ deps, positionals: parsed.value.positionals, value: values["for"] });
  if (target === undefined) {
    deps.writeDiagnostic(SNOOZE_USAGE);
    return EXIT_USAGE;
  }
  const { choice, id } = target;
  const home = resolvedHomeOf({ values });
  const read = readOpenHandSteps({ home });
  if (read.isErr()) {
    deps.writeDiagnostic(`hand snooze: ${read.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: read.value.unparsed, verb: "hand snooze" });
  if (!read.value.steps.some((step) => step.id === id)) {
    deps.writeDiagnostic(`hand snooze: ${HandStepErrors.unknownStep({ id }).message}`);
    return EXIT_ERROR;
  }
  const pressedIso = deps.now();
  const until = snoozeUntil({ choice, id, pressedIso });
  if (until.isErr()) {
    deps.writeDiagnostic(`hand snooze: ${until.error.message}`);
    return EXIT_ERROR;
  }
  if (!writeSnooze({ deps, home, record: { choice, id, pressedIso, untilIso: until.value } })) {
    return EXIT_ERROR;
  }
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ choice, id, settled: false, untilIso: until.value }));
    return EXIT_OK;
  }
  deps.writeOut(
    `hand snooze: ${id} snoozed until ${snoozeWakeLabel({ untilIso: until.value })} — still open, the note comes back then`,
  );
  return EXIT_OK;
}

/** `slopweaver hand snooze`. */
export const handSnoozeCommand = defineCommand({
  run: (argv) => runHandSnooze({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
