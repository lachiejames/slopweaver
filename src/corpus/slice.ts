/**
 * The PINNED SLICE — a named, reproducible subset of one source, and the digest that makes a rerun
 * comparable rather than merely similar.
 *
 * ## Why a pin, rather than counts
 *
 * The obvious shape for "did we lose anything between two runs?" is to compare counts, or identity sets.
 * The repository already has that in {@link ./manifest} and it is not enough for this job, measured: build
 * a manifest from a record, change that record's TEXT and its timestamp, rebuild, and the two manifests
 * compare EQUAL with zero findings. It stores which identities exist, never what they contained.
 *
 * That gap is not academic. Reconstructing files from the records the real corpus holds reported 1,063 files
 * apparently missing 66,471 characters — and re-splitting the same files with the same splitter showed it
 * near-lossless. The difference was **files edited after they were ingested**. Without a content pin a
 * completeness check cannot tell loss from staleness, so it cries wolf on 22% of a healthy corpus and is
 * then, correctly, ignored.
 *
 * So the pin digests CONTENT, and it is the whole point of this module:
 *
 *  - a rerun over an UNCHANGED fixture reproduces the digest exactly, so idempotence is checkable;
 *  - a rerun over a CHANGED fixture is a typed failure naming what moved, not a silently incomparable
 *    result. A moving baseline is worse than no baseline.
 *
 * ## What the pin is over
 *
 * `(recordIdentity, recordContentFingerprint)` per record, sorted, hashed. Both are reused rather than
 * reinvented: identity is the composite `(source, container, sourceId)` from {@link ./latestRecords}, and
 * the fingerprint is the writer's own content hash from {@link ./recordSerialisation} — the same one dedup keys
 * on, which deliberately excludes the observation timestamp so an unchanged rerun is a no-op. Reusing it
 * means the pin agrees with the writer by construction instead of by coincidence.
 *
 * Pure module — no I/O, no clock. The caller supplies the records and the capture time.
 */
import { createHash } from "node:crypto";

import { isRecord, isRecordOfNumbers } from "../lib/parsers.js";
import { recordIdentity } from "./latestRecords.js";
import { recordContentFingerprint } from "./recordSerialisation.js";
import type { CorpusRecord } from "./types.js";

/** The manifest schema version. Bumped when a field changes meaning, never when content changes. */
export const SLICE_MANIFEST_VERSION = 1;

/**
 * How a captured field reaches — or does not reach — a model.
 *
 * The three values are exhaustive by design, because the projection identity's whole claim is that nothing
 * falls off the edge UNCLASSIFIED. A fourth state would have to be "we do not know", which is the condition
 * this check exists to eliminate.
 */
export type FieldDisposition =
  /** The field's characters are searched AND rendered into the prompt, so they can reach a model. */
  | "indexed"
  /**
   * Searched by the ranker but NEVER rendered into the prompt.
   *
   * A category that only exists because the harness caught its own false declaration: `refs` was labelled
   * `indexed`, and BM25 does tokenise it — but the prompt renders title, text, date and author, not refs.
   * A unique string living only in `refs` therefore retrieves its record and never reaches the model, which
   * is precisely the silent loss this whole capability is about. Collapsing the two states would have hidden
   * it behind a green check.
   */
  | "searchable-only"
  /** Carried and used for filtering, ranking or citation, but never searched as text. */
  | "structural"
  /** Deliberately never indexed, and named here so that decision is visible rather than implicit. */
  | "non-indexable";

/**
 * Every top-level `CorpusRecord` field and what happens to it — the projection identity's field universe.
 *
 * Exactly the 14 declared fields, and the owner's ruling is that `raw` is ONE opaque blob rather than a tree
 * to recurse into: recursing is where the Notion row defect lives and that has its own doc. Keeping the map
 * exhaustive over the TYPE means adding a field to `CorpusRecord` without classifying it fails to compile,
 * which is the only way this stays true.
 */
export const FIELD_DISPOSITIONS: Readonly<Record<keyof CorpusRecord, FieldDisposition>> = {
  attrs: "structural",
  author: "structural",
  container: "structural",
  kind: "structural",
  // Source-specific opaque JSON. Never indexed, and that is a decision rather than an oversight — the
  // owner ruled it one blob for this check.
  raw: "non-indexable",
  // Searched but not rendered: `retrievalIndex` tokenises `title + text + refs`, while `askPrompt` renders
  // only title, text, date and author. A sentinel living only here is findable and unreachable.
  refs: "searchable-only",
  source: "structural",
  sourceId: "structural",
  text: "indexed",
  title: "indexed",
  tsIso: "structural",
  // A parse-time PRECOMPUTE, not captured content: the `derive` projection records whether the words read as
  // open work and then drops the words. Nothing indexes it, and nothing should — the text it was derived
  // from is what `retrieval` indexes, and a projection carrying both would be indexing the same fact twice.
  unresolved: "non-indexable",
  url: "structural",
  visibility: "structural",
};

