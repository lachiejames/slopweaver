/**
 * The poll gate's one filesystem read: has the file a poll names changed since the last time it was read?
 *
 * The gate exists to stop a turn re-reading a log, pid or task that is still being written, to learn it is not done
 * yet. It refused on the clock alone, so a second `grep` of a file NOTHING was writing was refused exactly like a
 * second `tail` of a running build. MEASURED on a supervisor transcript: 16 distinct poll-gate
 * refusals, and for 12 of them the target's current mtime is EARLIER than the first of the two reads — handover
 * docs, a published page, the chair's own tick scratch JSON, four finished background-task outputs. One
 * (`bh8b51mtk.output`) was written after its refusal: a file still growing, the case the gate is for. Repro: read
 * each refusal's target and "polled Ns ago" out of the transcript, then `stat -f '%Sm %z %N' <target>`.
 *
 * So the gate keys on this token as well as the clock: inside the window, a token whose every file part the last token
 * already held, byte for byte, means no file the re-read names moved, and it is allowed (`./pollGate.ts`). Equal is
 * the common case; a SUBSET is the other: the gate keys a read by its FIRST path, so `grep x A B C` then `grep x A`
 * share a target while naming different sets, and comparing whole tokens refused that static re-read (measured on a
 * seat's own transcript; repro inside one session: `grep -c x A B C`, then `grep -c x A` within 60s, with log-like
 * paths). A file the re-read names that the last read did not is still refused: nothing vouches for it. A part names
 * one file — its path, the real path it resolves to, its device and inode, its size, mtime and ctime —
 * and it is `undefined` whenever it cannot speak for the WHOLE target: no paths at all (a pid, a task, a pathless
 * loop), a path that does not exist, a glob, a directory (its mtime says nothing about edits inside
 * an existing child), a symbolic link (a repointed link can land on a file of the same size and mtime), a file this
 * process cannot read, a path or real path holding the part separator (a newline, which would split one part into
 * two), or any error. `undefined` leaves the clock rule exactly as it was.
 *
 * A read's other operands (a grep pattern, a bare file name the classifier cannot tell from one) are statted too:
 * one that exists as a regular file joins the token, one that exists as anything else voids it, one that provably
 * does not exist (ENOENT) is skipped — a pattern, or a missing file with no content to re-read — and one the lstat
 * cannot answer for voids it. A glob is never expanded: `globSync` enumerates a whole directory before any cap
 * could apply, and a hook has a 15-second budget whose overrun fails every door-gated call closed. A glob keeps the
 * clock rule — one of the 16 measured refusals.
 *
 * What it cannot see: a quiet log of a process still running looks identical to a finished one, so its unchanged
 * re-read is allowed; and the file may change, or its path be swapped, after this check and before the read itself —
 * the check holds the file open and binds the real path to that inode, and re-stats every file once the last is held,
 * so a swap or a write DURING the check voids the token, but nothing in a hook can hold the file still for the command
 * that follows. Nor can the closing pass, which re-stats each WRITTEN path, see a parent link repointed after the
 * realpath onto another hard link of the same inode: the token then carries a stale real path, but the same unchanged
 * inode, so the bytes the command reads are the bytes the token describes; re-running the
 * realpath in the closing pass would close the label too. A same-size rewrite that restores
 * its mtime is caught by the ctime, which no unprivileged process can set back.
 *
 * Nor can it see a file the inherited SHELL STATE names: `TZ=:/path` makes `date` open that zoneinfo file, and
 * `LOCPATH` or `LC_*` lead almost every filter to a locale file, with no word of the command naming either; and the program a command word runs — found through `PATH`, or an alias or function a startup
 * file defined — is never in the token, an in-place upgrade of `tail` included. The token covers the files the command's words name, never the whole closure of what a process may
 * open — that closure has no bottom. The same holds for the shell's own working directory: a relative word is vouched
 * for only when the payload's cwd is its own real path, but a cwd directory renamed and replaced under a shell still
 * sitting in the old one is process state the payload reports and no hook can check. Accepted on purpose: the gate is a spend guard that fails open by design
 * (`./pollGateRunner.ts`), so this residue costs one re-read the clock rule would have refused, never a boundary.
 */
