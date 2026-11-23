/**
 * `slopweaver codex reset --plan <alias> [--credit <id>]` | `--at-limit` — redeem a Codex account's free usage-limit
 * reset through the provider's own app-server call, so a reset the account holds is spent by the fleet rather than
 * left as a line nobody acts on.
 *
 * `--plan` redeems on the one store it names. `--at-limit` is the form the chair's tick runs every pass
 * (`./resetFleetRun.ts`): every unpaused store at its limit that holds a reset is claimed, one per account, and every
 * other store is left alone: usage is taken up to 99 percent and the reset then runs by itself, abstracted away from the owner.
 * Both forms reach a store only through `./resetOne.ts`,
 * and both hold the one home-wide reset lock (`../../../codex/resetLock.ts`) from the journal read to the last
 * settle, so a tick and a hand run can never mint two keys for one refill.
 *
 * Exit codes, `--plan`: 0 reset (or an earlier attempt already was); 3 nothing to redeem — no reset held, or the
 * provider found nothing to reset; 4 the answer never came back, another reset run holds the lock, or another plan
 * holds an open attempt that may share this one's account — re-run; 2 a caller mistake; 1 everything else, the not-at-a-limit refusal and a claim that left the store at its limit
 * included. `--at-limit`: 0 nothing due or every claim refilled its store, 4 a claim deferred, 1 anything failed.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { takeCodexResetLock } from "../../../codex/resetLock.js";
import { resetResultLine, singleResetExit } from "../../../codex/resetResult.js";
import { codexSignInPort } from "../../../codex/signInPort.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import { findRegisteredPlan } from "../../../plans/register.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { runCodexResetAtLimit } from "./resetFleetRun.js";
import { type ResetOneDeps, resetOne } from "./resetOne.js";

/** Where a `codex <verb>` flag tail begins in `process.argv` — `[node, cli, codex, reset, ...]`. */
const VERB_ARG_OFFSET = 4;

/** The value-taking flags `codex reset` accepts. */
const RESET_STRING_FLAGS: readonly string[] = ["credit", "home", "plan"];

/** The boolean flags `codex reset` accepts. */
const RESET_BOOLEAN_FLAGS: readonly string[] = ["at-limit"];

/** The parser's spec, built from the two lists so the parser and the advertised names cannot disagree. */
const RESET_FLAGS: FlagSpec = { boolean: [...RESET_BOOLEAN_FLAGS], string: [...RESET_STRING_FLAGS] };

