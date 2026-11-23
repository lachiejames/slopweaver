/**
 * The `op` boundary — the one place this atlas runs a subprocess, and the enforcement point for the closed
 * command allowlist.
 *
 * ## Nothing here accepts an argv
 *
 * {@link runOpSurface} takes a SURFACE NAME, looks the argv up in `inventory.ts`, and refuses a surface that
 * is not there. A caller cannot pass `["item", "get", "..."]` because a caller cannot pass an argv at all.
 * The one variable part is a single `{{id}}` placeholder, and the value substituted into it is validated as
 * an opaque 1Password identifier first — so no caller-supplied string ever becomes an argv element
 * unchecked.
 *
 * ## Synchronous, by doctrine
 *
 * `execFileSync`, never `spawn`/`execFile`. AGENTS.md rule 2 bans the asynchronous forms outright for every
 * process, not just a model: a synchronous child blocks its caller and therefore cannot outlive it. This is
 * also why there is no streaming — a large `op` output is bounded by {@link MAX_OUTPUT_BYTES} instead, and
 * an overflow is reported as an overflow rather than silently truncated.
 *
 * ## Failures are classified, never guessed at twice
 *
 * `op` reports "not installed", "not signed in" and "you do not have permission" through the same non-zero
 * exit, so {@link classifyOpFailure} reads stderr once and turns it into this atlas's own gap vocabulary.
 * A sync that could not tell them apart would tell the owner to re-authenticate when the real answer was
 * that the account lacks a permission.
 *
 * ## The atlas account is CLI-only
 *
 * Every child runs with `OP_BIOMETRIC_UNLOCK_ENABLED=false`. The dedicated atlas account cannot live in the
 * desktop app — the app refuses a second account on the same team — and with the app
 * integration on, `op` reads its accounts from the app, so the standalone `atlas` account in
 * `~/.config/op/config` vanishes from `op account list`. The variable
 * switches `op` back to that file. {@link signInOpSession} is the one call outside the surface allowlist: a
 * fixed `op signin` whose password arrives on stdin and whose session token is returned, never printed.
 */
import { execFileSync } from "node:child_process";

import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { OnepasswordGapCondition } from "./gaps.js";
import { onepasswordOpCommandFor } from "./inventory.js";
import { type OnepasswordOpError, OnepasswordOpErrors, onepasswordOpErrorLines } from "./opErrors.js";

/** The binary. Not configurable: a settable path is a way to run something that is not `op`. */
const OP_BINARY = "op";

/**
 * How long one `op` call may take. Generous, because `op vault get` on a cold session waits on a network
 * round trip and a biometric-unlocked session can prompt; short enough that a hung call fails a run rather
 * than parking it forever.
 */
const TIMEOUT_MS = 60_000;

/**
 * The largest output one `op` call may produce. `execFileSync` defaults to 1 MiB and THROWS on overflow —
 * a fact this repo has already paid for once in `devLint/coverageRatchet.ts`, where an overflow was reported
 * as "could not be read". Raised to 16 MiB and, more importantly, the overflow is classified distinctly
 * below so it can never again read as an unrelated failure.
 */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * What one `op` call produced.
 *
 * @internal
 */
export interface OpSurfaceResult {
  /** The parsed JSON rows. `op` list verbs return an array; a `get` verb returns one object, wrapped here. */
  readonly rows: readonly unknown[];
  /** The argv actually run, for the source record's `endpoint`. Never carries a credential. */
  readonly endpoint: string;
}

/** A `1Password` identifier as `op` emits them: opaque, and never anything an argv could interpret. */
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The one line `op signin` prints for a shell to `eval`: the session variable's name, then its token. */
const SIGNIN_EXPORT = /^export (OP_SESSION_[A-Za-z0-9_]+)="([^"\s]+)"$/;

/** A signed-in `op` session: the variable `op` reads it from, and the token to put there. */
export interface OpSession {
  readonly name: string;
  readonly token: string;
}

