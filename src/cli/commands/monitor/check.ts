/**
 * `slopweaver monitor check` — one pass of the whole lane.
 *
 * Reads every monitor over this machine's own ledgers, folds what it sees against the hand register, and —
 * with `--fire` — posts what ARRIVED and settles what is gone. `--push` then hands the push lane the same
 * home, so one banner names what arrived. A floating monitor (`monitor list` names each one's delivery — `recipe-stopped` and
 * `recipe-repairing` among them) also raises its step's note under `--fire`, through {@link monitorNoteRaiser}, so it
 * reaches the owner's screen with or without `--push`.
 *
 * ## A backlog is one card, because a monitor posts one card for its set
 *
 * The page the owner ruled on offered three ways to handle a first run over a standing backlog, and (i) — one card
 * naming the backlog, then arrival-only forever — is what the owner left in place. The monitor's own shape delivers
 * it: every monitor but `prs-backed-up` folds its whole set into ONE subject, and the pass refuses a reading
 * that does not (`../../../monitor/pass.ts` § readingShapeRefusal). Twenty parked runs used to be twenty rows;
 * that was 25 notes in one second, each a question already on the owner's queue. Now it is one card
 * naming the count, re-posted only when the set changes.
 *
 * ## `--fire` is opt-in, and the default is a rehearsal
 *
 * A pass that writes by default is one nobody can run to find out what it would do. Without `--fire` every
 * action is reported as `would post` / `would settle` and the register is not opened for writing at all.
 */
import { macosOnly, raiseHandNote } from "../../../hand/note/raise.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import type { HandStep } from "../../../hand/step.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { parseIsoMs } from "../../../lib/date.js";
import { err, ok } from "../../../lib/result.js";
import { holdFiredPassLock } from "../../../monitor/firedPassLock.js";
import { keptDownRaiser } from "../../../monitor/kindAnswerGate.js";
import { kindAnswerOffer } from "../../../monitor/noteAnswers.js";
import { type NoteRaiser, type PassOutcome, runMonitorPass } from "../../../monitor/pass.js";
import { isMonitorId } from "../../../monitor/registry.js";
import type { MonitorInputs } from "../../../monitor/sources.js";
import type { MonitorId } from "../../../monitor/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { flag, type HandDeps, reportReconciled, resolvedHomeOf } from "../hand/deps.js";
import { recordKindPressesAndCheckStores } from "../hand/kindPresses.js";
import { runHandPush } from "../hand/push.js";

import { withFiredStages } from "./checkFiredStages.js";
import { reportPass } from "./checkReport.js";
import { CHECK_USAGE, parseMonitorCheckArgs, VERB_ARG_OFFSET } from "./core.js";
import { bySession, type MonitorDeps, productionMonitorDeps } from "./deps.js";

/**
 * The instant this pass judges at: `--now` when one was given, else the machine clock.
 *
 * @param values the parsed flag map
 * @param deps the verb's seams, for its clock
 * @returns the instant as both spellings, or the refusal when `--now` was not an ISO instant
 */
export function passInstant({
  values,
  deps,
}: {
  values: Readonly<Record<string, unknown>>;
  deps: MonitorDeps;
}): { readonly nowIso: string; readonly nowMs: number } | { readonly problem: string } {
  const supplied = flag({ name: "now", values });
  if (supplied === undefined) {
    const nowIso = deps.now();
    const nowMs = parseIsoMs({ tsIso: nowIso });
    if (nowMs === undefined) {
      return { problem: `the clock answered ${nowIso}, which is not an ISO-8601 instant` };
    }
    return { nowIso, nowMs };
  }
  const nowMs = parseIsoMs({ tsIso: supplied });
  if (nowMs === undefined) {
    return { problem: `--now ${supplied} is not an ISO-8601 instant` };
  }
  return { nowIso: supplied, nowMs };
}

/** The pass's instant and the one monitor `--only` names, or the refusal of whichever flag was malformed. */
function passScope({
  values,
  deps,
}: {
  values: Readonly<Record<string, unknown>>;
  deps: MonitorDeps;
}):
  | { readonly nowIso: string; readonly nowMs: number; readonly only: MonitorId | undefined }
  | { readonly problem: string } {
  const instant = passInstant({ deps, values });
  if ("problem" in instant) {
    return instant;
  }
  const only = flag({ name: "only", values });
  if (only !== undefined && !isMonitorId(only)) {
    return { problem: `--only ${only} is no declared monitor — \`slopweaver monitor list\` names them` };
  }
  return { ...instant, only };
}

