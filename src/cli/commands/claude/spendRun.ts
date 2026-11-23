/**
 * `slopweaver claude spend --plan <alias> [--json]` — read a Claude plan's monthly spend and limit off the provider's
 * usage answer, record it in the readings ledger, and say what the owner's usage limit makes of it in dollars.
 *
 * It is the ONLY thing that reads a plan's spend. The usage endpoint is throttled per account (a first call answered
 * `429`, `retry-after: 3600`), so no gauge, tick or spawn calls it inline: they read
 * the recorded reading, which is evidence for an hour (`claude/spendPolicy.ts`). A throttle exits 4 and records
 * nothing; nothing here retries.
 *
 * The login is bound by the same step as `claude reset` (`./planLogin.ts`): a profile-scoped sign-in
 * proven by one gauge probe to be the plan's ENROLLED organisation, so a figure is never recorded against the wrong
 * plan. Any configured Claude plan may be read; only a `monthly-spend` plan's allowance is measured by it.
 *
 * Exit codes: 0 read and recorded; 2 a caller mistake; 3 no qualifying sign-in, or the answer carries no spend
 * block or an enabled one missing a figure; 4 not yet — throttled, or an answer that never came back; 1 everything else.
 */
import { readAssertions } from "../../../claude/assertionStore.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { readCredentialDocument } from "../../../claude/keychain.js";
import { probeOrganization } from "../../../claude/probeStore.js";
import type { ResetResponse } from "../../../claude/resetExchange.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import { type ClaudeSpendError, ClaudeSpendErrors } from "../../../claude/spendErrors.js";
import { requestSpendStatus } from "../../../claude/spendExchange.js";
import { type ClaudeSpendReading, claudeSpendVerdict } from "../../../claude/spendPolicy.js";
import { type ClaudeSpendValue, parseClaudeSpendStatus } from "../../../claude/spendStatus.js";
import { recordClaudeSpendReading } from "../../../claude/spendStore.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import { decodePlanAllowance, decodeUsageLimitPercent } from "../../../plans/usageLimit.js";
import type { ReadingReceipt } from "../../../readings/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { bindPlanLogin, type PlanLoginDeps } from "./planLogin.js";
import { refuse } from "./resetSend.js";

/** Where a `claude <verb>` flag tail begins in `process.argv` — `[node, cli, claude, spend, ...]`. */
const VERB_ARG_OFFSET = 4;

/** The value-taking flags `claude spend` accepts. */
const SPEND_STRING_FLAGS: readonly string[] = ["home", "plan"];

/** The switches `claude spend` accepts. */
const SPEND_BOOLEAN_FLAGS: readonly string[] = ["json"];

/** The parser's spec, built from the two lists so they cannot disagree. */
const SPEND_FLAGS: FlagSpec = { boolean: [...SPEND_BOOLEAN_FLAGS], string: [...SPEND_STRING_FLAGS] };

/** `claude spend`'s advertised flags, for the help-truth ratchet. Derived from the same lists. */
export const CLAUDE_SPEND_FLAG_NAMES: readonly string[] = [...SPEND_STRING_FLAGS, ...SPEND_BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `claude spend`, kept beside the verb so `--help` and the parser share one string. */
const SPEND_USAGE =
  "usage: slopweaver claude spend --plan <alias> [--json] [--home <dir>]\n" +
  "\n" +
  "  Read a Claude plan's monthly spend and limit over a profile-scoped sign-in proven to be that plan's, record\n" +
  "  it, and say what the plan's usage limit makes of it. Routing reads the recorded figure for an hour; the\n" +
  "  provider throttles this read to about once an hour per account, so nothing else calls it.\n" +
  "\n" +
  "  --plan   the plan alias to read\n" +
  "  --json   print the reading and its verdict as JSON\n" +
  "\n" +
  "  Exit 0 read and recorded, 3 no qualifying sign-in or no spend figure, 4 throttled — re-run after its\n" +
  "  retry-after.";

/** Every effect `claude spend` performs, injectable so its decisions are testable without a keychain or network. */
export interface ClaudeSpendDeps extends PlanLoginDeps {
  readonly requestStatus: (options: { accessToken: string }) => Promise<ResetResponse>;
  readonly record: (options: {
    home: string;
    reading: ClaudeSpendReading;
    nowIso: string;
  }) => Result<ReadingReceipt, ClaudeSpendError>;
}

/** What the flags ask for. */
interface SpendInvocation {
  readonly alias: string;
  readonly home: string;
  readonly json: boolean;
}

/**
 * Parse `claude spend` flags. Exported so the help-truth ratchet can probe the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseClaudeSpendArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: SPEND_FLAGS });
}

/** What the flags ask for, or the exit code `--help` or a caller mistake ends on. */
function invocationOf({ rest }: { rest: readonly string[] }): number | SpendInvocation {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SPEND_USAGE });
    return EXIT_OK;
  }
  const parsed = parseClaudeSpendArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, lines: [...parsed.error, SPEND_USAGE] });
  }
  const { values } = parsed.value;
  const plan = values["plan"];
  if (typeof plan !== "string") {
    return refuse({ code: EXIT_USAGE, lines: ["claude spend: --plan <alias> is required", SPEND_USAGE] });
  }
  const named = values["home"];
  return {
    alias: plan,
    home: resolveHome({ named: typeof named === "string" ? named : undefined }),
    json: values["json"] === true,
  };
}

