/**
 * The PURE half of `slopweaver claude mint` — every decision the minting seat takes, with no process, file or
 * clock in reach, so each one is unit-tested rather than trusted.
 *
 * ## The flow these decisions serve *
 * The CLI's `setup-token` login honours `$BROWSER`: it runs `$BROWSER <url>` with the AUTOMATIC authorize URL
 * — the one whose `redirect_uri` is the CLI's own localhost callback — and opens no tab itself. After
 * Authorize the code comes back to that callback, so nothing is pasted. MEASURED on 2.1.282.
 * The mint therefore points `$BROWSER` at a capture script ({@link captureScript}), appends
 * `login_hint=<the plan's enrolled address>` to what it captured ({@link hintedAuthorizeUrl}), which makes
 * the claude.ai login page pre-fill that address (proven live the same day), and hands the hinted URL to
 * the seat's browser. The login renders nothing without a terminal, so it runs under `/usr/bin/expect`
 * ({@link MINT_PTY_PROGRAM}), whose screen log is where the printed token is read back
 * ({@link setupTokenFromScreen}) before `seatTokenAdmit.ts` proves it and writes it.
 *
 * ## Why the address is the ENROLLED one only
 *
 * `claude signin` may pre-fill the `accounts.json` cache, labelled, because its own org-id check decides
 * which account landed. The mint is stricter ({@link mintAddress}): it refuses a plan with no bound address
 * rather than steering a login with a hand-typed string, because a mint is where a wrong account would
 * otherwise be discovered only after the owner has authorized it.
 */
import { err, ok, type Result } from "#lib/result.js";
import { shellQuoteToken } from "#lib/shellCommandLine.js";

import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";
import { assertionFor, type ClaudeIdentityAssertion } from "./identityAssertions.js";
import type { MintAuthorizeUrlUnexpectedError } from "./mintErrors.js";
import { replayScreen } from "./mintScreen.js";
import { validateSetupToken } from "./seatToken.js";

/** The width the mint's terminal is set to, wide enough that the token prints on one line. */
const MINT_SCREEN_COLUMNS = 500;

/** The height the mint's terminal is set to. */
const MINT_SCREEN_ROWS = 50;

/**
 * The Tcl program `/usr/bin/expect` runs, written to a file and never interpolated into.
 *
 * It is LOGIC-FREE on purpose: the command it spawns arrives as `$argv`, the log path, deadline and abort
 * file as environment variables, so nothing about WHICH program runs is spelled here — `no-headless` reads
 * this repository's text for a model runner in command position, and this program names none. It spawns,
 * widens the terminal so the token is printed on one line, and waits: on the token's prefix it gives the
 * login five seconds to finish printing and exits 0; on the login exiting first, 3; on the abort file, 4;
 * past the deadline, 2. `log_file -a` records the screen even with `log_user 0` keeping it off stdout.
 */
export const MINT_PTY_PROGRAM = [
  "log_user 0",
  "set timeout 1",
  "log_file -a $env(SLOPWEAVER_MINT_SCREEN_LOG)",
  "set deadline [expr {[clock seconds] + $env(SLOPWEAVER_MINT_DEADLINE_S)}]",
  "spawn -noecho {*}$argv",
  `stty columns ${String(MINT_SCREEN_COLUMNS)} rows ${String(MINT_SCREEN_ROWS)} < $spawn_out(slave,name)`,
  "while {1} {",
  "  expect {",
  '    "sk-ant-oat" { set timeout 5; expect eof; exit 0 }',
  "    eof { exit 3 }",
  "    timeout {}",
  "  }",
  "  if {[file exists $env(SLOPWEAVER_MINT_ABORT)]} { exit 4 }",
  "  if {[clock seconds] > $deadline} { exit 2 }",
  "}",
  "",
].join("\n");

/** What {@link MINT_PTY_PROGRAM}'s exit statuses mean. `1` is Tcl's own error exit and is none of these. */
const MINT_EXIT = { aborted: 4, deadline: 2, loginExited: 3, tokenSeen: 0 } as const;

/**
 * What the worker running `/usr/bin/expect` posts back: the exit status, whether its own ceiling killed it,
 * and the tail of expect's OWN stderr. Never stdout, and never the screen — the screen is read from its log.
 */
export interface MintPtyReport {
  /** Expect's exit status, or null when a signal ended it. */
  readonly status: number | null;
  /** Whether the worker's `spawnSync` ceiling fired, which the program's own deadline should always beat. */
  readonly hung: boolean;
  /** The last characters expect itself wrote to stderr — a Tcl error, a spawn failure. */
  readonly stderrTail: string;
}

/** What `startMintPty` hands its worker: the program, the argv it spawns, the environment and the ceiling. */
export interface MintPtyRequest {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly programPath: string;
  readonly timeoutMs: number;
}

/** How much of expect's own stderr a report carries. */
const STDERR_TAIL_CHARS = 400;

/**
 * Narrow a worker's `workerData` to the mint request it was started with.
 *
 * A worker handed anything else cannot run the mint, so this throws rather than inventing a default — the
 * worker's `error` event turns the throw into a failed report.
 *
 * @param value the thread's `workerData`, untyped by declaration
 * @returns the request
 */
