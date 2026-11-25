/**
 * The one append every line-oriented file in this repo goes through — a JSONL journal, a ledger, a line log, an id
 * index — so a record always starts on a line of its own, whatever the last writer left behind.
 *
 * A process killed partway through an append leaves the file without its trailing newline. The NEXT append, written
 * straight onto that torn tail, fuses with it: one unparseable line where there had been a fragment and a good record.
 * MEASURED: seeding `ledgers/loop-breakage.jsonl` with an
 * unterminated fragment made `recordLoopBreakage` fuse the next death onto it, its dedup could not see the fused
 * record, and the same death was written twice. Repro: the torn-tail case in
 * `src/__tests__/unit/live/turn/loopBreakage.test.ts`.
 *
 * Before this module was the one destination, the `torn-tail-append` criterion matched 88 appends outside it
 * (72 `appendFileSync` calls, 15 opens for append, one `{ flag: "a" }` write; repro: run
 * `scanTornTailAppend` over every in-scope file of `git archive <commit> src eval hooks`). Thirteen kept a private
 * guard and one was a durable-append helper; the other 74 guarded nothing, and with that helper's four unguarded
 * callers the unguarded call sites came to 78. The `torn-tail-append` gate in `yarn lint` (`src/devLint/tornTailAppend.ts`) now
 * refuses a filesystem append anywhere but here.
 *
 * **What it does not do**: make a probe-then-append transactional. Two writers that both find the same torn tail each
 * write a separator, leaving one blank line between their records, and a writer whose own append is in flight can
 * change the tail after another has probed it. The defect closed is the sequential one — a writer dies, a later append
 * arrives — which is the one every measurement above was. Nor can it judge a tail this process may append to but not
 * read (a mode-0200 file, which no store here creates): that tail is answered as torn, so at worst one empty line
 * lands before the record, where answering it whole would risk fusing the record onto a fragment (this holds for both the held-descriptor and the path-based case). Where neither its bytes nor its size can be
 * read — a sandbox denying the data and the metadata both — an EMPTY file cannot be told from a torn one, and gets
 * that same empty line.
 *
 * **What it follows**: by default a symlink at the appended path, into whatever file it reaches. A caller whose file
 * must never be reached through a link at its own name passes `noFollow`, and a link there is refused instead.
 */
import { appendFileSync, closeSync, constants, fstatSync, fsyncSync, openSync, readSync, statSync } from "node:fs";

import { isRecord } from "./parsers.js";
import { fsyncDirectories, writeAll } from "./writeAtomic.js";

/** The line feed byte every line here ends with. */
const NEWLINE = 0x0a;