/** The answer read into a plan's spend figures, or the exit code it ends on. */
function spendOf({ alias, response }: { alias: string; response: ResetResponse }): number | ClaudeSpendValue {
  if ("reason" in response) {
    return refuse({
      code: EXIT_DEFERRED,
      lines: [`claude spend: ${alias} — ${ClaudeSpendErrors.statusUnreadable({ detail: response.reason }).message}`],
    });
  }
  if (response.status === 429) {
    const throttled = ClaudeSpendErrors.rateLimited(
      response.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: response.retryAfterSeconds },
    );
    return refuse({ code: EXIT_DEFERRED, lines: [`claude spend: ${alias} — ${throttled.message}`] });
  }
  if (response.status < 200 || response.status >= 300) {
    const code = response.status >= 500 ? EXIT_DEFERRED : EXIT_ERROR;
    const detail = `HTTP ${String(response.status)}`;
    return refuse({
      code,
      lines: [`claude spend: ${alias} — ${ClaudeSpendErrors.statusUnreadable({ detail }).message}`],
    });
  }
  const parsed = parseClaudeSpendStatus({ bodyText: response.bodyText });
  if (parsed.isErr()) {
    const noFigure = parsed.error.code === "SPEND_BLOCK_ABSENT" || parsed.error.code === "SPEND_AMOUNT_ABSENT";
    const code = noFigure ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
    return refuse({ code, lines: [`claude spend: ${alias} — ${parsed.error.message}`] });
  }
  return parsed.value;
}

/** Print what the usage limit makes of a recorded reading — as JSON with `--json`, else as lines. */
function printVerdict({
  account,
  json,
  reading,
  readingId,
}: {
  account: ClaudeAccount;
  json: boolean;
  reading: ClaudeSpendReading;
  readingId: string;
}): void {
  const allowance = decodePlanAllowance({ allowance: account.allowance });
  const verdict = claudeSpendVerdict({
    alias: reading.alias,
    nowIso: reading.observedAtIso,
    reading,
    usageLimitPercent: decodeUsageLimitPercent({ usageLimitPercent: account.usageLimitPercent }),
  });
  if (json) {
    logger.out({ line: JSON.stringify({ allowance: allowance.kind, reading, verdict }) });
    return;
  }
  if (allowance.kind === "monthly-spend") {
    logger.out({ line: `${verdict.kind}: ${account.alias}: ${verdict.reason}` });
  } else {
    // A verdict kind on a subscription would read as a refusal of a plan routing never judges by its spend.
    logger.out({
      line: `${account.alias}: ${verdict.reason} — a ${allowance.kind} plan, so routing does not read its spend`,
    });
  }
  logger.out({ line: `recorded as reading ${readingId}` });
}

/**
 * `claude spend` over injected effects — the whole decision, testable without a keychain or the network.
 *
 * @param argv the full process argv
 * @param deps the effects
 * @returns the process exit code
 */
export async function runClaudeSpendWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ClaudeSpendDeps;
}): Promise<number> {
  const invocation = invocationOf({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (typeof invocation === "number") {
    return invocation;
  }
  const { alias, home, json } = invocation;
  const bound = await bindPlanLogin({ alias, deps, home, verb: "claude spend" });
  if (typeof bound === "number") {
    return bound;
  }
  const observedAtIso = deps.nowIso();
  const response = await bound.login.withBearer(({ accessToken }) => deps.requestStatus({ accessToken }));
  const spend = spendOf({ alias, response });
  if (typeof spend === "number") {
    return spend;
  }
  const reading: ClaudeSpendReading = { ...spend, alias, observedAtIso };
  const recorded = deps.record({ home, nowIso: deps.nowIso(), reading });
  if (recorded.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: [`claude spend: ${alias} — ${recorded.error.message}`] });
  }
  printVerdict({ account: bound.account, json, reading, readingId: recorded.value.record.readingId });
  return EXIT_OK;
}

/**
 * `claude spend` — read and record one Claude plan's monthly spend.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runClaudeSpend(argv: readonly string[]): Promise<number> {
  return runClaudeSpendWith({
    argv,
    deps: {
      login: { probe: ({ accessToken }) => probeOrganization({ accessToken }), read: readCredentialDocument },
      nowIso: () => new Date().toISOString(),
      readAccounts: ({ home }) => readSpawnAccounts({ home, port: planRegisterPort() }),
      readAssertions,
      record: recordClaudeSpendReading,
      requestStatus: requestSpendStatus,
    },
  });
}

export const claudeSpendCommand = defineCommand({ run: runClaudeSpend });
