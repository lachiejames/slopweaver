/**
 * `slopweaver desktop prebuild` — build and sign the app at the main checkout's HEAD into the one staged folder, so
 * the owner's Update now installs it rather than starting a build, so the app never lags the main checkout
 * by fifty landed PRs when the owner updates.
 *
 * `lefthook.yml`'s `post-merge` runs it in two halves, exactly as `codex plugin-sync` is run: `--decide` answers
 * every do-nothing case in the foreground and exits 3 unless a build is due, and only then does the hook's own
 * shell background `--log`, which builds and writes its outcome line to the stage's `prebuild.log`. The shell
 * backgrounds it, never this process: `no-headless` keeps an async child process out of `src/`.
 *
 * It never touches `/Applications`, never quits or opens the app, and never mints the signing identity — that
 * stays the first install's. The decisions are pure in `../../../desktop/stagedBuild.ts`, the build under the lock
 * is `prebuildHeld.ts`, and every effect goes through `installSeams.ts`, the install's own.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { DesktopInstallErrors } from "../../../desktop/errors.js";
import { hostSupported } from "../../../desktop/installPlan.js";
import { type StagePaths, stagePaths } from "../../../desktop/stagedBuild.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { BUILD_LOCK_KEY, holdBuildLock } from "./buildLock.js";
import { DESKTOP_PREBUILD_USAGE } from "./desktopUsage.js";
import { APP_SUPPORT, attempt } from "./installProcess.js";
import { type InstallSeams, machineSeams } from "./installSeams.js";
import { decidePrebuild, type PrebuildOutcome, prebuildHeld } from "./prebuildHeld.js";

/** argv[0..3] are node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The flags `desktop prebuild` accepts, without their leading `--`. */
const PREBUILD_FLAGS: FlagSpec = { boolean: ["decide", "log"], string: ["home"] };

/** The same flags, `--`-prefixed, for the help-truth ratchet. */
export const DESKTOP_PREBUILD_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: PREBUILD_FLAGS }),
  ...stringFlagsOf({ spec: PREBUILD_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `desktop prebuild` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseDesktopPrebuildArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PREBUILD_FLAGS });
}

/** The prefix every line of this verb carries, which is how a failed last run is found again in its log. */
const PREFIX = "desktop prebuild:";

/**
 * The one line a prebuild's outcome reads as.
 *
 * @param outcome what the run did
 * @returns the line
 */
