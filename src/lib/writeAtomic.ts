/**
 * The repo's ONE atomic, crash-durable file replace. Every store that used to hand-roll
 * `writeFileSync(tmp); renameSync(tmp, path)` routes through here.
 *
 * **Atomicity is not durability, and the difference is the whole point of this module.** `renameSync` is
 * atomic for VISIBILITY — no reader ever observes a half-written file, because a same-directory rename is a
 * single directory-entry swap. It says nothing about what survives a crash: `writeFileSync` alone only
 * reaches the OS page cache, so the rename metadata can hit the device while the dirty data does not,
 * leaving a final path whose contents are truncated or empty. A watermark lost that way silently re-ingests
 * or silently skips; a turn marker lost that way answers the same Slack tag twice.
 *
 * That lesson was learned once, in `src/codex/artifactStore.ts` (a review pass caught a comment promising
 * crash-safety the code did not deliver), and then not propagated: measured, twenty of the
 * repo's twenty-five temp-then-rename writers never called `fsyncSync` at all, and two of the five that did
 * flushed the file but not its DIRECTORY — which leaves the rename itself losable. This module is what
 * those sites now call, so the durability argument is made in one place and cannot drift out of a
 * twenty-first copy.
 *
 * **It throws rather than returning a `Result`, deliberately.** It is a boundary primitive of exactly the
 * same class as the `writeFileSync`/`renameSync` pair it replaces, and every call site already owns an error
 * seam — a domain `try`/`catch` mapping to its own typed union, or a `safeFs` wrapper from `safeBoundary.ts`.
 * Returning a `Result` here would put a second, redundant seam inside the first at every one of them.
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  futimesSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The tail every staged write's name ends in: `.<writer pid>.<uuid>.tmp`, exactly as {@link atomicTempPath}
 * mints it. Exported so a reader that must recognise an in-flight write — the backup's files leg, the
 * compactor's sweep — matches the writer's own shape rather than a copy of it.
 */
