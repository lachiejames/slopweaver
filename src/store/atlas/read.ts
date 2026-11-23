/**
 * The bounded READER — one atlas kind file off disk into projected rows, one slice at a time.
 *
 * Nothing here touches the database, and nothing here holds a file. Both matter: a kind file's size is a
 * property of the TENANT rather than of this code, and one Cloudflare account's `pages-project` document
 * measured over a hundred MiB (`src/atlas/atlasFile.ts`'s header). So the import must never call
 * `readKindFileIfPresent`, which pushes every parsed record into one array and returns
 * `records.slice(1)` — on that file it holds the whole object graph at once.
 *
 * `readJsonlLines` (`../../corpus/corpusStore.ts`) is what it calls instead: a chunked synchronous read
 * with a per-line callback, a per-chunk early exit and a `startByteOffset`, so a caller takes a bounded
 * slice, writes it, and resumes exactly where it stopped. This is the same shape `../ingestRead.ts` uses
 * for bronze, and the resume-cursor trap it documents applies here identically — the cursor is measured
 * from the LINE's own `byteOffset + byteLength`, never from the reader's `bytesConsumed`, because the
 * chunk that reached the ceiling has already delivered its remaining lines to a callback that skipped
 * them.
 */
import { statSync } from "node:fs";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import type { NewAtlasEntityChannelRow, NewAtlasEntityRow } from "../schema.js";

import { type ProjectedEnvelope, projectEnvelope } from "./envelope.js";
import { type AtlasImportError, AtlasImportErrors } from "./errors.js";
import { mayHoldNul, projectEntity } from "./project.js";

/** How many refusals one import keeps, however many it counts. See `../ingestRead.ts`'s own cap. */
const MAX_RETAINED_REFUSALS = 200;

/** What one bounded read of a kind file produced, before anything was written. */
export interface AtlasEntitySlice {
  readonly entities: readonly NewAtlasEntityRow[];
  readonly channels: readonly NewAtlasEntityChannelRow[];
  /** Retained EXAMPLES, capped at {@link MAX_RETAINED_REFUSALS} — never every refusal the slice produced. */
  readonly refusals: readonly AtlasImportError[];
  /** How many refusals the slice produced, exactly, however few of them it kept. */
  readonly refusalCount: number;
  readonly linesRead: number;
  /** U+0000 characters removed on the way into a jsonb column. See `./project.ts`'s `stripNuls`. */
  readonly nulsStripped: number;
  /** One past the end of the last line this slice ACCOUNTED FOR. See this module's header. */
  readonly resumeByteOffset: number;
}

/** What one kind file's line 1 gave, plus where its entities begin. */
export interface AtlasEnvelopeRead {
  readonly envelope: ProjectedEnvelope;
  /** The byte offset the first ENTITY line starts at, so a slice never re-reads the envelope. */
  readonly entitiesFrom: number;
}

/**
 * Read and project one kind file's envelope, and say where its entities begin.
 *
 * Reads exactly one line: a kind file's envelope is bounded by the number of kinds and scopes rather than
 * by the tenant, so holding one is safe in a way holding the file is not.
 *
 * @param path the kind file
 * @param platform the directory it sits in — the platform, never the envelope's own claim
 * @returns the projected envelope and where line 2 starts, or why line 1 is unusable
 */
export function readKindEnvelope({
  path,
  platform,
}: {
  path: string;
  platform: string;
}): { envelope: AtlasEnvelopeRead } | { error: AtlasImportError } {
  // An array rather than a `string | null`: the callback assigns and the code after it reads, which
  // TypeScript's control-flow analysis cannot connect across a closure — it narrows the variable to
  // `null` at the read and calls the guard an unnecessary comparison.
  const firstLine: string[] = [];
  let after = 0;
  try {
    readJsonlLines({
      onChunk: () => firstLine.length === 0,
      onLine: ({ line, byteOffset, byteLength }) => {
        if (firstLine.length > 0) {
          return;
        }
        firstLine.push(line);
        after = byteOffset + byteLength + 1;
      },
      path,
    });
  } catch (error: unknown) {
    return { error: AtlasImportErrors.unusableEnvelope({ field: errorMessage({ error }), path }) };
  }
  const first = firstLine[0];
  if (first === undefined) {
    return { error: AtlasImportErrors.unusableEnvelope({ field: "the file holds no lines", path }) };
  }
  const parsed = parseLine({ line: first, lineNumber: 1, path });
  if ("error" in parsed) {
    return { error: AtlasImportErrors.unusableEnvelope({ field: "line 1 is not valid JSON", path }) };
  }
  const projected = projectEnvelope({ envelope: parsed.value, path, platform });
  if (projected.isErr()) {
    return { error: projected.error };
  }
  return { envelope: { entitiesFrom: after, envelope: projected.value } };
}

/**
 * Read up to `limit` entity rows off a kind file, stopping the read as soon as it has them.
 *
 * The stop is checked between CHUNKS rather than between lines, because that is the seam
 * `readJsonlLines` offers — a chunk is 8 MiB, so overshooting by part of one is the price of never holding
 * the file.
 *
 * @param path the kind file
 * @param platform the directory it sits in
 * @param kind the envelope's kind — never the file name, which is plural where the kind is singular
 * @param generationAt the envelope's `updatedAt`, stamped onto every entity this slice takes
 * @param limit how many entity rows to take, and how many lines to examine, whichever comes first
 * @param from the byte offset to resume at
 * @param linesBefore how many non-blank lines earlier slices of this file already read, so a refusal
 *   names the line an operator would find it on rather than restarting its count at every resume
 * @returns the projected rows, the refusals, and how far the read actually got
 */
