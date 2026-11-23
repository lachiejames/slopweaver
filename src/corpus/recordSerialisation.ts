/**
 * The canonical bronze byte shape of a record, which is also what bronze dedups on.
 *
 * `serialiseRecord` fixes the key order and computes the fingerprint over everything EXCEPT `tsIso`, so
 * two captures of the same content at different times share a fingerprint and collapse.
 */
import { type CorpusAttributeValue, type CorpusRecord } from "./types.js";

/**
 * Deterministic code-unit string order. Positional because `Array.prototype.sort` dictates the signature.
 *
 * Deliberately NOT `localeCompare`: it orders by locale, so the same two records could serialise differently
 * on two machines — and since these bytes ARE the dedup fingerprint, that would make a record look changed
 * merely because it was written somewhere else.
 */
function byCodeUnit(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Attrs with keys in sorted order AND every array VALUE sorted, so serialisation (and the fingerprint) is
 * stable across runs.
 *
 * Sorting the keys alone was not enough, and the gap was a live defect rather than a theoretical one: a
 * provider is free to return a set-valued connection in a different order on each call, which produced a
 * different fingerprint for identical content and appended a false new version — permanently, on every
 * refresh, with no symptom other than a corpus that kept growing.
 *
 * Sorting the values is safe because every array-valued attribute this corpus stores is a SET, not a
 * sequence. Measured across a real 227k-record corpus, the complete list is `reactions`, `files`, `labels`
 * and `curatedEdges` — no attribute exists whose element order carries meaning. If one is ever added, it
 * must not use this path.
 */
function orderedAttrs({
  attrs,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
}): Record<string, CorpusAttributeValue> {
  const out: Record<string, CorpusAttributeValue> = {};
  for (const key of Object.keys(attrs).toSorted()) {
    const value = attrs[key]!; // key came from Object.keys, so the value is present
    out[key] = Array.isArray(value) ? [...value].toSorted(byCodeUnit) : value;
  }
  return out;
}

/** Fixed-key-order object for a record; optional fields appended only when set (stable serialisation). */
function orderedRecord({ record }: { record: CorpusRecord }): Record<string, unknown> {
  const ordered: Record<string, unknown> = {
    container: record.container,
    kind: record.kind,
    // `refs` is a SET of cross-references, not a sequence — the graph treats it as one. It was being stored
    // in text-appearance order, so re-extracting the same content in a different order churned the
    // fingerprint: 21,297 of 47,411 multi-entry `refs` arrays in a real corpus were not in sorted order.
    refs: [...record.refs].toSorted(byCodeUnit),
    source: record.source,
    sourceId: record.sourceId,
    text: record.text,
    tsIso: record.tsIso,
    url: record.url,
  };
  if (record.author !== undefined) {
    ordered["author"] = record.author;
  }
  if (record.title !== undefined) {
    ordered["title"] = record.title;
  }
  // `visibility` (PR4.5) is serialised ONLY when `private`, so a public record's bytes (and thus its
  // dedup fingerprint) are identical to pre-PR4.5 bronze — no churn, and unmarked legacy reads as public.
  if (record.visibility === "private") {
    ordered["visibility"] = "private";
  }
  // `attrs` is appended last (after the v0.1 fields) and only when non-empty, so old readers/writers are
  // unaffected and the fingerprint changes only on a genuine metadata change.
  if (record.attrs !== undefined && Object.keys(record.attrs).length > 0) {
    ordered["attrs"] = orderedAttrs({ attrs: record.attrs });
  }
  // `raw` (the full source payload) is appended last of all. It is EXCLUDED from the fingerprint (see
  // `contentFingerprint`) so a volatile raw field never churns bronze — first-captured raw is retained.
  if (record.raw !== undefined && Object.keys(record.raw).length > 0) {
    ordered["raw"] = record.raw;
  }
  return ordered;
}

/**
 * The canonical JSONL serialisation of a record.
 *
 * @param record the record to serialise
 * @returns the JSON line (no trailing newline)
 */
export function serialiseRecord({ record }: { record: CorpusRecord }): string {
  return escapeLineTerminators({ json: JSON.stringify(orderedRecord({ record })) });
}

/**
 * Escape U+2028 and U+2029 so a serialised record can never contain a stray line terminator.
 *
 * `JSON.stringify` leaves both characters RAW — they are legal inside a JSON string — but they ARE line
 * terminators to a great many readers, including Node's own `readline`. A JSONL store whose one invariant is
 * "one record per line" therefore ships lines that are not lines. Measured before this fix: 40 occurrences
 * across a real Linear bronze store, splitting 20 records in two.
 *
 * Nothing was losing data yet, because the production reader splits on `\n` alone. That is a thin margin to
 * rely on: any future reader that reaches for `readline` silently drops both halves of every affected record
 * and reports no error, which is precisely the failure mode this repo cares most about. The escape is
 * emitted at the single write choke-point so the guarantee holds for whatever reads bronze later.
 *
 * The output stays valid JSON and parses back to the identical string, so this changes the bytes on disk
 * without changing the value any reader sees.
 *
 * EXPORTED so every JSONL store in the home shares ONE implementation. The history store writes authored
 * event payloads and has the identical exposure; a second copy of a two-character escape table is exactly the
 * kind of duplicate that stays right in one file and rots in the other.
 *
 * @param json the serialised JSON line
 * @returns the same JSON with U+2028/U+2029 written as escapes
 */
export function escapeLineTerminators({ json }: { json: string }): string {
  return json.replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/**
 * Content fingerprint = the serialisation with `tsIso` blanked AND `raw` dropped, so neither a time-only
 * difference nor a volatile raw-payload field counts as a content change (either would needlessly churn
 * bronze). Dedup keys on the curated, meaningful content only.
 *
 * EXPORTED because it is THE dedup key of the corpus: the cross-window compactor (PR4.9,
 * {@link ./compact}) reuses this exact function rather than re-deriving one, so a compaction can never
 * collapse a pair the writer would have kept (or keep a pair the writer would have collapsed). Any drift
 * between the two would be silent data loss, so there is deliberately only one implementation.
 *
 * @param record the record to fingerprint
 * @returns the content fingerprint (a canonical JSON string, `tsIso` blanked + `raw` dropped)
 */
export function recordContentFingerprint({ record }: { record: CorpusRecord }): string {
  const { raw: _raw, ...withoutRaw } = record;
  return serialiseRecord({ record: { ...withoutRaw, tsIso: "" } });
}
