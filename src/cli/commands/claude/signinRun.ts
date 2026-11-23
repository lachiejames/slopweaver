/**
 * `slopweaver claude signin` — the surface the owner self-services their plan sign-ins from.
 *
 * Build the one command that walks
 * each plan's sign-in in their own terminal, with the status page as a second renderer, and pre-fill the email.
 * The walk's shape is: the surface names which Chrome profile they must
 * bring to the FOREGROUND, they put it in focus and say go, and ONLY THEN does the login launch — because the
 * vendor's login opens in whichever Chrome profile is frontmost, and the wrong one skips a step.
 *
 * ## What this file is allowed to do, and what it is not
 *
 * It runs the vendor's own `auth login` and nothing else writes a credential here. That subcommand starts no
 * model, and it runs SYNCHRONOUSLY with the terminal inherited, so it cannot outlive the process that started
 * it and the owner can watch and interrupt it — doctrine rule 2 is about an invisible model, and there is no
 * model here at all. The command line is built by {@link signinCommandLine} so that the
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR=` prefix can never be omitted by a caller.
 *
 * It NEVER launches a login without an explicit go. In the interactive walk that is a keypress; with
 * `--plan` it is the operator naming one store. There is no path that signs in a store nobody asked for.
 *
 * ## Replacing an enrollment is its own flag, and the only path that does it
 *
 * `--plan`, `--enroll` and the walk ESTABLISH an enrollment for a store that has none and CHECK one that
 * stands; on a mismatch they print the registered `identity-reenroll` refusal and write nothing.
 * `--reenroll <alias,...>` is the one deliberate replacement: it binds the account already live in each named
 * store, launches no login, judges the whole set at once, and refuses on any ambiguity. {@link signinRoute} is
 * where that split is decided, so a test can hold it rather than a reviewer. Every path that can write reads
 * the enrollments strictly first ({@link readAssertionsForWrite}), because every write stores the whole file.
 *
 * ## The sign-in RECORD, and why it is not the enrollment
 *
 * `signinOne` appends `{ alias, signedInAtIso }` to `claude-accounts/sign-in-log.jsonl` the moment the
 * vendor's login exits cleanly, and NEVER an instant taken before it — `claude/signInLog.ts` carries why
 * that order matters and why it is a separate append-only file rather than a moving field on the enrollment.
 * It is the only path that writes it, because it is the only path that launches a login.
 *
 * ## Where the email comes from, and the one act that turns it into a fact
 *
 * `--email` pre-population needs an address per plan, and an address is per-install state. The login
 * pre-fills the address the plan's standing ENROLLMENT bound when there is one, and otherwise the optional
 * `email` on the account row in `$SLOPWEAVER_HOME/claude-accounts/accounts.json`, parsed onto `ClaudeAccount`
 * (`accountBinding.ts`'s `loginHintAddress`). The launch line says which it was — `(enrolled)` or
 * `(accounts.json cache — unverified)` — and pre-filling the cache is safe only because the org-id check
 * after the login, not the address, decides which account landed. An address is printed beside the alias on
 * every line this verb says about a plan, so the prompt that tells them which Chrome
 * profile to bring forward names the account, not only `plan-two`.
 *
 * **That file's address is a display cache and this verb is where it stops being only that.** It is
 * hand-typed and a `/login` does not touch it, so it drifts from the token silently.
 * An enrollment and a re-enrollment are the only instants a human names a store, a live token and an
 * address together, so BOTH bind the configured address onto the assertion beside the organisation they just
 * probed (`identityAssertions.ts`). Every surface afterwards renders the BOUND address and calls the
 * configured one a cache. A row enrolled before this reads `unverified cache` until
 * `--reenroll <plan>` binds it; the fleet is unaffected either way.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import { type LoginHint, loginHintFor } from "../../../claude/accountBinding.js";
import { readAssertions } from "../../../claude/assertionStore.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { probePlan } from "../../../claude/probeStore.js";
import { appendSignIn, readSignIns } from "../../../claude/signInLog.js";
import { planSignin, type SigninPlan, type SigninProbe } from "../../../claude/signinPlan.js";
import { renderSigninLines, renderSigninPage, signinLaunchLine } from "../../../claude/signinRender.js";
import { readAccountsFile } from "../../../claude/spawnAccounts.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { claudeCommandErrorLines } from "./errors.js";
import { type ClaudeSigninArgs, parseClaudeSigninArgs, signinRoute } from "./signinArgs.js";
import { labelOf, reenrollMany, type SigninAttemptOutcome, verifyAndEnroll } from "./signinEnrolment.js";
import { signinPagePath } from "./signinPagePath.js";

/** How often the written page re-reads itself, in seconds. */
const PAGE_REFRESH_SECONDS = 10;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, signin, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** How long the vendor's interactive login may take before it is abandoned, in milliseconds. */
const LOGIN_TIMEOUT_MS = 600_000;

