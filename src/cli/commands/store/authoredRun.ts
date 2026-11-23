/**
 * `slopweaver store authored-list`, `authored-show` and `authored-restore` — the authored working state read
 * back OUT of the store.
 *
 * All three read the store only. `show` never falls back to the disk copy, so a file the home has lost still
 * reads and one the store never received says so. `restore` is how the file-reading code comes back on a fresh
 * machine: `store restore` rebuilds the database, then this writes every stored file the home is missing, and
 * the readers that open those paths (`live/turn/briefStore.ts`, the `judgement` stores, `hand/store.ts`,
 * `talk/relayStore.ts`, …) find them where they always did. No reader was rewired to a table: forty
 * directories have forty readers, and the restore is what makes the home removable without touching each.
 *
 * The shell only: `./authoredCore.ts` parses and renders, `./authoredShell.ts` opens the store and reads one path, `../../../store/fleet/authoredFile.ts` decides and
 * `./authoredDeps.ts` names every seam — the store's reads and `../../../store/fleet/authoredWrite.ts`'s writes.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type AuthoredRestorePlan,
  authoredDirectoryOf,
  newestPerPath,
  planAuthoredRestore,
  resolveAuthoredRef,
  type StoredAuthoredVersion,
} from "../../../store/fleet/authoredFile.js";
import { authoredAbsolutePath } from "../../../store/fleet/authoredFiles.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";

import {
  authoredListLine,
  authoredListRows,
  authoredRestoreLines,
  parseAuthoredListArgs,
  parseAuthoredRestoreArgs,
  parseAuthoredShowArgs,
} from "./authoredCore.js";
import { type AuthoredStoreSession, type AuthoredVerbDeps, productionAuthoredVerbDeps } from "./authoredDeps.js";
import { type MemoryRestoreOutcome, memoryRestoreLines, restoreClaudeMemory } from "./authoredMemoryRestore.js";
import { authoredHomeOf, newestAuthoredBody, openAuthoredStore, refuseAuthoredUsage } from "./authoredShell.js";
import {
  AUTHORED_IMPORT_COMMAND,
  AUTHORED_LIST_USAGE,
  AUTHORED_RESTORE_USAGE,
  AUTHORED_SHOW_USAGE,
} from "./authoredUsage.js";
import { storeTail } from "./core.js";

/**
 * Run `store authored-list` against injected seams.
 *
 * @param rest the argv after `store authored-list`
 * @returns the process exit code
 */
export async function runStoreAuthoredList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AuthoredVerbDeps;
}): Promise<number> {
  const args = parseAuthoredListArgs({ rest });
  if (args.isErr()) {
    return refuseAuthoredUsage({ deps, problems: args.error, usage: AUTHORED_LIST_USAGE, verb: "authored-list" });
  }
  const home = authoredHomeOf({ deps, named: args.value.home });
  const opened = await openAuthoredStore({ deps, home, verb: "authored-list" });
  if (opened.kind === "exit") {
    return opened.code;
  }
  try {
    const all = await opened.session.versions(
      args.value.directory === undefined ? {} : { directory: args.value.directory },
    );
    if (all.isErr()) {
      deps.writeDiagnostic(`store authored-list: ${all.error.message}`);
      return EXIT_ERROR;
    }
    const rows = authoredListRows({ all: all.value, newest: newestPerPath({ versions: all.value }) });
    if (args.value.json) {
      deps.writeOut(JSON.stringify({ rows }));
    } else {
      rows.forEach((row) => {
        deps.writeOut(authoredListLine({ row }));
      });
    }
    deps.writeDiagnostic(
      `store authored-list: ${String(rows.length)} path(s), ${String(all.value.length)} stored version(s)` +
        (rows.length === 0 ? ` — nothing imported yet; run \`${AUTHORED_IMPORT_COMMAND}\`` : ""),
    );
    return EXIT_OK;
  } finally {
    await opened.session.close();
  }
}

/**
 * Run `store authored-show` against injected seams.
 *
 * @param rest the argv after `store authored-show`
 * @returns the process exit code
 */
