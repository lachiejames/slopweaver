/**
 * `slopweaver codex plugin-sync` — keep the Codex install of Slopweaver on the main checkout's commit.
 *
 * `lefthook.yml`'s `post-merge` runs it in every checkout, and every landing reaches this machine as a
 * fast-forward of the main checkout, so that is when the install moves. The hook runs two halves. `--decide`
 * answers the do-nothing cases (not a main checkout, no Codex install, already current) in the foreground and
 * exits 3 unless a refresh is due. Only then does the hook's own shell background `--log`, which runs the
 * export plus `codex plugin add` — about 13 s measured on this tree — then has Codex trust every hook the refresh
 * installed, and writes its outcome line and the trust line to `codex-plugin/sync.log` under the cache root
 * (`src/cacheHome.ts`), which is rebuildable and so outside the home. The shell does the backgrounding, never this process: `no-headless`
 * refuses an async child process anywhere in `src/`, and `scripts/docs-site.sh --refresh --background` hands
 * the console's rebuild off the same way. A session-start fast-forward runs inside a 60 s hook budget and
 * must not hold it. The route and its measurements: `src/codexPlugin/plan.ts`.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { runningCheckoutRoot } from "#lib/gitRepo.js";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { cachePaths } from "../../../cacheHome.js";
import { renderHookTrust } from "../../../codex/hookTrust.js";
import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import { lastBackgroundFailure, renderSyncOutcome, type SyncOutcome } from "../../../codexPlugin/plan.js";
import { performSync, productionSyncDeps, resolveSyncTarget, type SyncPaths } from "../../../codexPlugin/sync.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { installedPluginId, renderTrustPass, trustCodexHooks } from "./hooksRun.js";

/** Where a `codex <verb>` flag tail begins in `process.argv`: `[node, cli, codex, plugin-sync, ...]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `codex plugin-sync` accepts, without their leading `--`. */
const PLUGIN_SYNC_FLAGS: FlagSpec = { boolean: ["decide", "log"], string: ["home"] };

/** The same flags, `--`-prefixed, for the help-truth ratchet. */
export const CODEX_PLUGIN_SYNC_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: PLUGIN_SYNC_FLAGS }),
  ...stringFlagsOf({ spec: PLUGIN_SYNC_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `codex plugin-sync` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexPluginSyncArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PLUGIN_SYNC_FLAGS });
}

/** Usage for `codex plugin-sync`, shared by `--help` and the manifest. */
export const CODEX_PLUGIN_SYNC_USAGE =
  "usage: slopweaver codex plugin-sync [--decide | --log] [--home <dir>]\n" +
  "\n" +
  "Export this main checkout's HEAD into <cache>/codex-plugin/slopweaver (`doctor` prints <cache>), point the personal Codex\n" +
  "marketplace's slopweaver entry at it, re-run `codex plugin add`, and have Codex trust every hook it\n" +
  "installed, so a new Codex session runs HEAD and every one of its hooks.\n" +
  "Skips a checkout that is not a declared main checkout of Slopweaver, and a machine with no Codex entry.\n" +
  "\n" +
  "  --decide  the post-merge hook's foreground half: re-state a failed last run and print the decision,\n" +
  "            exiting 3 when there is nothing to refresh, so the hook backgrounds --log only when one is due\n" +
  "  --log     the hook's background half: refresh, writing the one outcome line (a crash included) to\n" +
  "            <cache>/codex-plugin/sync.log instead of stdout\n" +
  "  --home    the home whose profile declares the main checkouts; the export itself is the machine's";

/** `$CODEX_HOME` when set, else Codex's own default under the user's home. */
function codexHome(): string {
  const named = process.env["CODEX_HOME"];
  if (named !== undefined && named.length > 0) {
    return named;
  }
  return join(homedir(), ".codex");
}

/** Resolve, decide and — unless only deciding — refresh; a due refresh while deciding is `backgrounded`. */
function syncOutcome({
  paths,
  mainCheckouts,
  log,
  decideOnly,
}: {
  paths: SyncPaths;
  mainCheckouts: readonly string[];
  log: string;
  decideOnly: boolean;
}): SyncOutcome {
  const target = resolveSyncTarget({ mainCheckouts, paths });
  if (target.isErr()) {
    return { did: "failed", error: target.error };
  }
  if ("skip" in target.value) {
    return { did: "skipped", why: target.value.skip };
  }
  if (!target.value.decision.refresh) {
    return { did: "current", why: target.value.decision.why };
  }
  if (decideOnly) {
    return { did: "backgrounded", log, why: target.value.decision.why };
  }
  return performSync({ deps: productionSyncDeps(), paths, target: target.value });
}

