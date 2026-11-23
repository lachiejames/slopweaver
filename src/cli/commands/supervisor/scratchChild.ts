/**
 * The one child launcher the supervisor-scratch verbs and `supervisor tick` share: a `slopweaver` child's
 * output streamed to two files, under a budget that kills it.
 *
 * It is `spawnSync`, never the async `spawn`: rule 2's `no-headless` gate bans every async child-process
 * capability with no allowlist, and a synchronous child cannot outlive the verb that launched it. The cost,
 * stated: `spawnSync` cannot detach, so a spent budget kills the direct child only. The installed launcher
 * `exec`s node, so that child IS the whole run; only a tsx fallback, which runs node as its own child, can
 * leave a grandchild writing into a file nobody reads.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { quietLauncherEnv } from "#lib/launcherEnv.js";

import type { ChildOutcome } from "../../../supervisor/scratch/childOutcome.js";

/** Write to a file this call CREATES — never one already there, and never through a link at the final component. */
const FRESH_FILE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

/**
 * Open an output file as a NEW inode: whatever stands at the path is unlinked first, so neither a symbolic link
 * nor a hard link sharing the seat form's inode can be truncated through it (both shapes). Exclusive
 * creation then refuses anything that appeared in between rather than writing into it.
 *
 * @param path the output file
 * @returns the open descriptor
 */
function openFresh({ path }: { path: string }): number {
  try {
    unlinkSync(path);
  } catch {
    // ENOENT: nothing stands there yet, which is the ordinary case.
  }
  return openSync(path, FRESH_FILE);
}

/**
 * Launch one `slopweaver` child with its output streamed straight to two files — never through a string —
 * killed once it overruns its budget.
 *
 * Both files are fsynced before they close, so the stdout file is a staged write `renameStagedFile` may promote.
 *
 * @param bin the binary
 * @param argv its arguments
 * @param stdoutPath where stdout goes
 * @param stderrPath where stderr goes
 * @param timeoutMs the budget, after which the child is killed
 * @param env the child's whole environment; this process's own, launcher quieted, when absent
 * @param cwd the directory the child runs in; this process's own when absent, and one that is not there fails the
 *   launch
 * @param transient `true` when the files are only read back in this process and then thrown away: they are closed
 *   without a flush, and a close that fails is ignored, so a post-exit disk fault cannot replace the exit already in
 *   hand. Absent, every file is flushed before it closes and a failure throws.
 * @returns how the child ended
 */
export async function runChildToFiles({
  bin,
  argv,
  stdoutPath,
  stderrPath,
  timeoutMs,
  env,
  cwd,
  transient,
}: {
  bin: string;
  argv: readonly string[];
  stdoutPath: string;
  stderrPath: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  transient?: true;
}): Promise<ChildOutcome> {
  const stdout = openFresh({ path: stdoutPath });
  let stderr: number;
  try {
    stderr = openFresh({ path: stderrPath });
  } catch (cause) {
    // The second open failing must not strand the first descriptor (EMFILE at the limit).
    closeSync(stdout);
    throw cause;
  }
  const startedMs = Date.now();
  let childEnv = quietLauncherEnv();
  if (env !== undefined) {
    childEnv = env;
  }
  try {
    const result = spawnSync(bin, [...argv], {
      ...(cwd === undefined ? {} : { cwd }),
      env: childEnv,
      killSignal: "SIGKILL",
      stdio: ["ignore", stdout, stderr],
      timeout: timeoutMs,
    });
    return outcomeOf({ durationMs: Date.now() - startedMs, result, stderr, timeoutMs });
  } finally {
    if (transient === true) {
      closeQuietly({ fds: [stdout, stderr] });
    } else {
      // Flushed before close, so a caller may rename the stdout file into place as a durable, staged write.
      flushAndClose({ fds: [stdout, stderr] });
    }
  }
}

/**
 * Close each descriptor, ignoring a failure: the caller reads the files back by path in this process, where the
 * page cache already holds what the child wrote, so a close fault changes nothing it will read.
 *
 * @param fds the descriptors, closed in order
 */