/**
 * The environment every `op` child runs in: the caller's, with the desktop-app integration switched off so
 * `op` reads the standalone account the atlas signs in as.
 *
 * @param env the caller's environment, which may already carry an exported `OP_SESSION_…`
 * @returns a copy with `OP_BIOMETRIC_UNLOCK_ENABLED=false`, whatever the caller had
 */
export function opCliOnlyEnv({ env }: { env: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  return { ...env, OP_BIOMETRIC_UNLOCK_ENABLED: "false" };
}

/**
 * The shortest `OP_SESSION_…` value treated as a token. A session token is a long random string; a value
 * shorter than this cannot be one, and splitting ordinary text on it (`OP_SESSION_X=a`) would rewrite `op`'s
 * own failure — `no active session found` included — into text that depends on the value and classifies wrong.
 */
const MIN_SESSION_TOKEN_LENGTH = 20;

/**
 * Replace every `OP_SESSION_…` token the child was handed with a placeholder, so no failure text carries a
 * session token — even one an `op` that is not the real one chose to print back.
 *
 * @param text a failure's stderr or message
 * @param env the environment the child ran with
 * @returns the text with each session token redacted
 */
export function redactOpSessions({ text, env }: { text: string; env: NodeJS.ProcessEnv }): string {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        name.startsWith("OP_SESSION") && value !== undefined && value.length >= MIN_SESSION_TOKEN_LENGTH,
    )
    .reduce((redacted, [, value]) => redacted.split(value!).join("<redacted>"), text);
}

/**
 * Read the session out of what `op signin` printed.
 *
 * Exactly one `export OP_SESSION_…="…"` line is the only shape accepted: none means the sign-in did not
 * happen, and two means this cannot say which account the token belongs to.
 *
 * @param stdout everything `op signin` wrote to stdout
 * @returns the session, or a failure that never quotes the output
 */
export function parseOpSigninExport({ stdout }: { stdout: string }): Result<OpSession, OnepasswordOpError> {
  const matches = stdout
    .split("\n")
    .map((line) => SIGNIN_EXPORT.exec(line.trim()))
    .filter((match) => match !== null);
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only === undefined) {
    return err(OnepasswordOpErrors.signinOutputUnparseable({ exportLines: matches.length }));
  }
  return ok({ name: only[1]!, token: only[2]! });
}

/**
 * Classify one `op` failure into this atlas's closed gap vocabulary.
 *
 * @param stderr what `op` wrote to stderr, plus the thrown error's own message
 * @returns the condition that failure earns
 */
export function classifyOpFailure({ stderr }: { stderr: string }): OnepasswordGapCondition {
  const lowered = stderr.toLowerCase();
  if (lowered.includes("enoent") || lowered.includes("command not found") || lowered.includes("not found in path")) {
    return "cli-not-installed";
  }
  if (
    lowered.includes("not signed in") ||
    lowered.includes("no active session found") ||
    // MEASURED, op 2.39.0: once the account has signed in on this machine, a lapsed session reads so.
    lowered.includes("could not find session token") ||
    lowered.includes("no account found") ||
    lowered.includes("session expired") ||
    lowered.includes("authentication required")
  ) {
    return "cli-not-signed-in";
  }
  if (
    lowered.includes("permission") ||
    lowered.includes("not allowed") ||
    lowered.includes("forbidden") ||
    lowered.includes("insufficient")
  ) {
    return "cli-permission-refused";
  }
  if (lowered.includes("maxbuffer") || lowered.includes("stdout maxbuffer")) {
    return "cli-output-unreadable";
  }
  return "cli-output-unreadable";
}

/** Normalise `op`'s JSON: a list verb yields an array, a `get` verb yields one object. */
function rowsOf({ parsed }: { parsed: unknown }): readonly unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return isRecord(parsed) ? [parsed] : [];
}

