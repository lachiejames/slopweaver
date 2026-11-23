/**
 * Heal a Notion record whose content-addressed ref was carved up by redact's digit pass — the pure half.
 *
 * Before `SHA256_SPAN` was added to `corpus/redact.ts`, the `\d{9,}` pass replaced every run of nine or
 * more digits inside a 64-hex digest with `[number]`. The BYTES had already been stored under the real
 * digest; only the reference written into the record was damaged, so the record names a file nobody can
 * open. MEASURED on the live home: 102 of 1,255 `attachment: sha256:…` refs in Notion bronze
 * were mangled, 9 of them still on the latest-view winner of their identity, and every one of the 77
 * distinct mangled digests matched exactly one stored file.
 *
 * The store already holds the answer, so this reads it back rather than spending a re-pull. All nine were
 * keyed on an undashed page id, the spelling the child-page frontier once minted; compaction re-keys such a
 * row onto the dashed id the API writes (`canonicalId.ts`), so a healed row and a later re-pull of the same
 * page are one identity to `latestRecords`.
 *
 * **What makes a candidate the answer, and nothing weaker.** A `[number]` stands for a run of at least nine
 * decimal digits, so the damaged digest is a pattern over the stored names. The heal takes a candidate only
 * when EXACTLY ONE stored name matches, the file re-hashes to that name, and — for an attachment, whose ref
 * records a byte count — the file is that size. Anything else is a typed refusal and the ref is left as it
 * was; a guess here would make a record point confidently at the wrong bytes.
 *
 * Reproduce the census: `slopweaver compact heal-refs` (dry-run by default).
 */
import { BODY_ATTR, type CorpusAttributeValue, type CorpusRecord } from "../types.js";
import { bodyRef } from "./bodyStore.js";
import { attachmentRef } from "./pageAttachments.js";
import { type RefHealError, RefHealErrors } from "./refHealErrors.js";

/** Which store a ref points into — each kind resolves only against its own. */
export type RefKind = "attachment" | "body";

/** What the redactor wrote in place of a run of nine or more digits. */
const NUMBER_TOKEN = "[number]";

/** A digest the digit pass carved: hex with at least one `[number]` in it. */
const MANGLED_DIGEST = /^[0-9a-f]*(?:\[number\][0-9a-f]*)+$/;

/** One attachment ref line, its byte count possibly carved too when the file is 100 MB or more. */
const ATTACHMENT_REF = /^attachment: sha256:(\S+) \((\d+|\[number\]) bytes\)$/;

/** The prefix a body ref carries. */
const BODY_PREFIX = "sha256:";

/** What the heal needs to know about one stored file: its size and what its bytes actually hash to. */
export interface StoredFileFacts {
  readonly size: number;
  readonly sha256: string;
}

/** The two seams the pure core reads the store through. */
export interface RefHealStore {
  /** Every digest stored for this kind — the names a mangled digest may match. */
  readonly held: (args: { kind: RefKind }) => readonly string[];
  /** The facts about one stored file, read only for the single candidate. */
  readonly inspect: (args: { kind: RefKind; digest: string }) => StoredFileFacts;
}

/** A healed ref, or the reason it was left alone. */
export type RefResolution = { readonly digest: string; readonly size: number } | { readonly error: RefHealError };

/**
 * Whether a digest is one the digit pass carved. Pure.
 *
 * @param digest the text after `sha256:` on a record
 * @returns true when it holds at least one `[number]` and is otherwise hex
 */
export function isMangledDigest({ digest }: { digest: string }): boolean {
  return MANGLED_DIGEST.test(digest);
}

/**
 * The pattern a carved digest's original must match: each `[number]` stood for nine or more digits. Pure.
 *
 * @param mangled a digest {@link isMangledDigest} accepts
 * @returns an anchored pattern over 64-hex names
 */
export function mangledDigestPattern({ mangled }: { mangled: string }): RegExp {
  // Hex carries no regex metacharacter, so the literal parts need no escaping; only the token is replaced.
  return new RegExp(`^${mangled.split(NUMBER_TOKEN).join("[0-9]{9,}")}$`);
}

/**
 * Whether a stored size agrees with what a ref recorded. A carved count stood for nine or more digits. Pure.
 *
 * @param recorded the byte count exactly as the ref wrote it, digits or `[number]`
 * @param size the stored file's real size
 * @returns true when the two agree
 */
function sizeAgrees({ recorded, size }: { recorded: string; size: number }): boolean {
  if (recorded === NUMBER_TOKEN) {
    return String(size).length >= 9;
  }
  return String(size) === recorded;
}

/**
 * Resolve one carved digest to the one stored file it named, or say why not. Pure over the seams.
 *
 * @param mangled the carved digest
 * @param kind which store to resolve against
 * @param recordedSize for an attachment, the byte count its ref recorded
 * @param store the store seams
 * @returns the real digest and size, or the refusal
 */
