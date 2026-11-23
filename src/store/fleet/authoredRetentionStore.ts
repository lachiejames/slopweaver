/**
 * The retention reconciliation, against the store: remove every stored location the classification now calls
 * `scratch`, and rewrite every stored call-file version still carrying a tool answer. `./authoredRetention.ts` decides
 * both; this file reads, writes and deletes, all in ONE transaction, so a failure leaves the store as it was.
 *
 * The order is what keeps every foreign key whole and every call readable at each step: a replacement body, then its
 * location, then the unstripped location, and last only the bodies THIS run left unreferenced — never a global sweep of
 * every orphan, which would reach rows another writer is mid-way through.
 *
 * A call body is read only when the database finds the ASCII token `"answer"` or a `\u` escape inside it, one body at
 * a time, so the reconciliation never holds the authored corpus in memory; the line parser is still what decides. That
 * prefilter is complete by JSON's own grammar rather than by trusting the writer: a key that decodes to `answer`
 * without spelling it is impossible unless at least one of its letters is written as a `\u` escape, the only escape
 * that can produce a letter.
 */
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { authoredAbsentTable, authoredBodyTable, authoredFileTable } from "../schema/authored.js";

import {
  type CallVersionRewrite,
  callVersionRewrite,
  type StoredAuthoredLocation,
  scratchLocations,
  scratchPaths,
} from "./authoredRetention.js";

/** What one reconciliation changed. */
export interface AuthoredRetentionCounts {
  /** Stored locations removed because their path is local-only. */
  readonly scratchLocationsDeleted: number;
  /** `authored_absent` rows removed with them. */
  readonly absentRowsDeleted: number;
  /** Call-file versions replaced by their stripped body. */
  readonly callVersionsRewritten: number;
  /** Rows the rewrites wrote: new bodies, new locations, and existing locations moved to a later instant. */
  readonly rowsInserted: number;
  /** Bodies this run left unreferenced, deleted. */
  readonly orphanBodiesDeleted: number;
}

/** Keys per `IN (...)`: far inside postgres's 65,535 bind parameters. */
const IN_ROWS = 1000;

/** The prefix every call file's path starts with, as a `LIKE` pattern. */
const CALL_PATH_PATTERN = "talk/calls/%";

/** The literal key a call line's tool answer is written under. */
const ANSWER_TOKEN = '"answer"';

/** The only JSON escape that can spell an ASCII letter, so the only way to write the same key without the token. */
const UNICODE_ESCAPE = "\\u";

/**
 * Reconcile the stored authored rows with the classification and the call-file strip.
 *
 * @param client an open store connection
 * @returns what changed, or the typed database failure
 */
export async function reconcileAuthoredRetention({
  client,
}: {
  client: StoreClient;
}): Promise<Result<AuthoredRetentionCounts, StoreError>> {
  try {
    const counts = await client.db.transaction(async (writer: StoreWriter): Promise<AuthoredRetentionCounts> => {
      const affected = new Set<string>();
      const rewrites = await rewriteCallVersions({ affected, writer });
      const scratch = await deleteScratchLocations({ affected, writer });
      const orphanBodiesDeleted = await deleteOrphanBodies({ affected: [...affected], writer });
      return {
        absentRowsDeleted: scratch.absent,
        callVersionsRewritten: rewrites.rewritten,
        orphanBodiesDeleted,
        rowsInserted: rewrites.inserted,
        scratchLocationsDeleted: scratch.locations,
      };
    });
    return ok(counts);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "reconcile authored retention" }));
  }
}

/** Rewrite every stored call version still carrying a tool answer, recording each replaced body's hash. */
async function rewriteCallVersions({
  affected,
  writer,
}: {
  affected: Set<string>;
  writer: StoreWriter;
}): Promise<{ rewritten: number; inserted: number }> {
  const candidates = await writer
    .select({ bodySha256: authoredFileTable.bodySha256, relativePath: authoredFileTable.relativePath })
    .from(authoredFileTable)
    .innerJoin(authoredBodyTable, eq(authoredBodyTable.bodySha256, authoredFileTable.bodySha256))
    .where(
      and(
        like(authoredFileTable.relativePath, CALL_PATH_PATTERN),
        or(
          sql`position(convert_to(${ANSWER_TOKEN}, 'UTF8') in ${authoredBodyTable.body}) > 0`,
          sql`position(convert_to(${UNICODE_ESCAPE}, 'UTF8') in ${authoredBodyTable.body}) > 0`,
        ),
      ),
    )
    .orderBy(asc(authoredFileTable.relativePath), asc(authoredFileTable.bodySha256));
  let rewritten = 0;
  let inserted = 0;
  for (const candidate of candidates) {
    const rows = await writer
      .select({
        body: authoredBodyTable.body,
        directory: authoredFileTable.directory,
        fileModifiedAt: authoredFileTable.fileModifiedAt,
      })
      .from(authoredFileTable)
      .innerJoin(authoredBodyTable, eq(authoredBodyTable.bodySha256, authoredFileTable.bodySha256))
      .where(
        and(
          eq(authoredFileTable.relativePath, candidate.relativePath),
          eq(authoredFileTable.bodySha256, candidate.bodySha256),
        ),
      );
    const row = rows[0]!;
    const rewrite = callVersionRewrite({ version: { ...candidate, ...row } });
    if (rewrite === undefined) {
      continue;
    }
    inserted += await applyRewrite({ rewrite, writer });
    affected.add(candidate.bodySha256);
    rewritten += 1;
  }
  return { inserted, rewritten };
}