/** Build the argv for one allowed surface, substituting at most one validated provider id. */
function argvFor({
  surface,
  id,
}: {
  surface: string;
  id: string | null;
}): Result<readonly string[], OnepasswordOpError> {
  const command = onepasswordOpCommandFor({ surface });
  if (command === null) {
    return err(OnepasswordOpErrors.surfaceNotAllowed({ surface }));
  }
  const needsId = command.template.includes("{{id}}");
  if (needsId && id === null) {
    return err(OnepasswordOpErrors.parentIdMissing({ surface }));
  }
  if (!needsId && id !== null) {
    return err(OnepasswordOpErrors.parentIdUnexpected({ surface }));
  }
  if (id !== null && !PROVIDER_ID.test(id)) {
    return err(OnepasswordOpErrors.idMalformed({ id }));
  }
  // `id!`: the {{id}} placeholder only survives here when `needsId` is true, and the guard above already
  // returned on `needsId && id === null`. Coalescing to "" would put an empty argv part in front of `op`.
  return ok(command.template.map((part) => (part === "{{id}}" ? id! : part)));
}

/**
 * Run one allowed `op` surface and parse its JSON.
 *
 * @param surface the surface name, which must be in the closed allowlist in `inventory.ts`
 * @param id the parent id for a per-parent surface, `null` for a once-per-run one
 * @param account the account shorthand to pass as `--account`, or `null` to let `op` choose
 * @param env the environment to hand the child — passed in so a test can run this with a stub on PATH
 * @returns the parsed rows and the argv that produced them, or the reason the call failed
 */
