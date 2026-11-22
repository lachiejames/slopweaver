/**
 * What running ONE due row costs, per KIND — the executors `automation run-due` dispatches to, and the
 * edges they run against.
 *
 * Split out of `./runDue.ts` when a third kind landed and that file crossed the size ratchet. The seam is
 * real rather than arithmetic: everything here answers "what does this ONE row do", and everything left
 * behind answers "which rows are due, in what order, and what is stamped". The two questions have
 * different reasons to change — a new kind touches only this file, and a change to selection, claims or
 * stamping touches only that one.
 *
 * ## The card kinds live next door
 *
 * `alert-summary` and `datadog-alert-digest` are both a READ leg whose stdout is a door-routed POST leg's
 * input, and both live in `./cardRowRunners.ts`. `metrics-push` has its own file, `./metricsPushRowRunner.ts`,
 * because its seam differs: its produce leg writes a FILE rather than a form on stdout. None of the three is
 * folded into a generic runner, because they share a SHAPE and nothing else — different planners, different
 * flags, different refusals, and a failure line that has to name the verb a reader should run by hand.
 *
 * ## `hygiene-sweep` runs only in the session seated for it
 *
 * `./hygieneRowRunner.ts` reads the landing packet, publishes it under `live/hygiene/`, and prints it for the
 * ONE visible session `automation seat` opened — like `resync`, it reaches this dispatch only under the row's
 * live claim token, and it never launches anything itself.
 *
 * ## `investigate` is the ask lane's own front door
 *
 * `investigate` is the one kind whose procedure comes from its row rather than from this repository, so it
 * does not run a procedure at all: it ASKS. `../../../live/automation/investigate.ts` posts the row's question
 * into its own channel and briefs the posted message as an ask, and every decision after that is the ask
 * lane's — one lifecycle, one dispatcher, one form for a tag and a due row alike. Its executor is `./investigateRowRunner.ts`.
 *
 * ## Nothing here spawns a model
 *
 * Each executor runs slopweaver VERBS: one dispatched by argv runs in a child process of this same CLI
 * (`./runDueVerbProcess.ts`), and a collected leg calls its verb's runner here. A child is another slopweaver verb
 * process and nothing else, and `no-headless` recognizes that one spawn by its exact shape.
 * `kinds.ts`'s header carries the ruling that made it so: the kinds exist precisely so a recurring job is a
 * reviewed, gated verb rather than a prompt. The
 * investigate executor is no exception — it stops at the brief, and whether that ask costs a session is
 * judged by a visible session, never here.
 */
