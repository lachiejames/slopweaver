/**
 * `slopweaver desktop e2e` — walk a real Slopweaver.app the way the owner does and photograph every step, so a change is
 * proven on the app itself before it is installed (every change is proven, so that at any given moment the owner works with a
 * fully functional desktop app).
 *
 * The bundle runs as a TEST INSTANCE beside the owner's app (`desktop/src/e2eMode.ts`), so a walk never quits, restarts or
 * reconfigures the copy the owner is using, and the walk's steps open and look but never press (`src/desktop/e2ePlan.ts`).
 * `--call` adds the call leg, which does press Talk: real voice calls on a visible test instance
 * (`src/desktop/e2eCallPlan.ts`). The pure halves are `src/desktop/e2e*.ts`; the effectful ones are `./e2eWalkLeg.ts`
 * and `./e2eDriver.ts` for the walk and `./e2eCallDriver.ts` for the calls.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { CALL_STEP_IDS, callLegCheckout, type E2eCallStep, pickDesktopE2eSteps } from "../../../desktop/e2eCallPlan.js";
import { cardReadSteps, type E2eCardStepId, placeCardSteps } from "../../../desktop/e2eCardReadPlan.js";
import { type DesktopE2eError, DesktopE2eErrors } from "../../../desktop/e2eErrors.js";
import type { E2eStep } from "../../../desktop/e2ePlan.js";
import { type E2eStepResult, e2eReport, e2eReportLines } from "../../../desktop/e2eReport.js";
import { e2eSettleCapOf } from "../../../desktop/e2eSettleCap.js";
import { type E2eWorkContext, e2eContextOf } from "../../../desktop/e2eWorkContext.js";
import { heldOnCall, isOnCallHold, type OnCallHoldError } from "../../../desktop/onCallHold.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { gitConfirmsMainWorktree, ownerDeclaredCheckouts } from "../talk/consoleOrigin.js";
import { DESKTOP_E2E_USAGE } from "./desktopUsage.js";
import { checkE2eBundle } from "./e2eBundle.js";
import { driveCallLeg, type E2eCallLegResult } from "./e2eCallDriver.js";
import { callCardOf, holdMinutesOf, micCandidateOf, pickRefusal } from "./e2eCallFlagRead.js";
import { proofDirOf, quietNote, stepProgress, writeRunFiles } from "./e2eRunOutput.js";
import { walkLeg } from "./e2eWalkLeg.js";
import { readOnCallHold } from "./onCallRead.js";

/** argv[0..3] are node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The installed app, which a walk takes when no other bundle is named. */
const INSTALLED_APP = "/Applications/Slopweaver.app";

/** The flags `desktop e2e` accepts, without their leading `--`. */
const E2E_FLAGS: FlagSpec = {
  boolean: ["call", "json", "menu-bar"],
  string: [
    "app",
    "call-card",
    "call-hold-minutes",
    "call-mic-candidate",
    "checkout",
    "context",
    "home",
    "only",
    "out",
    "settle-cap",
  ],
};