/** Whether a thrown filesystem error says the path is not there, the one failure that means "nothing to separate". */
function isAbsent({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

/** Whether the byte at `size - 1` of an open, readable descriptor is something other than a line feed. */
function lastByteUnterminated({ fd, size }: { fd: number; size: number }): boolean {
  const tail = Buffer.alloc(1);
  readSync(fd, tail, 0, 1, size - 1);
  return tail[0] !== NEWLINE;
}

/**
 * Whether a thrown filesystem error says this process may not read the file, though it may still append to it — a
 * mode that denies reading (`EACCES`) or a macOS sandbox that denies file-read-data (`EPERM`).
 */
function isUnreadable({ error }: { error: unknown }): boolean {
  return isRecord(error) && (error["code"] === "EACCES" || error["code"] === "EPERM");
}

/**
 * The platform's `O_NOFOLLOW`, or a throw where it has none (Node leaves it undefined on Windows): OR-ing an absent
 * flag into an open would quietly follow the very link a `noFollow` caller asked to refuse.
 */
function noFollowFlag(): number {
  const flag: unknown = constants.O_NOFOLLOW;
  if (typeof flag !== "number" || flag === 0) {
    throw new Error("this platform has no O_NOFOLLOW, so a noFollow open cannot refuse a symlink");
  }
  return flag;
}

/**
 * Open `path` to read its tail — non-blocking, so a FIFO cannot hang the probe — or `undefined` when this process may
 * write it but not read it. A missing path throws, for the caller to answer.
 */
function openTail({ path }: { path: string }): number | undefined {
  try {
    return openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error: unknown) {
    if (isUnreadable({ error })) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The answer for a file this process may not open to read: no tail when its path stats as absent, empty or not a
 * regular file, otherwise `unreadable` — including when an ACL or sandbox denies even that stat.
 */
function unopenableTail({ path, unreadable }: { path: string; unreadable: boolean }): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && stats.size > 0 ? unreadable : false;
  } catch (error: unknown) {
    if (isAbsent({ error })) {
      return false;
    }
    if (isUnreadable({ error })) {
      return unreadable;
    }
    throw error;
  }
}

/**
 * Whether the file at `path` ends mid-line, read strictly: an absent file, an empty one and anything that is not a
 * regular file have no tail to separate from; a file this process may append to but not read answers `unreadable`
 * (torn for an append, see {@link descriptorNeedsSeparator}; whole for the lenient probe, whose callers refuse on a torn
 * answer, as they did before this module answered unreadable tails at all); any OTHER failure to open or read it
 * throws, because appending blind onto a tail nobody could read is exactly how a record fuses. Size and type come
 * from the open descriptor, so a path whose metadata alone is denied is still read.
 */
function tailIsTorn({ path, unreadable }: { path: string; unreadable: boolean }): boolean {
  let fd: number | undefined;
  try {
    fd = openTail({ path });
  } catch (error: unknown) {
    // A socket refuses the open (ENXIO); like any path that is not a regular file, it has no tail.
    if (isAbsent({ error }) || !statSync(path).isFile()) {
      return false;
    }
    throw error;
  }
  if (fd === undefined) {
    return unopenableTail({ path, unreadable });
  }
  try {
    const stats = fstatSync(fd);
    return stats.isFile() && stats.size > 0 && lastByteUnterminated({ fd, size: stats.size });
  } finally {
    closeSync(fd);
  }
}

/**
 * Whether the next append onto `path` needs a leading newline first — the lenient probe, for a caller that only
 * DECIDES something from the tail (whether to trim a torn row, whether to refuse) and owns its own error policy. To
 * append, call {@link appendLines}, which probes strictly.
 *
 * @param path the file that is about to be appended to
 * @returns true when the file exists, is non-empty, and its last byte is not `\n`; false when it cannot be read
 */
export function needsSeparator({ path }: { path: string }): boolean {
  try {
    return tailIsTorn({ path, unreadable: false });
  } catch {
    // A tail this probe cannot read is reported by whatever the caller does with the file next.
    return false;
  }
}

/**
 * Whether a held append descriptor's file ends mid-line — for the few appenders that must hold one write-only
 * descriptor across a check and the write (a symlink-refusing open pinned with `fchmod`, a FIFO-refusing non-blocking
 * one). The tail is read through a SECOND, read-only descriptor on `path`, so the held one keeps the write-only open
 * it always had and needs no read permission (a read-write open refused a mode-0200 journal the
 * write-only open had opened and repaired). That second open never blocks and, by default, follows a symlink exactly
 * as the held open did (refusing one dropped a launch log reached through a link); with `noFollow` it refuses a
 * symlink at the name instead (`ELOOP`), for a held open that refused one too ({@link appendLines}' `noFollow`). Either
 * way it must reach the very file the
 * held descriptor is on, by device and inode: a path swapped between the two opens throws rather than judging the
 * wrong tail, as does a process with no descriptor left for that second open (`EMFILE`). A tail this process may not READ is one it cannot judge, so it is answered as torn: at worst one empty line
 * lands before the record, where a wrong "whole" would fuse the record onto a fragment. Of today's two outside callers only
 * the launch log can reach that case — the standing-ask journal is `fchmod`ed to 0600 by its owner before it probes.
 *
 * @param fd the held append descriptor on the file about to be appended to
 * @param path the name `fd` was opened by, which the tail is read back through
 * @param noFollow refuse a symlink at `path` for the read-back open instead of following it
 * @returns true when it is a non-empty regular file whose last byte is not `\n` or cannot be read
 */
export function descriptorNeedsSeparator({
  fd,
  path,
  noFollow = false,
}: {
  fd: number;
  path: string;
  noFollow?: boolean;
}): boolean {
  const held = fstatSync(fd);
  if (!held.isFile() || held.size === 0) {
    return false;
  }
  let reader: number;
  try {
    reader = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (noFollow ? noFollowFlag() : 0));
  } catch (error: unknown) {
    if (isUnreadable({ error })) {
      return true;
    }
    throw error;
  }
  try {
    const probed = fstatSync(reader);
    if (probed.dev !== held.dev || probed.ino !== held.ino) {
      throw new Error(`${path} was replaced between its append open and its tail probe`);
    }
    return lastByteUnterminated({ fd: reader, size: held.size });
  } finally {
    closeSync(reader);
  }
}

/**
 * `text` with its final line terminated — every line this module writes ends in a newline, so the NEXT append never
 * starts on this one's tail.
 */
function terminated({ text }: { text: string }): string {
  if (text.endsWith("\n")) {
    return text;
  }
  return `${text}\n`;
}

/**
 * The bytes one append writes: nothing for an empty `text`, which has no line to separate (the
 * open still happens, as `appendFileSync(path, "")` did, so an absent file is still created and a missing directory
 * still throws); otherwise a `\n` after a torn tail, then `text`, terminated. `tornTail` is asked only for a
 * non-empty `text`, so an empty append never probes a tail at all.
 */
function payloadFor({ text, tornTail }: { text: string; tornTail: () => boolean }): string {
  if (text.length === 0) {
    return "";
  }
  const lead = tornTail() ? "\n" : "";
  return `${lead}${terminated({ text })}`;
}

/**
 * The flags a `noFollow` append opens with: append-only, created when absent, a symlink at the final component refused
 * at the open (`ELOOP`), and a FIFO never waited on.
 */
function noFollowAppendFlags(): number {
  return constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | noFollowFlag() | constants.O_NONBLOCK;
}

/**
 * The `noFollow` append: one held descriptor, opened without following a final symlink and refused unless it is a
 * regular file, whose tail is probed through a second no-follow descriptor on the same inode, then written whole.
 */
function appendNoFollow({
  durable,
  mode,
  path,
  text,
}: {
  durable: boolean;
  mode: number | undefined;
  path: string;
  text: string;
}): void {
  const flags = noFollowAppendFlags();
  const handle = mode === undefined ? openSync(path, flags) : openSync(path, flags, mode);
  try {
    if (!fstatSync(handle).isFile()) {
      throw new Error(`${path} is not a regular file, so a noFollow append refuses it`);
    }
    const payload = payloadFor({
      text,
      tornTail: () => descriptorNeedsSeparator({ fd: handle, noFollow: true, path }),
    });
    writeAll({ handle, text: payload });
    if (durable) {
      fsyncSync(handle);
    }
  } finally {
    closeSync(handle);
  }
  if (durable) {
    fsyncDirectories({ paths: [path] });
  }
}

/**
 * Append whole lines to a line-oriented file, starting on a fresh line when the file's last write was torn.
 *
 * Writes, as one payload: a `\n` when the existing file is non-empty and does not end in one, then `text`, then a
 * final `\n` when `text` lacks it. An empty `text` writes no byte but still opens the file, exactly as
 * `appendFileSync(path, "")` did. A file that is not there is created (with `mode` when given). It throws, as the
 * filesystem calls it replaces did, so each store keeps its own error seam.
 *
 * `durable` is for a journal something durable is later built on: every byte is written through one descriptor, the
 * file fsynced, then its directory, so the append cannot vanish in a crash behind a record that survives it
 * (`handover settle`'s card effect). Without it the append is one buffered `appendFileSync`.
 *
 * By default the append follows a symlink at `path` and writes into whatever file it reaches, because a caller may
 * legitimately reach its file through a link (see {@link descriptorNeedsSeparator}). `noFollow` is for a file nothing
 * should ever reach through a link at its own name — a home ledger whose link could point at any other file in the
 * home: the append opens without following the final component, so a symlink there throws `ELOOP` and nothing is
 * written to its target; anything that opens but is not a regular file throws too. Linked ancestor directories are
 * still followed, and a hard link is not refused.
 *
 * @param path the file to append to; its directory must already exist
 * @param text one or more lines, the last newline optional
 * @param mode the permission bits a file this append creates gets (an existing file keeps its own)
 * @param durable fsync the file and its directory before returning
 * @param noFollow refuse a symlink at the final component of `path` rather than append into its target
 */
export function appendLines({
  path,
  text,
  mode,
  durable = false,
  noFollow = false,
}: {
  path: string;
  text: string;
  mode?: number;
  durable?: boolean;
  noFollow?: boolean;
}): void {
  if (noFollow) {
    appendNoFollow({ durable, mode, path, text });
    return;
  }
  const payload = payloadFor({ text, tornTail: () => tailIsTorn({ path, unreadable: true }) });
  if (!durable) {
    appendFileSync(path, payload, mode === undefined ? { encoding: "utf8" } : { encoding: "utf8", mode });
    return;
  }
  const handle = mode === undefined ? openSync(path, "a") : openSync(path, "a", mode);
  try {
    writeAll({ handle, text: payload });
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  fsyncDirectories({ paths: [path] });
}