/** Insert one stripped body and its location, then delete the unstripped location; returns the rows inserted. */
async function applyRewrite({
  rewrite,
  writer,
}: {
  rewrite: CallVersionRewrite;
  writer: StoreWriter;
}): Promise<number> {
  const bodies = await writer
    .insert(authoredBodyTable)
    .values(rewrite.body)
    .onConflictDoNothing({ target: authoredBodyTable.bodySha256 })
    .returning({ sha: authoredBodyTable.bodySha256 });
  // The stripped bytes may equal an OLDER version already stored at this path (one written before it carried an
  // answer). That row then stands for both, so it takes the later of the two instants: a do-nothing here would drop
  // the newer version's mtime, and with it which version is newest.
  const locations = await writer
    .insert(authoredFileTable)
    .values(rewrite.location)
    .onConflictDoUpdate({
      set: { fileModifiedAt: sql`excluded.file_modified_at` },
      setWhere: sql`excluded.file_modified_at > ${authoredFileTable.fileModifiedAt}`,
      target: [authoredFileTable.relativePath, authoredFileTable.bodySha256],
    })
    .returning({ path: authoredFileTable.relativePath });
  await writer
    .delete(authoredFileTable)
    .where(
      and(
        eq(authoredFileTable.relativePath, rewrite.remove.relativePath),
        eq(authoredFileTable.bodySha256, rewrite.remove.bodySha256),
      ),
    );
  return bodies.length + locations.length;
}

/** Delete every stored location and every absent row whose path the classification calls `scratch`. */
async function deleteScratchLocations({
  affected,
  writer,
}: {
  affected: Set<string>;
  writer: StoreWriter;
}): Promise<{ locations: number; absent: number }> {
  const stored: StoredAuthoredLocation[] = await writer
    .select({ bodySha256: authoredFileTable.bodySha256, relativePath: authoredFileTable.relativePath })
    .from(authoredFileTable);
  const doomed = scratchLocations({ locations: stored });
  for (const location of doomed) {
    await writer
      .delete(authoredFileTable)
      .where(
        and(
          eq(authoredFileTable.relativePath, location.relativePath),
          eq(authoredFileTable.bodySha256, location.bodySha256),
        ),
      );
    affected.add(location.bodySha256);
  }
  // Read from the absent table itself, never derived from the locations just deleted: an absent row can outlive every
  // location of its path, and it still names a local-only file in every dump.
  const absentRows = await writer.select({ path: authoredAbsentTable.relativePath }).from(authoredAbsentTable);
  const paths = scratchPaths({ paths: absentRows.map((row) => row.path) });
  let absent = 0;
  for (let start = 0; start < paths.length; start += IN_ROWS) {
    const removed = await writer
      .delete(authoredAbsentTable)
      .where(inArray(authoredAbsentTable.relativePath, paths.slice(start, start + IN_ROWS)))
      .returning({ path: authoredAbsentTable.relativePath });
    absent += removed.length;
  }
  return { absent, locations: doomed.length };
}

/** Delete the bodies among `affected` that no location references any more; returns how many went. */
async function deleteOrphanBodies({
  affected,
  writer,
}: {
  affected: readonly string[];
  writer: StoreWriter;
}): Promise<number> {
  let deleted = 0;
  for (let start = 0; start < affected.length; start += IN_ROWS) {
    const slice = affected.slice(start, start + IN_ROWS);
    const referenced = await writer
      .selectDistinct({ sha: authoredFileTable.bodySha256 })
      .from(authoredFileTable)
      .where(inArray(authoredFileTable.bodySha256, slice));
    const kept = new Set(referenced.map((row) => row.sha));
    const orphans = slice.filter((sha) => !kept.has(sha));
    if (orphans.length === 0) {
      continue;
    }
    const removed = await writer
      .delete(authoredBodyTable)
      .where(inArray(authoredBodyTable.bodySha256, orphans))
      .returning({ sha: authoredBodyTable.bodySha256 });
    deleted += removed.length;
  }
  return deleted;
}
