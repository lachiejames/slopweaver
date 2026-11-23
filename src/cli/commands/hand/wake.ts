/**
 * `slopweaver hand wake` — raise the note again for every snooze whose time has come.
 *
 * A snooze is a promise to come BACK, and nothing resident may keep it (rule 2: no daemon, no cron, no launch
 * agent). So the pass runs where passes already run — the supervisor's tick — and is idempotent: a lapsed snooze
 * on an open step raises its note (`keep` if it is somehow already up), stacked in front of any other note up, and
 * is forgotten once the note is up; one whose raise failed stays in the store and the next pass tries again.
 * The clock is read HERE, in which snoozes have lapsed, and nowhere in `hand push`'s arrival decision.
 */
import { macosOnly, raiseHandNote } from "../../../hand/note/raise.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import { snoozeActive } from "../../../hand/snooze.js";
import { forgetSnooze, readSnoozes, type SnoozeRecord } from "../../../hand/snoozeStore.js";
import type { HandStep } from "../../../hand/step.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { noteKeptDown } from "../../../monitor/kindAnswerGate.js";
import { kindAnswerOffer } from "../../../monitor/noteAnswers.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseHandWakeArgs, VERB_ARG_OFFSET, WAKE_USAGE } from "./core.js";
import {
  bySession,
  type HandDeps,
  productionHandDeps,
  reportReconciled,
  reportUnparsed,
  resolvedHomeOf,
} from "./deps.js";
import { recordKindPressesAndCheckStores } from "./kindPresses.js";

/** What one wake pass did with each lapsed snooze. */
interface WakeReport {
  /** Steps whose note is up again, the snooze forgotten. */
  readonly woken: readonly string[];
  /** Steps still snoozed, not yet due. */
  readonly sleeping: readonly string[];
  /** Steps whose snooze lapsed but whose note the owner's mute or "When it gets worse" keeps down, the snooze forgotten. */
  readonly keptDown: readonly string[];
}

/**
 * Run `hand wake` against injected seams.
 *
 * @param rest the argv tail after `hand wake`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code: 3 when no snooze has lapsed, 1 while a snooze record will not read
 */