export async function runStoreAuthoredShow({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AuthoredVerbDeps;
}): Promise<number> {
  const args = parseAuthoredShowArgs({ rest });
  if (args.isErr()) {
    return refuseAuthoredUsage({ deps, problems: args.error, usage: AUTHORED_SHOW_USAGE, verb: "authored-show" });
  }
  const { ref, out } = args.value;
  if (ref === undefined) {
    return refuseAuthoredUsage({
      deps,
      problems: ["--ref <anchor|path> is required"],
      usage: AUTHORED_SHOW_USAGE,
      verb: "authored-show",
    });
  }
  const home = authoredHomeOf({ deps, named: args.value.home });
  const resolved = resolveAuthoredRef({ home, ref });
  if (resolved.isErr()) {
    deps.writeDiagnostic(`store authored-show: ${resolved.error.message}`);
    return EXIT_ERROR;
  }
  const opened = await openAuthoredStore({ deps, home, verb: "authored-show" });
  if (opened.kind === "exit") {
    return opened.code;
  }
  try {
    const bytes = await newestAuthoredBody({ relativePath: resolved.value, session: opened.session });
    if (bytes.isErr()) {
      deps.writeDiagnostic(`store authored-show: ${bytes.error.message}`);
      return EXIT_ERROR;
    }
    return emitBody({ body: bytes.value, deps, out });
  } finally {
    await opened.session.close();
  }
}

/**
 * Print a body, or write it to `--out`. A body that is not text reproducing its own bytes needs `--out`.
 *
 * @param body the stored bytes
 * @param out the file to write, when given
 * @returns the exit code
 */
function emitBody({ body, out, deps }: { body: Buffer; out: string | undefined; deps: AuthoredVerbDeps }): number {
  if (out !== undefined) {
    try {
      deps.writeFile({ bytes: body, path: out });
    } catch (cause) {
      deps.writeDiagnostic(`store authored-show: could not write ${out}: ${errorMessage({ error: cause })}`);
      return EXIT_ERROR;
    }
    deps.writeDiagnostic(`store authored-show: wrote ${String(body.length)} byte(s) to ${out}`);
    return EXIT_OK;
  }
  const text = body.toString("utf8");
  if (body.includes(0) || !Buffer.from(text, "utf8").equals(body)) {
    deps.writeDiagnostic("store authored-show: the stored body is binary — pass --out <file> to write its exact bytes");
    return EXIT_ERROR;
  }
  // The out channel appends its own newline, so one trailing newline is handed back to it.
  deps.writeOut(text.endsWith("\n") ? text.slice(0, -1) : text);
  return EXIT_OK;
}

/**
 * Run `store authored-restore` against injected seams.
 *
 * @param rest the argv after `store authored-restore`
 * @returns the process exit code — non-zero only when a write failed
 */
export async function runStoreAuthoredRestore({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AuthoredVerbDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "store", rest, verb: "authored-restore" });
  if (gated !== undefined) {
    return gated;
  }
  const args = parseAuthoredRestoreArgs({ rest });
  if (args.isErr()) {
    return refuseAuthoredUsage({ deps, problems: args.error, usage: AUTHORED_RESTORE_USAGE, verb: "authored-restore" });
  }
  const home = authoredHomeOf({ deps, named: args.value.home });
  const opened = await openAuthoredStore({ deps, home, verb: "authored-restore" });
  if (opened.kind === "exit") {
    return opened.code;
  }
  try {
    const restorable = await readRestorable({ directory: args.value.directory, session: opened.session });
    if (restorable.isErr()) {
      deps.writeDiagnostic(`store authored-restore: ${restorable.error}`);
      return EXIT_ERROR;
    }
    const { absent, newest } = restorable.value;
    const plan = planAuthoredRestore({
      newest,
      presentSha256: (relativePath) => deps.fileSha256({ path: authoredAbsolutePath({ home, relativePath }) }),
    });
    const failed = args.value.dryRun
      ? []
      : await writeAll({ deps, home, session: opened.session, versions: plan.write });
    const projectsDir = deps.claudeProjectsFor({ home });
    const memory =
      projectsDir === undefined
        ? undefined
        : await restoreClaudeMemory({ deps, dryRun: args.value.dryRun, newest, projectsDir, session: opened.session });
    const lines = [
      ...authoredRestoreLines({ absent, dryRun: args.value.dryRun, failed, plan }),
      ...memoryRestoreLines({ dryRun: args.value.dryRun, memory }),
    ];
    if (args.value.json) {
      deps.writeOut(JSON.stringify(restoreDocument({ absent, dryRun: args.value.dryRun, failed, memory, plan })));
    }
    lines.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    const memoryFailed = memory === undefined ? 0 : memory.failed.length;
    return failed.length + memoryFailed > 0 ? EXIT_ERROR : EXIT_OK;
  } finally {
    await opened.session.close();
  }
}

