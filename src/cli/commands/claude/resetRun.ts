/**
 * `slopweaver claude reset --plan <alias> [--claim] [--grant <id>] [--json]` — read a Claude plan's free usage-limit
 * resets, and with `--claim` spend one through the provider's own call, so a reset the plan holds is redeemed by the
 * fleet rather than by hand in a Claude Code session.
 *
 * The order is the whole design (`claude/resetAttempt.ts` and `claude/resetClaim.ts` carry why each step is there):
 * bind a profile-scoped login to the plan's ENROLLED organisation by one gauge probe (`claude/resetCredential.ts`);
 * read the reset status; stop there without `--claim`. With it: close an open attempt the status shows is over and
 * send nothing, else resend it under its own request id; refuse a FRESH claim the provider would not honour, or one
 * that would spend with no window at its limit unless the `early-claude-reset` hatch is set; journal the intent;
 * send the claim through the door; journal the answer. This file reads; `./resetDecide.ts` decides whether to send
 * and under which id; `./resetSend.ts` sends and settles.
 *
 * Exit codes: 0 read, reset, or an earlier attempt settled; 2 a caller mistake; 3 nothing to redeem or no
 * qualifying sign-in; 4 not yet — throttled, a cooldown, or an answer that never came back (re-run, and the SAME
 * attempt is settled); 1 everything else, the early-spend refusal included.
 */
import { randomUUID } from "node:crypto";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { readAssertions } from "../../../claude/assertionStore.js";
import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import { readCredentialDocument } from "../../../claude/keychain.js";
import { probeOrganization } from "../../../claude/probeStore.js";
import type { ResetLogin } from "../../../claude/resetCredential.js";
import { ClaudeResetErrors } from "../../../claude/resetErrors.js";
import { type ResetResponse, requestResetClaim, requestResetStatus } from "../../../claude/resetExchange.js";
import { type ClaudeResetStatus, parseResetStatus } from "../../../claude/resetStatus.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { bindPlanLogin, type PlanLoginDeps } from "./planLogin.js";
import { claimToSend } from "./resetDecide.js";
import { renderResetStatus } from "./resetRender.js";
import { type ClaimTarget, refuse, sendAndSettle } from "./resetSend.js";

/** Where a `claude <verb>` flag tail begins in `process.argv` — `[node, cli, claude, reset, ...]`. */
const VERB_ARG_OFFSET = 4;

/** The value-taking flags `claude reset` accepts. */
const RESET_STRING_FLAGS: readonly string[] = ["grant", "home", "plan"];

/** The switches `claude reset` accepts. */
const RESET_BOOLEAN_FLAGS: readonly string[] = ["claim", "json"];

/** The parser's spec, built from the two lists so they cannot disagree. */
const RESET_FLAGS: FlagSpec = { boolean: [...RESET_BOOLEAN_FLAGS], string: [...RESET_STRING_FLAGS] };

/** `claude reset`'s advertised flags, for the help-truth ratchet. Derived from the same lists. */
export const CLAUDE_RESET_FLAG_NAMES: readonly string[] = [...RESET_STRING_FLAGS, ...RESET_BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** The variable that lets a claim spend with no window at its limit — the `early-claude-reset` row's key. */
const EARLY_RESET_ENV = "SLOPWEAVER_ALLOW_EARLY_CLAUDE_RESET";

/** Usage for `claude reset`, kept beside the verb so `--help` and the parser share one string. */
const RESET_USAGE =
  "usage: slopweaver claude reset --plan <alias> [--claim] [--grant <id>] [--json] [--home <dir>]\n" +
  "\n" +
  "  Read a Claude plan's free usage-limit resets over a profile-scoped sign-in proven to be that plan's —\n" +
  "  its own store's (`slopweaver claude signin --plan <alias>`), else the default keychain slot's. With\n" +
  "  --claim, spend one through the provider's own call. A claim with no window at its limit is refused:\n" +
  "  a reset spent with room left buys nothing now and is gone for later.\n" +
  "\n" +
  "  --plan   the plan alias to read or claim on\n" +
  "  --claim  spend one reset; without it the verb only reads\n" +
  "  --grant  the grant to spend, by the id the read lists; omitted, the provider's next grant\n" +
  "  --json   print the read as JSON (read only)\n" +
  "\n" +
  "  Exit 0 read or reset, 3 nothing to redeem or no qualifying sign-in, 4 not yet — re-run, and an\n" +
  "  unanswered claim is settled under the SAME request id.";

/** Every effect `claude reset` performs, injectable so its decisions are testable without a keychain or network. */
export interface ClaudeResetDeps extends PlanLoginDeps {
  /** The door ledger a claim's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
  readonly requestStatus: (options: { accessToken: string }) => Promise<ResetResponse>;
  readonly requestClaim: ClaimTarget["requestClaim"];
  readonly newRequestId: () => string;
  /** Whether the `early-claude-reset` hatch is open for this run. */
  readonly earlyAllowed: boolean;
}

/** What the flags ask for. */
interface ResetInvocation {
  readonly alias: string;
  readonly home: string;
  readonly claim: boolean;
  readonly json: boolean;
  readonly requestedGrant: string | undefined;
}

/**
 * Parse `claude reset` flags. Exported so the help-truth ratchet can probe the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseClaudeResetArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: RESET_FLAGS });
}

/** One parsed flag as the string it was given, or undefined when it was not given. */
function stringFlag({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/** What the flags ask for, or the exit code `--help` or a caller mistake ends on. */
function invocationOf({ rest }: { rest: readonly string[] }): number | ResetInvocation {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RESET_USAGE });
    return EXIT_OK;
  }
  const parsed = parseClaudeResetArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, lines: [...parsed.error, RESET_USAGE] });
  }
  const { values } = parsed.value;
  const alias = stringFlag({ value: values["plan"] });
  if (alias === undefined) {
    return refuse({ code: EXIT_USAGE, lines: ["claude reset: --plan <alias> is required", RESET_USAGE] });
  }
  const claim = values["claim"] === true;
  const json = values["json"] === true;
  const requestedGrant = stringFlag({ value: values["grant"] });
  if (requestedGrant !== undefined && !claim) {
    return refuse({ code: EXIT_USAGE, lines: ["claude reset: --grant names what --claim spends", RESET_USAGE] });
  }
  if (json && claim) {
    return refuse({ code: EXIT_USAGE, lines: ["claude reset: --json prints the read only", RESET_USAGE] });
  }
  return { alias, claim, home: resolveHome({ named: stringFlag({ value: values["home"] }) }), json, requestedGrant };
}

