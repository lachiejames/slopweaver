/**
 * Generic file-level primitives an atlas generation is built from: deterministic serialisation, a content
 * digest over the same bytes that reach disk, reading a file that may legitimately be absent, and an
 * atomic replace. Platform-agnostic — shared by every atlas platform's own `store.ts` (Vanta, Cloudflare),
 * promoted out of `atlas/vanta/` once a second atlas justified the extraction.
 *
 * ## Two document shapes, and why a KIND FILE is not one JSON object on disk
 *
 * A manifest is bounded: one status cell per kind, so it stays a single pretty-printed `.json` written
 * through {@link writeAtomic}. A kind file is not bounded by anything this code controls — its size is a
 * property of the TENANT. MEASURED: one Cloudflare account's Pages projects serialised to an
 * `atlas/cloudflare/pages-project.json` (and a superseded copy) past what one JS string may safely hold —
 * reproduce with `find ~/.slopweaver/atlas -name '*.json*' -size
 * +100M`. Nothing static could have seen that coming, which is why the `whole-file-json` gate never fired
 * here and why {@link safeJsonStringify} refusing at the seam is what caught it.
 *
 * So a kind file is `.jsonl`: the ENVELOPE on line 1 — the whole document with its entities emptied — and
 * then one entity per line after it. {@link writeAtomicKindFile} streams those lines through
 * `writeFileAtomicStream`, and {@link readKindFileIfPresent} pulls them back through `readJsonlLines`, so
 * neither side ever holds more than one record in a single JS string. The bytes are still deterministic,
 * because every line goes through {@link sortDeep} and arrays keep the order their producer chose, so
 * republishing the same generation still writes byte-identical output.
 *
 * The digest is unchanged in KIND but not in value: {@link digestOfKindFile} hashes exactly the line
 * sequence the writer emits, so what the manifest vouches for is still the bytes on disk rather than a
 * second serialisation that could drift from them.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { isAbsentError, isNotFoundError } from "#lib/presentFile.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic, writeFileAtomicBytes, writeFileAtomicStream } from "../lib/writeAtomic.js";

/**
 * What a kind file holds once its lines are read back: the envelope, and every entity after it.
 *
 * @internal
 */
export interface AtlasKindFileParts {
  readonly envelope: unknown;
  readonly entities: readonly unknown[];
}

/** The second line of every refusal to read a generation, so a corrupt atlas is never read as an empty one. */
const CORRUPT_REMEDY = "refusing rather than treating a corrupt atlas as an empty one";

/**
 * Recursively sort object keys so serialisation is deterministic. Arrays keep their order — callers
 * already sort entities by id and attributes by path, and those orders are meaningful.
 *
 * @param value the value to sort
 * @returns the value with every object's keys in sorted order
 */
export function sortDeep({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortDeep({ value: entry }));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    sorted[key] = sortDeep({ value: value[key] });
  }
  return sorted;
}

/**
 * Serialise for disk: sorted keys, pretty-printed, newline-terminated. The MANIFEST's form — see this
 * module's header for why a kind file does not use it.
 *
 * Goes through {@link safeJsonStringify} rather than `JSON.stringify` because a manifest's size is still not
 * this code's to promise: it carries one cell per kind, and the widest atlas here declares 115 of them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 */
export function stableJson({ value }: { value: unknown }): string {
  return `${safeJsonStringify({ label: "an atlas artifact", space: 2, value: sortDeep({ value }) })}\n`;
}

/**
 * A content digest over the same bytes that reach disk — reproducible from a file on disk.
 *
 * @param value the document to digest
 * @returns a hex sha-256 of the serialised form
 */
export function digestOf({ value }: { value: unknown }): string {
  return createHash("sha256").update(stableJson({ value })).digest("hex");
}

/** One record's own line: sorted keys, compact, newline-terminated. */
function kindFileLine({ value, label }: { value: unknown; label: string }): string {
  return `${safeJsonStringify({ label, value: sortDeep({ value }) })}\n`;
}

/**
 * Every line of a kind file, in the order they reach disk: the envelope, then one entity each.
 *
 * A generator rather than an array so the writer, the digest and the 1Password atlas's sensitivity gate
 * share ONE definition of the file's bytes without any of them materialising the whole thing — which is the
 * property the whole layout exists for.
 *
 * @returns each line, newline-terminated, yielded one at a time
 * @internal
 */
export function* kindFileLines({ envelope, entities }: AtlasKindFileParts): Generator<string> {
  yield kindFileLine({ label: "an atlas kind file envelope", value: envelope });
  for (const entity of entities) {
    yield kindFileLine({ label: "an atlas entity", value: entity });
  }
}

