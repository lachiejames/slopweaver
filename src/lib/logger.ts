/**
 * A thin stderr logger for the CLI. Diagnostics (errors, usage, warnings, progress) go HERE; a
 * command's actual data output (a table, an id, a JSON blob) is NOT a log — it stays raw on stdout via
 * `out()` so piping keeps working. Keeping the two streams apart is the whole point: `slopweaver store read
 * "..." | grep ...` must see only the answer, never a warning line.
 *
 * `out()` is the ONLY stdout channel a verb may use, and that is machine-enforced rather than conventional:
 * the `stdout-data-channel` gate refuses a `process.stdout.write` anywhere under `src/cli/`, because that
 * write is asynchronous on a pipe and `runCliProcess` ends with `process.exit` — see {@link writeAllSync}.
 * (`runCliProcess` drains both streams before that exit — `./drainStdio.ts` — as the backstop for modules
 * outside the gate; `out()` never queues, so it never needs it.)
 *
 * Pure-testable by construction: the only side effect is the injectable `sink`, so a test passes an
 * array-push sink and asserts the exact emitted lines (no mocks, no IO).
 */

import { writeSync } from "node:fs";

import { collectedErr, collectedOut } from "./outputCollect.js";
import { isRecord } from "./parsers.js";
import { sleepSync } from "./sleepSync.js";

/** The stdout file descriptor — the data channel, written synchronously; see {@link defaultOutSink}. */
const STDOUT_FD = 1;

/** The stderr file descriptor — written the same way only by {@link errExact}, for a hook whose refusal IS its output. */
const STDERR_FD = 2;

type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * The logging seam.
 *
 * Every method takes an OBJECT rather than a bare string, and that is deliberate rather than ceremony: it is
 * the shape structured logging needs. Adding a field — an `error` object carried instead of interpolated into
 * the message, or arbitrary context — then becomes additive and touches no call site. Wrapping first and
 * adding fields later migrates every call site once instead of twice.
 *
 * There is no exception here for being a "library-pattern primitive" — an object-taking `error` is the door to
 * structured logging, so it is exactly the signature the rule should apply to.
 */
export interface Logger {
  error({ msg }: { msg: string }): void;
  warn({ msg }: { msg: string }): void;
  info({ msg }: { msg: string }): void;
  debug({ msg }: { msg: string }): void;
  /**
   * Raw DATA output: writes `${line}\n` to STDOUT with no level gate and no prefix. This is a command's
   * actual output, not a diagnostic — it must stay on stdout so `… | grep` sees only the data. Distinct
   * from every other method here, which are level-gated diagnostics on stderr.
   *
   * It takes `{ line }`, not `{ msg }`, and stays a plain string channel: structured fields would be wrong
   * on a stream whose whole contract is that a pipe sees only the data.
   */
  out({ line }: { line: string }): void;
}

export interface CreateLoggerOpts {
  /** Minimum level to emit. error < warn < info < debug. Default `info`. */
  readonly level?: LogLevel;
  /** Where each diagnostic line goes. Default writes `${line}\n` to process.stderr. */
  readonly sink?: (line: string) => void;
  /** Where each `out` (data) line goes. Default writes `${line}\n` to process.stdout. */
  readonly outSink?: (line: string) => void;
}

/** Severity order: a level emits only when it is at or below the configured threshold. */
const LEVEL_RANK: Record<LogLevel, number> = { debug: 3, error: 0, info: 2, warn: 1 };

// Both sinks INHERIT their shape from `CreateLoggerOpts` rather than restating it, so the compiler checks
// they still match the seam a caller may substitute. `sink` stays a raw `(line)` channel: it is the stream
// itself, below the level where a structured field would mean anything.
const defaultSink: NonNullable<CreateLoggerOpts["sink"]> = (line) => {
  process.stderr.write(`${line}\n`);
};

const defaultOutSink: NonNullable<CreateLoggerOpts["outSink"]> = (line) => {
  // `writeSync`, not `process.stdout.write`, and this is a silent-truncation fix rather than a style choice.
  //
  // When stdout is a PIPE, `process.stdout.write` is asynchronous: it fills the pipe buffer and queues the
  // rest, and a process that exits before the queue drains loses it. The loss is silent and the exit code
  // is 0. Measured while adding `atlas slack --json`, whose document is larger than the buffer: piping it
  // to a parser produced a document cut off mid-string at 65,530 bytes, with a successful exit — a machine
  // lane whose output is quietly a prefix, which is the exact defect class this codebase refuses everywhere
  // else. Interactive use never showed it, because a TTY write is synchronous.
  //
  // This is the ONE data channel, so it is the one place the guarantee matters; diagnostics on stderr are
  // human-facing and short.
  writeStdout({ text: `${line}\n` });
};

/**
 * Every stdout byte's one door: the open collection scope's when a run inside one wrote it (`./outputCollect.ts`,
 * how `console batch` keeps each verb's output its own), else the descriptor, written whole.
 *
 * @param text the exact bytes
 */
function writeStdout({ text }: { text: string }): void {
  if (collectedOut({ text })) {
    return;
  }
  writeAllSync({ fd: STDOUT_FD, text });
}

