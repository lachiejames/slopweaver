/**
 * The PURE half of the chunk store: what a chunked file's manifest entry says, and where each chunk lives.
 *
 * A file at or over {@link CHUNKED_FILE_MIN_BYTES} is not one blob named for its whole digest. It is a list of
 * chunks cut by content (`./chunkBoundaries.ts`), each named for the SHA-256 of its RAW bytes and stored
 * ENCODED, so the night a `compact.jsonl` grows at its tail only the chunks past the old tail are new. The
 * manifest keeps the whole file's length and digest beside the list, so a rebuilt file is checked whole as
 * well as piece by piece.
 *
 * A file under the threshold stays one raw blob (`./plan.ts`'s `blobObjectName`) — the format every backup
 * before this one used, so every blob the destination already holds keeps counting as held.
 */
import { z } from "zod";

import { CHUNKING } from "./chunkBoundaries.js";

/**
 * The size at which a file is cut into chunks rather than sent as one blob — 64 MiB.
 *
 * MEASURED on this install, a nightly staging's `files.json`: 14 of its 12,640 real files are
 * over it and they hold 22.3 of its 26.4 GB, the bronze `compact.jsonl` files (0.08–17.4 GB) among them —
 * so a few files are nearly every byte, and those are the ones that change nightly. Counted with
 * `node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(m.files.filter(f=>f.bytes>=64*2**20&&!f.relativePath.endsWith(".tmp")).length)' <staging>/files.json`.
 */
export const CHUNKED_FILE_MIN_BYTES = 64 * 1024 * 1024;

/**
 * How a chunk's bytes are stored. `zstd` for a file's chunks — a bronze chunk compresses many times over —
 * and `identity` for the dump's, which `pg_dump -Fc` has already compressed.
 */
export type ChunkEncoding = (typeof CHUNK_ENCODINGS)[number];

/** Every encoding a chunk may be stored in, each under its own prefix. */
export const CHUNK_ENCODINGS = ["identity", "zstd"] as const;

/** One chunk: the digest and length of its RAW bytes, in file order. */
export interface ChunkRef {
  readonly sha256: string;
  readonly bytes: number;
}

/** A chunked file's content — the rule that cut it, how its chunks are stored, and the chunks in order. */
export interface ChunkedContent {
  readonly chunking: typeof CHUNKING;
  readonly encoding: ChunkEncoding;
  readonly chunks: readonly ChunkRef[];
}

/** What sending one or more chunked files' chunks did. */
export interface ChunkTally {
  /** Distinct chunks the content names. */
  readonly chunks: number;
  /** Of those, how many the destination already held. */
  readonly held: number;
  /** Of those, how many were sent. */
  readonly sent: number;
  /** The RAW bytes the sent chunks carry. */
  readonly sentRawBytes: number;
  /** The ENCODED bytes that actually crossed the wire. */
  readonly sentStoredBytes: number;
}

/** The tally of a leg that had nothing chunked to send. */
export const NO_CHUNKS: ChunkTally = { chunks: 0, held: 0, sent: 0, sentRawBytes: 0, sentStoredBytes: 0 };

/**
 * Whether every digest in a list is recorded at ONE length. Bytes that hash alike are the same bytes, so a
 * digest named at two lengths is a manifest no real cut or walk wrote — and one whose held test would pass
 * the first length while the second is missing. Pure.
 *
 * @param refs each digest beside the length recorded for it
 * @returns true when no digest carries two lengths
 */
export function lengthsAgree({ refs }: { refs: readonly { sha256: string; bytes: number }[] }): boolean {
  const lengths = new Map<string, number>();
  for (const ref of refs) {
    const seen = lengths.get(ref.sha256);
    if (seen !== undefined && seen !== ref.bytes) {
      return false;
    }
    lengths.set(ref.sha256, ref.bytes);
  }
  return true;
}

