/**
 * The EFFECTFUL half of the live Codex account read: ask every registered store's own `codex app-server`
 * who it is signed in as and how full its windows are, all at once, in one blocking child process.
 *
 * ## Why a Tcl program sits between this and the app-server
 *
 * The app-server speaks newline-delimited JSON-RPC over stdio and EXITS on stdin EOF, dropping any request it
 * has not answered — `account/rateLimits/read` is a network round trip, so `spawnSync` with `input` (which
 * closes stdin at once) never sees it. Holding stdin open while reading needs an asynchronous child, and
 * `no-headless` NH001 bans those outright. `/usr/bin/tclsh` is the shape `claude mint` already uses with
 * `expect`: ONE `spawnSync` of a logic-free program that opens a pipe to each store's app-server, writes the
 * requests it is handed, and waits — concurrently across stores — for the answers whose ids it is told to.
 * The program names no model runner; the command arrives as argv. MEASURED: five stores in 2.03s,
 * two in 1.38s. The read sends four requests and waits on two; `codex reset` sends the consume through the
 * same {@link exchangeWithCodexStores} and waits on one.
 *
 * No model turn runs. `account/read` and `account/rateLimits/read` read account state; nothing here reads
 * `auth.json` or a token — the app-server uses the store's own sign-in the way `codex login status` does.
 *
 * ## Which binary, and what it leaves behind
 *
 * The SDK's own vendored CLI — the binary every pass already spends through — resolved the way the SDK
 * resolves it, never a `codex` on PATH (on the owner's machine that is a cmux wrapper script). It is launched
 * with the plugin sync, bundled skills, memories, goals and apps switched off. MEASURED on a fresh
 * `mktemp -d` home, codex-cli 0.153.4 and 0.155.1: without the flags a launch clones a plugin marketplace
 * (`.tmp/git-*`, a non-OpenAI fetch) and writes `skills/.system`; with them neither appears, and
 * `--strict-config` exits clean, so every key is one the CLI reads. What remains is `installation_id` and the
 * CLI's own SQLite state inside that store — the provider's local state in a directory the register already
 * hands to it, the same kind `codex login` writes. A store that does not exist is never launched into.
 *
 * ## Why tests never reach a real Codex
 *
 * Every function that decides anything takes the reader as a REQUIRED dependency, and the one production
 * reader resolves its binary through {@link resolveAppServerExecutable}, which honours
 * `SLOPWEAVER_CODEX_APP_SERVER`. Every test lane's setup points that at a path that does not exist, so a
 * test that injects no fake reads `unreadable` — today's behaviour — identically on a laptop with Codex
 * installed and in CI.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACCOUNT_REQUEST_ID,
  type CodexAccountLive,
  linesByStore,
  parseCodexAccountLive,
  RATE_LIMITS_REQUEST_ID,
} from "./accountLiveParse.js";
import { codexBrowserOffOverrides } from "./browserSurface.js";
import { codexClientEnvironment } from "./client.js";
import { liveReadLaunch } from "./liveReadBudget.js";
import { LIVE_READ_PROGRAM } from "./liveReadProgram.js";
import { type CodexCli, vendoredCodexCli } from "./vendoredCli.js";

/** How one caller hands a batch of stores to the live read — the seam every decision takes. */
export type ReadCodexAccountsLive = (input: {
  readonly codexHomes: readonly string[];
  readonly readAtIso: string;
  /** The epoch-millisecond instant the whole batch must be over by, when a caller has one (`./fleetRead.ts`). */
  readonly deadlineAtMs?: number;
}) => readonly CodexAccountLive[];

/** The environment variable naming the app-server binary; every test lane sets it to a path that is absent. */
export const APP_SERVER_ENV = "SLOPWEAVER_CODEX_APP_SERVER";

/**
 * How long the whole batch may take to answer, measured from the program's start: every store shares ONE absolute
 * deadline, so a long register cannot push its last store's deadline past the outer timeout. Measured answers
 * arrive in under 2.5s.
 */
const PER_STORE_DEADLINE_MS = 8_000;
/** Bytes one store may write before it is cut off — a measured answer pair is under 2 KiB. */
const PER_STORE_BYTE_CAP = 256 * 1024;

/**
 * What a launch has to see. `account` is every read that needs account state alone, and switches plugins off
 * with everything else. `plugin-hooks` is the one read that needs the INSTALLED plugins loaded — `hooks/list`
 * reports nothing a plugin registers while `plugins` is disabled — so it keeps them on, and with them Codex's own
 * curated-marketplace git sync, the thing every interactive launch on that home already does (MEASURED on
 * codex-cli 0.157.1: an empty `CODEX_HOME` grew a `.tmp/git-*` clone under `plugins-enabled` flags).
 */
export type CodexLaunchScope = "account" | "plugin-hooks";

/**
 * The switches that keep a launch to what its scope needs — see this module's header for the measurement. Exported
 * for the one other program that holds an app-server open, a Connect's sign-in (`./loginExchange.ts`).
 *
 * @param scope what the launch has to see
 * @returns the app-server argv after the binary
 */
