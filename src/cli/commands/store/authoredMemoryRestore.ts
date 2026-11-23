/**
 * `store authored-restore`'s last step: the mirrored Claude Code auto-memory written back into
 * `~/.claude/projects/<project-dir>/memory/`, so a new Mac's supervisor boots with its memories
 * (`../../../store/fleet/claudeMemoryMirror.ts` carries the design).
 *
 * The same rules as the rest of the restore: a file already there is never overwritten, whatever it holds, and
 * every written file is re-hashed against the row it came from. Each write resolves inside its own corpus
 * directory rather than the projects directory, so a corpus that is a symbolic link elsewhere still restores.
 * It runs only for `~/.slopweaver` itself (`claudeProjectsForHome`) — `~/.claude` belongs to that home, and a
 * rehearsal restoring into a throwaway `--home` or `$SLOPWEAVER_HOME` must never write into the real corpora.
 */
import { ROOT_INDEX_FILE } from "../../../memory/types.js";
import {
  type AuthoredRestorePlan,
  planAuthoredRestore,
  type StoredAuthoredVersion,
} from "../../../store/fleet/authoredFile.js";
import { memoryRestoreTarget } from "../../../store/fleet/claudeMemoryMirror.js";

import type { AuthoredStoreSession, AuthoredVerbDeps } from "./authoredDeps.js";

/** What the write-back did, or would do. */
export interface MemoryRestoreOutcome {
  readonly projectsDir: string;
  readonly plan: AuthoredRestorePlan;
  readonly failed: readonly { readonly relativePath: string; readonly why: string }[];
}

/**
 * Write every mirrored memory file the projects directory is missing.
 *
 * @param newest the newest restorable version of every stored path — the mirror's are picked out here
 * @param dryRun whether to plan only
 * @returns the plan and every write that failed
 */
export async function restoreClaudeMemory({
  newest,
  projectsDir,
  session,
  deps,
  dryRun,
}: {
  newest: readonly StoredAuthoredVersion[];
  /** Claude Code's `~/.claude/projects`, already established as this home's own. */
  projectsDir: string;
  session: AuthoredStoreSession;
  deps: AuthoredVerbDeps;
  dryRun: boolean;
}): Promise<MemoryRestoreOutcome> {
  const plan = planAuthoredRestore({
    newest: newest.filter(
      (version) => memoryRestoreTarget({ projectsDir, relativePath: version.relativePath }) !== undefined,
    ),
    presentSha256: (relativePath) =>
      deps.fileSha256({ path: memoryRestoreTarget({ projectsDir, relativePath })!.path }),
  });
  const failed: { relativePath: string; why: string }[] = [];
  if (dryRun) {
    return { failed, plan, projectsDir };
  }
  for (const version of plan.write) {
    const target = memoryRestoreTarget({ projectsDir, relativePath: version.relativePath })!;
    const why = await writeOne({ deps, session, target, version });
    if (why !== undefined) {
      failed.push({ relativePath: version.relativePath, why });
    }
  }
  return { failed, plan, projectsDir };
}

/** Write one version to its target, returning why it failed or `undefined` once it hashes to the row. */
async function writeOne({
  version,
  target,
  session,
  deps,
}: {
  version: StoredAuthoredVersion;
  target: { directory: string; path: string };
  session: AuthoredStoreSession;
  deps: AuthoredVerbDeps;
}): Promise<string | undefined> {
  const body = await session.body({ bodySha256: version.bodySha256 });
  if (body.isErr() || body.value === undefined) {
    return "the store would not return its body";
  }
  const created = deps.createUnderRoot({
    bytes: body.value,
    modifiedAt: version.fileModifiedAt,
    path: target.path,
    root: target.directory,
  });
  if (created.isErr()) {
    return created.error.join("; ");
  }
  if (created.value === "exists") {
    return `${target.path} appeared since the plan and was left alone`;
  }
  if (deps.fileSha256({ path: target.path }) !== version.bodySha256) {
    return "the written file does not hash to the stored body";
  }
  return undefined;
}

/**
 * The lines the write-back prints.
 *
 * @param memory the outcome, or `undefined` when the home was not the default one
 * @param dryRun whether anything was written
 * @returns one summary line, each failure, then each memory already present with other bytes
 */
export function memoryRestoreLines({
  memory,
  dryRun,
}: {
  memory: MemoryRestoreOutcome | undefined;
  dryRun: boolean;
}): readonly string[] {
  if (memory === undefined) {
    return [
      "store authored-restore: Claude auto-memory not written back — this home is not ~/.slopweaver, so ~/.claude is not its own",
    ];
  }
  const { plan, failed, projectsDir } = memory;
  const verb = dryRun ? "would write" : "wrote";
  return [
    `store authored-restore: Claude auto-memory into ${projectsDir}: ${verb} ${String(plan.write.length - failed.length)}, ` +
      `${String(plan.identical.length)} already identical, ${String(plan.differs.length)} present with other bytes (left alone), ` +
      `${String(failed.length)} failed`,
    ...failed.map((failure) => `  FAILED ${failure.relativePath}: ${failure.why}`),
    ...plan.differs.map((version) => differsLine({ relativePath: version.relativePath })),
  ];
}

/**
 * One memory already in `~/.claude` with other bytes. The next nightly import follows the present file as an
 * edit and moves the old one into the project's attic, so the line says where to merge it from either way.
 */
function differsLine({ relativePath }: { relativePath: string }): string {
  const merge = `merge the old one from the home's ${relativePath}, which the next nightly import keeps in its attic`;
  if (relativePath.endsWith(`/${ROOT_INDEX_FILE}`)) {
    return `  INDEX ${relativePath}: a different ${ROOT_INDEX_FILE} is already in ~/.claude, so the restored memories are not listed in it — ${merge}`;
  }
  return `  DIFFERS ${relativePath}: a memory of that name with other bytes is already in ~/.claude and was kept — ${merge}`;
}