import { randomUUID } from "node:crypto";
import type { Result } from "#lib/result.js";
import type { FleetCeilingReport } from "../../../capacity/seatCeiling.js";
import { readFleetCeilingReport } from "../../../capacity/seatCeilingRead.js";
import { logger } from "../../../lib/logger.js";
import { ALERT_SUMMARY_KIND } from "../../../live/automation/alertSummary.js";
import { DATADOG_ALERT_DIGEST_KIND } from "../../../live/automation/datadogAlertDigest.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeDefinitionRun } from "../../../live/automation/definitionRunStore.js";
import type { FleetCeilingWhy } from "../../../live/automation/fleetCeilingAsk.js";
import type { FleetCeilingDelivery } from "../../../live/automation/fleetCeilingReport.js";
import { type ProcessAlive, recipeHolderAlive } from "../../../live/automation/holderLiveness.js";
import { INVESTIGATE_KIND } from "../../../live/automation/investigate.js";
import {
  ALIGNMENT_BRIEFING_KIND,
  BUMP_FIX_KIND,
  CALL_ASSESSMENT_KIND,
  ERROR_TRACKING_BATCH_KIND,
  FLEET_CEILING_REPORT_KIND,
  HYGIENE_SWEEP_KIND,
  INBOX_TRIAGE_KIND,
  LINEAR_BRIEFING_KIND,
  OWED_REPLY_KIND,
  RESYNC_KIND,
  THREAD_CHASE_KIND,
} from "../../../live/automation/kinds.js";
import { METRICS_PUSH_KIND } from "../../../live/automation/metricsPush.js";
import { refuseVerbRunPostTargets } from "../../../live/automation/postTarget.js";
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import { planVerbRun, VERB_RUN_KIND, verbRunArgv } from "../../../live/automation/verbRun.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import { EXIT_DEFERRED, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { productionDatadogAlertDigestDeps, runDatadogAlertDigestWith } from "../datadog/alertDigestRun.js";
import { runHandoverRegister } from "../handover/askRowRun.js";
import { productionSlackAlertSummaryDeps, runSlackAlertSummary } from "../slack/alertSummaryRun.js";
import { productionSlackWriteDeps, runSlackWrite } from "../slack/run.js";
import { promptChannelFromProfile } from "../slack/wiring.js";
import { runAlertDigestRow, runAlertSummaryRow } from "./cardRowRunners.js";
import { type CollectedLeg, collectLeg } from "./collectLeg.js";
import { deliverFleetCeiling, readFleetWhyForCeiling, withdrawFleetCeilingCard } from "./fleetCeilingDelivery.js";
import {
  type FleetCeilingCardReceipt,
  type FleetCeilingDelivered,
  type FleetCeilingDeliveryError,
} from "./fleetCeilingDeliveryErrors.js";
import { runFleetCeilingRow } from "./fleetCeilingRowRunner.js";
import { productionGithubLandingRead, runHygieneSweepRow } from "./hygieneRowRunner.js";
import { runInvestigateRow } from "./investigateRowRunner.js";
import { runMetricsPushRow } from "./metricsPushRowRunner.js";
import { postTargetRefusedLine } from "./postTargetLeg.js";
import { productionRunDueSignalTrap } from "./runDueSignal.js";
import { currentCliLaunch, runVerbInChild, verbChildEnv } from "./runDueVerbProcess.js";
import { type FailureHoldDeps, failureFindingCheckout } from "./slotFailureHold.js";

/** Every kind whose row runs its `params.argv` exactly as a `verb-run` row does, wherever it is seated. */
const VERB_RUN_SHAPED_KINDS: ReadonlySet<string> = new Set([
  VERB_RUN_KIND,
  RESYNC_KIND,
  BUMP_FIX_KIND,
  ERROR_TRACKING_BATCH_KIND,
  THREAD_CHASE_KIND,
  OWED_REPLY_KIND,
  CALL_ASSESSMENT_KIND,
  INBOX_TRIAGE_KIND,
  LINEAR_BRIEFING_KIND,
  ALIGNMENT_BRIEFING_KIND,
]);