/**
 * Write every byte to stdout, looping over partial writes.
 *
 * The loop is the load-bearing part and a plain `writeSync` is NOT enough: Node opens a piped stdout
 * non-blocking, so `writeSync` writes what fits in the pipe buffer, returns that count, and leaves the
 * rest. Measured: a 121 KB document came back as exactly 65,536 bytes — one buffer — under both
 * `process.stdout.write` and a single `writeSync`. `EAGAIN` means the pipe is full and the reader has not
 * drained, so the same bytes must be offered again.
 *
 * **That retry SLEEPS rather than spinning**, and a review pass is why: the first version retried
 * immediately, so a reader that stops consuming — a pager sitting at a prompt, a suspended process — left
 * this burning a core forever at the same offset. Waiting indefinitely for a paused reader is correct, and
 * is exactly what a blocking write does; doing it at 100% CPU is not.
 *
 * There is deliberately no attempt cap. A cap means giving up mid-document, which is the silent truncation
 * this function exists to prevent — better to block visibly than to exit 0 with a prefix.
 *
 * @param fd the descriptor written — stdout, or stderr for {@link errExact}
 * @param text the exact bytes to place on it
 */
function writeAllSync({ fd, text }: { fd: number; text: string }): void {
  const buffer = Buffer.from(text, "utf8");
  let written = 0;
  let waitMs = FIRST_DRAIN_WAIT_MS;
  while (written < buffer.length) {
    try {
      written += writeSync(fd, buffer, written, buffer.length - written);
    } catch (error: unknown) {
      // Anything that is not EAGAIN is a real failure and must not be swallowed — a silently dropped data
      // channel is the defect this function exists to fix.
      if (!(isRecord(error) && error["code"] === "EAGAIN")) {
        throw error;
      }
      // A bounded POLL, not a zero-cost wait, and that is a limitation rather than an oversight: Node
      // exposes no synchronous way to block until a descriptor becomes writable — there is no sync
      // `poll`/`select` — so waiting for a pipe means asking again. Doubling up to MAX_DRAIN_WAIT_MS takes
      // an indefinitely paused reader from hundreds of wake-ups a second to twenty, while still resuming
      // within a millisecond in the normal case where the reader is merely behind.
      sleepSync({ ms: waitMs });
      waitMs = Math.min(waitMs * 2, MAX_DRAIN_WAIT_MS);
    }
  }
}

/**
 * Raw data on stdout with NO line ending added — for a verb whose output is a stored body that must reach a
 * pipe byte for byte (`store measurement-show`), where `out()`'s trailing newline would alter it. The same
 * synchronous, loop-until-written channel as `out()`, so a piped reader gets every byte before exit.
 *
 * @param text the exact text to place on stdout
 */
export function outExact({ text }: { text: string }): void {
  writeStdout({ text });
}

/**
 * Text on stderr, every byte written before this returns — for a hook whose stderr IS what the model reads. A
 * `PreToolUse` refusal is one: Claude Code shows an exit-2 hook's stderr to the model, and the `profile-held` check
 * records the owner's profile as delivered only once the refusal carrying it has really left the process
 * (`src/admit/preToolUseDispatch.ts`'s `afterEmit`). `process.stderr.write` on a pipe queues, and the entry exits.
 *
 * @param text the exact text to place on stderr
 */
export function errExact({ text }: { text: string }): void {
  if (collectedErr({ text })) {
    return;
  }
  writeAllSync({ fd: STDERR_FD, text });
}

/** First pause after a full pipe — short, because the common case is a reader that drains immediately. */
const FIRST_DRAIN_WAIT_MS = 1;

/** Ceiling on the pause. Bounds the wake-up rate for a reader that has stopped consuming entirely. */
const MAX_DRAIN_WAIT_MS = 50;

/**
 * Build a logger. `level` gates output (a `debug` call is dropped at the default `info` level); `sink`
 * is the single side-effect seam. A `--quiet` caller passes `level: 'error'`, `--verbose` passes
 * `level: 'debug'`.
 *
 * @param level the minimum level emitted; omitted, the default `info`
 * @param sink where diagnostics go; omitted, the real stderr sink
 * @param outSink where data lines go; omitted, the real stdout sink
 * @returns the logger
 */
export function createLogger({
  level: minimum = "info",
  sink = defaultSink,
  outSink = defaultOutSink,
}: CreateLoggerOpts = {}): Logger {
  const threshold = LEVEL_RANK[minimum];
  const emit = ({ level, msg }: { level: LogLevel; msg: string }): void => {
    if (LEVEL_RANK[level] <= threshold) {
      sink(msg);
    }
  };
  return {
    debug: ({ msg }) => {
      emit({ level: "debug", msg });
    },
    error: ({ msg }) => {
      emit({ level: "error", msg });
    },
    info: ({ msg }) => {
      emit({ level: "info", msg });
    },
    out: ({ line }) => {
      outSink(line);
    },
    warn: ({ msg }) => {
      emit({ level: "warn", msg });
    },
  };
}

/**
 * The process-wide default logger (default level, stderr sink). Runners log diagnostics through this
 * directly instead of each threading its own injected `Logger` — the only reason to build a bespoke
 * logger is a test (array sink) or a `--quiet`/`--verbose` level override.
 */
export const logger = createLogger();