export function readEntitySlice({
  path,
  platform,
  kind,
  generationAt,
  limit,
  from,
  linesBefore,
}: {
  path: string;
  platform: string;
  kind: string;
  generationAt: Date;
  limit: number;
  from: number;
  linesBefore: number;
}): AtlasEntitySlice {
  // Clamped against the real size because the reader delivers a trailing EMPTY line after a final
  // newline, whose zero-length range sits AT end-of-file. See `../ingestRead.ts` for the same clamp.
  const fileBytes = statSync(path).size;
  const taken: SliceAccumulator = {
    channels: [],
    entities: [],
    linesBefore,
    linesRead: 0,
    nulsStripped: 0,
    refusalCount: 0,
    refusals: [],
    resumeByteOffset: from,
  };
  // TWO ceilings, for the reason `../ingestRead.ts` measured: a file whose every line is unprojectable
  // would otherwise read to EOF in one slice and hold a refusal object per line.
  const done = (): boolean => taken.entities.length >= limit || taken.linesRead >= limit;
  readJsonlLines({
    onChunk: () => !done(),
    onLine: ({ line, byteOffset, byteLength }) => {
      if (done()) {
        return;
      }
      // Advanced for a blank line too: a resumed read that stopped short of one would deliver it again
      // forever, because a blank line never becomes a row and so never moves a cursor that counts rows.
      taken.resumeByteOffset = Math.min(byteOffset + byteLength + 1, fileBytes);
      takeEntityLine({ generationAt, kind, line, path, platform, taken });
    },
    path,
    startByteOffset: from,
  });
  return {
    channels: taken.channels,
    entities: taken.entities,
    linesRead: taken.linesRead,
    nulsStripped: taken.nulsStripped,
    refusalCount: taken.refusalCount,
    refusals: taken.refusals,
    resumeByteOffset: taken.resumeByteOffset,
  };
}

/** What one slice has taken so far, extended in place by {@link takeEntityLine}. */
interface SliceAccumulator {
  /** Non-blank lines the earlier slices of this file read, so a refusal names an absolute line. */
  readonly linesBefore: number;
  linesRead: number;
  nulsStripped: number;
  refusalCount: number;
  resumeByteOffset: number;
  readonly entities: NewAtlasEntityRow[];
  readonly channels: NewAtlasEntityChannelRow[];
  readonly refusals: AtlasImportError[];
}

/**
 * Parse one line as JSON, without letting its size through an unguarded `JSON.parse`.
 *
 * @param line the raw line
 * @param path the file, for a refusal
 * @param lineNumber the line, for a refusal
 * @returns the parsed value, or the refusal
 */
function parseLine({
  line,
  path,
  lineNumber,
}: {
  line: string;
  path: string;
  lineNumber: number;
}): { value: unknown } | { error: AtlasImportError } {
  try {
    return { value: safeJsonParse({ label: `${path} line ${String(lineNumber)}`, text: line }) };
  } catch {
    return { error: AtlasImportErrors.unreadableLine({ lineNumber, path }) };
  }
}

/**
 * Parse, project and account for ONE entity line, extending the slice in place.
 *
 * A refused line is COUNTED and skipped rather than fatal: a single unreadable row must not cost the other
 * tens of thousands in that file. A refused ENVELOPE is the opposite and is handled by {@link readKindEnvelope},
 * because nothing after line 1 can be attributed without it.
 *
 * @param line the raw line, already known to be inside both ceilings
 * @param platform the directory
 * @param kind the envelope's kind
 * @param generationAt the envelope's instant
 * @param path the file, for a refusal
 * @param taken the slice's accumulated rows, refusals and counts
 */
function takeEntityLine({
  line,
  platform,
  kind,
  generationAt,
  path,
  taken,
}: {
  line: string;
  platform: string;
  kind: string;
  generationAt: Date;
  path: string;
  taken: SliceAccumulator;
}): void {
  if (line.trim().length === 0) {
    return;
  }
  taken.linesRead += 1;
  // Absolute, and +1 for the envelope on line 1. MEASURED as a defect before it shipped: counting from
  // the slice alone named line 2 for the 5,001st entity of a file, so a refusal pointed an operator at a
  // line that was fine.
  const lineNumber = taken.linesBefore + taken.linesRead + 1;
  const parsed = parseLine({ line, lineNumber, path });
  if ("error" in parsed) {
    keepRefusal({ refusal: parsed.error, taken });
    return;
  }
  const projected = projectEntity({
    entity: parsed.value,
    generationAt,
    kind,
    lineNumber,
    path,
    platform,
    scanForNuls: mayHoldNul({ line }),
  });
  if (projected.isErr()) {
    keepRefusal({ refusal: projected.error, taken });
    return;
  }
  taken.nulsStripped += projected.value.nulsStripped;
  taken.entities.push(projected.value.entity);
  // Pushed one at a time rather than spread: a channel list's length comes from DATA (one entity can
  // carry a view per channel), and spreading copies the whole accumulator on every append.
  for (const row of projected.value.channels) {
    taken.channels.push(row);
  }
}

/**
 * Count one refusal exactly, and keep it as an example only while there is room.
 *
 * Applied where a refusal is PRODUCED rather than where a pass accumulates them, because the array inside
 * one slice is the one that grows with the data.
 *
 * @param refusal the refusal just produced
 * @param taken the slice, extended in place
 */
function keepRefusal({ refusal, taken }: { refusal: AtlasImportError; taken: SliceAccumulator }): void {
  taken.refusalCount += 1;
  if (taken.refusals.length < MAX_RETAINED_REFUSALS) {
    taken.refusals.push(refusal);
  }
}