export function mintPtyRequestOf({ value }: { value: unknown }): MintPtyRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("claude mint worker: workerData was not an object");
  }
  const { argv, env, programPath, timeoutMs } = value as Partial<MintPtyRequest>;
  if (
    !Array.isArray(argv) ||
    typeof env !== "object" ||
    typeof programPath !== "string" ||
    typeof timeoutMs !== "number"
  ) {
    throw new Error("claude mint worker: workerData did not carry a mint request");
  }
  return { argv, env, programPath, timeoutMs };
}

/**
 * The report a worker posts once expect has exited: its status, whether the `spawnSync` ceiling killed it,
 * and the tail of its OWN stderr and any spawn error. Stdout is never read, since the screen and the token in
 * it live only in the screen log.
 *
 * @param status expect's exit status, or null when a signal ended it
 * @param stderr what expect wrote to stderr, when `spawnSync` captured any
 * @param error the spawn error `spawnSync` attached, if it attached one
 * @returns the report
 */
export function mintPtyReportOf({
  error,
  status,
  stderr,
}: {
  error: Error | undefined;
  status: number | null;
  stderr: unknown;
}): MintPtyReport {
  const stderrText = typeof stderr === "string" ? stderr : "";
  const failure = error === undefined ? "" : error.message;
  const code: unknown = error === undefined ? undefined : Reflect.get(error, "code");
  return {
    hung: code === "ETIMEDOUT",
    status,
    stderrTail: `${stderrText}${failure}`.slice(-STDERR_TAIL_CHARS),
  };
}

/**
 * Turn the pty's report and its screen into the token, or the reason there is none.
 *
 * The screen is read after a DEADLINE too, because the token can land in the same second the wait gave up.
 *
 * @param report what the worker posted when expect exited
 * @param screen the raw screen log
 * @returns the token, or which failure ended the mint
 */
export function tokenFromMint({
  report,
  screen,
}: {
  report: MintPtyReport;
  screen: string;
}): Result<string, ClaudeRotationError> {
  if (report.hung) {
    return err(ClaudeRotationErrors.mintPtyFailed({ detail: "expect outlived its own deadline and was killed" }));
  }
  if (report.status === MINT_EXIT.aborted) {
    return err(ClaudeRotationErrors.mintPtyFailed({ detail: "the mint was aborted before a token was printed" }));
  }
  const ran = [MINT_EXIT.tokenSeen, MINT_EXIT.deadline, MINT_EXIT.loginExited].some((code) => code === report.status);
  if (!ran) {
    const tail = report.stderrTail.trim();
    return err(ClaudeRotationErrors.mintPtyFailed({ detail: `expect exited ${String(report.status)}: ${tail}` }));
  }
  const token = setupTokenFromScreen({ screen });
  if (token.isErr() && report.status === MINT_EXIT.deadline) {
    return err(ClaudeRotationErrors.mintTimedOut({ stage: "token" }));
  }
  return token;
}

/** The host the automatic authorize URL is served from. */
const AUTHORIZE_HOST = "claude.com";

/** The path the automatic authorize URL is served at. */
const AUTHORIZE_PATH = "/cai/oauth/authorize";

/** The hosts the automatic flow's `redirect_uri` may name — the CLI's own callback server. */
const LOCAL_CALLBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/** The characters a setup token is made of. Matched from a position, so it always matches, possibly empty. */
const TOKEN_RUN = /^[A-Za-z0-9_-]*/;

/** The prefix every setup token opens with. A kind, not a secret. */
const TOKEN_PREFIX = "sk-ant-oat";

/**
 * The address a mint may pre-fill: the one the plan's standing enrollment BOUND, and nothing else.
 *
 * @param alias the plan being minted for
 * @param assertions every standing enrollment
 * @returns the bound address, or MINT_ADDRESS_UNBOUND naming which repair the plan needs
 */
export function mintAddress({
  alias,
  assertions,
}: {
  alias: string;
  assertions: readonly ClaudeIdentityAssertion[];
}): Result<string, ClaudeRotationError> {
  const assertion = assertionFor({ alias, assertions });
  if (assertion === undefined) {
    return err(ClaudeRotationErrors.mintAddressUnbound({ alias, enrolled: false }));
  }
  if (assertion.email === undefined) {
    return err(ClaudeRotationErrors.mintAddressUnbound({ alias, enrolled: true }));
  }
  return ok(assertion.email);
}

/**
 * Whether a `redirect_uri` is the CLI's own localhost callback — the automatic flow, where no code is pasted.
 *
 * @param redirect the `redirect_uri` parameter as the URL carried it, when it carried one
 * @returns true only for `http://localhost|127.0.0.1[:port]/callback`
 */
function isLocalCallback({ redirect }: { redirect: string | null }): boolean {
  if (redirect === null || !URL.canParse(redirect)) {
    return false;
  }
  const parsed = new URL(redirect);
  return parsed.protocol === "http:" && LOCAL_CALLBACK_HOSTS.has(parsed.hostname) && parsed.pathname === "/callback";
}

