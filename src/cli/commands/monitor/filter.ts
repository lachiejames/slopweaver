/**
 * `slopweaver monitor filter <install|show|status>` — the cmux notification filter, owned by a verb.
 *
 * `show` prints the script and touches nothing, which is what makes `install` reviewable before it runs.
 * `status` reads what the filter has ACTUALLY judged rather than whether the files are there, because a
 * shim cmux never invokes and a filter passing everything are the two failures that look alike from here.
 */
import { readFileSync } from "node:fs";

import { buildFilterScript } from "../../../monitor/filter.js";
import { hookCommandPaths, installFilter, readFilterStatus } from "../../../monitor/filterInstall.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flag, resolvedHomeOf } from "../hand/deps.js";

import { FILTER_USAGE, parseMonitorFilterArgs, VERB_ARG_OFFSET } from "./core.js";
import { type MonitorDeps, productionMonitorDeps } from "./deps.js";

/** The three actions, so an unknown one is refused by name rather than falling through to a default. */
const ACTIONS = ["install", "show", "status"] as const;

/**
 * The path cmux's config names for its notification hook.
 *
 * `--hook-script` wins, because a test and a `--home` install both need to name their own. Otherwise it is
 * DISCOVERED out of the owner's config: the file name there is one the owner chose, so it is state rather than code
 * (AGENTS.md, "Tools in the codebase, state outside it") and a constant here would be wrong on any other
 * install.
 *
 * @param values the parsed flag map
 * @param configPath cmux's own config
 * @returns the hook path, or the sentence saying why none could be found
 */
export function hookScriptPath({
  values,
  configPath,
}: {
  values: Readonly<Record<string, unknown>>;
  configPath: string;
}): { readonly path: string } | { readonly problem: string } {
  const supplied = flag({ name: "hook-script", values });
  if (supplied !== undefined) {
    return { path: supplied };
  }
  let configText: string;
  try {
    configText = readFileSync(configPath, "utf8");
  } catch {
    return { problem: `${configPath} could not be read — name the hook with --hook-script <path>` };
  }
  const paths = hookCommandPaths({ configText });
  const first = paths[0];
  if (first === undefined) {
    return {
      problem: `${configPath} declares no notifications.hooks command — add one, or name it with --hook-script <path>`,
    };
  }
  if (paths.length > 1) {
    return {
      problem: `${configPath} declares ${String(paths.length)} notification hooks and this verb will not guess which one is ours — name it with --hook-script <path>`,
    };
  }
  return { path: first };
}

/**
 * Run `monitor filter` against injected seams.
 *
 * @param rest the argv tail after `monitor filter`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runMonitorFilter({ rest, deps }: { rest: readonly string[]; deps: MonitorDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(FILTER_USAGE);
    return EXIT_OK;
  }
  const parsed = parseMonitorFilterArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(FILTER_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const action = parsed.value.positionals[0];
  if (action === undefined || !ACTIONS.some((known) => known === action)) {
    deps.writeDiagnostic(`monitor filter: expected one of ${ACTIONS.join(", ")}`);
    deps.writeDiagnostic(FILTER_USAGE);
    return EXIT_USAGE;
  }
  const paths = stateHomePaths({ home: resolvedHomeOf({ values }) });
  const filterPaths = { decisionsPath: paths.cmuxNotificationDecisionsJsonl };
  if (action === "show") {
    const script = buildFilterScript({ paths: filterPaths });
    if (script.isErr()) {
      deps.writeDiagnostic(`monitor filter show: ${script.error.message}`);
      return EXIT_ERROR;
    }
    deps.writeOut(script.value);
    return EXIT_OK;
  }
  const hook = hookScriptPath({ configPath: deps.cmuxConfigPath, values });
  if ("problem" in hook) {
    deps.writeDiagnostic(`monitor filter ${action}: ${hook.problem}`);
    return EXIT_USAGE;
  }
  if (action === "status") {
    return reportStatus({
      deps,
      filterPath: paths.cmuxNotificationFilterSh,
      hook: hook.path,
      paths: filterPaths,
      values,
    });
  }
  return reportInstall({
    deps,
    filterPath: paths.cmuxNotificationFilterSh,
    hook: hook.path,
    paths: filterPaths,
    values,
  });
}

/**
 * Write the filter and the shim, and print what moved — including the undo.
 *
 * The restore line is printed rather than merely recorded because it is the only undo that outlives this
 * session: `installFilter` backs the owner's own hook script up beside itself, and nothing else on the machine knows
 * where that copy went.
 *
 * @param filterPath where the real filter goes
 * @param hook the path cmux's config names, which becomes the shim
 * @param paths where the decision log lives
 * @param values the parsed flags
 * @param deps the verb's seams
 * @returns the process exit code
 */
function reportInstall({
  filterPath,
  hook,
  paths,
  values,
  deps,
}: {
  filterPath: string;
  hook: string;
  paths: { readonly decisionsPath: string };
  values: Readonly<Record<string, unknown>>;
  deps: MonitorDeps;
}): number {
  const receipt = installFilter({ filterPath, hookPath: hook, paths });
  if (receipt.isErr()) {
    deps.writeDiagnostic(`monitor filter install: ${receipt.error.message}`);
    return EXIT_ERROR;
  }
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify(receipt.value));
    return EXIT_OK;
  }
  deps.writeOut(`monitor filter install: the filter is ${receipt.value.filterPath}`);
  deps.writeOut(`  cmux runs ${receipt.value.hookPath}, which now hands off to it`);
  if (receipt.value.backupPath !== undefined) {
    deps.writeOut(`  what was there is ${receipt.value.backupPath}`);
  }
  deps.writeOut(`  undo with: ${receipt.value.restore}`);
  return EXIT_OK;
}

/**
 * Print what the filter has done, not what it was meant to do.
 *
 * @param filterPath the real filter
 * @param hook the path cmux's config names
 * @param paths where the decision log lives
 * @param values the parsed flags
 * @param deps the verb's seams
 * @returns the process exit code
 */
function reportStatus({
  filterPath,
  hook,
  paths,
  values,
  deps,
}: {
  filterPath: string;
  hook: string;
  paths: { readonly decisionsPath: string };
  values: Readonly<Record<string, unknown>>;
  deps: MonitorDeps;
}): number {
  const status = readFilterStatus({ decisionsPath: paths.decisionsPath, filterPath, hookPath: hook });
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ ...status, filterPath, hookPath: hook }));
    return EXIT_OK;
  }
  deps.writeOut(`monitor filter status: ${status.installed ? "installed" : "NOT installed"} at ${hook}`);
  deps.writeOut(`  filter ${status.filterPresent ? "present" : "MISSING"} at ${filterPath}`);
  if (status.decisions === undefined) {
    deps.writeOut("  it has judged nothing — either cmux has raised no notification, or it is not running this hook");
    return EXIT_OK;
  }
  const { judged, passed } = status.decisions;
  deps.writeOut(`  judged ${String(judged)}, passed ${String(passed)}, suppressed ${String(judged - passed)}`);
  return EXIT_OK;
}

/** `slopweaver monitor filter`. */
export const monitorFilterCommand = defineCommand({
  run: (argv) => runMonitorFilter({ deps: productionMonitorDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