/** The status read, or the exit code it ends on. */
async function readStatus({
  alias,
  deps,
  login,
}: {
  alias: string;
  deps: ClaudeResetDeps;
  login: ResetLogin;
}): Promise<number | ClaudeResetStatus> {
  const response = await login.withBearer(({ accessToken }) => deps.requestStatus({ accessToken }));
  if ("reason" in response) {
    return refuse({
      code: EXIT_DEFERRED,
      lines: [`claude reset: ${alias} — ${ClaudeResetErrors.statusUnreadable({ detail: response.reason }).message}`],
    });
  }
  if (response.status === 429) {
    const throttled = ClaudeResetErrors.statusRateLimited(
      response.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: response.retryAfterSeconds },
    );
    return refuse({ code: EXIT_DEFERRED, lines: [`claude reset: ${alias} — ${throttled.message}`] });
  }
  if (response.status < 200 || response.status >= 300) {
    const code = response.status >= 500 ? EXIT_DEFERRED : EXIT_ERROR;
    const detail = `HTTP ${String(response.status)}`;
    return refuse({
      code,
      lines: [`claude reset: ${alias} — ${ClaudeResetErrors.statusUnreadable({ detail }).message}`],
    });
  }
  const parsed = parseResetStatus({ bodyText: response.bodyText });
  if (parsed.isErr()) {
    const code = parsed.error.code === "RESET_BLOCK_ABSENT" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
    return refuse({ code, lines: [`claude reset: ${alias} — ${parsed.error.message}`] });
  }
  return parsed.value;
}

/** Print the status read — as JSON with `--json`, else as lines naming the plan by its enrolled address. */
function printStatus({
  assertion,
  invocation,
  login,
  status,
}: {
  assertion: ClaudeIdentityAssertion;
  invocation: ResetInvocation;
  login: ResetLogin;
  status: ClaudeResetStatus;
}): void {
  const { alias } = invocation;
  if (invocation.json) {
    const email = assertion.email === undefined ? {} : { email: assertion.email };
    logger.out({ line: JSON.stringify({ alias, ...email, source: login.source, status }) });
    return;
  }
  const label = assertion.email === undefined ? alias : `${alias} (${assertion.email})`;
  for (const line of renderResetStatus({ label, source: login.source, status })) {
    logger.out({ line });
  }
}

/**
 * `claude reset` over injected effects — the whole decision, testable without a keychain or the network.
 *
 * @param argv the full process argv
 * @param deps the effects
 * @returns the process exit code
 */
export async function runClaudeResetWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ClaudeResetDeps;
}): Promise<number> {
  const invocation = invocationOf({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (typeof invocation === "number") {
    return invocation;
  }
  const { alias, home } = invocation;
  const bound = await bindPlanLogin({ alias, deps, home, verb: "claude reset" });
  if (typeof bound === "number") {
    return bound;
  }
  const { assertion, login } = bound;
  const readAtIso = deps.nowIso();
  const status = await readStatus({ alias, deps, login });
  if (typeof status === "number") {
    return status;
  }
  printStatus({ assertion, invocation, login, status });
  if (!invocation.claim) {
    return EXIT_OK;
  }
  const claim = claimToSend({
    context: {
      alias,
      assertion,
      block: status.block,
      earlyAllowed: deps.earlyAllowed,
      home,
      newRequestId: deps.newRequestId,
      readAtIso,
      requestedGrant: invocation.requestedGrant,
    },
  });
  if (typeof claim === "number") {
    return claim;
  }
  return sendAndSettle({
    claim,
    target: { alias, home, ledger: deps.doorLedger, login, nowIso: deps.nowIso, requestClaim: deps.requestClaim },
  });
}

/**
 * `claude reset` — read, and with `--claim` spend, one Claude plan's free usage-limit reset.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runClaudeReset(argv: readonly string[]): Promise<number> {
  const earlyAllowed = process.env[EARLY_RESET_ENV] === "1";
  return runClaudeResetWith({
    argv,
    deps: {
      doorLedger: doorLedgerPort(),
      earlyAllowed,
      login: { probe: ({ accessToken }) => probeOrganization({ accessToken }), read: readCredentialDocument },
      newRequestId: randomUUID,
      nowIso: () => new Date().toISOString(),
      readAccounts: ({ home }) => readSpawnAccounts({ home, port: planRegisterPort() }),
      readAssertions,
      requestClaim: requestResetClaim,
      requestStatus: requestResetStatus,
    },
  });
}

export const claudeResetCommand = defineCommand({ run: runClaudeReset });