/**
 * A content digest over exactly the bytes {@link writeAtomicKindFile} writes, computed one line at a time.
 *
 * @param envelope the kind file with its entities emptied
 * @param entities the entities, in the order they will be written
 * @returns a hex sha-256 of the file's bytes
 */
export function digestOfKindFile({ envelope, entities }: AtlasKindFileParts): string {
  const hash = createHash("sha256");
  for (const line of kindFileLines({ entities, envelope })) {
    hash.update(line);
  }
  return hash.digest("hex");
}

/**
 * Why a file that is there could not be read, and how to clear it. An ENOENT reaching here was not absence, so
 * a link on the way to the file points at nothing; anything else is the file itself refusing to be read.
 */
function unreadableLines({ error, path }: { error: unknown; path: string }): string[] {
  const line = `cannot read ${path}: ${errorMessage({ error })}`;
  if (!isNotFoundError({ error })) {
    return [
      line,
      "restore read access to it, or move whatever stands at that path aside so the file reads as never written",
    ];
  }
  return [
    line,
    "a link on the way to it points at nothing — restore the link's target, or remove the link so the file reads as never written",
  ];
}

/**
 * Read a file's contents, distinguishing "not there" from "could not read". An absent file returns `null`
 * rather than an error, because absence is a legitimate state; any other failure is reported, since a
 * permissions problem read as absence would look exactly like a fresh install.
 *
 * @param path the file to read
 * @returns the contents, `null` when the file does not exist, or the reason it could not be read
 */
export function readFileIfPresent({ path }: { path: string }): Result<string | null> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return ok(null);
    }
    return err(unreadableLines({ error, path }));
  }
}

/**
 * Read a kind file back line by line, distinguishing "not there" from "could not read" from "corrupt" the
 * same way {@link readFileIfPresent} does. The first non-blank line is the envelope; every line after it is
 * one entity.
 *
 * A malformed line names its own line number rather than condemning the file as a whole, because a kind file
 * large enough to need this layout is one nobody can eyeball.
 *
 * @param path the file to read
 * @returns the envelope and its entities, `null` when the file does not exist, or why it cannot be read
 */
export function readKindFileIfPresent({ path }: { path: string }): Result<AtlasKindFileParts | null> {
  const records: unknown[] = [];
  const problems: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        try {
          records.push(safeJsonParse({ label: `${path} line ${String(index + 1)}`, text: line }));
        } catch (error: unknown) {
          problems.push(`${path} line ${String(index + 1)} is not valid JSON: ${errorMessage({ error })}`);
        }
      },
      path,
    });
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return ok(null);
    }
    return err(unreadableLines({ error, path }));
  }
  if (problems.length > 0) {
    return err([...problems, CORRUPT_REMEDY]);
  }
  if (records.length === 0) {
    return err([`${path} holds no envelope line`, CORRUPT_REMEDY]);
  }
  return ok({ entities: records.slice(1), envelope: records[0] });
}

/**
 * The path a kind's file occupied before this layout — the same name carrying `.json` where this build
 * writes `.jsonl`.
 *
 * Here rather than beside either of its two callers because a predecessor is a fact about the FORMAT, and
 * the format is this module's. `kit/singleFileRepair.ts` uses it to plan a repair; `kit/store.ts` uses it to
 * GRADE, so a generation the layout left behind is reported as left behind rather than as gone. Those two
 * had derived the same name independently, which is the drift that let a reader and a repair disagree about
 * what a kind file is called.
 *
 * @param path the path this build reads, which always ends `.jsonl`
 * @returns the pre-`.jsonl` sibling
 */
export function singleFileKindPath({ path }: { path: string }): string {
  return `${path.replace(/\.jsonl$/, "")}.json`;
}

/**
 * Replace one BINARY file atomically and durably, for an artifact whose bytes are not JSON.
 *
 * A separate function rather than a widened {@link writeAtomic} because the JSON path serialises through
 * {@link stableJson}, and pushing a PNG through a text writer would replace every byte outside the ASCII
 * range — a file with a plausible size that is not an image. The temp-fsync-rename-fsync discipline is
 * `lib/writeAtomic.ts`'s, shared with every other durable write here.
 *
 * @param path the file to write
 * @param bytes the file's exact contents, written verbatim
 * @returns nothing on success, or every reason the write failed
 */
export function writeAtomicBytes({ path, bytes }: { path: string; bytes: Uint8Array }): Result<null> {
  try {
    writeFileAtomicBytes({ bytes: Buffer.from(bytes), path });
  } catch (error: unknown) {
    return err([`cannot write ${path}: ${errorMessage({ error })}`]);
  }
  return ok(null);
}