/** One unique string that must survive the whole path, from the file on disk to the bytes a model is handed. */
export interface SliceSentinel {
  /** The literal string to look for. Unique enough that a match is not a coincidence. */
  readonly text: string;
  /** The question that should retrieve it, so the retrieval leg exercises ranking rather than a scan. */
  readonly query: string;
}

/**
 * The digest that makes two captures comparable.
 *
 * `records` and `identities` are carried beside the hash on purpose: when the hash differs, a bare "they
 * differ" is useless, and these two numbers separate "content changed" from "the set changed" without
 * needing the other capture in hand.
 */
export interface SlicePin {
  /** SHA-256 over the sorted `(identity, contentFingerprint)` pairs. */
  readonly digest: string;
  /** How many records the digest covers. */
  readonly records: number;
  /** How many DISTINCT logical identities those records carry. A gap means duplicate identities. */
  readonly identities: number;
}

/** A named, reproducible subset of one source, with what must be true of it. */
export interface SliceManifest {
  readonly version: typeof SLICE_MANIFEST_VERSION;
  /** The slice's name — the handle every command takes, and the manifest's filename stem. */
  readonly name: string;
  /** The source this slice is cut from. */
  readonly source: string;
  /**
   * The absolute roots the capture walked.
   *
   * Absolute because a slice is a LOCAL fixture and must be re-walkable, and this file lives under
   * `$SLOPWEAVER_HOME` — never in the repository — precisely because these name real directories.
   */
  readonly roots: readonly string[];
  /**
   * Relative-path prefixes the capture declined.
   *
   * Recorded rather than left to the caller because a pin is only reproducible if the re-walk sees the same
   * subtree. Verifying with different exclusions than were captured would compare two different slices and
   * report the difference as loss.
   */
  readonly exclude: readonly string[];
  /** When the capture was taken. Observation time may advance between runs; nothing else may. */
  readonly capturedAtIso: string;
  /** The content pin. */
  readonly pin: SlicePin;
  /** Strings that must survive to the bytes a model is handed. */
  readonly sentinels: readonly SliceSentinel[];
  /** Entries the walk saw and declined, per typed reason — the discovery identity's expected shape. */
  readonly declinedByReason: Readonly<Record<string, number>>;
  /** Entries the walk saw in total: read plus declined. */
  readonly entriesSeen: number;
}

/**
 * The content pin over a set of records. Pure and order-independent — the pairs are sorted before hashing,
 * so two captures that read the same files in a different order pin identically.
 *
 * @param records the captured records
 * @returns the digest plus the record and distinct-identity counts
 */
export function buildSlicePin({ records }: { records: readonly CorpusRecord[] }): SlicePin {
  // JSON-framed pairs rather than a delimiter-joined string: JSON escaping makes the encoding injective,
  // so no identity can be split or forged into another, and the source file needs no control byte to say so.
  // `tsIso` is hashed ALONGSIDE the writer's fingerprint rather than relying on it alone. The fingerprint
  // deliberately blanks the timestamp so that re-observing an unchanged record deduplicates — correct for a
  // writer, wrong for a pin, because `askPrompt` renders that date INTO the prompt. Without this, touching a
  // non-git note changes the date a model is shown while the pin reports the capture identical.
  const pairs = records.map((record) =>
    JSON.stringify([recordIdentity({ record }), recordContentFingerprint({ record }), record.tsIso]),
  );
  const hash = createHash("sha256");
  for (const pair of pairs.toSorted()) {
    hash.update(pair);
  }
  return {
    digest: hash.digest("hex"),
    identities: new Set(records.map((record) => recordIdentity({ record }))).size,
    records: records.length,
  };
}

/**
 * Why two pins differ — one line per difference, most specific first. Pure.
 *
 * @param before the pin recorded at capture
 * @param after the pin computed on this run
 * @returns one line per difference, empty when the two pins agree
 */