/**
 * The configured plans, or the reason they are unusable.
 *
 * @param home the Slopweaver home to read from
 * @returns the accounts in configured order
 */
function readAccounts({ home }: { home: string }): Result<readonly ClaudeAccount[]> {
  return readAccountsFile({ home }).mapErr((e) => [e.message]);
}

/** One probe of every configured store, and the accounts they named. */
async function probeAll({
  accounts,
  nowIso,
}: {
  accounts: readonly ClaudeAccount[];
  nowIso: string;
}): Promise<readonly SigninProbe[]> {
  const probes: SigninProbe[] = [];
  for (const account of accounts) {
    const result = await probePlan({ alias: account.alias, nowIso, storeDir: account.storeDir });
    probes.push({
      alias: account.alias,
      // `life` is that store's OWN credential, out of the same document the probe read. It used to be dropped
      // here, and dropping it is what let a reading taken over a plan's setup token grade a signed-out store
      // `VERIFIED` — `claude/signinPlan.ts` § A row grades TWO axes carries the measurement.
      life: result.life,
      ...(result.outcome.gauge === undefined ? {} : { gauge: result.outcome.gauge }),
      ...(result.outcome.problem === undefined ? {} : { problem: result.outcome.problem }),
      ...(result.organizationId === undefined ? {} : { organizationId: result.organizationId }),
    });
  }
  return probes;
}

/**
 * Read every store and decide what each row says.
 *
 * @param accounts the configured plans
 * @param home the Slopweaver home
 * @param nowIso the instant to stamp the readings with
 * @returns the planned walk
 */
async function currentPlan({
  accounts,
  home,
  nowIso,
}: {
  accounts: readonly ClaudeAccount[];
  home: string;
  nowIso: string;
}): Promise<SigninPlan> {
  const probes = await probeAll({ accounts, nowIso });
  return planSignin({ accounts, assertions: readAssertions({ home }), probes, signIns: readSignIns({ home }) });
}

/**
 * Why a vendor login may not launch from this process, or undefined when it may.
 *
 * `claude auth login` opens the default browser. A process with no terminal on its stdin is a tool call or a
 * pipe, so launching there opens a sign-in tab nobody at a prompt asked for — measured: an
 * agent's `signin --status --plan plan-five` did exactly that. This is a NARROWING, not an authentication: a
 * terminal on stdin proves terminal-shaped input, never that a human typed the command, because a session can
 * run under a pseudo-terminal too. What actually keeps a read from launching a login is the parser refusing a
 * read beside a store act; this closes the one launch path that is certainly unattended.
 *
 * @param stdinIsTty whether this process's stdin is an interactive terminal
 * @returns the refusal line, or undefined when a login may launch
 */
export function loginLaunchRefusal({ stdinIsTty }: { stdinIsTty: boolean }): string | undefined {
  if (stdinIsTty) {
    return undefined;
  }
  return "claude signin: refused to launch `claude auth login` — it opens a browser, and this process has no terminal on its stdin, so nobody at a prompt asked for one; the owner runs `slopweaver claude signin --plan <alias>` in a terminal, and `--status` alone reads without launching anything";
}

/**
 * Run the vendor's interactive login for one store, in the foreground.
 *
 * @param account the plan whose store to sign into
 * @param hint the address to pre-fill and where it came from, printed so a cache pre-fill never reads as bound
 * @returns whether the login exited cleanly
 */
