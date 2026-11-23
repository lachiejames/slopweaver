/**
 * Resolve the executables a capability table names, so `src/route/`'s pure planners can be handed data.
 *
 * The split is the one `./atlasReadings.ts` already draws: `./commandReading.ts` decides what a row should
 * advertise and touches no disk, while this one performs the lookups. Only the distinct KEYS the rows
 * actually depend on are resolved, so a forty-row table needing six distinct ones performs six lookups. A
 * row contributes more than one key when it is a shell invocation — `commandExecutableKeysOf` reads a
 * `bash -c` script for the `yarn <token>` pairs inside it — and every key it yields is graded here by the
 * same three rules, because a key from inside a string is the same shape as a key at the head.
 *
 * Three shapes, and which of them can produce a REFUSAL is decided by whether the namespace it searches is
 * the complete answer to the question — `./commandReading.ts`'s header carries why, and the `rg` measurement
 * that makes it a rule rather than caution:
 *
 * - **`yarn <script>`** is resolved against all three things Yarn itself would try, in its own order: the
 *   `scripts` block of the tree this build lives in, then `node_modules/.bin`, then Yarn's own command list.
 *   Together those are the whole of what `yarn <token>` can run, so a miss is `missing`. Checking only
 *   `scripts` would have refused `yarn dlx …` and `yarn node …` rows that run perfectly.
 * - **An ABSOLUTE path** (including the bundled launcher a `slopweaver` head materialises into) is resolved
 *   as a file this process may execute. The filesystem completely answers that, so a miss is `missing`. A
 *   RELATIVE one is `unprovable`: it resolves against the cwd of whoever runs the row, which is not this
 *   process's cwd and is not knowable here.
 * - **A bare name** is walked over `PATH` exactly as the shell would, rather than by shelling out to `which`
 *   — this module sits on the live turn's own path and must not spawn a process per row. `PATH` is NOT the
 *   whole of what a bare name resolves to in the host's shell, so a miss is `unprovable`.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";

import { hostPathEntries, isExecutableFile, resolveOnPath } from "../lib/executableOnPath.js";
import { parseJson } from "../lib/jsonParse.js";
import { isRecord } from "../lib/parsers.js";
import { safeFs } from "../lib/safeBoundary.js";

import { type CommandRouteReading, commandExecutableKeysOf, YARN_EXECUTABLE } from "./commandReading.js";
import type { SourceCapability } from "./profile.js";

/** The argv head `materialiseCapability` swaps for this build's own launcher before anything runs it. */
const SLOPWEAVER_EXECUTABLE = "slopweaver";

/**
 * Yarn's OWN top-level commands, which run whether or not the package declares a script of that name.
 *
 * Taken from `yarn --help` on Yarn 4.18.1, the version `packageManager` pins. Two residues, named rather than
 * discovered: a command a LATER Yarn adds is absent here, and a command a Yarn PLUGIN adds is absent too — a
 * row using either would be graded `missing`. This repository declares no plugins (`.yarnrc.yml` has no
 * `plugins:` key and there is no `.yarn/plugins`), so only the version residue is live today. Re-read the
 * list with the command in the comment below when the pinned version moves.
 */
// yarn --help | sed -e 's/\x1b\[[0-9;]*m//g' | grep -E "^  yarn " | awk '{print $2}' | sort -u
const YARN_OWN_COMMANDS: ReadonlySet<string> = new Set([
  "add",
  "bin",
  "cache",
  "config",
  "constraints",
  "dedupe",
  "dlx",
  "exec",
  "explain",
  "info",
  "init",
  "install",
  "link",
  "node",
  "npm",
  "pack",
  "patch",
  "patch-commit",
  "plugin",
  "rebuild",
  "remove",
  "run",
  "search",
  "set",
  "stage",
  "unlink",
  "unplug",
  "up",
  "upgrade-interactive",
  "version",
  "why",
  "workspace",
  "workspaces",
]);

/** The scripts one `package.json` declares, or `null` when the file could not be read or parsed. */
function declaredScripts({ path }: { path: string }): Readonly<Record<string, unknown>> | null {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "route.readPackageScripts", path });
  if (read.isErr()) {
    return null;
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return null;
  }
  const scripts = isRecord(decoded.value) ? decoded.value["scripts"] : undefined;
  return isRecord(scripts) ? scripts : {};
}

/**
 * Grade a `yarn <token>` pair against all three namespaces Yarn itself would try, in Yarn's own order.
 *
 * Checking only `scripts` was wrong and would have refused working rows: `yarn <token>` also runs a binary in
 * `node_modules/.bin` and any of Yarn's own commands. All three together are the complete answer, which is
 * what licenses the `missing` verdict at the end.
 *
 * @param executable the key being graded, echoed back into the reading
 * @param token the second argv element — a script name, a workspace binary or a Yarn command
 * @param treeRoot the tree whose `package.json` and `node_modules` the host's `yarn` would consult
 * @returns the reading, naming which of the three namespaces settled it
 */