import { type BigIntStats, closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

/**
 * Every stat is read as bigints. A number loses integers past 2^53, so two inodes a FUSE filesystem numbers that high
 * would share one identity, and a millisecond time collapses two writes the nanosecond one tells apart.
 */
type Stats = BigIntStats;

/** Separates one file's part of a token from the next. A path holding it voids the token, so a part never splits. */
const PART_SEPARATOR = "\n";

/**
 * Whether a token describes only files the last token already described, each unchanged: every part of `token` is a
 * part of `last`, byte for byte. Equal tokens are the common case; a subset is a re-read naming fewer of the same files.
 *
 * @param token the change token now
 * @param last the change token recorded at the last poll of the same target
 * @returns true only when no file the re-read names is new or has moved
 */
export function tokenUnchangedSince({ token, last }: { token: string; last: string }): boolean {
  const before = new Set(last.split(PART_SEPARATOR));
  return token.split(PART_SEPARATOR).every((part) => before.has(part));
}

/**
 * Stat a path as bigints without following a final link, throwing as `lstatSync` does.
 *
 * @param path the absolute path
 * @returns its stats
 */
function lstatExact({ path }: { path: string }): Stats {
  return lstatSync(path, { bigint: true });
}

/**
 * Whether an observation of a path is still the regular file a token part was built from: the same device and inode,
 * size, mtime and ctime.
 *
 * @param observed what a later stat answered, or `undefined` when it could not
 * @param held the stats the part was built from
 * @returns true only for the same unchanged regular file
 */
function sameFile({ observed, held }: { observed: Stats | undefined; held: Stats }): boolean {
  return (
    observed !== undefined &&
    observed.isFile() &&
    observed.dev === held.dev &&
    observed.ino === held.ino &&
    observed.size === held.size &&
    observed.mtimeNs === held.mtimeNs &&
    observed.ctimeNs === held.ctimeNs
  );
}

/**
 * Stat one path without following a final symbolic link, answering `undefined` when it does not exist or cannot be
 * statted.
 *
 * @param path the absolute path
 * @returns its stats, or `undefined`
 */
function statOrNothing({ path }: { path: string }): Stats | undefined {
  try {
    return lstatExact({ path });
  } catch {
    return undefined;
  }
}

/**
 * Hold one file open and describe it: the open file's own stats and the real path it lands on — or `undefined` when
 * it cannot be vouched for.
 *
 * The open is what binds the check to one file. It is a read open, so an unreadable file fails it; `O_NOFOLLOW`
 * refuses a final symbolic link; `O_NONBLOCK` keeps a path swapped for a FIFO from hanging the hook. The open file must
 * be the regular file the earlier lstat saw (same device and inode), and the real path — every parent link followed,
 * so a repointed parent directory moves it — must land on that same inode, as must a last lstat of the path itself.
 * A swap or a write before that last call changes an inode, a size, an mtime or a ctime and voids the token; one after it is
 * the stat-then-read residual in the file header.
 *
 * @param path the absolute path
 * @param seen what the earlier lstat of that path answered
 * @returns the real path and the open file's stats, or `undefined`
 */
function heldFile({ path, seen }: { path: string; seen: Stats }): { real: string; stat: Stats } | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor, { bigint: true });
    const real = realpathSync.native(path);
    const landed = lstatExact({ path: real });
    // The LAST call re-reads the path as the command will — parent links followed afresh — so a parent repointed after
    // the realpath lands elsewhere. Every lstat, the first included, must carry the size, mtime and ctime the token is built
    // from: a write between any two observations voids the token rather than letting it describe a file mid-change.
    const again = lstatExact({ path });
    const same = [seen, landed, again].every((other) => sameFile({ held: stat, observed: other }));
    return stat.isFile() && same ? { real, stat } : undefined;
  } catch {
    return undefined;
  } finally {
    closeQuietly({ descriptor });
  }
}

/**
 * Stat a read's other operand, telling a name that is not there (a grep pattern) from one the lstat could not answer
 * for — a parent this process may not search, say — which might be a file the command reads.
 *
 * @param path the absolute path
 * @returns its stats, `absent` on ENOENT, or `unknown` on any other error
 */
function operandStat({
  path,
}: {
  path: string;
}): { kind: "present"; stat: Stats } | { kind: "absent" } | { kind: "unknown" } {
  try {
    return { kind: "present", stat: lstatExact({ path }) };
  } catch (error) {
    const absent = error instanceof Error && "code" in error && error.code === "ENOENT";
    return absent ? { kind: "absent" } : { kind: "unknown" };
  }
}

/**
 * Close a descriptor the fingerprint opened, never throwing: the hook must answer whatever the filesystem does.
 *
 * @param descriptor the descriptor, or `undefined` when the open never succeeded
 */
function closeQuietly({ descriptor }: { descriptor: number | undefined }): void {
  if (descriptor === undefined) {
    return;
  }
  try {
    closeSync(descriptor);
  } catch {
    // A failed close leaves nothing the token depends on; the process exits when the hook answers.
  }
}

