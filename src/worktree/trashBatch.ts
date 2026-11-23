/**
 * One reclaim-trash batch's lifecycle on disk — published PENDING, then committed or dropped — shared by the
 * removal that moves a worktree's bulk aside (`./reclaimTrash.ts`) and by anything else that throws a directory
 * away into the same trash.
 *
 * Why a batch is pending, and why it is published through a `.staging` directory, is `./reclaimTrash.ts`'s
 * header: every emptier of every vintage deletes a batch with no `pending.json`, so a batch must never exist
 * under its final name without one while something is still moving into it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { ownProcessStart } from "../admit/lockHolder.js";

/** The marker a batch carries until nothing in it can be needed back. */
const PENDING_NAME = "pending.json";

/** A batch still being built: its marker is written here, and the batch renamed to its final name, before any move. */
export const STAGING_SUFFIX = ".staging";

/** A batch's `pending.json`: which tree its moves came from, and which process is making them. */
const pendingSchema = z.object({
  moves: z.array(z.object({ from: z.string(), to: z.string() })),
  pid: z.number().int(),
  start: z.string().optional(),
  worktree: z.string(),
});

/** What one batch's `pending.json` records. */
export type PendingRecord = z.infer<typeof pendingSchema>;

/**
 * Publish one fresh PENDING batch directory under the trash, its marker in place from the instant the batch has
 * its final name.
 *
 * Built under a name the emptier never deletes while its writer lives, then the DIRECTORY is renamed whole: a
 * batch under its final name has carried its marker from the instant it existed, so no sweep can read it as
 * committed. The marker itself is the durable write, and it is `writeFileAtomic`'s.
 *
 * @param dir the batch's final path under the trash root
 * @param pending what its `pending.json` records
 * @returns whether the batch now exists; on `false` nothing is left behind
 */
export function publishBatch({ dir, pending }: { dir: string; pending: PendingRecord }): boolean {
  const unpublished = `${dir}${STAGING_SUFFIX}`;
  try {
    mkdirSync(dirname(dir), { recursive: true });
    mkdirSync(unpublished);
    writeFileAtomic({
      contents: safeJsonStringify({ label: "reclaim trash pending batch", value: pending }),
      path: join(unpublished, PENDING_NAME),
    });
    renameSync(unpublished, dir);
    return true;
  } catch {
    // Nothing has moved yet, so the half-built staging directory holds nothing to keep. A full disk is the
    // likeliest cause, and left behind, each one was held for good.
    rmSync(unpublished, { force: true, recursive: true });
    return false;
  }
}

/**
 * Mark a batch deletable by removing its marker. A failed unlink leaves it pending under this process, which the
 * next emptying pass settles once this process has exited.
 *
 * @param dir the batch directory
 */
export function commitBatch({ dir }: { dir: string }): void {
  try {
    unlinkSync(join(dir, PENDING_NAME));
  } catch {
    // See the contract above.
  }
}

/**
 * Remove an emptied batch: its marker, then the directory. A leftover is an ordinary deletable batch.
 *
 * @param dir the batch directory
 */
export function dropBatch({ dir }: { dir: string }): void {
  try {
    unlinkSync(join(dir, PENDING_NAME));
    rmdirSync(dir);
  } catch {
    // See the contract above.
  }
}

/** A batch's pending state as the emptier reads it. */
export type PendingRead = { readonly kind: "committed" } | { readonly kind: "unreadable" } | PendingRecord;

/**
 * Read a batch's `pending.json`.
 *
 * @param dir the batch directory
 * @returns `committed` when it carries none, `unreadable` when one is there and does not parse, else the record
 */
export function readPending({ dir }: { dir: string }): PendingRead {
  const path = join(dir, PENDING_NAME);
  if (!existsSync(path)) {
    return { kind: "committed" };
  }
  try {
    const parsed = pendingSchema.safeParse(
      safeJsonParse({ label: "reclaim trash pending batch", text: readFileSync(path, "utf8") }),
    );
    if (parsed.success) {
      return parsed.data;
    }
    return { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}

/**
 * Move one directory nothing will ever need back into the trash, for an emptier to delete.
 *
 * Published through the same staging-marker-first protocol as a removal's batch, so no emptier of any vintage
 * ever sees it markerless and half-built. Its marker records NO moves, because nothing in it is ever put back:
 * a writer that dies before committing leaves a batch the next pass settles by itself — its `worktree`, the
 * discarded path, is gone once the rename landed, and there is nothing to restore if it did not.
 *
 * @param dir the directory to throw away — a pool entry that does not fit, or a recycled tree an install failed over
 * @param trashDir the trash root, on the directory's own volume
 * @param label what names the batch, so a reader of the trash can tell where it came from
 * @param nowMs the instant naming the batch
 * @returns why the directory could not be moved, or `undefined` once it is in the trash
 */
export function discardIntoTrash({
  dir,
  trashDir,
  label,
  nowMs,
}: {
  dir: string;
  trashDir: string;
  label: string;
  nowMs: number;
}): string | undefined {
  const batch = join(trashDir, `${label}-${String(nowMs)}-${String(process.pid)}`);
  if (
    !publishBatch({ dir: batch, pending: { moves: [], pid: process.pid, start: ownProcessStart(), worktree: dir } })
  ) {
    return `a trash batch could not be published under ${trashDir}`;
  }
  try {
    renameSync(dir, join(batch, "0"));
  } catch (error: unknown) {
    dropBatch({ dir: batch });
    return error instanceof Error ? error.message : String(error);
  }
  commitBatch({ dir: batch });
  return undefined;
}
