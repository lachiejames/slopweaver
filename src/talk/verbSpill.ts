/**
 * Where a `talk verb` answer too large for the voice's 20 KiB goes whole: one `0600` file under
 * `$home/talk/verb-spill/`, which the voice pages with `file_read` from `nextFrom`.
 *
 * Measured on a call: the owner asked the voice to read a pull request's
 * description and diff, `github read` printed more than the answer carries, the note said "ask for less", and
 * there was no less to ask for — the voice told the owner "the GitHub diff is the bit that came back cut off" and
 * could not give two grounded examples. `file_read` already pages any file on
 * this machine, masking credentials inside it (`./fileToolSchemas.ts`), so the rest of a cut answer is put
 * where that tool reaches rather than given a continuation protocol of its own.
 *
 * Pruned on every write, by count and by age, so the directory stays a handful of recent answers rather than an
 * archive of everything the voice ever read.
 */
import { chmodSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory, writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

/**
 * The most spills kept, the new one included; a call reads a few long answers, never dozens at once. Each is at
 * most the gateway's 1 MiB capture, so the directory stays under about 32 MiB.
 */
export const VERB_SPILL_KEEP = 32;

/** The oldest a spill may be before a later write removes it: a call, and a margin, never a second day. */
export const VERB_SPILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Where one answer's whole stdout went, and how big it is. */
export interface VerbSpill {
  readonly path: string;
  readonly bytes: number;
}

/** Why one answer could not be kept whole: each is said in the note in place of a spill. */
export type VerbSpillError =
  | { readonly code: "SPILL_ID_INVALID"; readonly message: string; readonly id: string }
  | { readonly code: "SPILL_DIR_NOT_PLAIN"; readonly message: string; readonly dir: string }
  | { readonly code: "SPILL_PRUNE_FAILED"; readonly message: string; readonly dir: string }
  | { readonly code: "SPILL_WRITE_FAILED"; readonly message: string; readonly path: string };

/** The one way each {@link VerbSpillError} is built. */
export const VerbSpillErrors = {
  dirNotPlain: ({ dir }: { dir: string }): VerbSpillError => ({
    code: "SPILL_DIR_NOT_PLAIN",
    dir,
    message: `the spill directory ${dir} is not a plain directory, so nothing is pruned or kept there`,
  }),
  idInvalid: ({ id }: { id: string }): VerbSpillError => ({
    code: "SPILL_ID_INVALID",
    id,
    message: `the spill id ${id} is not a lowercase v4 UUID, so a later prune could never remove it`,
  }),
  pruneFailed: ({ dir, why }: { dir: string; why: string }): VerbSpillError => ({
    code: "SPILL_PRUNE_FAILED",
    dir,
    message: `the spill directory ${dir} could not be pruned: ${why}`,
  }),
  writeFailed: ({ path, why }: { path: string; why: string }): VerbSpillError => ({
    code: "SPILL_WRITE_FAILED",
    message: `the whole answer could not be kept at ${path}: ${why}`,
    path,
  }),
} as const;

/**
 * A spill file's name: the spill id, a lowercase v4 UUID, then `.txt`. Exactly that shape, since the prune deletes
 * whatever matches it — a looser one took a stale file of 36 hyphens for a spill.
 */
const SPILL_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.txt$/u;

/**
 * `$home/talk/verb-spill` (`0700`), beside the call files under the state home's own `talk/` directory.
 *
 * @returns the directory
 */
export function verbSpillDir({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "verb-spill");
}

/**
 * Which spill files to remove before one more is written: anything older than {@link VERB_SPILL_MAX_AGE_MS}, and
 * the oldest of the rest until {@link VERB_SPILL_KEEP} minus one remain, leaving room for the new one. A name that
 * is not a spill's is never a candidate. Pure.
 *
 * @param files the directory's entries with their modification instants
 * @param nowMs the instant the age is judged at
 * @returns the names to remove
 */
export function spillsToPrune({
  files,
  nowMs,
}: {
  files: readonly { readonly name: string; readonly mtimeMs: number }[];
  nowMs: number;
}): readonly string[] {
  const spills = files.filter((file) => SPILL_FILE.test(file.name)).toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  return spills
    .filter((file, index) => index >= VERB_SPILL_KEEP - 1 || nowMs - file.mtimeMs > VERB_SPILL_MAX_AGE_MS)
    .map((file) => file.name);
}

/**
 * Prune the spill directory, then write one answer's whole stdout to a fresh `0600` file in it.
 *
 * A prune that fails writes nothing: an unbounded directory of the owner's verb output is worse than one answer the voice
 * is told to ask less of.
 *
 * @param home the state home
 * @param id the spill's id, a v4 UUID, so the name is the caller's and never derived from the output
 * @param text the whole captured stdout
 * @param nowMs the instant the prune judges age at
 * @returns where it went, or why it could not be written
 */
export function writeVerbSpill({
  home,
  id,
  text,
  nowMs,
}: {
  home: string;
  id: string;
  text: string;
  nowMs: number;
}): Result<VerbSpill, VerbSpillError> {
  const dir = verbSpillDir({ home });
  const name = `${id}.txt`;
  if (!SPILL_FILE.test(name)) {
    return err(VerbSpillErrors.idInvalid({ id }));
  }
  const path = join(dir, name);
  try {
    ensureDirectory({ directory: dir });
    // A symlink here would carry the prune and the write outside the state home.
    if (!lstatSync(dir).isDirectory()) {
      return err(VerbSpillErrors.dirNotPlain({ dir }));
    }
    chmodSync(dir, 0o700);
    const files = readdirSync(dir).map((entry) => ({ mtimeMs: statSync(join(dir, entry)).mtimeMs, name: entry }));
    for (const stale of spillsToPrune({ files, nowMs })) {
      rmSync(join(dir, stale), { force: true });
    }
  } catch (cause: unknown) {
    return err(VerbSpillErrors.pruneFailed({ dir, why: messageOf({ cause }) }));
  }
  try {
    writeFileAtomic({ contents: text, dirMode: 0o700, fileMode: 0o600, path });
    // The create mode passes through the umask, and one of 0077 or tighter would leave a file the note points
    // the voice at but nobody can read; the mode is set, not requested.
    chmodSync(path, 0o600);
  } catch (cause: unknown) {
    return err(VerbSpillErrors.writeFailed({ path, why: messageOf({ cause }) }));
  }
  return ok({ bytes: Buffer.byteLength(text, "utf8"), path });
}

/* A thrown value as text, never by `String()`, which can itself throw. */
function messageOf({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return `a thrown ${typeof cause} that is not an Error`;
}