/** The manifest schema of {@link ChunkedContent}, shared by the files and the dump manifests. */
export const chunkedContentSchema = z
  .object({
    chunking: z.literal(CHUNKING),
    chunks: z
      .array(z.object({ bytes: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict())
      .refine((chunks) => lengthsAgree({ refs: chunks }), "a chunk digest is recorded at two lengths"),
    encoding: z.enum(CHUNK_ENCODINGS),
  })
  .strict();

/**
 * The prefix every chunk of one encoding lives under — what the skip test lists ONCE per run.
 *
 * The encoding is part of the name because it is part of what the object IS: the same raw chunk stored two
 * ways is two objects, and a reader must never decode one as the other.
 *
 * @param project the Supabase project id, the same top-level segment every other object uses
 * @param encoding how the chunks under it are stored
 * @returns the prefix, ending in a slash
 */
export function chunkPrefix({ project, encoding }: { project: string; encoding: ChunkEncoding }): string {
  return `${project}/chunks/${encoding}/`;
}

/**
 * Where one chunk lives: under its encoding, named for the digest of its RAW bytes.
 *
 * @param project the Supabase project id
 * @param encoding how it is stored
 * @param sha256 the digest of its raw bytes
 * @returns the object name
 */
export function chunkObjectName({
  project,
  encoding,
  sha256,
}: {
  project: string;
  encoding: ChunkEncoding;
  sha256: string;
}): string {
  return `${chunkPrefix({ encoding, project })}${sha256}`;
}

/** One chunk the destination lacks, where it sits in its file. */
export interface MissingChunk {
  readonly sha256: string;
  readonly bytes: number;
  readonly offset: number;
}

/**
 * The chunks of one content the destination does not already hold, each distinct digest once, with its offset. Pure.
 *
 * A chunk counts as held when an object stands at its name with a plausible length: exactly the raw length
 * for `identity`, and any non-zero length for `zstd`, whose stored length is only known once it is encoded.
 * The name alone is safe to trust here in a way it was not for a blob, because nothing sends a chunk except
 * `sendChunks` (`./chunkUpload.ts`), which hashes the frozen bytes before it names them and takes back out anything that did
 * not land as sent.
 *
 * @param content the chunked file's content
 * @param project the Supabase project id
 * @param stored each listed object's name mapped to its stored length
 * @returns the chunks to send, first occurrence of each digest, in file order
 */
export function missingChunks({
  content,
  project,
  stored,
}: {
  content: ChunkedContent;
  project: string;
  stored: ReadonlyMap<string, number>;
}): readonly MissingChunk[] {
  const missing: MissingChunk[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const chunk of content.chunks) {
    const length = stored.get(chunkObjectName({ encoding: content.encoding, project, sha256: chunk.sha256 }));
    const held = length !== undefined && (content.encoding === "zstd" ? length > 0 : length === chunk.bytes);
    if (!held && !seen.has(chunk.sha256)) {
      missing.push({ bytes: chunk.bytes, offset, sha256: chunk.sha256 });
    }
    seen.add(chunk.sha256);
    offset += chunk.bytes;
  }
  return missing;
}

/**
 * How many distinct chunks a content names. Pure.
 *
 * @param content the chunked file's content
 * @returns the count of distinct digests
 */
export function distinctChunks({ content }: { content: ChunkedContent }): number {
  return new Set(content.chunks.map((chunk) => chunk.sha256)).size;
}

/**
 * Two tallies as one. Pure.
 *
 * @param left one tally
 * @param right the other
 * @returns their field-by-field sum
 */
export function addTallies({ left, right }: { left: ChunkTally; right: ChunkTally }): ChunkTally {
  return {
    chunks: left.chunks + right.chunks,
    held: left.held + right.held,
    sent: left.sent + right.sent,
    sentRawBytes: left.sentRawBytes + right.sentRawBytes,
    sentStoredBytes: left.sentStoredBytes + right.sentStoredBytes,
  };
}