/** The injected edges, so the tick is testable with plain fakes. */
export interface RecipeRunDueDeps {
  /** The checkout a failed firing's finding names as its `repo:` — `failureFindingCheckout` in production. */
  readonly checkoutFor: FailureHoldDeps["checkoutFor"];
  readonly now: () => string;
  /**
   * Runs one verb's full argv and answers its exit code and the tail of what the verb wrote to stderr, so a failed
   * firing's record can say WHY (`../../../live/automation/verbFailureWhy.ts` carries the incident). In production
   * the verb runs in a CHILD process with default signal disposition (`./runDueVerbProcess.ts`), never through
   * `cli/main.ts` in this one. Every recipe step that dispatches a verb by argv runs through it — a `verb-run`
   * row, a card's post, `metrics-push`'s two legs, an `investigate` brief; the read and post legs that collect stdout
   * call their verb's runner in this process through `./collectLeg.ts` instead.
   */
  readonly runVerbKeepingDiagnostics: (
    argv: readonly string[],
  ) => Promise<{ readonly exitCode: number; readonly diagnostics: string }>;
  /**
   * Runs `slack alert-summary` and answers the form document it emitted, rather than printing it.
   *
   * A separate seam from {@link RecipeRunDueDeps.runVerbKeepingDiagnostics} because this leg's OUTPUT is the
   * input to the next one, a typed form rather than text to stream. In production this is the read verb's own
   * exported runner with its `writeOut` sink collected instead — the same code path, one edge swapped. Its
   * stderr tail comes back beside it, as every collected leg's does, so a failed read's record says why.
   */
  readonly runAlertSummaryRead: (options: { readonly rest: readonly string[] }) => Promise<CollectedLeg>;
  /**
   * Runs `datadog alert-digest` and answers the form document it emitted, rather than printing it.
   *
   * A separate seam for exactly the reason {@link RecipeRunDueDeps.runAlertSummaryRead} is one: this leg's
   * OUTPUT is the next leg's input, and the dispatcher writes stdout to the process's own file descriptor.
   */
  readonly runAlertDigestRead: (options: { readonly rest: readonly string[] }) => Promise<CollectedLeg>;
  /**
   * Runs `slack post` and answers the `--json` document it emitted, rather than printing it.
   *
   * A third seam of the same shape as the two above, and for the same reason: this leg's OUTPUT is the next
   * leg's input. An `investigate` row's opening message is the ask's own ADDRESS, so its ts has to come
   * back into this process — a post whose document went to the fd would leave the tick unable to say which
   * ask it had just created.
   */
  readonly runSlackPost: (options: { readonly rest: readonly string[] }) => Promise<CollectedLeg>;
  /**
   * Runs `github landing` and answers the `--json` packet it emitted, rather than printing it — a
   * `hygiene-sweep` row publishes that packet before its seated session reads it (`./hygieneRowRunner.ts`).
   */
  readonly runGithubLandingRead: (options: { readonly rest: readonly string[] }) => Promise<CollectedLeg>;
  /** Measures the plans' unused week for a `fleet-ceiling-report` row — `fleet ceiling`'s own reader. */
  readonly readFleetCeilingReport: (options: {
    readonly home: string;
    readonly days: number;
    readonly nowIso: string;
  }) => Promise<Result<FleetCeilingReport>>;
  /** What held the fleet back over the hour before a `fleet-ceiling-report` slot — `fleet why`'s own reader. */
  readonly readFleetWhy: (options: { readonly home: string; readonly nowIso: string }) => FleetCeilingWhy;
  /**
   * Publishes a `fleet-ceiling-report` morning's page, places its Queue card once and withdraws yesterday's —
   * `./fleetCeilingDelivery.ts`. A seam so a test asserts the plan handed over without writing a board.
   */
  readonly deliverFleetCeiling: (options: {
    readonly delivery: FleetCeilingDelivery;
    readonly home: string;
    readonly nowIso: string;
  }) => Promise<Result<FleetCeilingDelivered, FleetCeilingDeliveryError>>;
  /**
   * Withdraws the card an earlier attempt at a `fleet-ceiling-report` slot left open, for a retry whose report could
   * not be read at all — `./fleetCeilingDelivery.ts`. The one card path a firing that never delivers still takes.
   */
  readonly withdrawFleetCeilingCard: (options: {
    readonly home: string;
    readonly slug: string;
  }) => Promise<Result<FleetCeilingCardReceipt, FleetCeilingDeliveryError>>;
  /**
   * Mints the holder token an attempt at one cadence firing is taken under — `./slotRun.ts`.
   *
   * Injected rather than minted inside the ledger so a test can pin it and assert on the exact token a
   * settle quotes back, which is the check that stops a late run closing a successor's attempt.
   */
  readonly mintId: () => string;
  /**
   * Writes the dead-letter board row for a firing that gave up — `slopweaver handover register`.
   *
   * A board row rather than a surface of its own: `AGENTS.md` says the board is the ONLY register of what
   * is in flight, "never write a status document, add a row".
   */
  readonly register: (args: { readonly argv: readonly string[] }) => Promise<number>;
  /**
   * The environment the DOORS read, so an escape hatch an operator opened for one tick still opens.
   *
   * Injected rather than read from `process.env` at the point of use for the reason every other door does
   * it: a hatch a test cannot open is a hatch no test can prove still works. `slack post` takes the same
   * seam as `SlackWriteDeps.doorEnv`, and an `investigate` row's plan-time voice check reads the same
   * session off it, so one `voice-rules` grant taken before `slopweaver automation run-due` lifts the
   * refusal in both legs rather than in one.
   */
  readonly doorEnv: () => Readonly<Record<string, string | undefined>>;
  /**
   * The ONE conversation an automation's PROMPT may be posted into, from `slackBot.promptChannel`.
   *
   * A seam rather than a direct profile read for the reason {@link RecipeRunDueDeps.doorEnv} is one: a
   * refusal a test cannot reach is a refusal no test can prove still fires. `undefined` on an install that
   * has configured none, which REFUSES every `investigate` row rather than asking somewhere public.
   */
  readonly promptChannel: (args: { readonly home: string }) => string | undefined;
  /** Whether a stored slot attempt's holder pid still runs — `recipeHolderAlive` in production. */
  readonly processAlive: ProcessAlive;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run a verb in a child process (`./runDueVerbProcess.ts` says why), keeping the tail of what it wrote to stderr
 * beside its exit code. The trap is installed first, so even a seated row's child, never armed, dies with this
 * process. A child that cannot be launched THROWS with its reason, which the row's `THREW` line reports, exactly as
 * a leg that threw in this process did; it never falls back to running the verb here.
 *
 * A verb that throws INSIDE the child is a different case, and the child's own CLI boundary (`cli/main.ts`'s
 * `runCliProcess`) catches it exactly as it does on a typed invocation: it logs the message, adds at most one hint
 * line, and exits 1. So the row records `exit 1 · why: <that message>`, a typed run's own answer, rather than the
 * exit-less `THREW` the in-process call produced; both settle the firing failed through the same path.
 */