function launchLogin({ account, hint }: { account: ClaudeAccount; hint: LoginHint | undefined }): boolean {
  const refusal = loginLaunchRefusal({ stdinIsTty: process.stdin.isTTY === true });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
    return false;
  }
  const email = hint?.address;
  logger.error({ msg: signinLaunchLine({ hint, storeDir: account.storeDir }) });
  try {
    execFileSync("claude", ["auth", "login", ...(email === undefined ? [] : ["--email", email])], {
      env: { ...process.env, CLAUDE_SECURESTORAGE_CONFIG_DIR: account.storeDir },
      stdio: "inherit",
      timeout: LOGIN_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Print an attempt's lines and turn its outcome into the exit code.
 *
 * @param outcome what the attempt concluded
 * @returns the process exit code
 */
function finish({ outcome }: { outcome: SigninAttemptOutcome }): number {
  for (const line of outcome.lines) {
    logger.out({ line });
  }
  return outcome.ok ? EXIT_OK : EXIT_ERROR;
}

/**
 * The configured plan an alias names, or the usage refusal when none does.
 *
 * @param accounts the configured plans
 * @param alias the plan asked for
 * @param flag the flag that named it, for the refusal
 * @returns the account, or undefined after reporting that no plan carries that name
 */
function accountNamed({
  accounts,
  alias,
  flag,
}: {
  accounts: readonly ClaudeAccount[];
  alias: string;
  flag: "--enroll" | "--plan";
}): ClaudeAccount | undefined {
  const refusal = unconfiguredPlanLine({ aliases: [alias], configured: accounts.map((entry) => entry.alias), flag });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
  }
  return accounts.find((entry) => entry.alias === alias);
}

/** The vendor login, injected so a test can hold the record-then-verify ORDER without a real browser. */
type LaunchLogin = typeof launchLogin;

/** The store probe, injected so a test can hand the shell a fixed reading without a live store. */
type ProbeStore = typeof probePlan;

/**
 * The clock, injected as a FUNCTION rather than as an instant.
 *
 * A fixed instant handed in by the caller would have to be taken before {@link launchLogin} is called, and
 * that login blocks in a browser for up to {@link LOGIN_TIMEOUT_MS} — ten minutes. A record whose whole
 * purpose is to say when they signed in must be stamped when the login FINISHED, so the clock is read after it
 * returns and the test still supplies its own.
 */
type Clock = () => string;

/**
 * Sign one named store in and report what landed.
 *
 * **The sign-in is RECORDED before anything verifies it**, and that order is the whole point of the record
 * rather than an implementation detail: every check after this line — the re-probe, the organisation-id
 * comparison, `establishAssertion`, the `identity-reenroll` refusal — can fail on a store the owner genuinely
 * just signed into, and those are exactly the cases where they need to see when they last did. This is also the
 * ONLY path that writes the log, because it is the only path that launches a vendor login: `--enroll` binds a
 * store that is already live and `--reenroll` explicitly launches nothing, so neither may claim a sign-in.
 *
 * **First, though, the record is SUBORDINATE to the sign-in**, which is why a failed append warns here and
 * falls through instead of ending the run. Sequencing the record ahead of the verification is the point
 * above; letting it VETO the verification was a separate bug — an unwritable home threw between a completed
 * browser login and `establishAssertion`, discarding up to ten minutes of the owner's own login and leaving
 * the store signed in with no identity bound. `signInLog.ts`'s own `appendSignIn` doc carries the measurement.
 *
 * @internal — exported so the order above is provable against a real log file, with the login and the probe
 *   both supplied as plain fakes rather than reached for real.
 *
 * @param accounts the configured plans
 * @param alias the plan to sign in
 * @param home the Slopweaver home
 * @param launch the vendor login — {@link launchLogin} in production
 * @param now read ONCE after the login returns, never before it — see {@link Clock}
 * @param probe the store probe — `probePlan` in production
 * @returns the process exit code
 */
export async function signinOne({
  accounts,
  alias,
  home,
  launch,
  now,
  probe,
}: {
  accounts: readonly ClaudeAccount[];
  alias: string;
  home: string;
  launch: LaunchLogin;
  now: Clock;
  probe: ProbeStore;
}): Promise<number> {
  const account = accountNamed({ accounts, alias, flag: "--plan" });
  if (account === undefined) {
    return EXIT_USAGE;
  }
  if (!launch({ account, hint: loginHintFor({ account, assertions: readAssertions({ home }) }) })) {
    logger.error({ msg: `claude signin: the login for ${labelOf({ account })} did not complete` });
    return EXIT_ERROR;
  }
  const nowIso = now();
  const recorded = appendSignIn({ alias: account.alias, home, nowIso });
  if (recorded.isErr()) {
    logger.warn({
      msg: `claude signin: recorded no sign-in for ${labelOf({ account })} — ${recorded.error.message}. The sign-in itself stands and enrollment continues; --status will read this store as having none recorded here.`,
    });
  }
  return finish({
    outcome: await verifyAndEnroll({
      account,
      configured: accounts.map((entry) => entry.alias),
      home,
      nowIso,
      probe,
    }),
  });
}

/**
 * Bind one already-live store's current account as its expected identity, signing nothing in.
 *
 * @param accounts the configured plans
 * @param alias the plan to enroll
 * @param home the Slopweaver home
 * @returns the process exit code
 */
async function enrollNamed({
  accounts,
  alias,
  home,
}: {
  accounts: readonly ClaudeAccount[];
  alias: string;
  home: string;
}): Promise<number> {
  const account = accountNamed({ accounts, alias, flag: "--enroll" });
  if (account === undefined) {
    return EXIT_USAGE;
  }
  return finish({
    outcome: await verifyAndEnroll({
      account,
      configured: accounts.map((entry) => entry.alias),
      home,
      nowIso: new Date().toISOString(),
      probe: probePlan,
    }),
  });
}

/**
 * The refusal for a flag naming a store that is not configured, or undefined when every name is.
 *
 * It lists the configured plans rather than echoing what was typed: a mistyped alias can be anything, an
 * organisation id pasted into the wrong place included, and no line this verb prints may carry one.
 *
 * @internal — exported so the refusal is provable without a live install.
 *
 * @param aliases the stores the flag named, as typed
 * @param configured every configured plan's alias
 * @param flag which of `--plan`, `--enroll` or `--reenroll` named them
 * @returns the line to print, or undefined when every named store is configured
 */
export function unconfiguredPlanLine({
  aliases,
  configured,
  flag,
}: {
  aliases: readonly string[];
  configured: readonly string[];
  flag: "--enroll" | "--plan" | "--reenroll";
}): string | undefined {
  const unknown = aliases.filter((alias) => !configured.includes(alias)).length;
  if (unknown === 0) {
    return undefined;
  }
  return `claude signin: \`${flag}\` names ${String(unknown)} store(s) that are not configured — the configured plans are ${configured.join(", ")}; no enrollment was changed`;
}

/**
 * Replace the named already-live stores' standing enrollments with the accounts they hold now.
 *
 * @param accounts the configured plans
 * @param aliases the plans to re-enroll, as named on the command line
 * @param home the Slopweaver home
 * @returns the process exit code
 */
async function reenrollNamed({
  accounts,
  aliases,
  home,
}: {
  accounts: readonly ClaudeAccount[];
  aliases: readonly string[];
  home: string;
}): Promise<number> {
  const configured = accounts.map((entry) => entry.alias);
  const unknown = unconfiguredPlanLine({ aliases, configured, flag: "--reenroll" });
  if (unknown !== undefined) {
    logger.error({ msg: unknown });
    return EXIT_USAGE;
  }
  return finish({
    outcome: await reenrollMany({
      accounts: aliases.flatMap((alias) => accounts.filter((entry) => entry.alias === alias)),
      configured,
      home,
      nowIso: new Date().toISOString(),
      probe: probePlan,
    }),
  });
}

/**
 * The interactive walk: offer each repairable store in turn, and launch nothing without a go.
 *
 * @param accounts the configured plans
 * @param home the Slopweaver home
 * @returns the process exit code
 */
async function walk({ accounts, home }: { accounts: readonly ClaudeAccount[]; home: string }): Promise<number> {
  if (process.stdin.isTTY !== true) {
    logger.error({
      msg: "claude signin: the walk needs a terminal it can prompt in — use `--plan <alias>` for one store, or `--status` to read",
    });
    return EXIT_USAGE;
  }
  const plan = await currentPlan({ accounts, home, nowIso: new Date().toISOString() });
  for (const line of renderSigninLines({ nowIso: new Date().toISOString(), plan })) {
    logger.out({ line });
  }
  const remaining = plan.summary.remaining;
  if (remaining.length === 0) {
    return EXIT_OK;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (const alias of remaining) {
      const account = accounts.find((entry) => entry.alias === alias);
      if (account === undefined) {
        continue;
      }
      const answer = await rl.question(
        `\nBring the Chrome profile for ${labelOf({ account })} to the FOREGROUND — the login opens in whichever profile is frontmost.\nPress Enter when it is in focus, or type skip: `,
      );
      if (answer.trim().toLowerCase() === "skip") {
        logger.out({ line: `${labelOf({ account })}: skipped` });
        continue;
      }
      await signinOne({
        accounts,
        alias,
        home,
        launch: launchLogin,
        now: () => new Date().toISOString(),
        probe: probePlan,
      });
    }
  } finally {
    rl.close();
  }
  const after = await currentPlan({ accounts, home, nowIso: new Date().toISOString() });
  for (const line of renderSigninLines({ nowIso: new Date().toISOString(), plan: after })) {
    logger.out({ line });
  }
  return after.summary.complete ? EXIT_OK : EXIT_ERROR;
}

/**
 * The read-only faces: the status lines, the JSON document, and the written page.
 *
 * @param accounts the configured plans
 * @param args what was asked for
 * @param home the Slopweaver home
 * @returns the process exit code
 */
async function report({
  accounts,
  args,
  home,
}: {
  accounts: readonly ClaudeAccount[];
  args: ClaudeSigninArgs;
  home: string;
}): Promise<number> {
  const nowIso = new Date().toISOString();
  const plan = await currentPlan({ accounts, home, nowIso });
  if (args.wantsPage) {
    const path = signinPagePath({ args, home });
    writeFileSync(path, renderSigninPage({ nowIso, plan, refreshSeconds: PAGE_REFRESH_SECONDS }));
    logger.error({ msg: `claude signin: wrote ${path}` });
  }
  if (args.wantsJson) {
    logger.out({ line: JSON.stringify({ observedAtIso: nowIso, ...plan }) });
  } else if (!args.wantsPage || args.wantsStatus) {
    for (const line of renderSigninLines({ nowIso, plan })) {
      logger.out({ line });
    }
  }
  return plan.summary.complete ? EXIT_OK : EXIT_ERROR;
}

/**
 * Report every problem a Result carried, prefixed with the verb's own name.
 *
 * @param problems what went wrong
 * @returns nothing
 */
function complain({ problems }: { problems: readonly string[] }): void {
  for (const problem of problems) {
    logger.error({ msg: `claude signin: ${problem}` });
  }
}

/**
 * Read every plan's sign-in state, or write the page, or walk the sign-ins, or re-enroll one store.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
async function runClaudeSignin(argv: readonly string[]): Promise<number> {
  const args = parseClaudeSigninArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (args.isErr()) {
    complain({ problems: claudeCommandErrorLines({ error: args.error }) });
    return EXIT_USAGE;
  }
  const home = slopweaverHome();
  const accounts = readAccounts({ home });
  if (accounts.isErr()) {
    complain({ problems: accounts.error });
    return EXIT_ERROR;
  }
  const route = signinRoute({ args: args.value });
  switch (route.kind) {
    case "reenroll":
      return reenrollNamed({ accounts: accounts.value, aliases: route.aliases, home });
    case "enroll":
      return enrollNamed({ accounts: accounts.value, alias: route.alias, home });
    case "plan":
      return signinOne({
        accounts: accounts.value,
        alias: route.alias,
        home,
        launch: launchLogin,
        now: () => new Date().toISOString(),
        probe: probePlan,
      });
    case "report":
      return report({ accounts: accounts.value, args: args.value, home });
    case "walk":
      return walk({ accounts: accounts.value, home });
    default: {
      const unreachable: never = route;
      return unreachable;
    }
  }
}

export const claudeSigninCommand = defineCommand({ run: runClaudeSignin });