/** `codex reset`'s advertised flags, for the help-truth ratchet. Derived from the same lists. */
export const CODEX_RESET_FLAG_NAMES: readonly string[] = [...RESET_STRING_FLAGS, ...RESET_BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex reset`, kept beside the verb so `--help` and the parser share one string. */
const RESET_USAGE =
  "usage: slopweaver codex reset (--plan <alias> [--credit <id>] | --at-limit) [--home <dir>]\n" +
  "\n" +
  "  Redeem a free usage-limit reset on a registered Codex destination through the provider's own\n" +
  "  app-server call. Refused unless the store's live read finds it at its limit — a window at the\n" +
  "  register's pause bar (99% by default, `plans set-thresholds`) whose reset is still ahead. A reset\n" +
  "  spent with room left buys nothing now and is gone\n" +
  "  for later. Each claim journals the store before and after.\n" +
  "\n" +
  "  --plan      the register alias to redeem on\n" +
  "  --credit    one reset by the id `codex route --json` lists; omitted, the soonest-expiring one\n" +
  "  --at-limit  every unpaused plan at its limit that holds a reset, once per account — the chair's tick\n" +
  "\n" +
  "  Exit 0 reset, 3 nothing to redeem, 4 re-run (no answer came back, another reset run holds the\n" +
  "  lock, or another plan's attempt is open) — the SAME attempt is settled. --at-limit: 0 nothing due or all refilled, 4 deferred, 1 failed.";

/**
 * Parse `codex reset` flags. Exported so the help-truth ratchet can probe the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexResetArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: RESET_FLAGS });
}

/** One parsed flag as the string it was given, or undefined when it was not given. */
function stringFlag({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/** Which form a run is, with what that form needs. */
type ResetMode =
  | { readonly kind: "at-limit"; readonly home: string }
  | { readonly kind: "plan"; readonly alias: string; readonly credit: string | undefined; readonly home: string };

/**
 * Which form the flags ask for, or the usage errors.
 *
 * @param parsed the parsed flags
 * @returns the mode, or why the flags are not one
 */
export function resetModeOf({ parsed }: { parsed: ParsedFlags }): Result<ResetMode> {
  const { values } = parsed;
  const alias = stringFlag({ value: values["plan"] });
  const credit = stringFlag({ value: values["credit"] });
  const home = resolveHome({ named: stringFlag({ value: values["home"] }) });
  if (values["at-limit"] === true) {
    if (alias !== undefined || credit !== undefined) {
      return err(["codex reset: --at-limit chooses its own plans and credits, so it takes no --plan or --credit"]);
    }
    return ok({ home, kind: "at-limit" });
  }
  if (alias === undefined) {
    return err(["codex reset: one of --plan <alias> or --at-limit is required"]);
  }
  return ok({ alias, credit, home, kind: "plan" });
}

/**
 * Run `--plan` on the one store it names. The caller holds the reset lock.
 *
 * @param deps the stores the run reaches
 * @param mode the alias, credit and home
 * @returns the exit code
 */
async function runOnePlan({
  deps,
  mode,
  startedMs,
}: {
  deps: ResetOneDeps;
  mode: ResetMode & { kind: "plan" };
  startedMs: number;
}): Promise<number> {
  const { alias, credit, home } = mode;
  // One register read names both the store and the bar its claim is judged by, so the two cannot disagree.
  const register = await deps.port.read({ home });
  if (register.isErr()) {
    logger.error({ msg: `codex reset: ${register.error.message}` });
    return EXIT_ERROR;
  }
  const plan = findRegisteredPlan({ alias, plans: register.value.plans, provider: "codex" });
  if (plan === undefined) {
    logger.error({ msg: `codex reset: no registered Codex plan is called ${JSON.stringify(alias)}` });
    return EXIT_USAGE;
  }
  const codexHome = plan.storeDir;
  const [live] = readCodexAccountsLive({ codexHomes: [codexHome], readAtIso: new Date().toISOString() });
  const result = await resetOne({
    deps,
    live: live!,
    requestedCredit: credit,
    target: { alias: plan.alias, codexHome, home, startedMs, thresholds: register.value.thresholds.codex },
  });
  const code = singleResetExit({ result });
  const line = resetResultLine({ result });
  if (code === EXIT_OK) {
    logger.out({ line });
  } else {
    logger.error({ msg: line });
  }
  return code;
}

/**
 * Take the reset lock and run the form asked for, releasing the lock however it ends.
 *
 * @param deps the stores the run reaches
 * @param mode the form and its inputs
 * @returns the exit code — deferred when another reset run holds the lock
 */
async function runLocked({ deps, mode }: { deps: ResetOneDeps; mode: ResetMode }): Promise<number> {
  // The budget clock starts BEFORE the lease, so no pause between the two can stretch a run past the stale bound.
  const startedMs = Date.now();
  let lock: ReturnType<typeof takeCodexResetLock>;
  try {
    lock = takeCodexResetLock({ home: mode.home, nowIso: new Date(startedMs).toISOString() });
  } catch (cause) {
    logger.error({ msg: `codex reset: the reset lock could not be taken: ${String(cause)}` });
    return EXIT_ERROR;
  }
  if (lock.isErr()) {
    logger.error({ msg: `codex reset: another reset run holds the lock (${lock.error}) — nothing was sent; re-run` });
    return EXIT_DEFERRED;
  }
  try {
    if (mode.kind === "at-limit") {
      return await runCodexResetAtLimit({ deps, home: mode.home, startedMs });
    }
    return await runOnePlan({ deps, mode, startedMs });
  } finally {
    lock.value.release();
  }
}

/**
 * `codex reset` — redeem a free usage-limit reset on one Codex destination, or on every one at its limit.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexReset(argv: readonly string[]): Promise<number> {
  return runCodexResetOver({
    argv,
    deps: {
      doorLedger: doorLedgerPort(),
      fleetCap: codexFleetCapPort(),
      port: planRegisterPort(),
      signInPort: codexSignInPort(),
    },
  });
}

/**
 * {@link runCodexReset} over injected store ports — the seam a test reaches it through without a store.
 *
 * @param argv the full process argv
 * @param deps the door ledger, fleet-cap, sign-in and plan-register stores the run reaches
 * @returns the process exit code
 */
export async function runCodexResetOver({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ResetOneDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RESET_USAGE });
    return EXIT_OK;
  }
  const mode = parseCodexResetArgs({ rest }).andThen((parsed) => resetModeOf({ parsed }));
  if (mode.isErr()) {
    for (const line of [...mode.error, RESET_USAGE]) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  return runLocked({ deps, mode: mode.value });
}

export const codexResetCommand = defineCommand({ run: runCodexReset });
