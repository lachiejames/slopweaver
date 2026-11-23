/**
 * The fan-out's files read back off disk — a shard file's digest, the persisted plan, each shard's records
 * and the readers' replies — for `store read` and `store collect`.
 *
 * Reads only: every write stays in `read.ts`, which imports this leaf and is never imported by it.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { type ReaderReply, readerReplySchema, type Shard, type ShardRecord } from "../../../retrieval/fanout.js";
import { shardPath } from "./readCore.js";

/**
 * How many bytes of a shard file are hashed at a time.
 *
 * The transient this helper holds, and the only thing that makes it safe on a file of any size.
 */
const DIGEST_CHUNK_BYTES = 64 * 1024;

/**
 * The SHA-256 of one shard file's raw BYTES, read in bounded chunks.
 *
 * ## Why bytes, and why not the decoded lines
 *
 * A Codex review pass broke the earlier version, which hashed the DECODED lines: `Buffer.toString("utf8")`
 * is lossy, so two different byte sequences can decode to the same string and hash identically. Its
 * counterexample was a replacement character written first as its own UTF-8 encoding and then as an
 * invalid byte — different files, one digest. The everyday version of the same hole is a line ending
 * changing, which that hash also could not see because it re-added the separator itself.
 *
 * ## Why not `readFileSync`
 *
 * A `.jsonl` read whole is the shape the `whole-file-json` gate refuses everywhere, and the criterion is
 * the file TYPE rather than a size somebody remembered — a helper that reads one whole is a helper the
 * next caller points at a bronze window. This reads a fixed buffer at a time, so its transient is the
 * buffer rather than the file, and it hashes what is actually on disk.
 *
 * @param shardFile the shard's path
 * @returns the hex digest of the file's bytes, or `null` when it cannot be read
 */