/** Run the background half, turning anything it throws into a recorded failure, and write the log. */
function runToLog({
  paths,
  mainCheckouts,
  log,
}: {
  paths: SyncPaths;
  mainCheckouts: readonly string[];
  log: string;
}): number {
  let outcome: SyncOutcome;
  try {
    outcome = syncOutcome({ decideOnly: false, log, mainCheckouts, paths });
  } catch (error: unknown) {
    outcome = { did: "failed", error: CodexPluginSyncErrors.crashed({ detail: errorMessage({ error }) }) };
  }
  const lines = [renderSyncOutcome({ outcome })];
  if (outcome.did === "refreshed") {
    lines.push(trustAfterRefresh({ paths }).line);
  }
  mkdirSync(paths.exportRoot, { recursive: true });
  writeFileAtomic({ contents: `${lines.join("\n")}\n`, path: log });
  return outcome.did === "failed" ? EXIT_ERROR : EXIT_OK;
}

/** Which half of the verb runs: the hook's two, or a plain run in the foreground. */
type SyncMode = "decide" | "log" | "foreground";

/** The mode and `--home` the flags name, or the problems to print before the usage. */
function modeOf({ rest }: { rest: readonly string[] }): Result<{ mode: SyncMode; named: string | undefined }> {
  const parsed = parseCodexPluginSyncArgs({ rest });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  if (values["decide"] === true && values["log"] === true) {
    return err(["--decide and --log are the hook's two halves; pass one"]);
  }
  let mode: SyncMode = "foreground";
  if (values["decide"] === true) {
    mode = "decide";
  } else if (values["log"] === true) {
    mode = "log";
  }
  const named = values["home"];
  return ok({ mode, named: typeof named === "string" ? named : undefined });
}

/** Print the last background run's failure, when the log holds one. */
function restatePreviousFailure({ log }: { log: string }): void {
  if (!existsSync(log)) {
    return;
  }
  const previous = lastBackgroundFailure({ log: readFileSync(log, "utf8") });
  if (previous !== undefined) {
    logger.out({ line: `codex plugin-sync: ${previous} (log ${log})` });
  }
}

/**
 * After a refresh, have Codex trust every hook the refresh just installed. A re-add that changed a hook's hash
 * turns that hook off in Codex until its trust record carries the new hash, silently, so the refresh is the
 * moment to write it — the fleet's act, never a step for their hands (`src/codex/hookTrust.ts`).
 * Install and every landing reach this one path, so a new hook rides it too. It never changes the exit code:
 * the refresh succeeded, and a hook still skipped is `slopweaver codex hooks`'s exit 3 to report.
 *
 * @returns the pass line, and the report lines when a hook is still skipped afterwards
 */
function trustAfterRefresh({ paths }: { paths: SyncPaths }): { line: string; still: readonly string[] } {
  const plugin = installedPluginId({ userHome: paths.userHome });
  if ("reason" in plugin) {
    return { line: `codex hooks: nothing to trust — ${plugin.reason}`, still: [] };
  }
  const pass = trustCodexHooks({ codexHome: paths.codexHome, cwd: paths.checkout, pluginId: plugin.pluginId });
  const report = renderHookTrust({ codexHome: paths.codexHome, reading: pass.reading });
  return { line: renderTrustPass({ codexHome: paths.codexHome, pass }), still: report.allRun ? [] : report.lines };
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv
 * @returns the process exit code — 3 from `--decide` when no refresh is due, 1 for a failed run
 */
export function runCodexPluginSync(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CODEX_PLUGIN_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = modeOf({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: CODEX_PLUGIN_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { mode, named } = parsed.value;
  const home = resolveHome({ named });
  const paths: SyncPaths = {
    checkout: runningCheckoutRoot(),
    codexHome: codexHome(),
    exportRoot: cachePaths().codexPlugin,
    userHome: homedir(),
  };
  const mainCheckouts = mainCheckoutsFromProfile({ home }).map((config) => config.path);
  const log = join(paths.exportRoot, "sync.log");
  if (mode === "log") {
    return runToLog({ log, mainCheckouts, paths });
  }
  restatePreviousFailure({ log });
  const decideOnly = mode === "decide";
  const outcome = syncOutcome({ decideOnly, log, mainCheckouts, paths });
  logger.out({ line: renderSyncOutcome({ outcome }) });
  if (outcome.did === "failed") {
    return EXIT_ERROR;
  }
  if (outcome.did === "refreshed") {
    const trusted = trustAfterRefresh({ paths });
    for (const line of [trusted.line, ...trusted.still]) {
      logger.out({ line });
    }
  }
  return decideOnly && outcome.did !== "backgrounded" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const codexPluginSyncCommand = defineCommand({ run: runCodexPluginSync });
