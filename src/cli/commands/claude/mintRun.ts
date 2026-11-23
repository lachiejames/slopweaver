/**
 * `slopweaver claude mint` — the minting seat: run a plan's `setup-token` login, pre-fill the plan's ENROLLED
 * address on the claude.ai login page, and write the token it prints only once it proves itself.
 *
 * The seat pre-fills the plan's email and presses Continue. This verb is the half that
 * needs no browser: it runs the login under a pseudo-terminal with `$BROWSER` pointed at a capture script,
 * appends `login_hint=<address>` to the authorize URL it captured, and prints that URL for the seat to open
 * with the browser verbs. After Authorize the code returns to the login's own localhost callback, the login
 * prints the token, and `claude/seatTokenAdmit.ts` — the same path `claude token` takes — probes it, judges
 * it against the enrollment, and writes it. Every decision is in `claude/mintFlow.ts`, every effect in
 * `claude/mintPty.ts`.
 *
 * It refuses BEFORE spawning anything when the plan has no enrolled address, and it never prints the token.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { readAssertions } from "../../../claude/assertionStore.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "../../../claude/errors.js";
import { hintedAuthorizeUrl, mintAddress, mintHandoffLines, tokenFromMint } from "../../../claude/mintFlow.js";
import {
  MINT_DEADLINE_MS,
  type MintPaths,
  type MintPtyHandle,
  prepareMintDir,
  readMintScreen,
  removeMintDir,
  startMintPty,
  waitForAuthorizeUrl,
} from "../../../claude/mintPty.js";
import { admitSetupToken } from "../../../claude/seatTokenAdmit.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import { slopweaverHome } from "../../../homeDir.js";
import { planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { reportSetupTokenAdmission } from "./setupTokenReport.js";

/** The flags this verb accepts, and the ONLY place they are named — its usage is held to this by `helpTruth`. */
const MINT_FLAG_SPEC = { boolean: [], string: ["plan"] } as const;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, mint, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** The variable that opens the `claude-mint-authorize-host` hatch. */
const AUTHORIZE_HOST_HATCH = "SLOPWEAVER_ALLOW_CLAUDE_MINT_AUTHORIZE_HOST";

/**
 * Every flag this verb advertises, derived from the spec it actually parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_MINT_FLAG_NAMES: readonly string[] = [
  ...MINT_FLAG_SPEC.string.map((name) => `--${name}`),
  ...MINT_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * Parse this verb's own argument tail, strictly.
 *
 * @internal — exported so the help ratchet probes the REAL parser.
 *
 * @param rest the argv tail, after `claude mint`
 * @returns the plan to mint for, or every rejection at once
 */
export function parseClaudeMintArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<{ readonly alias: string }, ClaudeRotationError> {
  const parsed = parseFlags({ args: rest, spec: MINT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ClaudeRotationErrors.mintArgsInvalid({ problems: parsed.error }));
  }
  const alias = parsed.value.values["plan"];
  if (typeof alias !== "string") {
    return err(ClaudeRotationErrors.mintArgsInvalid({ problems: ["--plan was not passed"] }));
  }
  return ok({ alias });
}

/**
 * Report every problem, prefixed with the verb's own name.
 *
 * @param problems what went wrong
 */
function complain({ problems }: { problems: readonly string[] }): void {
  for (const problem of problems) {
    logger.error({ msg: `claude mint: ${problem}` });
  }
}

/**
 * Drive one running mint from captured URL to admitted token.
 *
 * @param account the plan being minted for
 * @param address the plan's enrolled address
 * @param allowUnexpectedHost whether the authorize-host hatch is open
 * @param home the Slopweaver home
 * @param paths the mint's directory
 * @param pty the running login
 * @returns the admitted token's lines and path, or why the mint ended without one
 */