/**
 * Append the plan's address to the authorize URL the login handed its browser, after checking it is the
 * automatic flow's URL on the host the mint was built against.
 *
 * The captured string is returned EXACTLY with one parameter appended — never re-serialised through `URL`,
 * which would re-encode the PKCE challenge and state the login's own callback will compare byte for byte.
 *
 * @param captured what the capture script recorded — the URL the login passed to `$BROWSER`
 * @param address the plan's enrolled address, from {@link mintAddress}
 * @param allowUnexpectedHost whether the `claude-mint-authorize-host` hatch is open for this invocation
 * @returns the hinted URL, or which check the captured one failed
 */
export function hintedAuthorizeUrl({
  address,
  allowUnexpectedHost,
  captured,
}: {
  address: string;
  allowUnexpectedHost: boolean;
  captured: string;
}): Result<string, MintAuthorizeUrlUnexpectedError> {
  if (!URL.canParse(captured)) {
    return err(ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "unparseable" }));
  }
  const url = new URL(captured);
  if (url.protocol !== "https:") {
    return err(ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "not-https" }));
  }
  if (url.hostname !== AUTHORIZE_HOST && !allowUnexpectedHost) {
    return err(ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "host", host: url.hostname }));
  }
  if (url.pathname !== AUTHORIZE_PATH) {
    return err(ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "path" }));
  }
  if (!isLocalCallback({ redirect: url.searchParams.get("redirect_uri") })) {
    return err(ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "redirect-not-localhost" }));
  }
  if (url.searchParams.has("login_hint")) {
    return err(ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "hint-present" }));
  }
  return ok(`${captured}&login_hint=${encodeURIComponent(address)}`);
}

/**
 * The token characters opening a string.
 *
 * @param text where to read from
 * @returns the longest leading run of token characters, empty when there is none
 */
function leadingRun({ text }: { text: string }): string {
  return TOKEN_RUN.exec(text)![0];
}

/**
 * Read the setup token the login printed off the mint's screen log.
 *
 * The log is REPLAYED onto a virtual screen ({@link replayScreen}), never stripped of its escapes: the login's
 * renderer skips every cell the terminal already holds, so stripping silently drops each token character that
 * matched what stood in its column before — a 401 on a plan mint. The LAST occurrence
 * wins, because the login re-renders and an earlier render can be incomplete. A token the renderer wrapped is
 * re-joined: while a run reaches the end of its line, the next line continues it — but only when that whole
 * line (indent aside) is token characters, so the prose printed after a token is never glued onto it. What
 * comes out is held to `validateSetupToken`, and the value never enters an error.
 *
 * @param screen the raw bytes the pseudo-terminal recorded, escape sequences and carriage returns included
 * @returns the token, or MINT_NO_TOKEN when the screen carried none
 */
export function setupTokenFromScreen({ screen }: { screen: string }): Result<string, ClaudeRotationError> {
  const lines = replayScreen({ columns: MINT_SCREEN_COLUMNS, raw: screen, rows: MINT_SCREEN_ROWS });
  const index = lines.findLastIndex((line) => line.includes(TOKEN_PREFIX));
  if (index === -1) {
    return err(ClaudeRotationErrors.mintNoToken());
  }
  const first = lines[index]!;
  const opening = first.slice(first.lastIndexOf(TOKEN_PREFIX));
  let token = leadingRun({ text: opening });
  if (token.length < opening.length) {
    return validateSetupToken({ input: token });
  }
  for (const next of lines.slice(index + 1)) {
    const continuation = next.trimStart();
    const piece = leadingRun({ text: continuation });
    if (piece === "" || piece.length !== continuation.length) {
      break;
    }
    token += piece;
  }
  return validateSetupToken({ input: token });
}

/**
 * The `$BROWSER` the login is given: a script that records the URL it was asked to open, and opens nothing.
 *
 * It writes to a `.part` sibling and renames, so a reader polling for the file never sees half a URL.
 *
 * @param urlPath where the captured URL lands
 * @returns the script's whole text
 */
export function captureScript({ urlPath }: { urlPath: string }): string {
  const part = shellQuoteToken({ token: `${urlPath}.part` });
  const final = shellQuoteToken({ token: urlPath });
  return `#!/bin/sh\nprintf '%s' "$1" > ${part} && mv ${part} ${final}\n`;
}

/**
 * What the verb prints once the hinted URL is ready: the one thing the seat does next, and the URL itself.
 *
 * @param alias the plan being minted for
 * @param address the enrolled address the URL pre-fills
 * @param hintedUrl the authorize URL with the address appended
 * @returns the lines to print, the URL alone on its own line so it can be copied whole
 */
export function mintHandoffLines({
  address,
  alias,
  hintedUrl,
}: {
  address: string;
  alias: string;
  hintedUrl: string;
}): readonly string[] {
  return [
    `mint ${alias}: open this in the browser signed into ${address} — the address is pre-filled; press Continue, then Authorize`,
    hintedUrl,
    `mint ${alias}: waiting for the login to print the token — nothing is pasted, and it is written only once it proves itself`,
  ];
}