/** `store authored-restore --json`'s document: the home's restore, then Claude auto-memory's, or null when skipped. */
function restoreDocument({
  absent,
  dryRun,
  failed,
  memory,
  plan,
}: {
  absent: number;
  dryRun: boolean;
  failed: readonly { relativePath: string; why: string }[];
  memory: MemoryRestoreOutcome | undefined;
  plan: AuthoredRestorePlan;
}): Record<string, unknown> {
  const claudeMemory =
    memory === undefined
      ? null
      : {
          differs: memory.plan.differs.map((version) => version.relativePath),
          failed: memory.failed,
          identical: memory.plan.identical.length,
          written: memory.plan.write.length - memory.failed.length,
        };
  return {
    absent,
    claudeMemory,
    differs: plan.differs.map((version) => version.relativePath),
    dryRun,
    failed,
    identical: plan.identical.length,
    written: plan.write.length - failed.length,
  };
}

/**
 * The newest stored version of every path a restore may write, and how many the last import found deleted.
 *
 * A stored path this build no longer classifies authored is never written: the classification, not the table,
 * decides what belongs in the home. Nor is one the last import found deleted: the table only ever adds, so
 * without this a restore brings back every file the home ever held.
 *
 * @param directory the one authored directory to narrow the versions to, when `--directory` named one
 * @returns the writable versions and the deleted count, or the store's own message when a read failed
 */
async function readRestorable({
  directory,
  session,
}: {
  directory: string | undefined;
  session: AuthoredStoreSession;
}): Promise<Result<{ absent: number; newest: readonly StoredAuthoredVersion[] }, string>> {
  const all = await session.versions(directory === undefined ? {} : { directory });
  if (all.isErr()) {
    return err(all.error.message);
  }
  const absent = await session.absent();
  if (absent.isErr()) {
    return err(absent.error.message);
  }
  const classified = newestPerPath({ versions: all.value }).filter(
    (version) => authoredDirectoryOf({ relativePath: version.relativePath }) !== undefined,
  );
  const newest = classified.filter((version) => !absent.value.has(version.relativePath));
  return ok({ absent: classified.length - newest.length, newest });
}

/**
 * Write every planned version, re-hashing each written file against the row it came from.
 *
 * @param versions the versions to write, each absent in the home
 * @returns each path whose write failed, with why
 */
async function writeAll({
  versions,
  session,
  home,
  deps,
}: {
  versions: readonly StoredAuthoredVersion[];
  session: AuthoredStoreSession;
  home: string;
  deps: AuthoredVerbDeps;
}): Promise<readonly { relativePath: string; why: string }[]> {
  const failed: { relativePath: string; why: string }[] = [];
  for (const version of versions) {
    const body = await session.body({ bodySha256: version.bodySha256 });
    if (body.isErr() || body.value === undefined) {
      failed.push({ relativePath: version.relativePath, why: "the store would not return its body" });
      continue;
    }
    const path = authoredAbsolutePath({ home, relativePath: version.relativePath });
    try {
      deps.createFile({
        bytes: body.value,
        modifiedAt: version.fileModifiedAt,
        path,
        root: stateHomePaths({ home }).root,
      });
    } catch (cause) {
      failed.push({ relativePath: version.relativePath, why: errorMessage({ error: cause }) });
      continue;
    }
    if (deps.fileSha256({ path }) !== version.bodySha256) {
      failed.push({ relativePath: version.relativePath, why: "the written file does not hash to the stored body" });
    }
  }
  return failed;
}

/** `slopweaver store authored-list`. */
export const storeAuthoredListCommand = defineCommand({
  run: (argv) => runStoreAuthoredList({ deps: productionAuthoredVerbDeps(), rest: storeTail({ argv }) }),
});

/** `slopweaver store authored-show`. */
export const storeAuthoredShowCommand = defineCommand({
  run: (argv) => runStoreAuthoredShow({ deps: productionAuthoredVerbDeps(), rest: storeTail({ argv }) }),
});

/** `slopweaver store authored-restore`. */
export const storeAuthoredRestoreCommand = defineCommand({
  run: (argv) => runStoreAuthoredRestore({ deps: productionAuthoredVerbDeps(), rest: storeTail({ argv }) }),
});