async function drive({
  account,
  address,
  allowUnexpectedHost,
  home,
  paths,
  pty,
}: {
  account: ClaudeAccount;
  address: string;
  allowUnexpectedHost: boolean;
  home: string;
  paths: MintPaths;
  pty: MintPtyHandle;
}): Promise<Result<{ readonly lines: readonly string[]; readonly path: string }, ClaudeRotationError>> {
  const captured = await waitForAuthorizeUrl({ paths, pty });
  if (captured.isErr()) {
    return err(captured.error);
  }
  const hinted = hintedAuthorizeUrl({ address, allowUnexpectedHost, captured: captured.value });
  if (hinted.isErr()) {
    return err(hinted.error);
  }
  for (const line of mintHandoffLines({ address, alias: account.alias, hintedUrl: hinted.value })) {
    logger.out({ line });
  }
  const token = tokenFromMint({ report: await pty.finished, screen: readMintScreen({ paths }) });
  if (token.isErr()) {
    return err(token.error);
  }
  return admitSetupToken({ account, home, nowIso: new Date().toISOString(), token: token.value });
}

/**
 * Run one mint in its own directory, and leave nothing behind: the login is joined and the directory — the
 * screen log holding the token included — removed on every path out.
 *
 * @param account the plan being minted for
 * @param address the plan's enrolled address
 * @param allowUnexpectedHost whether the authorize-host hatch is open
 * @param home the Slopweaver home
 * @returns the process exit code
 */
async function mint({
  account,
  address,
  allowUnexpectedHost,
  home,
}: {
  account: ClaudeAccount;
  address: string;
  allowUnexpectedHost: boolean;
  home: string;
}): Promise<number> {
  const prepared = prepareMintDir({ home, nowMs: Date.now() });
  if (prepared.isErr()) {
    complain({ problems: [prepared.error.message] });
    return EXIT_ERROR;
  }
  const { cleared, paths } = prepared.value;
  if (cleared > 0) {
    logger.error({ msg: `claude mint: removed ${String(cleared)} leftover mint director(ies) an earlier mint left` });
  }
  const pty = startMintPty({ deadlineMs: MINT_DEADLINE_MS, paths });
  const stop = (): void => {
    pty.abort();
  };
  // `on`, never `once`, and SIGHUP too: a second Ctrl-C, or the pane closing, must not fall through to
  // Node's default exit while the `finally` waits on the login — that leaves the screen log, token and all.
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGHUP", stop);
  try {
    const admitted = await drive({ account, address, allowUnexpectedHost, home, paths, pty });
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
  } finally {
    pty.abort();
    await pty.finished;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGHUP", stop);
    removeMintDir({ paths });
  }
}

/**
 * Mint, prove and write one plan's setup token.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
async function runClaudeMint(argv: readonly string[]): Promise<number> {
  const args = parseClaudeMintArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
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
        "this install registers no Claude destination, so there is no plan to mint for — `slopweaver plans add --provider claude` registers one",
      ],
    });
    return EXIT_ERROR;
  }
  const configured = accounts.value;
  const account = configured.find((entry) => entry.alias === args.value.alias);
  if (account === undefined) {
    complain({
      problems: [
        `no configured plan is called \`${args.value.alias}\` (configured: ${configured.map((entry) => entry.alias).join(", ")})`,
      ],
    });
    return EXIT_USAGE;
  }
  const address = mintAddress({ alias: account.alias, assertions: readAssertions({ home }) });
  if (address.isErr()) {
    complain({ problems: [address.error.message] });
    return EXIT_ERROR;
  }
  // The hatch is read into a local and passed as a value, never a parameter default (`hatch-release`).
  const allowUnexpectedHost = process.env[AUTHORIZE_HOST_HATCH] === "1";
  if (allowUnexpectedHost) {
    logger.error({
      msg: `claude mint: OVERRIDDEN by ${AUTHORIZE_HOST_HATCH}=1 — an authorize host off claude.com is accepted`,
    });
  }
  return mint({ account, address: address.value, allowUnexpectedHost, home });
}

export const claudeMintCommand = defineCommand({ run: runClaudeMint });