function yarnTokenReading({
  executable,
  token,
  treeRoot,
}: {
  executable: string;
  token: string;
  treeRoot: string;
}): CommandRouteReading {
  const path = join(treeRoot, "package.json");
  const scripts = declaredScripts({ path });
  if (scripts === null) {
    // Unprovable, not missing: nothing was established about the token, so nothing may be refused on it.
    return { because: `${path} could not be read as JSON`, executable, resolution: "unprovable" };
  }
  if (typeof scripts[token] === "string") {
    return {
      because: `\`${executable}\` runs the \`${token}\` script declared in ${path}`,
      executable,
      resolution: "resolved",
    };
  }
  const binary = join(treeRoot, "node_modules", ".bin", token);
  if (isExecutableFile({ path: binary })) {
    return { because: `\`${executable}\` runs the workspace binary ${binary}`, executable, resolution: "resolved" };
  }
  if (YARN_OWN_COMMANDS.has(token)) {
    return { because: `\`${executable}\` is one of Yarn's own commands`, executable, resolution: "resolved" };
  }
  return {
    because: `\`${executable}\` names no script in ${path}, no binary in node_modules/.bin, and no Yarn command`,
    executable,
    resolution: "missing",
  };
}

/**
 * Grade an executable named as a path.
 *
 * Only an ABSOLUTE path may be refused: a relative one resolves against the cwd of whoever runs the row,
 * which is neither this process's cwd nor knowable from here.
 *
 * @param executable the key being graded, echoed back into the reading
 * @param candidate the path to test — the bundled launcher when the key was `slopweaver`
 * @returns the reading, naming the path it tested either way
 */
function pathReading({ executable, candidate }: { executable: string; candidate: string }): CommandRouteReading {
  if (isExecutableFile({ path: candidate })) {
    return { because: `\`${executable}\` is the executable file ${candidate}`, executable, resolution: "resolved" };
  }
  if (!isAbsolute(candidate)) {
    return {
      because: `\`${executable}\` names the relative path ${candidate}, which resolves against the cwd of whoever runs it`,
      executable,
      resolution: "unprovable",
    };
  }
  return {
    because: `\`${executable}\` names ${candidate}, which is not an executable file`,
    executable,
    resolution: "missing",
  };
}

/**
 * Grade one executable key by the rule its shape selects.
 *
 * @param executable the key from `commandExecutableOf`
 * @param slopweaverCommand the bundled launcher a `slopweaver` head materialises into
 * @param treeRoot the tree whose `package.json` a `yarn <script>` key is resolved against
 * @param pathEntries the `PATH` directories a bare name is walked against
 * @returns what the lookup established, and what was looked for where
 */
function executableReading({
  executable,
  slopweaverCommand,
  treeRoot,
  pathEntries,
}: {
  executable: string;
  slopweaverCommand: string;
  treeRoot: string;
  pathEntries: readonly string[];
}): CommandRouteReading {
  const yarnPrefix = `${YARN_EXECUTABLE} `;
  if (executable.startsWith(yarnPrefix)) {
    return yarnTokenReading({ executable, token: executable.slice(yarnPrefix.length), treeRoot });
  }
  const isBundledLauncher = executable === SLOPWEAVER_EXECUTABLE;
  const candidate = isBundledLauncher ? slopweaverCommand : executable;
  if (isBundledLauncher || isAbsolute(candidate) || candidate.includes(sep)) {
    return pathReading({ candidate, executable });
  }
  if (pathEntries.length === 0) {
    return { because: "this host declares no PATH entries to walk", executable, resolution: "unprovable" };
  }
  const found = resolveOnPath({ name: candidate, pathEntries });
  if (found === null) {
    return {
      because:
        `\`${executable}\` is on none of this host's ${String(pathEntries.length)} PATH entries — it runs only` +
        " if the host's own shell defines it, which this grading cannot see",
      executable,
      resolution: "unprovable",
    };
  }
  return { because: `\`${executable}\` resolves to ${found}`, executable, resolution: "resolved" };
}

/**
 * Resolve every executable the given capability rows name.
 *
 * An executable that cannot be found is graded rather than omitted: omitting it would leave the row exactly
 * as declared, which is the whole failure `./commandReading.ts` was opened for.
 *
 * @param capabilities the merged capability table, whose commands yield the keys to resolve — a shell row
 *   yielding its head plus every `yarn <token>` its `-c` script names
 * @param slopweaverCommand the bundled launcher this host resolved, so a `slopweaver` row is graded on the
 *   file it will really run rather than on whether the name happens to be installed on `PATH`
 * @param treeRoot the tree whose `package.json` a `yarn <script>` row is resolved against
 * @param pathEntries the `PATH` directories to walk; defaults to this host's own
 * @returns one reading per executable key, keyed by that key
 */
export function commandRouteReadings({
  capabilities,
  slopweaverCommand,
  treeRoot,
  pathEntries = hostPathEntries(),
}: {
  capabilities: readonly SourceCapability[];
  slopweaverCommand: string;
  treeRoot: string;
  pathEntries?: readonly string[];
}): ReadonlyMap<string, CommandRouteReading> {
  const executables = [...new Set(capabilities.flatMap((capability) => commandExecutableKeysOf({ capability })))];
  const readings = new Map<string, CommandRouteReading>();
  for (const executable of executables) {
    readings.set(executable, executableReading({ executable, pathEntries, slopweaverCommand, treeRoot }));
  }
  return readings;
}