function closeQuietly({ fds }: { fds: readonly number[] }): void {
  for (const fd of fds) {
    try {
      closeSync(fd);
    } catch {
      // Ignored on purpose: see above.
    }
  }
}

/**
 * Flush then close each descriptor, closing every one even when a flush fails, then throw the first
 * flush failure so a caller relying on a durable write still hears of it.
 *
 * @param fds the descriptors, flushed and closed in order
 */
function flushAndClose({ fds }: { fds: readonly number[] }): void {
  const failures: Error[] = [];
  for (const fd of fds) {
    try {
      fsyncSync(fd);
    } catch (cause) {
      failures.push(cause instanceof Error ? cause : new Error(`fsync of descriptor ${fd} failed`, { cause }));
    } finally {
      closeSync(fd);
    }
  }
  const [failure] = failures;
  if (failure !== undefined) {
    throw failure;
  }
}

/**
 * Launch one bounded `slopweaver` child whose output nobody reads — only how it ended — streamed into a throwaway
 * directory that is removed after, so a JSON caller's own stdout is never mixed with the child's.
 *
 * @param bin the binary
 * @param argv its arguments
 * @param timeoutMs the budget, after which the child is killed
 * @param env the child's whole environment; this process's own, launcher quieted, when absent
 * @param cwd the directory the child runs in; this process's own when absent
 * @returns how the child ended
 */