export function digestOf({ shardFile }: { shardFile: string }): string | null {
  let handle: number | undefined;
  try {
    handle = openSync(shardFile, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
    for (;;) {
      const read = readSync(handle, buffer, 0, buffer.length, null);
      if (read === 0) {
        break;
      }
      hash.update(buffer.subarray(0, read));
    }
    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    if (handle !== undefined) {
      closeSync(handle);
    }
  }
}

/* The plan as it is written to disk and read back, so `collect` checks against what `read` actually
   built rather than against whatever the caller says the shards contained. */

const shardRecordSchema = z.object({
  author: z.string().nullable(),
  clipped: z.boolean(),
  container: z.string(),
  id: z.string(),
  source: z.string(),
  text: z.string(),
  title: z.string().nullable(),
  tsIso: z.string(),
  url: z.string(),
});

const planSchema = z.object({
  candidates: z.number().int().min(0),
  question: z.string(),
  shards: z.array(
    z.object({
      // REQUIRED on a plan read from disk, unlike the in-memory `Shard`: `store read` refuses to write a
      // plan it could not hash, so a shard without one is a file that was tampered with rather than a
      // shape this program produces. Requiring it here is what removes the skip-the-check branch entirely.
      digest: z.string(),
      id: z.string(),
      // The COUNT only. The records themselves live in the shard file and nowhere else — see
      // `shardsFromDisk` for the counterexample that removing this duplicate closes.
      records: z.number().int().min(0),
      token: z.string().optional(),
    }),
  ),
});

/** One shard as the persisted plan describes it: where to look, what it should hash to, how many rows. */
interface PlannedShard {
  readonly id: string;
  readonly digest: string;
  readonly records: number;
  readonly token?: string;
}

/** A plan as it is read back: the question, and each shard's metadata. Records come from the FILES. */
interface PersistedPlan {
  readonly candidates: number;
  readonly question: string;
  readonly shards: readonly PlannedShard[];
}

/**
 * Read a plan back off disk, refusing a file that is not one.
 *
 * @param planFile where the plan was written
 * @returns the plan's metadata, or why it could not be read
 */
export function readPlan({ planFile }: { planFile: string }): { plan: PersistedPlan } | { errors: readonly string[] } {
  let text: string;
  try {
    text = readFileSync(planFile, "utf8");
  } catch (error: unknown) {
    return {
      errors: [`cannot read the plan at ${planFile}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const parsed = planSchema.safeParse(safeJsonParse({ label: "fan-out plan", text }));
  if (!parsed.success) {
    // `!` rather than a fallback: zod builds a failed parse's error from at least one issue, always.
    return { errors: [`${planFile} is not a fan-out plan: ${parsed.error.issues[0]!.message}`] };
  }
  return {
    plan: {
      candidates: parsed.data.candidates,
      question: parsed.data.question,
      shards: parsed.data.shards.map((shard) => ({
        digest: shard.digest,
        id: shard.id,
        records: shard.records,
        ...(shard.token !== undefined ? { token: shard.token } : {}),
      })),
    },
  };
}

/**
 * Rebuild the checkable plan by reading each shard FILE, and report what each one hashed to.
 *
 * ## Why the records come from the file and not from the plan
 *
 * A Codex review pass broke the property here, and the defect was two sources of truth rather than a
 * missing check. The digest authenticated the shard FILE while validation ran against records the plan
 * carried INLINE — so a plan naming a fabricated record, beside an untouched shard file whose digest
 * matched perfectly, kept a finding for evidence that existed nowhere. Nothing was tampered with in the
 * sense any check was looking for; the two halves simply described different slices.
 *
 * So the plan stops carrying records at all. Everything a finding is checked against is parsed from the
 * bytes that were hashed, which is what makes the digest mean something about the thing being validated.
 *
 * This is not tamper-proofing and is not claimed as any: someone who can write both files can write
 * anything, and a reader with filesystem access can read every shard regardless. What it guarantees is
 * that the plan and the shard cannot DISAGREE, because only one of them says what a shard holds.
 *
 * @param plan the plan's metadata
 * @param planPath where it was read from, whose directory holds the shards
 * @returns the shards with their records, and each shard's current digest — `null` where it could not be read
 */
export function shardsFromDisk({ plan, planPath }: { plan: PersistedPlan; planPath: string }): {
  shards: readonly Shard[];
  digests: ReadonlyMap<string, string | null>;
} {
  const dir = dirname(planPath);
  const digests = new Map<string, string | null>();
  const shards: Shard[] = [];
  for (const planned of plan.shards) {
    const file = shardPath({ dir, shard: { id: planned.id, records: [] } });
    // A file that cannot be hashed is recorded as `null` rather than omitted. Omitting it reads as "not
    // checked" to the collector, which is what let an unreadable shard pass every check and exit zero.
    digests.set(planned.id, digestOf({ shardFile: file }));
    shards.push({
      id: planned.id,
      records: recordsInShard({ file }),
      digest: planned.digest,
      ...(planned.token !== undefined ? { token: planned.token } : {}),
    });
  }
  return { digests, shards };
}

/**
 * Parse one shard file's records, streaming it a line at a time.
 *
 * A line that is not a shard record is SKIPPED rather than thrown on: the digest is what says whether the
 * file is the one the plan described, and a parse failure inside a file whose digest already matched would
 * be a bug in this program rather than something a caller can act on.
 *
 * @param file the shard file
 * @returns every record it holds, in file order, empty when it cannot be read
 */
function recordsInShard({ file }: { file: string }): readonly ShardRecord[] {
  const records: ShardRecord[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = shardRecordSchema.safeParse(safeJsonParse({ label: "shard record", text: line }));
        if (parsed.success) {
          records.push(parsed.data);
        }
      },
      path: file,
    });
  } catch {
    return [];
  }
  return records;
}

/**
 * Read the readers' replies, refusing anything that is not the shape they were asked for.
 *
 * A reply that does not parse is refused with its position, never skipped: a fan-out that silently
 * dropped a malformed reader would report fewer findings and give no reason at all.
 *
 * @param repliesFile the JSON array of replies
 * @returns the replies, or why they could not be read
 */
export function readReplies({
  repliesFile,
}: {
  repliesFile: string;
}): { replies: readonly ReaderReply[] } | { errors: readonly string[] } {
  let text: string;
  try {
    text = readFileSync(repliesFile, "utf8");
  } catch (error: unknown) {
    return {
      errors: [`cannot read the replies at ${repliesFile}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const value = safeJsonParse({ label: "fan-out replies", text });
  const asArray = Array.isArray(value) ? value : [value];
  const replies: ReaderReply[] = [];
  const errors: string[] = [];
  for (const [at, entry] of asArray.entries()) {
    const parsed = readerReplySchema.safeParse(entry);
    if (parsed.success) {
      replies.push(parsed.data);
      continue;
    }
    // `!` for the same reason as the plan's read: a failed zod parse carries at least one issue.
    errors.push(`reply ${String(at + 1)} is not a reader reply: ${parsed.error.issues[0]!.message}`);
  }
  return errors.length > 0 ? { errors } : { replies };
}
