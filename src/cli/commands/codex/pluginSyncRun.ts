/**
 * `slopweaver codex plugin-sync` — keep every Codex home's install of Slopweaver on the main checkout's commit.
 *
 * Every Codex home: each one the plan register names, paused rows included, and the ambient `$CODEX_HOME`
 * (`src/codexPlugin/homes.ts`), because a seat boots with `CODEX_HOME` set to its plan's home and loads only
 * what is installed THERE. The export is cut once; each home gets its own add, read-back, hook-trust pass and line.
 *
 * `lefthook.yml`'s `post-merge` runs it in every checkout, and every landing reaches this machine as a
 * fast-forward of the main checkout, so that is when an install moves. The hook runs two halves. `--decide`
 * answers the do-nothing cases (not a main checkout, no marketplace entry, every home current or never
 * installed) in the foreground and exits 3 unless a refresh is due. Only then does the hook's own shell
 * background `--log`, which exports and runs `codex plugin add` into each due home — about 13 s per home,
 * measured on this tree — then has Codex trust every hook it installed there, and writes one line per home to
 * `codex-plugin/sync.log` under the cache root (`src/cacheHome.ts`), which is rebuildable and so outside the home.
 * The shell does the backgrounding, never this process: `no-headless` refuses an async child process anywhere in
 * `src/`, and `scripts/docs-site.sh --refresh --background` hands the console's rebuild off the same way. A
 * session-start fast-forward runs inside a 60 s hook budget and must not hold it.
 *
 * **The hook only UPDATES a home that already carries an install stamp.** It never seeds the personal
 * marketplace and never makes a first install; those are a foreground run's, so the first write into each real
 * Codex home is one somebody started and watched (`src/codexPlugin/fleetPlan.ts` § Two scopes). The route and
 * its measurements: `src/codexPlugin/plan.ts`.
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
import { codexDestinations } from "../../../codex/destinations.js";
import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import type { SyncPaths } from "../../../codexPlugin/fleetPlan.js";
import { backgroundFailures, renderSyncOutcome, syncFailed } from "../../../codexPlugin/plan.js";
import { pluginSyncOutcome, productionPluginSyncDeps, type SyncMode } from "../../../codexPlugin/run.js";
import { planRegisterPort } from "../../../plans/port.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { trustPluginHooks } from "./pluginTrust.js";

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
  "Export this main checkout's HEAD into <cache>/codex-plugin/slopweaver (`doctor` prints <cache>), add a local\n" +
  "slopweaver entry to the personal Codex marketplace (~/.agents/plugins/marketplace.json) when it has none, and\n" +
  "run `codex plugin add` into EVERY Codex home: each one the plan register names, paused ones included, and the\n" +
  "ambient $CODEX_HOME. Each home gets its own line and its own hook-trust pass; a registered home with no\n" +
  "directory is that home's failure. Skips a checkout that is not a declared main checkout of Slopweaver.\n" +
  "\n" +
  "  --decide  the post-merge hook's foreground half: re-state the last background run's failures and print the\n" +
  "            decision, exiting 3 when no home is due, so the hook backgrounds --log only when one is\n" +
  "  --log     the hook's background half: refresh, writing one line per home (a crash included) to\n" +
  "            <cache>/codex-plugin/sync.log instead of stdout\n" +
  "  --home    the Slopweaver home whose profile declares the main checkouts and whose plan register names the\n" +
  "            Codex homes\n" +
  "\n" +
  "--decide and --log only UPDATE a home that already carries an install; they never edit the marketplace and\n" +
  "never make a first install. A plain run does both.";

/** `$CODEX_HOME` when set, else Codex's own default under the user's home. */
function ambientCodexHome(): string {
  const named = process.env["CODEX_HOME"];
  if (named !== undefined && named.length > 0) {
    return named;
  }
  return join(homedir(), ".codex");
}

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

/** Print each failure the last background run left in its log. */
function restatePreviousFailures({ log }: { log: string }): void {
  if (!existsSync(log)) {
    return;
  }
  for (const failure of backgroundFailures({ log: readFileSync(log, "utf8") })) {
    logger.out({ line: `codex plugin-sync: ${failure} (log ${log})` });
  }
}

/** The background half: refresh, turning anything thrown into a recorded failure, and write every line at once. */
async function runToLog({
  paths,
  run,
  log,
}: {
  paths: SyncPaths;
  run: () => ReturnType<typeof pluginSyncOutcome>;
  log: string;
}): Promise<number> {
  let lines: readonly string[];
  let failed: boolean;
  try {
    const outcome = await run();
    lines = renderSyncOutcome({ outcome });
    failed = syncFailed({ outcome });
  } catch (error: unknown) {
    const crashed = {
      did: "failed",
      error: CodexPluginSyncErrors.crashed({ detail: errorMessage({ error }) }),
    } as const;
    lines = renderSyncOutcome({ outcome: crashed });
    failed = true;
  }
  mkdirSync(paths.exportRoot, { recursive: true });
  writeFileAtomic({ contents: `${lines.join("\n")}\n`, path: log });
  return failed ? EXIT_ERROR : EXIT_OK;
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv
 * @returns the process exit code — 3 from `--decide` when no home is due, 1 when any home failed
 */
export async function runCodexPluginSync(argv: readonly string[]): Promise<number> {
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
    exportRoot: cachePaths().codexPlugin,
    userHome: homedir(),
  };
  const log = join(paths.exportRoot, "sync.log");
  const deps = productionPluginSyncDeps({
    ambientCodexHome: ambientCodexHome(),
    log,
    mainCheckouts: mainCheckoutsFromProfile({ home }).map((config) => config.path),
    paths,
    readDestinations: () => codexDestinations({ home, port: planRegisterPort() }),
    trustHooks: trustPluginHooks,
  });
  if (mode === "log") {
    return runToLog({ log, paths, run: () => pluginSyncOutcome({ deps, mode }) });
  }
  restatePreviousFailures({ log });
  const outcome = await pluginSyncOutcome({ deps, mode });
  for (const line of renderSyncOutcome({ outcome })) {
    logger.out({ line });
  }
  if (syncFailed({ outcome })) {
    return EXIT_ERROR;
  }
  return mode === "decide" && outcome.did !== "backgrounded" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const codexPluginSyncCommand = defineCommand({ run: runCodexPluginSync });
