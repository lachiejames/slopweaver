/**
 * Every address `automation register-standing` has written into this install's own-repository rows —
 * `$SLOPWEAVER_HOME/live/recipe/own-repositories.json`.
 *
 * **Why a history.** `./standingRowSupersession.ts` brings a row forward only when it is EXACTLY a shape an earlier
 * build or pass wrote, which is the proof nobody edited it. A repository's address moves, so once a row is derived
 * from `origin` the earlier shape is not in this build. Reading it off the stored row would make every hand edit look
 * like the build's own write; this file holds only slugs a pass resolved and wrote. **Append-only**: a pass that died
 * between this write and its row write, or two moves between passes, still leaves each address recognisable.
 *
 * **Absent is valid; unreadable never reads as absent.** A fresh home has no file. One that will not read or parse is a
 * typed error, because read as empty it would leave a moved row reading as somebody's edit.
 */
import { lstatSync, readFileSync, statSync } from "node:fs";

import { z } from "zod";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** The file is there and could not be read. */
interface OwnRepositoriesUnreadableError {
  readonly code: "OWN_REPOSITORIES_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The file read, and is not a history this build accepts. */
interface OwnRepositoriesMalformedError {
  readonly code: "OWN_REPOSITORIES_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** The history could not be written. */
interface OwnRepositoriesWriteFailedError {
  readonly code: "OWN_REPOSITORIES_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way reading or extending the history can fail. */
export type OwnRepositoryStoreError =
  OwnRepositoriesUnreadableError | OwnRepositoriesMalformedError | OwnRepositoriesWriteFailedError;

/** Build one {@link OwnRepositoryStoreError}. */
const OwnRepositoryStoreErrors = {
  malformed: ({ path, why }: { path: string; why: string }): OwnRepositoriesMalformedError => ({
    code: "OWN_REPOSITORIES_MALFORMED",
    message: `the own-repository history at ${path} is malformed: ${why}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): OwnRepositoriesUnreadableError => ({
    cause,
    code: "OWN_REPOSITORIES_UNREADABLE",
    message: `cannot read the own-repository history at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): OwnRepositoriesWriteFailedError => ({
    cause,
    code: "OWN_REPOSITORIES_WRITE_FAILED",
    message: `cannot write the own-repository history at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

const fileSchema = z.strictObject({
  repositories: z.array(z.string().regex(/^[^\s/A-Z]+\/[^\s/A-Z]+$/u, "one lower-case `owner/name` pair")),
  schemaVersion: z.literal(1),
});

/** Whether anything, a dangling symlink included, sits at the path itself. */
function pathEntryExists({ path }: { readonly path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the history under one home.
 *
 * @param home the state home to resolve it under
 * @returns every address recorded, oldest first and empty when no file exists, or why it could not be read
 */
export function readOwnRepositories({
  home,
}: {
  readonly home: string;
}): Result<readonly string[], OwnRepositoryStoreError> {
  const path = stateHomePaths({ home }).live.recipe.ownRepositoriesJson;
  let text: string;
  try {
    // A FIFO or a device would block or stream forever under readFileSync, so only a regular file is read.
    const entry = statSync(path, { throwIfNoEntry: false });
    if (entry !== undefined && !entry.isFile()) {
      return err(OwnRepositoryStoreErrors.unreadable({ cause: new Error("not a regular file"), path }));
    }
    text = readFileSync(path, "utf8");
  } catch (cause) {
    // A dangling symlink also reads as ENOENT, but its path exists: that is a history that cannot be read.
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT" && !pathEntryExists({ path })) {
      return ok([]);
    }
    return err(OwnRepositoryStoreErrors.unreadable({ cause, path }));
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "own repositories", text });
  } catch (cause) {
    return err(OwnRepositoryStoreErrors.malformed({ path, why: errorMessage({ error: cause }) }));
  }
  const parsed = fileSchema.safeParse(decoded);
  if (!parsed.success) {
    const why = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
    return err(OwnRepositoryStoreErrors.malformed({ path, why }));
  }
  return ok(parsed.data.repositories);
}

/**
 * Append one address to the history, writing nothing when it is already recorded.
 *
 * @param home the state home to write it under
 * @param repository the canonical lower-case `owner/name` a pass is about to write into the rows
 * @returns nothing on success, or why the history could not be read or written
 */
export function recordOwnRepository({
  home,
  repository,
}: {
  readonly home: string;
  readonly repository: string;
}): Result<void, OwnRepositoryStoreError> {
  return readOwnRepositories({ home }).andThen((recorded) => {
    if (recorded.includes(repository)) {
      return ok(undefined);
    }
    const path = stateHomePaths({ home }).live.recipe.ownRepositoriesJson;
    const value = { schemaVersion: 1, repositories: [...recorded, repository] };
    try {
      writeFileAtomic({ contents: `${safeJsonStringify({ label: "own repositories", space: 2, value })}\n`, path });
    } catch (cause) {
      return err(OwnRepositoryStoreErrors.writeFailed({ cause, path }));
    }
    return ok(undefined);
  });
}