const runVerbInChildKeepingStderr: RecipeRunDueDeps["runVerbKeepingDiagnostics"] = async (argv) => {
  productionRunDueSignalTrap().install();
  const env = verbChildEnv();
  if (env.isErr()) {
    throw new Error(env.error.join("; "));
  }
  const ran = await runVerbInChild({ argv, env: env.value, launch: currentCliLaunch() });
  if (ran.isErr()) {
    throw new Error(ran.error.message);
  }
  return { diagnostics: ran.value.diagnostics, exitCode: ran.value.exitCode };
};

/** `datadog alert-digest` run in-process, its lines collected rather than printed. */
const alertDigestReadCollectingLines: RecipeRunDueDeps["runAlertDigestRead"] = ({ rest }) =>
  collectLeg({
    run: ({ writeOut }) =>
      runDatadogAlertDigestWith({ deps: { ...productionDatadogAlertDigestDeps(), writeOut }, rest }),
  });

/**
 * The real edges.
 *
 * @returns the production dependencies, dispatching through the CLI's own router
 * @internal
 */
export function productionRecipeRunDueDeps(): RecipeRunDueDeps {
  return {
    checkoutFor: failureFindingCheckout,
    doorEnv: () => process.env,
    mintId: () => randomUUID(),
    promptChannel: ({ home }) => promptChannelFromProfile({ home }),
    now: () => new Date().toISOString(),
    readFleetCeilingReport,
    readFleetWhy: readFleetWhyForCeiling,
    deliverFleetCeiling: (options) => deliverFleetCeiling({ ...options, publish: productionPublishPage }),
    withdrawFleetCeilingCard,
    register: ({ argv }) => runHandoverRegister(["node", "slopweaver", "handover", "register", ...argv]),
    runAlertDigestRead: alertDigestReadCollectingLines,
    runAlertSummaryRead: ({ rest }) =>
      collectLeg({
        run: ({ writeOut }) => runSlackAlertSummary({ deps: { ...productionSlackAlertSummaryDeps(), writeOut }, rest }),
      }),
    runGithubLandingRead: productionGithubLandingRead,
    runSlackPost: ({ rest }) =>
      collectLeg({
        run: ({ writeOut }) =>
          runSlackWrite({ argv: rest, deps: { ...productionSlackWriteDeps(), out: writeOut }, verb: "post" }),
      }),
    runVerbKeepingDiagnostics: runVerbInChildKeepingStderr,
    processAlive: recipeHolderAlive,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** What running one due row produced. */
export interface RowOutcome {
  readonly recipeId: string;
  readonly failed: boolean;
  /** True only when the verb actually reached the dispatcher — a refusal and a dry run are both false. */
  readonly ran: boolean;
  /** The verb's exit code, or `null` when it never ran. */
  readonly exitCode: number | null;
  readonly line: string;
  /**
   * Lines printed UNDER {@link RowOutcome.line}, when a row has something a reader must act on that does
   * not belong in a one-line summary — a shots row's capture list is the only one today.
   */
  readonly detail: readonly string[];
}

/**
 * Run one `verb-run` row: resolve its plan, then hand the argv to the dispatcher.
 *
 * `--dry-run` prints the plan and runs NOTHING here, because the verb a row selects is arbitrary and this
 * kind has no way to ask it to withhold its own effect — see {@link runAlertSummaryRow}, whose write leg
 * does, for the other half of that contrast.
 *
 * @param definition the due row
 * @param deps the injected edges
 * @param dryRun whether to plan the row and stop short of running it
 * @param home the state home this tick is running over, which is where the owner's DM id is configured
 * @param base the shared not-yet-run outcome fields
 * @returns what happened, ready to print
 */
async function runVerbRunRow({
  definition,
  deps,
  dryRun,
  home,
  base,
}: {
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  home: string;
  base: Omit<RowOutcome, "line">;
}): Promise<RowOutcome> {
  const plan = planVerbRun({ definition });
  if (plan.isErr()) {
    return { ...base, failed: true, line: `recipe ${definition.recipeId} · REFUSED · ${plan.error.message}` };
  }
  // The 291-8x tripwire for the one kind whose destination is a word in an arbitrary argv rather than a
  // field. It is over- and under-inclusive by construction and `postTarget.ts` says how — rule 3's "a block
  // confirms you were wrong, its absence means nothing" is exactly the standing of this check.
  const targets = refuseVerbRunPostTargets({ definition, dmChannel: deps.promptChannel({ home }) });
  if (targets.isErr()) {
    return {
      ...base,
      failed: true,
      line: postTargetRefusedLine({ error: targets.error, recipeId: definition.recipeId }),
    };
  }
  const argv = plan.value.argv.join(" ");
  if (dryRun) {
    return { ...base, line: `recipe ${definition.recipeId} · would run · slopweaver ${argv}` };
  }
  const { diagnostics, exitCode } = await deps.runVerbKeepingDiagnostics(verbRunArgv({ plan: plan.value }));
  if (exitCode === EXIT_DEFERRED) {
    // The verb ran and declined to act yet, so this row has NOT done its work: `ran` stays false, which is
    // the same field `runDue` reads to decide whether to stamp. Leaving it true and filtering on the code
    // downstream would put the same decision in two places, and the one that drifted would be the one that
    // silenced a row for a day. See `../../exitCodes.ts`'s `EXIT_DEFERRED`. The verb's closing stderr is what it
    // was waiting on, so it rides the line onto the slot record exactly as a failure's cause does.
    return {
      ...base,
      exitCode,
      line: appendVerbFailureWhy({
        diagnostics,
        line: `recipe ${definition.recipeId} · DEFERRED · slopweaver ${argv} · not stamped, still due`,
      }),
    };
  }
  return ranVerbOutcome({ argv, base, diagnostics, exitCode, recipeId: definition.recipeId });
}

/**
 * The outcome of a `verb-run` row whose verb ran to an exit other than {@link EXIT_DEFERRED}.
 *
 * @param argv the verb's argv, joined for the line
 * @param base the shared not-yet-run outcome fields
 * @param diagnostics the tail of what the verb wrote to stderr
 * @param exitCode the verb's exit code
 * @param recipeId the row the line names
 * @returns the graded outcome, whose line carries the verb's own closing words when it failed
 */
function ranVerbOutcome({
  argv,
  base,
  diagnostics,
  exitCode,
  recipeId,
}: {
  argv: string;
  base: Omit<RowOutcome, "line">;
  diagnostics: string;
  exitCode: number;
  recipeId: string;
}): RowOutcome {
  // EXIT_EXPECTED_EMPTY is the verb working as designed — it ran its whole pipeline and found nothing to do —
  // and `slotSettle.ts`'s `settleSlot` already retires the firing on it exactly as on a zero. Grading it failed
  // HERE would stamp the row as succeeded and exited the tick 1 in the same
  // breath: MEASURED on `resync-corpus-fathom`, whose `refresh --source fathom --store` deduped its one
  // transcript, wrote 0 rows and exited 3 — a quiet window reported as a hard failure every tick it stayed
  // quiet. `../../exitCodes.ts` § EXIT_EXPECTED_EMPTY; the line says so a reader does not have to know 3.
  const nothingToDo = exitCode === EXIT_EXPECTED_EMPTY;
  const exitLabel = nothingToDo ? `exit ${String(exitCode)} (nothing to do)` : `exit ${String(exitCode)}`;
  const failed = exitCode !== EXIT_OK && !nothingToDo;
  const ranLine = `recipe ${recipeId} · ran · slopweaver ${argv} · ${exitLabel}`;
  // This line IS the slot record's `detail`, so a failure carries the verb's own closing words onto the
  // record, the COOLING line and any dead-letter row — never only its exit code.
  return {
    ...base,
    exitCode,
    failed,
    line: failed ? appendVerbFailureWhy({ diagnostics, line: ranLine }) : ranLine,
    ran: true,
  };
}

/**
 * Run one due row, or say exactly why it could not be run.
 *
 * A row selecting a kind this tick does not execute is REPORTED rather than refused: a SPAWN-shaped row is
 * only this tick's when the caller holds its claim token, and a kind nothing implements is nobody's — a tick
 * that failed because a row names a kind this build has no executor for would refuse a whole sweep over
 * one unrunnable row.
 *
 * @param definition the due row
 * @param deps the injected edges
 * @param dryRun whether to withhold this row's effect
 * @param home the state home this tick is running over
 * @returns what happened, ready to print
 */
export async function runOneRow({
  definition,
  deps,
  dryRun,
  home,
  media,
  slotIso,
  priorRun,
}: {
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  home: string;
  /** The graded captures a seated session took for a shots row; empty on every ordinary tick. */
  media: readonly string[];
  /** The cadence firing this run covers — the identity every write leg delivers under. */
  slotIso: string;
  /** The row's run record, absent when no firing of it has ever settled — a card row's day-one trigger. */
  priorRun: RecipeDefinitionRun | undefined;
}): Promise<RowOutcome> {
  const base = { detail: [], exitCode: null, failed: false, ran: false, recipeId: definition.recipeId };
  // Every seated worklist kind in `VERB_RUN_SHAPED_KINDS` is planned and run as a `verb-run` row is — the
  // same wrapper verb, the same planner, the same door. What differs is WHERE, and that is decided before this
  // function is reached: `runDue.ts` only hands a spawn-shaped row over when the caller proved it holds the row's
  // live claim, which is what makes this process the session that was seated for it.
  if (definition.kind === HYGIENE_SWEEP_KIND) {
    return runHygieneSweepRow({ base, definition, deps, dryRun, home });
  }
  if (VERB_RUN_SHAPED_KINDS.has(definition.kind)) {
    return runVerbRunRow({ base, definition, deps, dryRun, home });
  }
  if (definition.kind === ALERT_SUMMARY_KIND) {
    return runAlertSummaryRow({ base, definition, deps, dryRun, home, media, priorRun, slotIso });
  }
  if (definition.kind === DATADOG_ALERT_DIGEST_KIND) {
    return runAlertDigestRow({ base, definition, deps, dryRun, home, media, priorRun, slotIso });
  }
  if (definition.kind === INVESTIGATE_KIND) {
    return runInvestigateRow({ base, definition, deps, dryRun, home, slotIso });
  }
  if (definition.kind === METRICS_PUSH_KIND) {
    return runMetricsPushRow({ base, definition, deps, dryRun, home, slotIso });
  }
  if (definition.kind === FLEET_CEILING_REPORT_KIND) {
    return runFleetCeilingRow({ base, definition, deps, dryRun, home, slotIso });
  }
  return {
    ...base,
    line: `recipe ${definition.recipeId} · not mine · kind '${definition.kind}' is not a run-here kind`,
  };
}