export function runOpSurface({
  surface,
  id = null,
  account = null,
  env = process.env,
}: {
  surface: string;
  id?: string | null;
  account?: string | null;
  env?: NodeJS.ProcessEnv;
}): Result<OpSurfaceResult> {
  const argv = argvFor({ id, surface });
  if (argv.isErr()) {
    return err(onepasswordOpErrorLines({ error: argv.error }));
  }
  const args = [...argv.value, "--format=json", ...(account === null ? [] : ["--account", account])];
  let stdout: string;
  try {
    stdout = execFileSync(OP_BINARY, args, {
      encoding: "utf8",
      env: opCliOnlyEnv({ env }),
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
  } catch (error: unknown) {
    const stderr = isRecord(error) && typeof error["stderr"] === "string" ? error["stderr"] : "";
    const cause = new Error(redactOpSessions({ env, text: errorMessage({ error }) }));
    return err(
      onepasswordOpErrorLines({
        error: OnepasswordOpErrors.callFailed({
          argv: argv.value,
          cause,
          stderr: redactOpSessions({ env, text: stderr }),
        }),
      }),
    );
  }
  if (stdout.trim() === "") {
    return ok({ endpoint: `op ${argv.value.join(" ")}`, rows: [] });
  }
  // A row is published to the atlas, so a session token never reaches one — even as a vault named after it.
  const parsedText = redactOpSessions({ env, text: stdout });
  try {
    return ok({ endpoint: `op ${argv.value.join(" ")}`, rows: rowsOf({ parsed: JSON.parse(parsedText) }) });
  } catch {
    return err(onepasswordOpErrorLines({ error: OnepasswordOpErrors.outputUnparseable({ argv: argv.value }) }));
  }
}

/**
 * The terminal `expect` gives `op signin`.
 *
 * MEASURED on `op` 2.39.0, with a dummy password so no session could result: a password PIPED to
 * `op signin` is never read (no prompt, exit 7), and one written into a pseudo-terminal before the prompt is
 * discarded. `op` reads a password only from a terminal, after it has prompted — so this waits for the
 * prompt, then types. The password arrives on `expect`'s stdin, never an argv, and the terminal does not
 * echo it; the account arrives in the environment, so nothing is interpolated into the script. `-f` lets
 * `op` print its `export` line to a terminal rather than to a shell's `$(…)`. Repro, which prints no prompt:
 * `printf 'x\n' | OP_BIOMETRIC_UNLOCK_ENABLED=false op signin --account atlas; echo $?`
 *
 * `op` itself is found on the inherited PATH, exactly as every {@link runOpSurface} call finds it, so the
 * password is typed into whatever `op` that PATH names. That is the same-user boundary, accepted rather than
 * closed: anything able to shadow `op` for this user can already read the 0600 secret directly.
 */
const SIGNIN_EXPECT_SCRIPT = `
log_user 0
set timeout 45
gets stdin password
if {[info exists env(ONEPASSWORD_SIGNIN_ACCOUNT)]} {
  spawn -noecho ${OP_BINARY} signin --account $env(ONEPASSWORD_SIGNIN_ACCOUNT) -f
} else {
  spawn -noecho ${OP_BINARY} signin -f
}
expect {
  -re {Enter the password[^\\n]*: $} { send -- "$password\\r" }
  timeout { puts stderr "op signin never prompted for a password"; exit 70 }
  eof { puts stderr "op signin exited before prompting for a password"; exit 71 }
}
log_user 1
expect eof
lassign [wait] pid spawnid oserr code
exit $code
`;

/** The binary that gives `op signin` its terminal: the system copy, never one found on PATH. */
const EXPECT_BINARY = "/usr/bin/expect";

/**
 * The lines of a failed sign-in worth printing: `op`'s own `[ERROR]` sentences and the script's refusals.
 *
 * A failed sign-in prints no session and the terminal never echoes the password — but an `op` that is not
 * the real one could print it back, so the password is redacted from every kept line before it can reach
 * a log. The filter keeps everything else `op` wrote out regardless.
 *
 * @param output what the terminal and stderr carried
 * @param password the password that was typed, never to appear in what this returns
 * @returns the error sentences, in order
 */
export function signinFailureLines({ output, password }: { output: string; password: string }): readonly string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[ERROR]") || line.startsWith("op signin "))
    .map((line) => (password === "" ? line : line.split(password).join("<redacted>")));
}

/**
 * Sign the atlas account in, unattended, and return its session without printing it.
 *
 * The one `op` call outside the surface allowlist, and it reads nothing: it mints the session the
 * allowlisted surfaces then run as. {@link SIGNIN_EXPECT_SCRIPT} says why it needs a terminal. The token is
 * parsed out of the `export` line and handed back for the caller to put in the environment of later calls,
 * never written anywhere.
 *
 * @param account the validated account shorthand, or `null` for the one account `~/.config/op/config` holds
 * @param password the dedicated account's password, from the `onepassword-atlas-password` secret
 * @param env the environment to hand the child
 * @returns the session, or why the sign-in failed — never the output itself
 */
export function signInOpSession({
  account,
  password,
  env = process.env,
}: {
  account: string | null;
  password: string;
  env?: NodeJS.ProcessEnv;
}): Result<OpSession> {
  const argv = ["signin", ...(account === null ? [] : ["--account", account])];
  const accountEnv = account === null ? env : { ...env, ONEPASSWORD_SIGNIN_ACCOUNT: account };
  let stdout: string;
  try {
    stdout = execFileSync(EXPECT_BINARY, ["-c", SIGNIN_EXPECT_SCRIPT], {
      encoding: "utf8",
      env: opCliOnlyEnv({ env: accountEnv }),
      input: `${password}\n`,
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
  } catch (error: unknown) {
    const streams = ["stdout", "stderr"].map((name) =>
      isRecord(error) && typeof error[name] === "string" ? error[name] : "",
    );
    const status = isRecord(error) && typeof error["status"] === "number" ? String(error["status"]) : "no status";
    return err(
      onepasswordOpErrorLines({
        error: OnepasswordOpErrors.callFailed({
          argv,
          cause: new Error(`exited ${status}`),
          stderr: signinFailureLines({ output: streams.join("\n"), password }).join("\n"),
        }),
      }),
    );
  }
  return parseOpSigninExport({ stdout }).mapErr((error) => onepasswordOpErrorLines({ error }));
}