export function runHandWake({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WAKE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandWakeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WAKE_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolvedHomeOf({ values });
  const reconciled = reconcileHandSteps({ bySession: bySession({ values }), home, nowIso: deps.now() });
  if (reconciled.isErr()) {
    deps.writeDiagnostic(`hand wake: ${reconciled.error.message}`);
    return EXIT_ERROR;
  }
  reportReconciled({ deps, outcome: reconciled.value, verb: "hand wake" });
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    deps.writeDiagnostic(`hand wake: ${open.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: open.value.unparsed, verb: "hand wake" });
  // A press this pass met and could not honour may still keep a note down, so it fails the pass like a snooze record.
  const pressFaulted =
    recordKindPressesAndCheckStores({
      home,
      open: open.value.steps,
      verb: "hand wake",
      writeDiagnostic: deps.writeDiagnostic,
    }) > 0;
  // A record that will not read holds its step down with a wake time nobody can know, so it is never "nothing
  // lapsed": the pass exits 1 while one stands, and the tick that runs it surfaces the fault instead of a quiet 3.
  const snoozes = readSnoozes({ home });
  snoozes.problems.forEach((problem) => {
    deps.writeDiagnostic(`hand wake: ${problem.message}`);
  });
  return wakeSnoozes({
    deps,
    home,
    json: values["json"] === true,
    records: snoozes.records,
    steps: open.value.steps,
    storeFaulted: snoozes.problems.length > 0 || pressFaulted,
  });
}

/**
 * Wake every lapsed snooze on an open step and report the pass.
 *
 * @param records every snooze record that read
 * @param steps every open step
 * @param storeFaulted whether a snooze record or a press failed to read — the pass then exits 1 whatever it woke
 * @returns the process exit code
 */
function wakeSnoozes({
  deps,
  home,
  json,
  records,
  steps,
  storeFaulted,
}: {
  deps: HandDeps;
  home: string;
  json: boolean;
  records: readonly SnoozeRecord[];
  steps: readonly HandStep[];
  storeFaulted: boolean;
}): number {
  const nowIso = deps.now();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const held = records.filter((record) => byId.has(record.id));
  const sleeping = held.filter((record) => snoozeActive({ nowIso, untilIso: record.untilIso })).map(({ id }) => id);
  const lapsed = held.filter((record) => !snoozeActive({ nowIso, untilIso: record.untilIso }));
  if (lapsed.length === 0) {
    const quiet = reportWake({ deps, json, report: { keptDown: [], sleeping, woken: [] } });
    return storeFaulted ? EXIT_ERROR : quiet;
  }
  const platform = macosOnly({ platform: deps.platform });
  if (platform !== undefined) {
    deps.writeDiagnostic(`hand wake: ${platform.message}`);
    return EXIT_ERROR;
  }
  const { failed, keptDown, woken } = raiseLapsed({ byId, deps, home, json, lapsed });
  const code = reportWake({ deps, json, report: { keptDown, sleeping, woken } });
  return failed || storeFaulted ? EXIT_ERROR : code;
}

/**
 * Raise the note again for each lapsed snooze, forgetting the snooze once its note is up.
 *
 * @param home the state home
 * @param lapsed the snooze records whose wake time has passed, each on an open step
 * @param byId every open step, by id
 * @param deps the verb's seams
 * @param json whether stdout is the one JSON line, so a kept-down step's sentence is not printed beside it
 * @returns the steps woken, the steps whose note the owner's kind answer keeps down, and whether any raise failed
 */
function raiseLapsed({
  home,
  lapsed,
  byId,
  deps,
  json,
}: {
  home: string;
  lapsed: readonly SnoozeRecord[];
  byId: ReadonlyMap<string, HandStep>;
  deps: HandDeps;
  json: boolean;
}): { woken: readonly string[]; keptDown: readonly string[]; failed: boolean } {
  const outcomes = lapsed.map((record) => ({
    id: record.id,
    ...wakeOne({ deps, home, json, step: byId.get(record.id)! }),
  }));
  return {
    failed: outcomes.some((outcome) => outcome.failed),
    keptDown: outcomes.filter((outcome) => outcome.kind === "kept").map(({ id }) => id),
    woken: outcomes.filter((outcome) => outcome.kind === "woken").map(({ id }) => id),
  };
}

/**
 * Wake one lapsed snooze: raise its step's note and forget the snooze, or spend it unraised when the owner's kind answer keeps
 * that note down.
 *
 * @param step the open step the snooze is on
 * @param json whether stdout is the one JSON line, so a kept-down step's sentence is not printed beside it
 * @returns what became of the step, and whether a raise or a forget failed
 */
function wakeOne({ deps, home, json, step }: { deps: HandDeps; home: string; json: boolean; step: HandStep }): {
  kind: "kept" | "woken" | "unraised";
  failed: boolean;
} {
  // A lapsed snooze on a kind the owner has since muted, or a subject the owner holds until worse, is spent without a raise:
  // the later answer is the one that stands, and the card is still on the Queue.
  const kept = noteKeptDown({ home, step });
  if (kept !== undefined) {
    // A snooze record that will not go still stands on disk: named, and the verb fails, never a clean spend.
    const forgetFailed = forgetAndReport({ deps, home, id: step.id }) > 0;
    if (!json) {
      deps.writeOut(`hand wake: ${step.id}'s snooze lapsed, and its note is ${kept}`);
    }
    return { failed: forgetFailed, kind: "kept" };
  }
  const raised = raiseHandNote({
    home,
    kindAnswers: kindAnswerOffer({ step }),
    level: "ordinary",
    nowIso: deps.now(),
    run: deps.run,
    step,
    whenLive: "keep",
  });
  if (raised.isErr()) {
    deps.writeDiagnostic(`hand wake: ${step.id} — ${raised.error.message}`);
    return { failed: true, kind: "unraised" };
  }
  return { failed: forgetAndReport({ deps, home, id: step.id }) > 0, kind: "woken" };
}

/**
 * Forget one spent snooze, naming each problem the store met.
 *
 * @param id the step whose snooze is spent
 * @returns how many problems were named — non-zero means the record may still stand
 */
function forgetAndReport({ home, id, deps }: { home: string; id: string; deps: HandDeps }): number {
  const problems = forgetSnooze({ home, id });
  problems.forEach((problem) => {
    deps.writeDiagnostic(`hand wake: ${problem.message}`);
  });
  return problems.length;
}

/**
 * Print what the pass did.
 *
 * @param report the pass's outcome
 * @param json print it as one JSON line instead of sentences
 * @returns 0 when a snooze had lapsed, 3 when none had
 */
function reportWake({ report, json, deps }: { report: WakeReport; json: boolean; deps: HandDeps }): number {
  const lapsedAny = report.woken.length + report.keptDown.length > 0;
  if (json) {
    deps.writeOut(JSON.stringify(report));
    return lapsedAny ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  }
  if (!lapsedAny) {
    deps.writeOut(`hand wake: no snooze has lapsed (${String(report.sleeping.length)} still snoozed)`);
    return EXIT_EXPECTED_EMPTY;
  }
  report.woken.forEach((id) => {
    deps.writeOut(`hand wake: ${id} is back on the owner's screen — its snooze lapsed`);
  });
  return EXIT_OK;
}

/** `slopweaver hand wake`. */
export const handWakeCommand = defineCommand({
  run: (argv) => runHandWake({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