/**
 * Whether the payload's working directory is its own real path, so a relative word lands where the hook resolves it.
 *
 * A cwd reached through a symbolic link can be repointed after the shell entered it: the shell keeps the directory it
 * holds, while the hook would resolve the text afresh and fingerprint a decoy. A cwd with no
 * link in it has no such second answer.
 *
 * @param cwd the payload's working directory
 * @returns true only when it resolves to exactly itself
 */
function canonicalCwd({ cwd }: { cwd: string }): boolean {
  const trimmed = cwd.length > 1 && cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  try {
    return realpathSync.native(trimmed) === trimmed;
  } catch {
    return false;
  }
}

/**
 * Stat every file a poll names, keyed by the absolute path the shell opens — or `undefined` when one cannot be vouched
 * for.
 *
 * @param cwd the payload's working directory, which a relative path is resolved against
 * @param paths the path-looking operands, each of which must exist
 * @param operands the other operands, each counted only when it exists
 * @returns the stats by absolute path, or `undefined`
 */
function namedFiles({
  cwd,
  paths,
  operands,
}: {
  cwd: string;
  paths: readonly string[];
  operands: readonly string[];
}): Map<string, Stats> | undefined {
  // A relative word resolves against the cwd, so it is vouched for only when the cwd has one answer.
  if ([...paths, ...operands].some((path) => !isAbsolute(path)) && !canonicalCwd({ cwd })) {
    return undefined;
  }
  // Joined as text, never normalised: `resolve` would collapse `link/..` before the kernel follows `link`, and
  // fingerprint a different file from the one the shell opens.
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  const absolute = ({ path }: { path: string }): string => (isAbsolute(path) ? path : `${base}${path}`);
  const files = new Map<string, Stats>();
  for (const path of paths) {
    const file = absolute({ path });
    const stat = statOrNothing({ path: file });
    // A path that must exist and does not (or is a glob, which names no file literally) cannot be vouched for.
    if (stat === undefined) {
      return undefined;
    }
    files.set(file, stat);
  }
  for (const operand of operands) {
    const file = absolute({ path: operand });
    const found = operandStat({ path: file });
    // Only a name that provably is not there is a pattern; one the lstat could not answer for might be a file.
    if (found.kind === "unknown") {
      return undefined;
    }
    // A name that is not there has no content for the call to re-read, and is skipped: so a grep's pattern leaves a
    // grep and a tail of one untouched file the same token. Should it appear, it joins the token and moves it.
    if (found.kind === "present") {
      files.set(file, found.stat);
    }
  }
  return files;
}

/**
 * The change token for every file a poll names.
 *
 * @param cwd the payload's working directory, which a relative path is resolved against
 * @param paths the path-looking operands the classifier read off the probes (`PollShape.paths`); each must exist
 * @param operands the probes' other operands (`PollShape.operands`); each counts only when it exists
 * @param onHeld called after each file is held, before the next; a test's seam for a write landing mid-check
 * @returns the token, or `undefined` when it cannot vouch for the whole target
 */
export function pollFingerprint({
  cwd,
  paths,
  operands,
  onHeld,
}: {
  cwd: string;
  paths: readonly string[];
  operands: readonly string[];
  onHeld?: ({ file }: { file: string }) => void;
}): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }
  const files = namedFiles({ cwd, operands, paths });
  if (files === undefined) {
    return undefined;
  }
  const held: { file: string; real: string; stat: Stats }[] = [];
  for (const [file, seen] of [...files].toSorted(([left], [right]) => (left < right ? -1 : 1))) {
    const one = seen.isFile() ? heldFile({ path: file, seen }) : undefined;
    if (one === undefined) {
      return undefined;
    }
    held.push({ file, ...one });
    onHeld?.({ file });
  }
  // Each file was held one after another, so an EARLIER one may have moved while a later one was being statted.
  // One closing pass over every path, after the last is held, voids the token if any did.
  if (!held.every(({ file, stat }) => sameFile({ held: stat, observed: statOrNothing({ path: file }) }))) {
    return undefined;
  }
  if (held.some(({ file, real }) => file.includes(PART_SEPARATOR) || real.includes(PART_SEPARATOR))) {
    return undefined;
  }
  return held
    .map(({ file, real, stat: { dev, ino, size, mtimeNs, ctimeNs } }) =>
      [file, real, `${String(dev)}:${String(ino)}`, String(size), String(mtimeNs), String(ctimeNs)].join("\u0000"),
    )
    .join(PART_SEPARATOR);
}