export function renderPrebuildOutcome({ outcome }: { outcome: PrebuildOutcome }): string {
  switch (outcome.did) {
    case "skipped":
      return `${PREFIX} nothing to build — ${outcome.why}`;
    case "due":
      return `${PREFIX} ${outcome.why}, in the background (log ${outcome.log})`;
    case "built":
      return `${PREFIX} ${outcome.sha.slice(0, 9)} is built, signed and waiting for Update now`;
    case "moved":
      return (
        `${PREFIX} HEAD moved from ${outcome.from.slice(0, 9)} to ${outcome.to.slice(0, 9)} during the build, so ` +
        "it and any older staged build were discarded; the move's own hook builds the new one"
      );
    case "failed":
      return `${PREFIX} failed — ${outcome.error.message}`;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/** Which half of the verb runs: the hook's two, or a plain run in the foreground. */
type PrebuildMode = "decide" | "log" | "foreground";

/**
 * One prebuild: the host check, the decision, then — unless only deciding — the build under the lock.
 *
 * @returns what the run did
 */
async function prebuild({
  seams,
  home,
  mode,
  paths,
}: {
  seams: InstallSeams;
  home: string;
  mode: PrebuildMode;
  paths: StagePaths;
}): Promise<PrebuildOutcome> {
  const host = hostSupported({ arch: process.arch, platform: process.platform });
  if (host.isErr()) {
    return { did: "skipped", why: host.error.message };
  }
  const decided = decidePrebuild({ home, paths, seams });
  if (decided.isErr()) {
    return { did: "failed", error: decided.error };
  }
  if (!decided.value.decision.due) {
    return { did: "skipped", why: decided.value.decision.why };
  }
  if (mode === "decide") {
    return { did: "due", log: paths.log, why: decided.value.decision.why };
  }
  const lock = await holdBuildLock({
    acquire: () =>
      acquireOperationLock({
        home: APP_SUPPORT,
        key: BUILD_LOCK_KEY,
        nowIso: new Date(seams.nowMs()).toISOString(),
        staleAfterMs: Number.POSITIVE_INFINITY,
      }),
    nowMs: seams.nowMs,
    pause: seams.pause,
    waiting: ({ detail }) => {
      seams.out({ line: `${PREFIX} waiting for the build in progress (${detail})` });
    },
  });
  if (lock.isErr()) {
    return { did: "failed", error: DesktopInstallErrors.installInProgress({ detail: lock.error }) };
  }
  try {
    return prebuildHeld({ home, paths, seams });
  } finally {
    lock.value.release();
  }
}

/** The mode and `--home` the flags name, or the problems to print before the usage. */
function modeOf({ rest }: { rest: readonly string[] }): Result<{ mode: PrebuildMode; named: string | undefined }> {
  const parsed = parseDesktopPrebuildArgs({ rest });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  if (values["decide"] === true && values["log"] === true) {
    return err(["--decide and --log are the hook's two halves; pass one"]);
  }
  let mode: PrebuildMode = "foreground";
  if (values["decide"] === true) {
    mode = "decide";
  } else if (values["log"] === true) {
    mode = "log";
  }
  const named = values["home"];
  return ok({ mode, named: typeof named === "string" ? named : undefined });
}

/** The last run's line, when it recorded a failure, so the next foreground decision says so. */
function previousFailure({ seams, log }: { seams: InstallSeams; log: string }): string | undefined {
  if (!seams.exists({ path: log })) {
    return undefined;
  }
  const failed = attempt({ act: () => seams.readText({ path: log }), what: `could not read ${log}` });
  if (failed.isErr()) {
    return undefined;
  }
  return failed.value.split("\n").find((line) => line.startsWith(`${PREFIX} failed`));
}

/**
 * The hook's background half: run the build with every line kept, then write them to the stage's log, which the
 * writer creates the folder for. A throw is a failed run like any other, so the log still records it.
 *
 * @returns the process exit code
 */
async function runLogged({
  seams,
  home,
  paths,
}: {
  seams: InstallSeams;
  home: string;
  paths: StagePaths;
}): Promise<number> {
  const lines: string[] = [];
  const logged: InstallSeams = { ...seams, out: ({ line }) => lines.push(line) };
  let outcome: PrebuildOutcome;
  try {
    outcome = await prebuild({ home, mode: "log", paths, seams: logged });
  } catch (error: unknown) {
    outcome = {
      did: "failed",
      error: DesktopInstallErrors.stepFailed({ command: "desktop prebuild", detail: errorMessage({ error }) }),
    };
  }
  lines.push(renderPrebuildOutcome({ outcome }));
  seams.writeText({ path: paths.log, text: `${new Date(seams.nowMs()).toISOString()}\n${lines.join("\n")}\n` });
  return outcome.did === "failed" ? EXIT_ERROR : EXIT_OK;
}

/**
 * A run in the foreground — the hook's deciding half, or a plain one — printing the last run's failure first.
 *
 * @returns the process exit code — 3 from `--decide` when no build is due, 1 for a failed run
 */
async function runShown({
  seams,
  home,
  mode,
  paths,
}: {
  seams: InstallSeams;
  home: string;
  mode: PrebuildMode;
  paths: StagePaths;
}): Promise<number> {
  const previous = previousFailure({ log: paths.log, seams });
  if (previous !== undefined) {
    logger.out({ line: `${previous} (log ${paths.log})` });
  }
  const outcome = await prebuild({ home, mode, paths, seams });
  logger.out({ line: renderPrebuildOutcome({ outcome }) });
  if (outcome.did === "failed") {
    return EXIT_ERROR;
  }
  return mode === "decide" && outcome.did !== "due" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv
 * @returns the process exit code — 3 from `--decide` when no build is due, 1 for a failed run
 */
export async function runDesktopPrebuild(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  const asksHelp = rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h");
  if (asksHelp) {
    logger.out({ line: DESKTOP_PREBUILD_USAGE });
    return EXIT_OK;
  }
  const parsed = modeOf({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: DESKTOP_PREBUILD_USAGE });
    return EXIT_USAGE;
  }
  const { mode, named } = parsed.value;
  const home = resolveHome({ named });
  const seams = machineSeams();
  const paths = stagePaths({ appSupport: APP_SUPPORT, nonce: seams.nonce });
  if (mode === "log") {
    return runLogged({ home, paths, seams });
  }
  return runShown({ home, mode, paths, seams });
}

export const desktopPrebuildCommand = defineCommand({ run: runDesktopPrebuild });
