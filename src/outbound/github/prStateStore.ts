/**
 * Reading and writing the per-repository pull-request snapshot on disk.
 *
 * ## One file per repository, replaced whole, atomically
 *
 * The concurrency shape the corpus watermark already proved (`src/corpus/watermark.ts`): the unit of
 * concurrent write is the unit of the FILE, and every write is a temp-and-rename so a crash mid-write
 * cannot leave a half-file. Two clones of the same repository never collide because the file name hashes
 * the git common directory as well as the slug; two worktrees of ONE clone deliberately DO share a
 * snapshot, because they share the branches it describes.
 *
 * That is not on its own enough, and this module does not pretend it is: two restacks of one repository
 * would still overwrite each other's complete snapshots with different complete snapshots. What stops that
 * is the repository operation lock (`src/admit/operationLock.ts`), which `github stack restack` takes before
 * it fetches and holds until it has published. The atomic rename is what keeps a LOCK-FREE reader — a dry
 * run, a status read — from ever seeing a partial file.
 *
 * ## The rows never pass through one JS string
 *
 * Read with `readJsonlLines`, written one line at a time through `writeFileAtomicStream`. A repository's
 * open pull requests are bounded by the repository rather than by anything this code controls, and 391 open
 * ones in acme-admin is the measurement that makes that a real bound rather than a theoretical
 * one.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomicStream } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { assemblePrState, type PrState, prStateRows } from "./prStateCore.js";
import { type PrStateError, PrStateErrors } from "./prStateErrors.js";

/**
 * Where one repository's snapshot lives.
 *
 * @param gitCommonDir the clone's own `git rev-parse --git-common-dir`, so worktrees of one clone share a
 *   snapshot while two clones of the same repository keep their own
 * @returns the absolute path of the snapshot file
 */
export function prStatePath({
  gitCommonDir,
  home,
  repo,
}: {
  gitCommonDir: string;
  home: string;
  repo: string;
}): string {
  const digest = createHash("sha256").update(`${repo.toLowerCase()}\u0000${gitCommonDir}`, "utf8").digest("hex");
  return join(stateHomePaths({ home }).live.github.prStateDir, `${digest.slice(0, 32)}.jsonl`);
}

/**
 * Read one repository's snapshot.
 *
 * @param repo the `owner/name` the caller expects it to describe
 * @returns the snapshot, `undefined` when none has been written yet, or why the one there cannot be used
 */
export function readPrState({
  gitCommonDir,
  home,
  repo,
}: {
  gitCommonDir: string;
  home: string;
  repo: string;
}): Result<PrState | undefined, PrStateError> {
  const path = prStatePath({ gitCommonDir, home, repo });
  const rows: unknown[] = [];
  let refusal: PrStateError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0 || refusal !== undefined) {
          return;
        }
        try {
          rows.push(safeJsonParse({ label: "a pull-request snapshot row", text: line }));
        } catch {
          refusal = PrStateErrors.invalid({ path, why: "one of its lines is not JSON" });
        }
      },
      path,
    });
  } catch (error: unknown) {
    if (isMissingFile({ error })) {
      return ok(undefined);
    }
    return err(PrStateErrors.unreadable({ cause: error, path }));
  }
  if (refusal !== undefined) {
    return err(refusal);
  }
  return assemblePrState({ path, repo: repo.toLowerCase(), rows });
}

/** Whether a caught error is "there is no such file", which is a real answer rather than a fault. */
function isMissingFile({ error }: { error: unknown }): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

/**
 * Replace one repository's snapshot, atomically.
 *
 * @param state the whole snapshot; a previous one is replaced rather than merged, since a partial snapshot
 *   would let a merged pull request survive as a row nothing ever deletes
 * @returns nothing on success, or why it could not be written
 */
export function writePrState({
  gitCommonDir,
  home,
  state,
}: {
  gitCommonDir: string;
  home: string;
  state: PrState;
}): Result<void, PrStateError> {
  const path = prStatePath({ gitCommonDir, home, repo: state.header.repo });
  try {
    writeFileAtomicStream({
      dirMode: 0o700,
      fileMode: 0o600,
      path,
      produce: ({ write }) => {
        for (const row of prStateRows({ state })) {
          write({ text: `${safeJsonStringify({ label: "a pull-request snapshot row", value: row })}\n` });
        }
      },
    });
  } catch (error: unknown) {
    return err(PrStateErrors.unwritable({ cause: error, path }));
  }
  return ok(undefined);
}
