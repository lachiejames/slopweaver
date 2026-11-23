/**
 * ONE key that identifies a record the same way everywhere retrieval touches it — the BM25 index, the
 * vector index, the ranking receipt, and the citation the model is told to use.
 *
 * ## Why not `sourceId`
 *
 * A record's real identity is `(source, container, sourceId)`, never `sourceId` alone — GitHub numbers
 * issues PER REPOSITORY, so `#7` exists in every repo the corpus has seen (see {@link
 * ../corpus/latestRecords}). Keying retrieval on `sourceId` alone measured **2,130 identities lost** on
 * the real corpus: two distinct records collapse into one posting carrying both term frequencies, and a
 * query matching one is handed the other, with a citation that looks correct.
 *
 * ## Why not the escaped identity triple either
 *
 * {@link recordIdentity} IS record-unique by construction and would remove the loss, but it changes every
 * key in the corpus (100%, measured) and is not human-readable — a NUL-joined escaped triple in a receipt
 * or a citation defeats the point of printing one.
 *
 * ## The choice: {@link citeToken}
 *
 * `citeToken` is already the citation key, so the thing retrieval indexes and the thing the model is told
 * to cite become the SAME string. On the real corpus it changed only 10.8% of keys (all readable) and lost
 * zero identities. It is not unique BY CONSTRUCTION — it drops `source` when a `sourceId` already carries
 * its container's tail, so `(linear, linear/TEAM, TEAM-9)` and `(self, notes/TEAM, TEAM-9)` both render
 * `TEAM-9` — so {@link findRecordKeyCollisions} is what actually enforces "record-unique": it refuses a
 * genuine collision rather than letting one silently merge two records' postings.
 */
import { identityOf } from "../corpus/latestRecords.js";
import type { CorpusRecord } from "../corpus/types.js";
import { citeToken } from "./citeToken.js";

/**
 * The one key retrieval indexes, ranks, and cites a record by.
 *
 * @param record the record to key
 * @returns the record's retrieval key
 */
export function recordKey({ record }: { record: CorpusRecord }): string {
  return citeToken({ record });
}

/** One retrieval key genuinely shared by two or more distinct records — named so the refusal is legible. */
export interface RecordKeyCollision {
  readonly key: string;
  readonly refs: readonly { readonly source: string; readonly container: string; readonly sourceId: string }[];
}

/**
 * Every key shared by more than one DISTINCT logical identity.
 *
 * Grouped by {@link recordIdentity} first, so a key held by several PHYSICAL rows of the very same identity
 * is never reported — that case is {@link latestRecords}'s decision, already made upstream, and is not a new
 * one this function invents. Only a key spanning two or more different identities is a genuine collision.
 *
 * It reads only the three identity fields. A key held by one identity keeps that identity's ref and nothing
 * more; a map is built only for a key a second identity shares, because across a whole corpus nearly every
 * key is held once. Pure.
 *
 * @param records the records to check — candidates for one retrieval index
 * @returns one entry per key shared by two or more distinct identities, naming every identity involved, in
 *   first-seen order
 */
export function findRecordKeyCollisions({
  records,
}: {
  records: readonly IdentityFields[];
}): readonly RecordKeyCollision[] {
  const heldByKey = new Map<
    string,
    { readonly identity: string; readonly ref: IdentityFields } | Map<string, IdentityFields>
  >();
  for (const record of records) {
    const key = citeToken({ record });
    const identity = identityOf({ container: record.container, source: record.source, sourceId: record.sourceId });
    const held = heldByKey.get(key);
    if (held === undefined || (!(held instanceof Map) && held.identity === identity)) {
      heldByKey.set(key, { identity, ref: record });
    } else if (held instanceof Map) {
      held.set(identity, record);
    } else {
      heldByKey.set(
        key,
        new Map([
          [held.identity, held.ref],
          [identity, record],
        ]),
      );
    }
  }
  const collisions: RecordKeyCollision[] = [];
  for (const [key, held] of heldByKey) {
    if (!(held instanceof Map)) {
      continue;
    }
    collisions.push({
      key,
      refs: [...held.values()].map((record) => ({
        container: record.container,
        source: record.source,
        sourceId: record.sourceId,
      })),
    });
  }
  return collisions;
}

/** The three fields a record's identity and retrieval key are computed from. */
interface IdentityFields {
  readonly source: string;
  readonly container: string;
  readonly sourceId: string;
}

/**
 * Render one collision so the remedy is obvious from the line alone. Pure.
 *
 * @param collision the collision to render
 * @returns the refusal line for this one key
 */
export function recordKeyCollisionMessage({ collision }: { collision: RecordKeyCollision }): string {
  const named = collision.refs.map((ref) => `${ref.source}/${ref.container}#${ref.sourceId}`).join(", ");
  return `retrieval key "${collision.key}" is shared by ${String(collision.refs.length)} distinct records (${named}) — refusing rather than silently merging their postings into one`;
}
