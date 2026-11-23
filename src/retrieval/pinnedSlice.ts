/**
 * Pinning a retrieved slice so a LATER command can rebuild exactly the evidence a session was shown.
 *
 * ## Why this exists
 *
 * Under the no-spawned-model doctrine, answering is two commands with a human-visible session in between:
 * one command retrieves and writes a brief, the session composes the answer, and a second command grounds
 * and renders it. Between those two the corpus can change — `refresh` is append-only and runs whenever the
 * owner likes — so the second command has to find *the same records*, or it is grounding an answer against
 * evidence nobody read.
 *
 * ## The identity is composite, and that is not a detail
 *
 * A ref is `(source, container, sourceId)`, never `sourceId` alone. `src/retrieval/citeToken.ts` records the
 * measurement that settles this: 70.0% of records share a citation token with at least one other record, and
 * `sourceId` alone still lost 114 identities on the real corpus, because GitHub numbers issues PER
 * REPOSITORY — `#7` exists in every repo the corpus has seen. Keying a rebuild on `sourceId` would silently
 * hand back a record from the wrong repository.
 *
 * The key itself is {@link recordIdentity}, reused rather than reinvented, so a pin and a latest-version
 * collapse can never disagree about what "the same record" means.
 *
 * ## Refusing is the feature
 *
 * {@link sliceByPinnedRefs} returns an error when a ref matches no record or more than one. Both cases are
 * real: a corpus can lose a record to a re-scope, and it can hold two rows for one identity because bronze
 * is append-only. Picking one — the shape `askEngine` uses today, where a `Map` keyed on `sourceId` lets the
 * last physical row win — would produce an answer grounded in a record the session never saw, and it would
 * look completely normal. A refusal costs one regenerated brief; a silent substitution costs a wrong answer
 * with a citation link that appears to support it.
 *
 * **A known limitation, stated rather than implied:** this protects the REBUILD, not the ranking. The BM25
 * and vector indexes still key on `sourceId` alone (`retrievalIndex.ts`, `vectorIndex.ts`), so a collision
 * can still cause the wrong record to be retrieved in the first place. Fixing that migrates the on-disk
 * vector cache and forces a full re-embed, so it is deliberately not folded in here. What this file
 * guarantees is narrower and still worth having: whatever was retrieved is what gets grounded.
 */

import { identityOf, recordIdentity } from "../corpus/latestRecords.js";
import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * One record's logical identity, as stored in a brief.
 *
 * Three named fields rather than the opaque {@link recordIdentity} string, because a brief is a file a human
 * may read and a NUL-joined key is not readable. The key is derived from these when matching.
 */
export interface PinnedRecordRef {
  readonly source: CorpusSource;
  readonly container: string;
  readonly sourceId: string;
}

/**
 * Pin a slice: its records' logical identities, in rank order.
 *
 * Order is preserved because it IS the ranking — the slice the session was shown was ordered, and a rebuild
 * that reordered it would change which records the prompt truncates first.
 *
 * @param slice the ranked records the session was shown
 * @returns one ref per record, in the same order
 */
export function pinSlice({ slice }: { slice: readonly CorpusRecord[] }): readonly PinnedRecordRef[] {
  return slice.map((record) => ({
    container: record.container,
    source: record.source,
    sourceId: record.sourceId,
  }));
}

/** The identity key for a ref — the same key {@link recordIdentity} computes for a record. */
function refIdentity({ ref }: { ref: PinnedRecordRef }): string {
  return identityOf({ container: ref.container, source: ref.source, sourceId: ref.sourceId });
}

/** Every record that shares each identity, so an ambiguous identity can be reported rather than resolved. */
function recordsByIdentity({ records }: { records: readonly CorpusRecord[] }): Map<string, CorpusRecord[]> {
  const byIdentity = new Map<string, CorpusRecord[]>();
  for (const record of records) {
    const key = recordIdentity({ record });
    const bucket = byIdentity.get(key);
    if (bucket === undefined) {
      byIdentity.set(key, [record]);
      continue;
    }
    bucket.push(record);
  }
  return byIdentity;
}

/** How a ref failed to resolve, phrased so the remedy is obvious from the line alone. */
function refFailure({ ref, found }: { ref: PinnedRecordRef; found: number }): string {
  const where = `${ref.source}/${ref.container}#${ref.sourceId}`;
  return found === 0
    ? `${where} is no longer in the corpus — regenerate the brief rather than answering from a slice that has moved`
    : `${where} matches ${String(found)} records, so the one the session read cannot be identified — regenerate the brief`;
}

/**
 * Rebuild the exact slice a set of refs pins, in ref order.
 *
 * Refuses rather than substituting. Every unresolvable ref is reported together, not just the first, because
 * a corpus that lost one record has usually lost several and one round trip should surface all of them.
 *
 * @param records the records currently loadable from the corpus
 * @param refs the pinned refs, in the order the brief stored them
 * @returns the records in ref order, or every reason a ref could not be resolved
 */
export function sliceByPinnedRefs({
  records,
  refs,
}: {
  records: readonly CorpusRecord[];
  refs: readonly PinnedRecordRef[];
}): Result<readonly CorpusRecord[]> {
  const byIdentity = recordsByIdentity({ records });
  const resolved: CorpusRecord[] = [];
  const failures: string[] = [];
  for (const ref of refs) {
    const matches = byIdentity.get(refIdentity({ ref }));
    // A ref no loadable record carries is refused outright, never read as an empty match.
    if (matches === undefined) {
      failures.push(refFailure({ found: 0, ref }));
      continue;
    }
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only === undefined) {
      failures.push(refFailure({ found: matches.length, ref }));
      continue;
    }
    resolved.push(only);
  }
  return failures.length > 0 ? err(failures) : ok(resolved);
}