/**
 * The note raiser a floating monitor's newly posted steps go through: the hand register's own raise, at the
 * monitor's window level.
 *
 * `whenLive: "keep"` is what keeps `--push` from drawing a second panel: the push lane raises the top arrival
 * the same way, finds this step's note already wanted, and keeps it. Every other note stays up: a second arrival
 * in the same pass stacks in front of the first, in the next cascade slot (the owner's reversal).
 *
 * The raise judges liveness at the HAND clock, never at `--now`: it compares against file times the machine
 * wrote, so a replayed instant would read a note that just launched as long dead and draw another.
 *
 * @param hand the hand register's seams — clock, platform, launcher
 * @param home the state home the note's liveness files live under
 * @returns the raiser the pass calls once per newly posted floating step
 */
export function monitorNoteRaiser({ hand, home }: { hand: HandDeps; home: string }): NoteRaiser {
  return ({ step, level }) => {
    const platform = macosOnly({ platform: hand.platform });
    if (platform !== undefined) {
      // A fact about the machine rather than a failed raise, reported exactly as `hand post` reports it.
      return ok(platform.message);
    }
    const raised = raiseHandNote({
      home,
      kindAnswers: kindAnswerOffer({ step }),
      level,
      nowIso: hand.now(),
      run: hand.run,
      step,
      whenLive: "keep",
    });
    if (raised.isErr()) {
      return err(raised.error.message);
    }
    switch (raised.value.kind) {
      case "launched":
        return ok(`floating, top right in the cascade (slot ${String(raised.value.slot)})`);
      case "kept":
        return ok("already floating — its note is up, so no second one was drawn");
    }
  };
}

/**
 * Run `monitor check` against injected seams.
 *
 * @param rest the argv tail after `monitor check`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runMonitorCheck({ rest, deps }: { rest: readonly string[]; deps: MonitorDeps }): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "monitor", rest, verb: "check" });
  if (gated !== undefined) {
    return gated;
  }
  return checkPass({ deps, rest });
}

/** One `monitor check` pass, past the ruling gate {@link runMonitorCheck} asks first. */
async function checkPass({ rest, deps }: { rest: readonly string[]; deps: MonitorDeps }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(CHECK_USAGE);
    return EXIT_OK;
  }
  const parsed = parseMonitorCheckArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(CHECK_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const scope = passScope({ deps, values });
  if ("problem" in scope) {
    deps.writeDiagnostic(`monitor check: ${scope.problem}`);
    return EXIT_USAGE;
  }
  const home = resolvedHomeOf({ values });
  const push = values["push"] === true;
  const fire = values["fire"] === true || push;
  if (!fire) {
    return passBody({ deps, fire, home, push, scope, stillHeld: () => true, values });
  }
  // A fired pass holds the home's one fired-pass lock from its Done reconciliation to its last settle, so two
  // producers firing at once never both read "no card open" and post the same fault twice (`firedPassLock.ts`).
  const held = await holdFiredPassLock({ home, now: deps.hand.now, wait: waitMs });
  if (held.isErr()) {
    deps.writeDiagnostic(`monitor check: ${held.error}`);
    return EXIT_ERROR;
  }
  try {
    return await passBody({ deps, fire, home, push, scope, stillHeld: held.value.stillHeld, values });
  } finally {
    held.value.release();
  }
}

/** Wait on the machine clock — the fired-pass lock's backoff. */
async function waitMs({ ms }: { ms: number }): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** One parsed pass: its Done reconciliation when fired, the open cards, the pass, and its report. */
async function passBody({
  deps,
  fire,
  home,
  push,
  scope,
  stillHeld,
  values,
}: {
  deps: MonitorDeps;
  fire: boolean;
  home: string;
  push: boolean;
  scope: { readonly nowIso: string; readonly nowMs: number; readonly only: MonitorId | undefined };
  stillHeld: () => boolean;
  values: Readonly<Record<string, unknown>>;
}): Promise<number> {
  const open = openCards({ deps, fire, home, values });
  if (open === undefined) {
    return EXIT_ERROR;
  }
  const { postedIds, steps } = open;
  // The owner's "Never for this kind" and "When it gets worse" presses, recorded before anything below asks whether to raise a
  // note. A store failure keeps the press on disk, its note reads dismissed until the next pass, and the pass exits 1.
  const pressFaulted =
    fire &&
    recordKindPressesAndCheckStores({
      home,
      open: steps,
      verb: "monitor check",
      writeDiagnostic: deps.writeDiagnostic,
    }) > 0;
  const { outcome, stageFaulted } = await firedOrRehearsed({
    deps,
    fire,
    home,
    open: steps,
    postedIds,
    scope,
    stillHeld,
    values,
  });
  reportPass({ json: values["json"] === true, outcome, writeOut: deps.writeOut });
  // A hold the escalation stage could not move may still keep a note down, exactly as a press it could not honour.
  const faulted = pressFaulted || stageFaulted;
  if (!push) {
    return faulted ? EXIT_ERROR : EXIT_OK;
  }
  const pushed = runHandPush({
    deps: deps.hand,
    rest: ["--home", home, "--by-session", bySession({ values })],
  });
  return faulted ? EXIT_ERROR : pushed;
}