export function launchFlags({ scope }: { scope: CodexLaunchScope }): readonly string[] {
  const plugins = scope === "account" ? ["--disable", "plugins"] : [];
  return ["app-server", "--strict-config", ...plugins, ...QUIET_FLAGS];
}

/** The switches every launch carries whatever its scope. */
const QUIET_FLAGS: readonly string[] = [
  "--disable",
  "remote_plugin",
  "--disable",
  "memories",
  "--disable",
  "goals",
  "--disable",
  "skill_search",
  "--disable",
  "apps",
  "-c",
  "skills.bundled.enabled=false",
  // An app-server starts its MCP servers on `thread/start` and never on this read's four requests — measured
  // with a home declaring a server that touches a marker file: absent after these requests, present
  // after a `thread/start` (`codex/browserDoor.ts` is the door on the launches that DO start a thread). The
  // overrides ride anyway, because `--disable plugins` leaves `node_repl` declared, so a request added to
  // REQUESTS that starts a thread cannot bring the ChatGPT app's browser up with it.
  ...codexBrowserOffOverrides().flatMap((override) => ["-c", override]),
];

/** The four lines each store is sent: the handshake, then the two reads. */
const REQUESTS: readonly string[] = [
  JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "slopweaver", version: "0" } } }),
  JSON.stringify({ method: "initialized" }),
  JSON.stringify({ id: RATE_LIMITS_REQUEST_ID, method: "account/rateLimits/read" }),
  JSON.stringify({ id: ACCOUNT_REQUEST_ID, method: "account/read", params: { refreshToken: false } }),
];

/**
 * The app-server binary: `SLOPWEAVER_CODEX_APP_SERVER` when set, else the SDK's vendored CLI, resolved the way
 * `./vendoredCli.ts` resolves it.
 *
 * @param env the environment to read the override from
 * @returns the absolute path, or the reason there is none on this machine
 */