export function resolveMangledDigest({
  mangled,
  kind,
  recordedSize,
  store,
}: {
  mangled: string;
  kind: RefKind;
  recordedSize?: string;
  store: RefHealStore;
}): RefResolution {
  const pattern = mangledDigestPattern({ mangled });
  const candidates = store.held({ kind }).filter((digest) => pattern.test(digest));
  const [only] = candidates;
  if (only === undefined) {
    return { error: RefHealErrors.noCandidate({ mangled }) };
  }
  if (candidates.length > 1) {
    return { error: RefHealErrors.ambiguous({ candidates, mangled }) };
  }
  const facts = store.inspect({ digest: only, kind });
  if (facts.sha256 !== only) {
    return { error: RefHealErrors.digestMismatch({ actual: facts.sha256, digest: only }) };
  }
  if (recordedSize !== undefined && !sizeAgrees({ recorded: recordedSize, size: facts.size })) {
    return { error: RefHealErrors.sizeMismatch({ actual: facts.size, digest: only, recorded: recordedSize }) };
  }
  return { digest: only, size: facts.size };
}

/** What healing one record did. */
export interface RecordHeal {
  /** The record with every resolvable ref rewritten; the input itself when nothing was. */
  readonly record: CorpusRecord;
  /** How many refs were rewritten. */
  readonly healed: number;
  /** Every carved ref left alone, and why. */
  readonly refusals: readonly RefHealError[];
}

/** Heal one `files` entry, or return it untouched. Pure over the seams. */
function healFileEntry({
  entry,
  store,
  refusals,
}: {
  entry: string;
  store: RefHealStore;
  refusals: RefHealError[];
}): string {
  const match = ATTACHMENT_REF.exec(entry);
  const mangled = match?.[1];
  const recordedSize = match?.[2];
  if (mangled === undefined || recordedSize === undefined || !isMangledDigest({ digest: mangled })) {
    return entry;
  }
  const resolved = resolveMangledDigest({ kind: "attachment", mangled, recordedSize, store });
  if ("error" in resolved) {
    refusals.push(resolved.error);
    return entry;
  }
  return attachmentRef({ bytes: resolved.size, digest: resolved.digest });
}

/**
 * Rewrite every carved content ref on one record — attachment refs in `attrs.files`, the body ref in
 * `attrs.body` — to the digest the store proves it named. Pure over the seams; nothing else on the record
 * moves, so the healed row differs from its predecessor ONLY in the refs.
 *
 * @param record the record to heal
 * @param store the store seams
 * @returns the healed record, how many refs moved, and every refusal
 */
export function healRecordRefs({ record, store }: { record: CorpusRecord; store: RefHealStore }): RecordHeal {
  const attrs = record.attrs;
  if (attrs === undefined) {
    return { healed: 0, record, refusals: [] };
  }
  const refusals: RefHealError[] = [];
  const next: Record<string, CorpusAttributeValue> = { ...attrs };
  let healed = 0;
  const files = attrs["files"];
  if (Array.isArray(files)) {
    const entries: readonly string[] = files;
    const rewritten = entries.map((entry) => healFileEntry({ entry, refusals, store }));
    healed += rewritten.filter((entry, index) => entry !== entries[index]).length;
    next["files"] = rewritten;
  }
  const body = attrs[BODY_ATTR];
  if (typeof body === "string" && body.startsWith(BODY_PREFIX)) {
    const mangled = body.slice(BODY_PREFIX.length);
    if (isMangledDigest({ digest: mangled })) {
      const resolved = resolveMangledDigest({ kind: "body", mangled, store });
      if ("error" in resolved) {
        refusals.push(resolved.error);
      } else {
        next[BODY_ATTR] = bodyRef({ digest: resolved.digest });
        healed += 1;
      }
    }
  }
  if (healed === 0) {
    return { healed, record, refusals };
  }
  return { healed, record: { ...record, attrs: next }, refusals };
}

/**
 * Whether a record still carries a carved content ref, healed or not — the witness a heal is checked by.
 * Pure.
 *
 * @param record the record to check
 * @returns true when any attachment or body ref on it is carved
 */
export function carriesMangledRef({ record }: { record: CorpusRecord }): boolean {
  const attrs = record.attrs;
  if (attrs === undefined) {
    return false;
  }
  const files = attrs["files"];
  const fileHit =
    Array.isArray(files) &&
    files.some((entry) => {
      const mangled = ATTACHMENT_REF.exec(entry)?.[1];
      return mangled !== undefined && isMangledDigest({ digest: mangled });
    });
  const body = attrs[BODY_ATTR];
  const bodyHit =
    typeof body === "string" &&
    body.startsWith(BODY_PREFIX) &&
    isMangledDigest({ digest: body.slice(BODY_PREFIX.length) });
  return fileHit || bodyHit;
}