/** The same flags, `--`-prefixed, for the help-truth ratchet. */
export const DESKTOP_E2E_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: E2E_FLAGS }),
  ...stringFlagsOf({ spec: E2E_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** What one run was asked for. */
export interface DesktopE2eArgs {
  readonly app: string;
  readonly checkout: string | undefined;
  readonly home: string | undefined;
  readonly out: string | undefined;
  readonly steps: readonly E2eStep[];
  /** The call leg's scenarios, none without `--call`, a named card's already placed. */
  readonly calls: readonly E2eCallStep[];
  /** With `--call-card all`, the card scenarios each card the console draws is asked, once the leg can read them. */
  readonly inventorySurfaces: readonly E2eCardStepId[];
  readonly json: boolean;
  /** With `--menu-bar`, every instance the run launches draws its own menu bar icon, named Slopweaver Test. */
  readonly menuBar: boolean;
  /** With `--context`, the work context every instance's console is put in before its first step or call. */
  readonly context: E2eWorkContext | undefined;
  /** With `--settle-cap <seconds>`, how long each walk step waits to settle before it is photographed, to measure a slow page. */
  readonly settleCapMs: number;
}

/**
 * Parse `desktop e2e` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns what the run was asked for, or the problems to print before the usage
 */
export function parseDesktopE2eArgs({ rest }: { rest: readonly string[] }): Result<DesktopE2eArgs> {
  const parsed = parseFlags({ args: rest, spec: E2E_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const text = ({ key }: { key: string }): string | undefined => {
    const value = values[key];
    return typeof value === "string" ? value : undefined;
  };
  const call = values["call"] === true;
  const holdMinutes = holdMinutesOf({ call, hold: text({ key: "call-hold-minutes" }) });
  if (holdMinutes.isErr()) {
    return err(holdMinutes.error);
  }
  const card = callCardOf({ call, card: text({ key: "call-card" }) });
  if (card.isErr()) {
    return err(card.error);
  }
  const only = text({ key: "only" });
  const ids = only === undefined ? [] : only.split(",").filter((id) => id !== "");
  const carded = card.value.kind !== "none";
  const candidate = micCandidateOf({ ids, text: text({ key: "call-mic-candidate" }) });
  if (candidate.isErr()) {
    return err(candidate.error);
  }
  const instance = instanceFlagsOf({ text });
  if (instance.isErr()) {
    return err(instance.error);
  }
  const picked = pickDesktopE2eSteps({
    call,
    carded,
    holdMinutes: holdMinutes.value,
    micCandidate: candidate.value,
    only: ids,
  });
  const refused = pickRefusal({ picked });
  if (refused !== undefined) {
    return err([refused]);
  }
  const app = text({ key: "app" });
  const checkout = text({ key: "checkout" });
  const out = text({ key: "out" });
  const named = card.value.kind === "named" ? card.value.keys : [];
  const cards = cardReadSteps({ cardKeys: named, surfaces: picked.cardSurfaces });
  return ok({
    app: app !== undefined ? resolve(app) : INSTALLED_APP,
    calls: placeCardSteps({ calls: picked.calls, cards, order: CALL_STEP_IDS }),
    inventorySurfaces: card.value.kind === "inventory" ? picked.cardSurfaces : [],
    checkout: checkout === undefined ? undefined : resolve(checkout),
    ...instance.value,
    home: text({ key: "home" }),
    json: values["json"] === true,
    menuBar: values["menu-bar"] === true,
    out: out === undefined ? undefined : resolve(out),
    steps: picked.walk,
  });
}

/**
 * The flags that set up each test instance rather than pick its steps: the work context and the settle cap.
 *
 * @param text a string flag's value by key, `undefined` when not passed
 * @returns both, read, or the first refusal
 */
function instanceFlagsOf({
  text,
}: {
  text: ({ key }: { key: string }) => string | undefined;
}): Result<Pick<DesktopE2eArgs, "context" | "settleCapMs">> {
  return e2eContextOf({ text: text({ key: "context" }) })
    .andThen((context) =>
      e2eSettleCapOf({ text: text({ key: "settle-cap" }) }).map((settleCapMs) => ({ context, settleCapMs })),
    )
    .mapErr((refused) => [refused.message]);
}

/**
 * The checkout the instance reads its console from: the named one, or the declared main checkout of this repository.
 * The call leg runs on the main one only (`callLegCheckout`).
 *
 * @param args what the run was asked for
 * @param home the state home whose profile declares the main checkouts
 * @returns the checkout, or why none resolved
 */
function checkoutOf({ args, home }: { args: DesktopE2eArgs; home: string }): Result<string, DesktopE2eError> {
  if (args.checkout === undefined) {
    return checkoutForRunningRepo({ home, verb: "desktop e2e" }).mapErr((problems) =>
      DesktopE2eErrors.checkoutUnresolved({ detail: problems.join("; ") }),
    );
  }
  const calling = args.calls.length > 0 || args.inventorySurfaces.length > 0;
  if (!calling) {
    return ok(args.checkout);
  }
  // Compared, and then launched, as the real path, so a symlink to the owner's checkout is the owner's checkout and one retargeted
  // after the check moves nothing; the list is the console gate's own, read from the owner's account's home whatever `--home`
  // names, and already canonical.
  return callLegCheckout({
    calling,
    checkout: realOf({ path: args.checkout }),
    // The gate also needs git to confirm a main worktree, so a declared linked worktree is not the owner's either.
    declared: ownerDeclaredCheckouts().filter((root) => gitConfirmsMainWorktree({ root })),
  });
}

/**
 * A path with its symlinks resolved, or the path as given when nothing is there to resolve — the launch then fails on
 * it by name.
 *
 * @param path the checkout as named
 * @returns the real path
 */
function realOf({ path }: { path: string }): string {
  if (!existsSync(path)) {
    return path;
  }
  return realpathSync(path);
}

/**
 * Walk the bundle and write the report, the instance's own saved state removed whatever happens.
 *
 * @param args what the run was asked for
 * @param home the state home the photographs default under
 * @returns the process exit code: 0 when every step passed, 4 held because the owner is on a call, 1 otherwise
 */
async function walkAndReport({ args, home }: { args: DesktopE2eArgs; home: string }): Promise<number> {
  // Before anything else, for the walk as much as the calls: e2e testing stops while the owner is on a call, and
  // a walk's window on the owner's screen is that too (`../../../desktop/onCallHold.ts`).
  const held = readOnCallHold({ home });
  if (held !== undefined) {
    logger.error({ msg: held.message });
    return e2eExitCode({ failed: 0, fatal: held.message, heldOnCall: heldOnCall({ code: held.code }) });
  }
  const startedIso = new Date().toISOString();
  // The checkout first, so a call leg aimed at a worktree is refused for that whatever the bundle.
  const checkout = checkoutOf({ args, home }).andThen((dir) =>
    checkE2eBundle({ app: args.app, menuBar: args.menuBar }).map(() => dir),
  );
  if (checkout.isErr()) {
    logger.error({ msg: `desktop e2e: ${checkout.error.message}` });
    return EXIT_ERROR;
  }
  const out = proofDirOf({ home, out: args.out, startedIso });
  mkdirSync(out, { recursive: true });
  const progress = stepProgress({ json: args.json });
  const onCall = (): OnCallHoldError | undefined => readOnCallHold({ home });
  const walked = await walkLeg({
    app: args.app,
    checkout: checkout.value,
    context: args.context,
    menuBar: args.menuBar,
    onCall,
    out,
    progress,
    settleCapMs: args.settleCapMs,
    steps: args.steps,
  });
  if (walked.isErr()) {
    logger.error({ msg: `desktop e2e: ${walked.error.message}` });
    // An error here is before any step ran: a hold at the launch, or a fault. A hold mid-walk comes back in the value.
    const heldAtLaunch = isOnCallHold(walked.error) && heldOnCall({ code: walked.error.code });
    return e2eExitCode({ failed: 0, fatal: walked.error.message, heldOnCall: heldAtLaunch });
  }
  const called = await callLegAfter({
    args,
    checkout: checkout.value,
    firstIndex: walked.value.results.length,
    home,
    out,
    progress,
    walkHeld: walked.value.held,
  });
  const steps = [...walked.value.results, ...called.results];
  const report = e2eReport({ app: args.app, checkout: checkout.value, fatal: called.fatal, out, startedIso, steps });
  writeRunFiles({ calls: args.calls, out, report, steps, trials: called.fidelityTrials });
  if (!args.json && called.fatal !== undefined) {
    logger.out({ line: `STOPPED  ${called.fatal}` });
  }
  logger.out({ line: args.json ? JSON.stringify(report) : e2eReportLines({ report }).at(-1)! });
  return e2eExitCode({ failed: report.failed, fatal: report.fatal, heldOnCall: called.heldOnCall });
}

/**
 * The call leg after the walk. A walk the owner stopped by picking up a call runs no call leg, and its steps still count: one
 * that failed before the call fails the run, exit 1, rather than hiding behind the hold.
 */
async function callLegAfter({
  args,
  checkout,
  firstIndex,
  home,
  out,
  progress,
  walkHeld,
}: {
  args: DesktopE2eArgs;
  checkout: string;
  firstIndex: number;
  home: string;
  out: string;
  progress: ({ result }: { result: E2eStepResult }) => void;
  walkHeld: OnCallHoldError | undefined;
}): Promise<E2eCallLegResult> {
  if (walkHeld !== undefined) {
    return {
      fatal: walkHeld.message,
      fidelityTrials: [],
      heldOnCall: heldOnCall({ code: walkHeld.code }),
      results: [],
    };
  }
  return driveCallLeg({
    app: args.app,
    checkout,
    // Every console the owner declares, git-confirmed this instant or not.
    consoles: [checkout, ...ownerDeclaredCheckouts()],
    context: args.context,
    firstIndex,
    home,
    inventorySurfaces: args.inventorySurfaces,
    menuBar: args.menuBar,
    nonce: randomUUID().slice(0, 8),
    note: quietNote({ json: args.json }),
    out,
    progress,
    steps: args.calls,
  });
}

/**
 * A run's exit code: a failed step is a failure whatever stopped the run after it; a stop that was only the owner's call is
 * `EXIT_DEFERRED`, the same command right once it ends; any other stop is a failure.
 *
 * @param failed how many steps failed
 * @param fatal what stopped the run early, if anything did
 * @param heldOnCall whether that stop was a call seen, rather than a fault
 * @returns 0, 1 or 4
 */
export function e2eExitCode({
  failed,
  fatal,
  heldOnCall: held,
}: {
  failed: number;
  fatal: string | undefined;
  heldOnCall: boolean;
}): number {
  if (failed > 0) {
    return EXIT_ERROR;
  }
  if (fatal === undefined) {
    return EXIT_OK;
  }
  return held ? EXIT_DEFERRED : EXIT_ERROR;
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv
 * @returns the process exit code: 0 when every step passed, 4 held because the owner is on a call, 1 for a failed step or a
 *   walk that could not start
 */
export async function runDesktopE2e(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
    logger.out({ line: DESKTOP_E2E_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDesktopE2eArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: DESKTOP_E2E_USAGE });
    return EXIT_USAGE;
  }
  return walkAndReport({ args: parsed.value, home: resolveHome({ named: parsed.value.home }) });
}

export const desktopE2eCommand = defineCommand({ run: runDesktopE2e });