export const ATOMIC_WRITE_TEMP_TAIL = /\.(\d+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/**
 * The sibling temp path a staged write of `path` occupies until it is renamed into place. Its writer's pid
 * is in the name so a later process can tell a write in flight from one whose writer died.
 *
 * @param path the file being replaced
 * @returns `<path>.<pid>.<uuid>.tmp`
 */
function atomicTempPath({ path }: { path: string }): string {
  return `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
}

/**
 * The pid of the process that staged `name`, when `name` is a staged write of the file called `target` —
 * `<target>.<pid>.<uuid>.tmp` and nothing else. A staged write of a different file, a name merely ending in
 * `.tmp`, and the target itself all answer `undefined`. Pure.
 *
 * @param name a directory entry's basename
 * @param target the basename of the file whose staged writes are wanted
 * @returns the writer's pid, or `undefined` when `name` is not one of `target`'s staged writes
 */
export function atomicTempWriterPid({ name, target }: { name: string; target: string }): number | undefined {
  if (!name.startsWith(`${target}.`)) {
    return undefined;
  }
  const tail = ATOMIC_WRITE_TEMP_TAIL.exec(name);
  if (tail === null || tail.index !== target.length) {
    return undefined;
  }
  return Number(tail[1]);
}

/**
 * Flush a directory entry so a new or renamed NAME survives a crash.
 *
 * Best-effort by design: directory fsync is not permitted on every platform (Windows in particular), and
 * failing a write because the OS declined to flush a directory would trade a durability nicety for an
 * outright lost result. The file's own bytes are already on the device by the time this is called.
 */
function fsyncDirectory({ directory }: { directory: string }): void {
  let handle: number | undefined;
  try {
    handle = openSync(directory, "r");
    fsyncSync(handle);
  } catch {
    // Not supported here; the file's contents are already durable.
  } finally {
    if (handle !== undefined) {
      closeSync(handle);
    }
  }
}

/**
 * Write a whole string to an open descriptor, looping until every byte is accepted (a short write is legal).
 * A write that makes no progress throws rather than spinning (see {@link writeAllBytes}).
 *
 * @param handle an open descriptor, written from its current position
 */
export function writeAll({ handle, text }: { handle: number; text: string }): void {
  writeAllBytes({ bytes: Buffer.from(text, "utf8"), handle });
}

/**
 * Write every byte of a buffer, looping because one `writeSync` may be short. The binary sibling of `writeAll`.
 * A `writeSync` that accepts nothing without throwing would spin this loop forever, so it throws instead, and the
 * caller's cleanup removes the staging file (the owner-written mark had lost that guard on moving here).
 */
function writeAllBytes({ handle, bytes }: { handle: number; bytes: Buffer }): void {
  let written = 0;
  while (written < bytes.length) {
    const step = writeSync(handle, bytes, written, bytes.length - written);
    if (step <= 0) {
      throw new Error(`a write stopped at ${String(written)} of ${String(bytes.length)} bytes, accepting none`);
    }
    written += step;
  }
}

/**
 * Stage a file's bytes through a WRITE SINK, then replace the target atomically and durably: open a
 * uniquely-named sibling temp file, hand the producer a `write` it may call any number of times, fsync the
 * temp, rename it over the target, then fsync the directory.
 *
 * This is the shape a file whose bytes are PRODUCED rather than held needs. {@link writeFileAtomic}'s
 * iterable of chunks already covers a file too large for one V8 string, but only when the chunks can be
 * pulled from a generator — and the repo's one sanctioned JSONL reader ({@link ../corpus/corpusStore}'s
 * `readJsonlLines`) delivers its lines to a CALLBACK, which cannot `yield`. Bronze compaction reads with
 * that reader and writes with this sink, so a 5.9 GiB window is rewritten without either side ever holding
 * a whole file.
 *
 * Throws whatever `produce` throws, having removed the temp file — so a producer that aborts part-way
 * (compaction refusing a corrupt line) leaves the target exactly as it was.
 *
 * The sink offers `write` for text and `writeBytes` for raw bytes, and a producer may call both against
 * one file. `writeBytes` is what a BINARY artefact needs: the dense vector block is a flat run of
 * little-endian float32, and encoding it as text to reach a text-only sink would reintroduce the whole-file
 * string this sink exists to avoid.
 *
 * @param produce called once with the sink; every `write`/`writeBytes` appends to the staged temp file, in order
 * @param dirMode the mode for directories this creates (default: the process umask's)
 * @param fileMode the mode for the file it writes (default: the process umask's)
 * @param exactMode set `fileMode` on the staged temp itself before the rename, so the umask cannot strip a bit a
 *   caller is preserving from the file it replaces
 * @param flushDirectory `false` only when `path` is itself a STAGING sibling that a later
 *   {@link renameStagedFile} installs into the same directory and {@link fsyncDirectories} then flushes — the
 *   same deferral {@link renameStagedFile} offers a set installer, for the same measured reason. Omitted, the
 *   directory is flushed here, so every other caller keeps the whole guarantee without saying anything.
 * @param path the file to replace
 * @param stagedMtime set on the staged temp before the rename, which keeps a file's mtime, so the file is never
 *   visible at the final path carrying the mtime its staging happened to get
 */
export function writeFileAtomicStream({
  produce,
  dirMode,
  fileMode,
  exactMode,
  flushDirectory,
  path,
  stagedMtime,
}: {
  produce: (args: { write: (args: { text: string }) => void; writeBytes: (args: { bytes: Buffer }) => void }) => void;
  dirMode?: number | undefined;
  fileMode?: number | undefined;
  exactMode?: boolean | undefined;
  flushDirectory?: boolean | undefined;
  path: string;
  stagedMtime?: Date | undefined;
}): void {
  const directory = dirname(path);
  const temporary = atomicTempPath({ path });
  mkdirSync(directory, dirMode === undefined ? { recursive: true } : { mode: dirMode, recursive: true });
  try {
    const handle = fileMode === undefined ? openSync(temporary, "wx") : openSync(temporary, "wx", fileMode);
    try {
      if (exactMode === true && fileMode !== undefined) {
        fchmodSync(handle, fileMode);
      }
      produce({
        write: ({ text }) => {
          writeAll({ handle, text });
        },
        writeBytes: ({ bytes }) => {
          writeAllBytes({ bytes, handle });
        },
      });
      if (stagedMtime !== undefined) {
        futimesSync(handle, stagedMtime, stagedMtime);
      }
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, path);
  } catch (error: unknown) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may never have been created, or the rename may already have consumed it. Either way
      // its absence is not a second failure worth reporting over the first.
    }
    throw error;
  }
  if (flushDirectory !== false) {
    fsyncDirectory({ directory });
  }
}

/**
 * Move an already-staged file onto its final path, and flush the directory entry unless the caller is
 * installing a SET and will flush once at the end.
 *
 * The other half of a staged write, for a caller that could not use {@link writeFileAtomic}'s single call
 * because the staging and the install are separated in TIME — `atlas/kit/generationSwap.ts` stages a whole
 * generation before installing any of it, precisely so a failure part-way leaves the published one
 * untouched. Without a directory fsync the rename is losable exactly as this module's header describes,
 * which is the durability half {@link writeFileAtomic} would otherwise have provided.
 *
 * The staged file's own bytes are NOT fsynced here: whatever produced it already did that, and re-opening
 * a file to flush bytes this function never wrote would hide a caller that skipped the step.
 *
 * `flushDirectory` has no default ON PURPOSE, so every call site says which it is. MEASURED:
 * flushing per rename cost one `slopweaver atlas datadog sync` publish 540 ms of its 1.83 s (reproduce by
 * timing `syncDatadogCatalogue` against a `mkdtempSync` home with and without the flush), because that
 * atlas installs a whole generation of kinds into one directory and every rename re-flushed it. One flush
 * per DISTINCT directory after the last rename is the same guarantee, so a set installer passes `false`
 * here and calls {@link fsyncDirectories} once — and a single-file caller passes `true` and is done.
 *
 * Throws whatever the rename throws, having moved nothing.
 *
 * @param from the staged file, already written and fsynced
 * @param to the final path it takes over
 * @param flushDirectory `false` only when the caller flushes the directory itself after its last rename
 */
export function renameStagedFile({
  from,
  to,
  flushDirectory,
}: {
  from: string;
  to: string;
  flushDirectory: boolean;
}): void {
  renameSync(from, to);
  if (flushDirectory) {
    fsyncDirectory({ directory: dirname(to) });
  }
}

/**
 * Flush every distinct directory a set of renames touched, so those entries survive a crash — the deferred
 * half of {@link renameStagedFile}`({ flushDirectory: false })`.
 *
 * Best-effort per directory, for the same reason {@link renameStagedFile} is: see the note on the private
 * flush this delegates to.
 *
 * @param paths the paths that were renamed INTO place; each one's directory is flushed exactly once
 */
export function fsyncDirectories({ paths }: { paths: readonly string[] }): void {
  for (const directory of new Set(paths.map((path) => dirname(path)))) {
    fsyncDirectory({ directory });
  }
}

/**
 * Replace one file atomically AND durably: write a uniquely-named sibling temp file, fsync it, rename it
 * over the target, then fsync the directory.
 *
 * The temp name carries a random uuid for two reasons. It is unguessable, so a same-user process cannot
 * hard-link the in-progress inode to the final path and expose a partial file there; and it is unique, so
 * two concurrent writers to the same path stage into different files instead of interleaving into one
 * shared `<path>.tmp`. The descriptor is opened `wx` (fail if it exists), which turns the impossible
 * collision into an error rather than a silent overwrite.
 *
 * `contents` may be an iterable of chunks instead of one string, for a file too large to hold in a single
 * V8 string — the chunks are written in order and the result is their concatenation. A plain string is
 * NOT treated as an iterable of characters. When the chunks cannot be PULLED (a callback-driven producer),
 * use {@link writeFileAtomicStream} instead — this is a thin wrapper over it.
 *
 * Throws on any failure, having removed the temp file. See this module's header for why it throws.
 *
 * @param contents the bytes to write — one string, or chunks written in order
 * @param dirMode the mode for directories this creates (default: the process umask's)
 * @param fileMode the mode for the file it writes (default: the process umask's)
 * @param exactMode set `fileMode` exactly, whatever the umask, as {@link writeFileAtomicStream} takes it
 * @param path the file to replace
 * @param stagedMtime the mtime the file arrives at its final path with, as {@link writeFileAtomicStream} takes it
 */
export function writeFileAtomic({
  contents,
  dirMode,
  fileMode,
  exactMode,
  path,
  stagedMtime,
}: {
  contents: string | Iterable<string>;
  dirMode?: number | undefined;
  fileMode?: number | undefined;
  exactMode?: boolean | undefined;
  path: string;
  stagedMtime?: Date | undefined;
}): void {
  writeFileAtomicStream({
    dirMode,
    exactMode,
    fileMode,
    path,
    stagedMtime,
    produce: ({ write }) => {
      for (const chunk of typeof contents === "string" ? [contents] : contents) {
        write({ text: chunk });
      }
    },
  });
}

/**
 * Replace one BINARY file atomically and durably — the same temp-fsync-rename-fsync discipline as
 * {@link writeFileAtomic}, over bytes rather than text.
 *
 * A separate function rather than a widened `contents` type, because the two cannot share one: this repo's
 * text writer encodes every chunk as UTF-8, and pushing a PNG through it would replace every byte outside
 * the ASCII range with U+FFFD — a file that still has a plausible size and is not an image. That is exactly
 * the silent corruption an atomic write exists to prevent, so the binary case gets its own door.
 *
 * Throws on any failure, having removed the temp file. See this module's header for why it throws.
 *
 * @param bytes the file's exact contents, written verbatim with no encoding step
 * @param dirMode the mode for directories this creates (default: the process umask's)
 * @param fileMode the mode for the file it writes (default: the process umask's)
 * @param path the file to replace
 */
export function writeFileAtomicBytes({
  bytes,
  dirMode,
  fileMode,
  path,
}: {
  bytes: Buffer;
  dirMode?: number | undefined;
  fileMode?: number | undefined;
  path: string;
}): void {
  const directory = dirname(path);
  const temporary = atomicTempPath({ path });
  mkdirSync(directory, dirMode === undefined ? { recursive: true } : { mode: dirMode, recursive: true });
  try {
    const handle = fileMode === undefined ? openSync(temporary, "wx") : openSync(temporary, "wx", fileMode);
    try {
      writeAllBytes({ bytes, handle });
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, path);
  } catch (error: unknown) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may never have been created, or the rename may already have consumed it. Either way
      // its absence is not a second failure worth reporting over the first.
    }
    throw error;
  }
  fsyncDirectory({ directory });
}

/**
 * Make a directory and every missing ancestor, so a caller can tell a DIRECTORY failure from a file one.
 *
 * It exists as its own export rather than folded into {@link createFileExclusive} because `mkdirSync` and an
 * exclusive create both raise `EEXIST`, for entirely different reasons: the directory call does it when an
 * ancestor of the path is a regular FILE, the create when the target is already there. A caller that wrapped
 * both in one `try` read the first as the second and told an operator a file existed that did not (measured
 * by a review pass on a baseline-seeding verb since retired). Two calls, two answers.
 *
 * Every directory it MAKES is flushed into its parent, so the name of a new directory is on the device before
 * {@link createFileExclusive} builds on it. Flushing only the file's own directory left a fresh ledger directory's
 * entry in `ledgers/` volatile: after a crash the reservation inside it could vanish with it, and an identical
 * retry would read the slot as free (seen on `linear document create`). A directory already there costs
 * nothing.
 *
 * @param directory the deepest directory wanted; every missing ancestor is made too
 * @param mode the permission bits for each directory it makes, such as owner-only 0o700 (default: the umask's)
 */
export function ensureDirectory({ directory, mode }: { directory: string; mode?: number | undefined }): void {
  const firstCreated = mkdirSync(directory, mode === undefined ? { recursive: true } : { mode, recursive: true });
  if (firstCreated === undefined) {
    return;
  }
  const outermost = resolve(firstCreated);
  let current = resolve(directory);
  while (dirname(current) !== current) {
    fsyncDirectory({ directory: dirname(current) });
    if (current === outermost) {
      return;
    }
    current = dirname(current);
  }
}

/**
 * Create a file that is NOT there, failing with `EEXIST` when it is — the create-only sibling of
 * {@link writeFileAtomic}.
 *
 * Temp-then-rename is the wrong primitive whenever the caller's whole point is that an existing file must
 * survive: `renameSync` replaces unconditionally, so guarding it with an earlier `existsSync` leaves a
 * window in which another writer's file lands and is then silently overwritten. `O_EXCL` has no window —
 * the kernel decides, and the loser is told. Use this when losing a race must be an ERROR rather than a
 * last-write-wins.
 *
 * Both flushes are this module's standing argument applied to a create: the file's `fsync` puts the BYTES on
 * the device, and {@link fsyncDirectory} puts the NAME there. A create that skipped the second would return
 * successfully and be gone after a crash, which is the same defect the header describes for a rename.
 *
 * The caller makes the directory first, with {@link ensureDirectory} — see its note for why that is not
 * merely an ordering detail. It throws rather than returning a `Result`, exactly as its siblings do.
 *
 * @param path the file to create; its parent must already exist
 * @param contents the whole body, written in full before the flush
 * @param mode the permission bits the file is created with, such as owner-only 0o600 (default: the umask's)
 */
export function createFileExclusive({
  path,
  contents,
  mode,
}: {
  path: string;
  contents: string;
  mode?: number | undefined;
}): void {
  const handle = mode === undefined ? openSync(path, "wx") : openSync(path, "wx", mode);
  try {
    writeAll({ handle, text: contents });
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  fsyncDirectory({ directory: dirname(path) });
}

/**
 * Remove one file or directory tree, a name already gone included, then flush its parent so the removal survives a
 * crash: the other end of {@link createFileExclusive}, for a lock released, a record spent or a half-built tree
 * cleared. A lock file whose removal a crash undid would read as held by a pid that no longer runs.
 *
 * Throws whatever the removal throws, exactly as its siblings do.
 *
 * @param path the file or directory to remove; a directory goes with everything inside it
 */
export function removeEntry({ path }: { path: string }): void {
  rmSync(path, { force: true, recursive: true });
  fsyncDirectory({ directory: dirname(path) });
}

/**
 * Flush a file already written, then its directory, so a write a retry found on disk is on the device before
 * something durable is built on it. A write whose own fsync failed is visible and may still be lost; a retry that
 * reads it back as done calls this rather than trusting it (`handover settle`).
 *
 * @param path the file to flush; it must exist
 */
export function fsyncFile({ path }: { path: string }): void {
  const handle = openSync(path, "r");
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  fsyncDirectory({ directory: dirname(path) });
}