export async function runBoundedChild({
  bin,
  argv,
  timeoutMs,
  env,
  cwd,
}: {
  bin: string;
  argv: readonly string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): Promise<ChildOutcome> {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-child-"));
  try {
    return await runChildToFiles({
      argv,
      bin,
      ...(cwd === undefined ? {} : { cwd }),
      ...(env === undefined ? {} : { env }),
      stderrPath: join(dir, "child.err"),
      stdoutPath: join(dir, "child.out"),
      timeoutMs,
    });
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/** How a bounded child ended, and what it printed on stderr — read up to a cap, the cut said rather than hidden. */
export interface BoundedChildWithStderr {
  readonly outcome: ChildOutcome;
  /** The stderr text kept: all of it, or its first `stderrMaxBytes` bytes cut back to a whole UTF-8 character. */
  readonly stderr: string;
  /** How many bytes the child wrote to stderr in all. */
  readonly stderrBytes: number;
  /** How many of those bytes {@link stderr} was decoded from — the raw count, never the text re-encoded. */
  readonly stderrKeptBytes: number;
  /** Whether {@link stderr} is a prefix of what the child wrote. */
  readonly stderrTruncated: boolean;
}

/**
 * {@link runBoundedChild}, keeping what the child printed on stderr — the refusal a gate prints, for a caller that has
 * to say why the child did not succeed. The stderr file is read before the directory is removed, at most
 * `stderrMaxBytes` of it, so a child printing without end until its budget is spent still costs one bounded read.
 *
 * @param bin the binary
 * @param argv its arguments
 * @param timeoutMs the budget, after which the child is killed
 * @param stderrMaxBytes the most stderr bytes kept
 * @param env the child's whole environment; this process's own, launcher quieted, when absent
 * @param cwd the directory the child runs in; this process's own when absent
 * @returns how the child ended and what it printed on stderr
 */
export async function runBoundedChildWithStderr({
  bin,
  argv,
  timeoutMs,
  stderrMaxBytes,
  env,
  cwd,
}: {
  bin: string;
  argv: readonly string[];
  timeoutMs: number;
  stderrMaxBytes: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): Promise<BoundedChildWithStderr> {
  const startedMs = Date.now();
  let dir: string;
  try {
    dir = mkdtempSync(join(tmpdir(), "slopweaver-child-"));
  } catch (cause) {
    return notStarted({ cause, startedMs });
  }
  try {
    const stderrPath = join(dir, "child.err");
    let outcome: ChildOutcome;
    try {
      outcome = await runChildToFiles({
        argv,
        bin,
        ...(cwd === undefined ? {} : { cwd }),
        ...(env === undefined ? {} : { env }),
        stderrPath,
        stdoutPath: join(dir, "child.out"),
        timeoutMs,
        transient: true,
      });
    } catch (cause) {
      // `spawnSync` reports its own failures and a transient close never throws, so a throw here is an output file
      // that would not open: no child ran.
      return notStarted({ cause, startedMs });
    }
    return { outcome, ...stderrPrefix({ maxBytes: stderrMaxBytes, path: stderrPath }) };
  } finally {
    removeScratch({ dir });
  }
}

/**
 * Remove a throwaway directory without ever throwing. The result it held is already in hand, and a directory that
 * will not go — its parent made unwritable while the child ran — must not replace that result with a
 * rejection; it is left under the OS temp directory instead.
 *
 * @param dir the throwaway directory
 */
export function removeScratch({ dir }: { dir: string }): void {
  try {
    rmSync(dir, { force: true, recursive: true });
  } catch {
    // Left behind on purpose: see above.
  }
}

/**
 * A child that never started because its output could not be set up — named as a launch failure, never thrown, so
 * a caller judging many children is not ended by one.
 *
 * @param cause what failed while setting up the child's output
 * @returns a launch failure carrying no stderr
 */
function notStarted({ cause, startedMs }: { cause: unknown; startedMs: number }): BoundedChildWithStderr {
  const message = cause instanceof Error ? cause.message : String(cause);
  const outcome: ChildOutcome = { durationMs: Date.now() - startedMs, kind: "launch-failed", message };
  return { outcome, stderr: "", stderrBytes: 0, stderrKeptBytes: 0, stderrTruncated: false };
}

/** The stderr half of a {@link BoundedChildWithStderr}. */
type StderrPrefix = Pick<BoundedChildWithStderr, "stderr" | "stderrBytes" | "stderrKeptBytes" | "stderrTruncated">;

/**
 * {@link readPrefix}, never thrown: the child ran, so a stderr file that will not read is named in the text rather than
 * reading as a child that printed nothing.
 *
 * @param path the stderr file
 * @param maxBytes the most bytes read
 * @returns the kept text, the file's whole size, and whether the text is a prefix
 */
function stderrPrefix({ maxBytes, path }: { maxBytes: number; path: string }): StderrPrefix {
  try {
    return readPrefix({ maxBytes, path });
  } catch (cause) {
    const stderr = `[stderr unreadable: ${cause instanceof Error ? cause.message : String(cause)}]`;
    const bytes = Buffer.byteLength(stderr, "utf8");
    return { stderr, stderrBytes: bytes, stderrKeptBytes: bytes, stderrTruncated: false };
  }
}

/**
 * The first `maxBytes` of a file as text, a character cut at the boundary dropped rather than mangled.
 *
 * @param path the stderr file
 * @param maxBytes the most bytes read
 * @returns the kept text, the file's whole size, and whether the text is a prefix
 */
function readPrefix({ maxBytes, path }: { maxBytes: number; path: string }): StderrPrefix {
  const fd = openSync(path, "r");
  try {
    const stderrBytes = fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(stderrBytes, maxBytes));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const stderrTruncated = read < stderrBytes;
    // Past the cap, a multi-byte character the cap split is dropped rather than decoded as U+FFFD; a whole read
    // decodes to the end, so a dangling byte the child left becomes U+FFFD instead of vanishing. The kept
    // count is the RAW bytes the text was decoded from, never the text re-encoded: an invalid byte decodes to a
    // three-byte U+FFFD, so a re-encoded count overstates what was kept. `ignoreBOM` keeps a leading
    // U+FEFF as text, so a stderr of only that is not read as empty.
    const stderrKeptBytes = stderrTruncated ? read - splitCharacterTail({ bytes: buffer.subarray(0, read) }) : read;
    const stderr = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer.subarray(0, stderrKeptBytes));
    return { stderr, stderrBytes, stderrKeptBytes, stderrTruncated };
  } finally {
    closeSync(fd);
  }
}

/**
 * How many trailing bytes of a capped read are the start of one UTF-8 character the cap split: a lead byte and the
 * continuation bytes after it, fewer than the lead byte announces. Anything else — a complete character, a stray
 * continuation byte, an invalid lead — is zero, so it is kept and decodes as itself or as U+FFFD.
 *
 * @param bytes the bytes the capped read returned
 * @returns the length of the split character's start, from 0 to 3
 */
export function splitCharacterTail({ bytes }: { bytes: Uint8Array }): number {
  let continuations = 0;
  while (
    continuations < 3 &&
    continuations < bytes.length &&
    isContinuation({ byte: bytes[bytes.length - 1 - continuations]! })
  ) {
    continuations += 1;
  }
  const leadIndex = bytes.length - 1 - continuations;
  if (leadIndex < 0) {
    return 0;
  }
  const lead = bytes[leadIndex]!;
  const announced = sequenceLength({ lead });
  if (announced <= continuations + 1) {
    return 0;
  }
  // A second byte outside the lead's own range already makes the sequence invalid, so it is kept and decodes as
  // U+FFFD rather than being dropped as a character the cap split (`E0 80` at the cap would lose two bytes).
  const second = bytes[leadIndex + 1];
  if (second !== undefined && !secondByteFits({ lead, second })) {
    return 0;
  }
  return continuations + 1;
}

/**
 * Whether a continuation byte is a legal SECOND byte after this lead, by the WHATWG UTF-8 decoder's ranges: `E0`
 * needs A0–BF (no overlong), `ED` 80–9F (no surrogate), `F0` 90–BF (no overlong), `F4` 80–8F (nothing past U+10FFFF).
 *
 * @param lead the sequence's first byte
 * @param second the byte after it, already known to be a continuation byte
 * @returns whether the decoder would keep reading the sequence
 */
function secondByteFits({ lead, second }: { lead: number; second: number }): boolean {
  if (lead === 0xe0) {
    return second >= 0xa0;
  }
  if (lead === 0xed) {
    return second <= 0x9f;
  }
  if (lead === 0xf0) {
    return second >= 0x90;
  }
  if (lead === 0xf4) {
    return second <= 0x8f;
  }
  return true;
}

/**
 * Whether one byte is a UTF-8 continuation byte, `10xxxxxx`.
 *
 * @param byte the byte
 * @returns true for 0x80 through 0xBF
 */
function isContinuation({ byte }: { byte: number }): boolean {
  return (byte & 0xc0) === 0x80;
}

/**
 * How many bytes a UTF-8 sequence starting at this lead byte spans, or 1 for a byte that leads no multi-byte
 * sequence (ASCII, a continuation byte, an invalid lead), which a split can never leave unfinished.
 *
 * @param lead the first byte of the sequence
 * @returns 2, 3 or 4 for a valid multi-byte lead, else 1
 */
function sequenceLength({ lead }: { lead: number }): number {
  if (lead >= 0xc2 && lead <= 0xdf) {
    return 2;
  }
  if (lead >= 0xe0 && lead <= 0xef) {
    return 3;
  }
  if (lead >= 0xf0 && lead <= 0xf4) {
    return 4;
  }
  return 1;
}

/**
 * How a finished `spawnSync` child ended: a spent budget is `ETIMEDOUT`, any other error never started it.
 *
 * @param stderr the open stderr file, which a launch failure is written to
 * @returns the child's outcome
 */
function outcomeOf({
  result,
  durationMs,
  stderr,
  timeoutMs,
}: {
  result: SpawnSyncReturns<Buffer>;
  durationMs: number;
  stderr: number;
  timeoutMs: number;
}): ChildOutcome {
  const { error, status, signal } = result;
  if (error !== undefined && "code" in error && error.code === "ETIMEDOUT") {
    return { durationMs, kind: "timed-out", signal: "SIGKILL", timeoutMs };
  }
  if (error !== undefined) {
    writeSync(stderr, `${error.message}\n`);
    return { durationMs, kind: "launch-failed", message: error.message };
  }
  if (status !== null) {
    return { durationMs, exitCode: status, kind: "exited" };
  }
  return { durationMs, kind: "signalled", signal: String(signal) };
}