/** The open cards a pass reads, the owner's Done reconciled into rows first when it fires; `undefined` once a read failed. */
function openCards({
  deps,
  fire,
  home,
  values,
}: {
  deps: MonitorDeps;
  fire: boolean;
  home: string;
  values: Readonly<Record<string, unknown>>;
}): { postedIds: readonly string[]; steps: readonly HandStep[] } | undefined {
  if (fire) {
    // The owner's Done is a marker the note writes, so a fired pass turns it into a row first: otherwise a card the owner closed
    // still reads open, the pass settles it as its own, and `meeting-prep-due` posts it again. At the hand clock,
    // never `--now`, because the row records when the owner's press landed. A rehearsal writes nothing, so it skips this.
    const reconciled = reconcileHandSteps({ bySession: bySession({ values }), home, nowIso: deps.hand.now() });
    if (reconciled.isErr()) {
      deps.writeDiagnostic(`monitor check: ${reconciled.error.message}`);
      return undefined;
    }
    reportReconciled({ deps: deps.hand, outcome: reconciled.value, verb: "monitor check" });
  }
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    deps.writeDiagnostic(`monitor check: ${open.error.message}`);
    return undefined;
  }
  // A skipped line is reported HERE and not swallowed: this pass decides whether a monitor's card is
  // already open, so a posting it could not read makes it post a duplicate card for a step the owner has.
  open.value.unparsed.forEach((problem) => {
    deps.writeDiagnostic(`monitor check: skipped — ${problem.message}`);
  });
  return open.value;
}

/**
 * The pass itself, and — only when it FIRED — a lost notice's note raised again and the fleet-health note's memory
 * moved after it: a rehearsal draws nothing, and must leave the news for the pass that posts it
 * (`../../../monitor/fleetHealthShown.ts`).
 */
async function firedOrRehearsed({
  deps,
  fire,
  home,
  open,
  postedIds,
  scope,
  stillHeld,
  values,
}: {
  deps: MonitorDeps;
  fire: boolean;
  home: string;
  open: readonly HandStep[];
  postedIds: readonly string[];
  scope: { readonly nowIso: string; readonly nowMs: number; readonly only: MonitorId | undefined };
  stillHeld: () => boolean;
  values: Readonly<Record<string, unknown>>;
}): Promise<{ outcome: PassOutcome; stageFaulted: boolean }> {
  const { nowIso } = scope;
  const rawRaiser = monitorNoteRaiser({ hand: deps.hand, home });
  // Every automatic raise asks the owner's kind answers first; only the escalation stage raises past them, because a held
  // subject reading worse is exactly what the hold waited for.
  const raiseNote = keptDownRaiser({ home, raiseNote: rawRaiser });
  const passed = await runMonitorPass({
    consoleBase: deps.hand.consoleBase(),
    fire,
    inputs: passInputs({ deps, home, scope, values }),
    nowIso,
    openIds: open.map((step) => step.id),
    openWithDecision: new Set(open.filter((step) => step.decision !== undefined).map((step) => step.id)),
    postedBy: bySession({ values }),
    postedIds,
    openPage: ({ url }) => deps.openPage({ home, url }),
    raiseNote,
    stillHeld,
  });
  if (!fire) {
    return { outcome: passed, stageFaulted: false };
  }
  return withFiredStages({
    home,
    now: deps.hand.now,
    open,
    passed,
    platform: deps.hand.platform,
    raiseNote,
    rawRaiser,
    stillHeld,
    writeDiagnostic: deps.writeDiagnostic,
  });
}

/** What every monitor reads, off the verb's seams and the pass's scope. */
function passInputs({
  deps,
  home,
  scope,
  values,
}: {
  deps: MonitorDeps;
  home: string;
  scope: { readonly nowIso: string; readonly nowMs: number; readonly only: MonitorId | undefined };
  values: Readonly<Record<string, unknown>>;
}): MonitorInputs {
  return {
    claudeProbesPort: deps.claudeProbesPort,
    claudeProjectsDir: deps.claudeProjectsDir,
    fleetCapPort: deps.fleetCapPort,
    home,
    landingPath: flag({ name: "landing", values }),
    nowIso: scope.nowIso,
    nowMs: scope.nowMs,
    only: scope.only,
    orgHealthPort: deps.orgHealthPort,
    pagePublished: deps.pagePublished,
    processes: deps.processes,
    registerPort: deps.registerPort,
    signInPort: deps.signInPort,
  };
}

/** `slopweaver monitor check`. */
export const monitorCheckCommand = defineCommand({
  run: (argv) => runMonitorCheck({ deps: productionMonitorDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