export function comparePins({ before, after }: { before: SlicePin; after: SlicePin }): readonly string[] {
  // The counts are compared BEFORE the digest short-circuit, and that ordering is the fix for a real hole.
  // "Both are derived from the same records, so they cannot disagree" is true of a pin this process just
  // computed and false of one READ OFF DISK: `parseSliceManifest` validates types, not internal consistency,
  // so a hand-edited or partially-corrupted manifest can carry a matching digest beside a wrong count and
  // would have compared clean.
  const findings: string[] = [];
  if (before.records !== after.records) {
    findings.push(
      `record count moved: ${String(before.records)} → ${String(after.records)} (${signed({ n: after.records - before.records })})`,
    );
  }
  if (before.identities !== after.identities) {
    findings.push(
      `distinct identities moved: ${String(before.identities)} → ${String(after.identities)} (${signed({ n: after.identities - before.identities })})`,
    );
  }
  if (before.digest === after.digest) {
    return findings;
  }
  if (findings.length === 0) {
    // The counts match and the digest does not, which is the interesting case and the one a count-based
    // manifest reports as clean: the same records, holding different CONTENT.
    findings.push(
      `content changed with no change in shape: ${String(after.records)} record(s) and ${String(after.identities)} identity(ies) as before, but the content digest moved (${before.digest.slice(0, 12)} → ${after.digest.slice(0, 12)})`,
    );
  }
  return findings;
}

/** A signed count, so a reader sees direction without subtracting. */
function signed({ n }: { n: number }): string {
  return n > 0 ? `+${String(n)}` : String(n);
}

/**
 * The exclusions a manifest declares, treating ABSENT as "none". Pure.
 *
 * Absent is not malformed here, and the distinction matters: a pin captured before `--exclude` existed
 * excluded nothing, so reading it as an empty list is exactly faithful. Refusing it instead would orphan
 * every pin already on disk the moment the field was added — a schema tightening that destroys the baselines
 * it was meant to protect. Dogfooding caught precisely that: two live pins stopped parsing.
 *
 * A PRESENT but non-array value is still refused, because that is genuinely malformed.
 *
 * @param value the raw `exclude` field, of unvalidated shape
 * @returns the string prefixes, or undefined when the field is present and not an array
 */
function parseExclude({ value }: { value: unknown }): readonly string[] | undefined {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : undefined;
}

/**
 * Whether a value is a well-formed {@link SliceManifest}, checked strictly rather than coerced. Pure.
 *
 * Strict on purpose: {@link ./manifest.parseCorpusManifest} accepts `{"version":2}` and fills most missing
 * collections with an empty one, which turns a truncated file into a manifest that compares clean against
 * anything. A pin that can be satisfied by a corrupt file is not a pin.
 *
 * @param value the parsed JSON
 * @returns the manifest when every required field is present and well-typed, else undefined
 */
export function parseSliceManifest({ value }: { value: unknown }): SliceManifest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const m = value;
  const pin = m["pin"];
  if (m["version"] !== SLICE_MANIFEST_VERSION || !isRecord(pin)) {
    return undefined;
  }
  const p = pin;
  if (typeof p["digest"] !== "string" || typeof p["records"] !== "number" || typeof p["identities"] !== "number") {
    return undefined;
  }
  const declinedByReason = m["declinedByReason"];
  if (
    typeof m["name"] !== "string" ||
    typeof m["source"] !== "string" ||
    typeof m["capturedAtIso"] !== "string" ||
    typeof m["entriesSeen"] !== "number" ||
    !Array.isArray(m["roots"]) ||
    !Array.isArray(m["sentinels"]) ||
    !isRecordOfNumbers(declinedByReason)
  ) {
    return undefined;
  }
  const sentinels: SliceSentinel[] = [];
  for (const entry of m["sentinels"]) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const text = entry["text"];
    const query = entry["query"];
    if (typeof text !== "string" || typeof query !== "string") {
      return undefined;
    }
    sentinels.push({ query, text });
  }
  // Rebuilt field by field rather than asserted, so the returned manifest is narrowed by the checks above
  // instead of by a cast that would keep compiling after a field was added and left unvalidated.
  const exclude = parseExclude({ value: m["exclude"] });
  if (exclude === undefined) {
    return undefined;
  }
  return {
    capturedAtIso: m["capturedAtIso"],
    declinedByReason,
    entriesSeen: m["entriesSeen"],
    exclude,
    name: m["name"],
    pin: { digest: p["digest"], identities: p["identities"], records: p["records"] },
    roots: m["roots"].filter((root): root is string => typeof root === "string"),
    sentinels,
    source: m["source"],
    version: SLICE_MANIFEST_VERSION,
  };
}