export function resolveAppServerExecutable({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): CodexCli | { readonly reason: string } {
  const override = env[APP_SERVER_ENV];
  if (override !== undefined && override !== "") {
    return { path: override, pathDirs: [] };
  }
  return vendoredCodexCli();
}

/**
 * Read every store's live account state in one blocking child — the production {@link ReadCodexAccountsLive}.
 *
 * A store that does not exist is `store-missing` and never launched into. Anything that stops the read as a
 * whole — no binary, no `tclsh`, the outer ceiling — makes every launched store `unreadable` with that
 * reason; a store that failed on its own terms never takes another store's answer with it.
 *
 * @param codexHomes the stores to read, in the order the answer is returned
 * @param readAtIso the instant every row is dated
 * @param deadlineAtMs the instant the batch must be over by, judged at launch: it shortens the shared deadline so
 *   the deadline plus the standing cleanup margin fits — and, too close to leave a launch any chance, makes every
 *   present store `unreadable` unlaunched
 * @returns one live state per store, in the order given
 */
export function readCodexAccountsLive({
  codexHomes,
  deadlineAtMs,
  readAtIso,
}: {
  codexHomes: readonly string[];
  deadlineAtMs?: number;
  readAtIso: string;
}): readonly CodexAccountLive[] {
  const present = codexHomes.filter((codexHome) => existsSync(codexHome));
  let answers: ReadonlyMap<string, CodexAccountLive> = new Map();
  if (present.length > 0) {
    answers = readPresent({ codexHomes: present, readAtIso, ...(deadlineAtMs === undefined ? {} : { deadlineAtMs }) });
  }
  return codexHomes.map((codexHome) => {
    const answer = answers.get(codexHome);
    if (answer !== undefined) {
      return answer;
    }
    return { codexHome, kind: "store-missing", readAtIso };
  });
}

/** One `tclsh` run over the stores that exist, keyed by store, inside the caller's deadline when there is one. */
function readPresent({
  codexHomes,
  deadlineAtMs,
  readAtIso,
}: {
  codexHomes: readonly string[];
  deadlineAtMs?: number;
  readAtIso: string;
}): ReadonlyMap<string, CodexAccountLive> {
  const exchanged = exchangeWithCodexStores({
    answerIds: [RATE_LIMITS_REQUEST_ID, ACCOUNT_REQUEST_ID],
    codexHomes,
    deadlineMs: PER_STORE_DEADLINE_MS,
    requests: REQUESTS,
    scope: "account",
    ...(deadlineAtMs === undefined ? {} : { callerDeadlineAtMs: deadlineAtMs }),
  });
  if ("reason" in exchanged) {
    return new Map(
      codexHomes.map((codexHome) => [
        codexHome,
        { codexHome, kind: "unreadable", readAtIso, reason: exchanged.reason } satisfies CodexAccountLive,
      ]),
    );
  }
  return new Map(
    codexHomes.map((codexHome, index) => [
      codexHome,
      parseCodexAccountLive({ codexHome, lines: exchanged.linesByStore[index]!, readAtIso }),
    ]),
  );
}

/** The app-server an exchange launches, once its answer ids are known safe to hand the Tcl program, or why not. */
function exchangeExecutable({
  answerIds,
}: {
  answerIds: readonly number[];
}): { readonly path: string } | { readonly reason: string } {
  // The ids reach a regular expression inside the Tcl program, so anything but a plain integer is refused here
  // rather than handed to it.
  if (answerIds.length === 0 || !answerIds.every((id) => Number.isSafeInteger(id) && id >= 0)) {
    return { reason: `the answer ids ${JSON.stringify(answerIds)} are not a list of non-negative integers` };
  }
  const executable = resolveAppServerExecutable({ env: process.env });
  if ("reason" in executable) {
    return { reason: executable.reason };
  }
  if (!existsSync(executable.path)) {
    return { reason: `the Codex CLI is not at ${executable.path}` };
  }
  return { path: executable.path };
}

/**
 * Hold ONE JSON-RPC exchange open with each store's own app-server, all at once, and return what each answered.
 *
 * The one transport both the live read and `codex reset` speak through: the requests are sent in order, and a
 * store is ended once it has answered every id in `answerIds` — or on EOF, the byte cap or the shared deadline,
 * each of which it reports as a marker line (`LIVE_MARKER_PREFIX`) in place of the missing answers.
 *
 * @param codexHomes the stores to hold the exchange with, every one of which must exist
 * @param requests the newline-free JSON lines to send each store, the handshake included
 * @param answerIds the request ids whose answers end a store's exchange — every other line it writes is dropped
 * @param deadlineMs how long the whole batch may take, measured from its launch, when no caller deadline is nearer
 * @param scope whether the launch loads the installed plugins, which only a hook read needs
 * @param callerDeadlineAtMs the epoch-millisecond instant the whole exchange, cleanup included, must be over by —
 *   judged at launch by {@link liveReadLaunch}, which shortens the batch or launches nothing
 * @returns each store's answer lines in store order, or why the exchange could not run at all
 */
export function exchangeWithCodexStores({
  answerIds,
  callerDeadlineAtMs,
  codexHomes,
  deadlineMs,
  requests,
  scope,
}: {
  answerIds: readonly number[];
  callerDeadlineAtMs?: number;
  codexHomes: readonly string[];
  deadlineMs: number;
  requests: readonly string[];
  scope: CodexLaunchScope;
}): { readonly linesByStore: readonly (readonly string[])[] } | { readonly reason: string } {
  const executable = exchangeExecutable({ answerIds });
  if ("reason" in executable) {
    return executable;
  }
  const dir = mkdtempSync(join(tmpdir(), "sw-codex-live-"));
  try {
    const programPath = join(dir, "read.tcl");
    writeFileSync(programPath, LIVE_READ_PROGRAM, { mode: 0o600 });
    return runLiveReadProgram({
      answerIds,
      callerDeadlineAtMs,
      codexHomes,
      executablePath: executable.path,
      programPath,
      requests,
      scope,
      standingMs: deadlineMs,
    });
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/** Run the written Tcl program over the stores once, killed at the outer timeout, and split what it printed. */
function runLiveReadProgram({
  answerIds,
  callerDeadlineAtMs,
  codexHomes,
  executablePath,
  programPath,
  requests,
  scope,
  standingMs,
}: {
  answerIds: readonly number[];
  callerDeadlineAtMs: number | undefined;
  codexHomes: readonly string[];
  executablePath: string;
  programPath: string;
  requests: readonly string[];
  scope: CodexLaunchScope;
  standingMs: number;
}): { readonly linesByStore: readonly (readonly string[])[] } | { readonly reason: string } {
  const storeArgs = [String(PER_STORE_BYTE_CAP), ...codexHomes, "--", executablePath, ...launchFlags({ scope })];
  const env = {
    ...codexClientEnvironment({ codexHome: undefined, env: process.env }),
    SLOPWEAVER_CODEX_LIVE_ANSWER_IDS: answerIds.map(String).join(" "),
    SLOPWEAVER_CODEX_LIVE_REQUESTS: requests.join("\n"),
  };
  // Judged last, after every piece of pre-launch work, so none of it is spent from the caller's deadline unseen:
  // what remains between this instant and the timer starting is `spawnSync`'s own fork and exec.
  const launch = liveReadLaunch({
    deadlineAtMs: callerDeadlineAtMs,
    nowMs: Date.now(),
    standingMs,
    storeCount: codexHomes.length,
  });
  if ("reason" in launch) {
    return { reason: launch.reason };
  }
  const run = spawnSync("tclsh", [programPath, launch.deadlineArg, ...storeArgs], {
    encoding: "utf8",
    // The outer timeout is a backstop, so it cannot be one a `tclsh` may decline: SIGTERM can be ignored and
    // `spawnSync` would not return until it exits. `talk verb` kills the same way.
    killSignal: "SIGKILL",
    env,
    maxBuffer: PER_STORE_BYTE_CAP * (codexHomes.length + 1),
    stdio: ["ignore", "pipe", "ignore"],
    timeout: launch.outerTimeoutMs,
  });
  if (run.error !== undefined) {
    return { reason: `the app-server exchange could not run: ${run.error.message}` };
  }
  return { linesByStore: linesByStore({ stdout: run.stdout, storeCount: codexHomes.length }) };
}
