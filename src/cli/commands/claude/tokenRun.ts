/**
 * `slopweaver claude token` — hand a plan the setup token the owner minted, and only once it has PROVEN itself.
 *
 * A plan holding a setup token boots its seats on it (an Anthropic API key in the environment outranks it,
 * `claude/spawnStore.ts`), and the first minted token proves the
 * rate-limit windows and plan identity survive. A token minted elsewhere arrives here — `claude mint` mints
 * one itself and proves it through the same `admitSetupToken` — so this verb begins where a mint ends: it takes the pasted value from a no-echo prompt or a pipe,
 * never argv; spends one probe request over it; and writes it into the plan's store directory ONLY when the
 * response carried a gauge, a Fable week and the account enrolled for that plan (`claude/seatToken.ts`
 * § judgeSetupToken). A refusal writes nothing, so a wrong paste cannot put a plan on the wrong account.
 *
 * `--status` reads which plans are on a token without touching the network.
 */
import { logger } from "#lib/logger.js";
import { readStdin } from "#lib/readStdin.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "../../../claude/errors.js";
import { readSetupTokenFile, type SetupTokenFile, validateSetupToken } from "../../../claude/seatToken.js";
import { admitSetupToken } from "../../../claude/seatTokenAdmit.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import { slopweaverHome } from "../../../homeDir.js";
import { planRegisterPort } from "../../../plans/port.js";
import { promptSecretNoEcho } from "../../../secrets/prompt.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { reportSetupTokenAdmission } from "./setupTokenReport.js";

/** The flags this verb accepts, and the ONLY place they are named — its usage is held to this by `helpTruth`. */
const TOKEN_FLAG_SPEC = { boolean: ["status", "stdin"], string: ["plan"] } as const;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, token, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Every flag this verb advertises, derived from the spec it actually parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_TOKEN_FLAG_NAMES: readonly string[] = [
  ...TOKEN_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TOKEN_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** What one invocation was asked to do. */
export type ClaudeTokenArgs =
  { readonly kind: "status" } | { readonly kind: "set"; readonly alias: string; readonly forceStdin: boolean };

/**
 * Parse this verb's own argument tail, strictly.
 *
 * @param rest the argv tail, after `claude token`
 * @returns what was asked for, or every rejection at once
 */
export function parseClaudeTokenArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ClaudeTokenArgs, ClaudeRotationError> {
  const parsed = parseFlags({ args: rest, spec: TOKEN_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ClaudeRotationErrors.tokenArgsInvalid({ problems: parsed.error }));
  }
  const values = parsed.value.values;
  const alias = values["plan"];
  const status = values["status"] === true;
  if (typeof alias === "string" && status) {
    return err(ClaudeRotationErrors.tokenArgsInvalid({ problems: ["both were passed"] }));
  }
  if (status) {
    return ok({ kind: "status" });
  }
  if (typeof alias !== "string") {
    return err(ClaudeRotationErrors.tokenArgsInvalid({ problems: ["neither was passed"] }));
  }
  return ok({ alias, forceStdin: values["stdin"] === true, kind: "set" });
}

/**
 * One line per plan saying how its seats authenticate, and a closing count. Pure over the file seam.
 *
 * @param accounts the configured plans, in configured order
 * @param read what each plan's store directory holds by way of a token
 * @returns the lines to print
 */
export function renderTokenStatus({
  accounts,
  read,
}: {
  accounts: readonly ClaudeAccount[];
  read: (options: { storeDir: string }) => SetupTokenFile;
}): readonly string[] {
  const states = accounts.map((account) => ({ alias: account.alias, file: read({ storeDir: account.storeDir }) }));
  const lines = states.map(({ alias, file }) => {
    if (file.kind === "token") {
      return `${alias}: on a setup token — its seats boot over a file descriptor against unbound stores`;
    }
    if (file.kind === "unreadable") {
      return `${alias}: setup token file UNREADABLE — spawns routed here refuse until it is replaced`;
    }
    return `${alias}: store-backed, no setup token yet — a seat mints one with \`slopweaver claude mint --plan ${alias}\``;
  });
  const onToken = states.filter(({ file }) => file.kind === "token").length;
  return [...lines, `${String(onToken)} of ${String(accounts.length)} plans on a setup token`];
}

/**
 * Capture, prove and write one plan's token.
 *
 * @param account the plan the token is offered for
 * @param forceStdin whether `--stdin` forces a piped read on a terminal
 * @param home the Slopweaver home the enrollments live under
 * @returns the process exit code
 */
async function setToken({
  account,
  forceStdin,
  home,
}: {
  account: ClaudeAccount;
  forceStdin: boolean;
  home: string;
}): Promise<number> {
  const piped = forceStdin || process.stdin.isTTY !== true;
  const raw = piped
    ? await readStdin()
    : await promptSecretNoEcho({ prompt: `paste ${account.alias}'s setup token (hidden): ` });
  const token = validateSetupToken({ input: raw });
  if (token.isErr()) {
    complain({ problems: [token.error.message] });
    return EXIT_USAGE;
  }
  const admitted = await admitSetupToken({ account, home, nowIso: new Date().toISOString(), token: token.value });
  return reportSetupTokenAdmission({
    account,
    admitted,
    writeOut: ({ line }) => {
      logger.out({ line });
    },
    writeProblem: ({ problem }) => {
      complain({ problems: [problem] });
    },
  });
}

/**
 * Report every problem, prefixed with the verb's own name.
 *
 * @param problems what went wrong
 */
function complain({ problems }: { problems: readonly string[] }): void {
  for (const problem of problems) {
    logger.error({ msg: `claude token: ${problem}` });
  }
}

/**
 * Read which plans are on a token, or prove and write one plan's token.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
async function runClaudeToken(argv: readonly string[]): Promise<number> {
  const args = parseClaudeTokenArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (args.isErr()) {
    complain({ problems: [args.error.message] });
    return EXIT_USAGE;
  }
  const home = slopweaverHome();
  const accounts = await readSpawnAccounts({ home, port: planRegisterPort() });
  if (accounts.isErr()) {
    complain({ problems: [accounts.error.message] });
    return EXIT_ERROR;
  }
  if (accounts.value === undefined) {
    complain({
      problems: [
        "this install registers no Claude destination, so there is nothing to hand a token to — `slopweaver plans add --provider claude` registers one",
      ],
    });
    return EXIT_ERROR;
  }
  if (args.value.kind === "status") {
    for (const line of renderTokenStatus({ accounts: accounts.value, read: readSetupTokenFile })) {
      logger.out({ line });
    }
    return EXIT_OK;
  }
  const alias = args.value.alias;
  const account = accounts.value.find((entry) => entry.alias === alias);
  if (account === undefined) {
    complain({
      problems: [
        `no configured plan is called \`${alias}\` (configured: ${accounts.value.map((entry) => entry.alias).join(", ")})`,
      ],
    });
    return EXIT_USAGE;
  }
  return setToken({ account, forceStdin: args.value.forceStdin, home });
}

export const claudeTokenCommand = defineCommand({ run: runClaudeToken });