/**
 * Replace one file atomically and durably, serialising the document the way the MANIFEST is written.
 * The temp-file / fsync / rename / fsync-the-directory mechanics live in {@link writeFileAtomic}; this is
 * the atlas-shaped wrapper over it — stable JSON in, a `Result` out.
 *
 * @param path the file to write
 * @param value the document to serialise
 * @returns nothing on success, or every reason the write failed
 */
export function writeAtomic({ path, value }: { path: string; value: unknown }): Result<null> {
  try {
    writeFileAtomic({ contents: stableJson({ value }), path });
  } catch (error: unknown) {
    return err([`cannot write ${path}: ${errorMessage({ error })}`]);
  }
  return ok(null);
}

/**
 * Replace one KIND FILE atomically and durably, streaming it a record at a time so neither the envelope nor
 * any entity ever shares a JS string with the rest of the file. The staging, fsync and rename discipline is
 * {@link writeFileAtomicStream}'s, so a reader still sees either the whole previous generation or the whole
 * new one.
 *
 * `flushDirectory: false` is the publish's: it stages every kind file beside its destination and
 * `kit/generationSwap.ts` flushes each destination directory ONCE after the last install, so a per-file flush
 * of the staging write is the same guarantee paid for again per kind. Omitted, the directory is flushed here. MEASURED: directory flushes were 1,269 ms of the 2,466 ms two back-to-back
 * `syncDatadogCatalogue` publishes spent in `fsync` (reproduce with `node --import tsx --cpu-prof` over two
 * `syncDatadogCatalogue({ at, home })` calls against `mkdtempSync` homes, then sum `fsyncDirectory`).
 *
 * @param path the file to write
 * @param envelope the kind file with its entities emptied — line 1
 * @param entities the entities, one line each, in the order given
 * @param flushDirectory `false` only when `path` is a staging sibling whose installer flushes the directory
 * @returns nothing on success, or every reason the write failed
 */
export function writeAtomicKindFile({
  path,
  envelope,
  entities,
  flushDirectory,
}: {
  path: string;
  envelope: unknown;
  entities: readonly unknown[];
  flushDirectory?: boolean | undefined;
}): Result<null> {
  try {
    writeFileAtomicStream({
      flushDirectory,
      path,
      produce: ({ write }) => {
        for (const line of kindFileLines({ entities, envelope })) {
          write({ text: line });
        }
      },
    });
  } catch (error: unknown) {
    return err([`cannot write ${path}: ${errorMessage({ error })}`]);
  }
  return ok(null);
}

/**
 * Read only a kind file's ENVELOPE — line 1 — without materialising the entities after it.
 *
 * `publishAtlas` derives the manifest clock from every kind file the generation vouches for, including the
 * ones this publish is not rewriting, and those are on disk. Reading them with {@link readKindFileIfPresent}
 * would pull whole files into memory to look at one field: a kind file's size is the tenant's (see this
 * module's header), and a publish touching one kind would read every other kind whole.
 * So this stops the stream as soon as the envelope is in hand — `readJsonlLines`'s `onChunk` returning
 * `false` ends the read before the next chunk, bounding it at one `READ_CHUNK_BYTES` window whatever
 * the file's size. Reproduce the bound: `ls -l ~/.slopweaver/atlas/cloudflare/pages-project.jsonl`.
 *
 * @param path the file to read
 * @returns the envelope record, `null` when the file does not exist, or why it cannot be read
 */
export function readKindEnvelopeIfPresent({ path }: { path: string }): Result<unknown | null> {
  const found: unknown[] = [];
  const problems: string[] = [];
  try {
    readJsonlLines({
      onChunk: () => found.length === 0 && problems.length === 0,
      onLine: ({ line, index }) => {
        if (found.length > 0 || problems.length > 0 || line.trim().length === 0) {
          return;
        }
        try {
          found.push(safeJsonParse({ label: `${path} line ${String(index + 1)}`, text: line }));
        } catch (error: unknown) {
          problems.push(`${path} line ${String(index + 1)} is not valid JSON: ${errorMessage({ error })}`);
        }
      },
      path,
    });
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return ok(null);
    }
    return err(unreadableLines({ error, path }));
  }
  if (problems.length > 0) {
    return err([...problems, CORRUPT_REMEDY]);
  }
  if (found.length === 0) {
    return err([`${path} holds no envelope line`, CORRUPT_REMEDY]);
  }
  return ok(found[0]);
}
