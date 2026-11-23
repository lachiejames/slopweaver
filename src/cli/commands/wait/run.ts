/**
 * `slopweaver wait` — wait on a process or a file with ONE call, on the one wait contract (`src/wait/loop.ts`).
 *
 * The poll gate refuses a second `kill -0`, `tail` or `test -f` of the same target inside a minute, and until
 * this verb existed the only thing it could name instead was a Claude Code tool. A session in a shell had no
 * command that simply waited, so it wrote the `until … sleep … done` loop the gate then refused — measured as
 * 568 hand-rolled loops in one week (the self-improvement page, item 3).
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseWaitOptions } from "../../../wait/flags.js";
import {
  LOCAL_WAIT_CEILING_MS,
  LOCAL_WAIT_SCHEDULE_MS,
  realWaitClock,
  type WaitClock,
  waitUntilSettled,
} from "../../../wait/loop.js";
import { type FileReading, fileSettled, type PidReading, readFileForWait, readPid } from "../../../wait/probes.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

export const WAIT_USAGE =
  "usage: slopweaver wait (--pid <n> | --file <path> [--contains <text>]) [--timeout-seconds <n>]\n" +
  "  Wait with ONE call instead of a poll loop: until a process exits, or a file exists (and, with\n" +
  "  --contains, carries that text). Reads on a short stepped backoff, prints a state only when it changes,\n" +
  "  and ends on WAIT-DONE (exit 0) or WAIT-TIMEOUT (exit 4, not yet — running it again unchanged is\n" +
  "  correct). A Claude Code background task is its output file: --file <path> --contains <marker>.\n" +
  "  --timeout-seconds defaults to 540, inside the 600s a foreground Bash call may run; a longer wait\n" +
  "  belongs in the background, where its completion resumes the session.";

/** `wait`'s flags. `--timeout-seconds` is the shared wait flag; `--wait` itself is implied by the verb. */
const STRING_FLAGS: readonly string[] = ["pid", "file", "contains", "timeout-seconds"];
const FLAGS: FlagSpec = { boolean: [], string: STRING_FLAGS };

/** `--`-prefixed, for the help-truth ratchet. */
export const WAIT_FLAG_NAMES: readonly string[] = STRING_FLAGS.map((name) => `--${name}`).toSorted();

/** What one invocation waits on. */
export type WaitTarget =
  | { readonly kind: "pid"; readonly pid: number }
  | { readonly kind: "file"; readonly path: string; readonly contains: string | undefined };

/** A parsed invocation. */
export interface WaitArgs {
  readonly target: WaitTarget;
  readonly timeoutSeconds: number;
}

/** Resolve exactly one target from the parsed values. */
function targetOf({ values }: { values: Readonly<Record<string, string | boolean>> }): Result<WaitTarget> {
  const pid = values["pid"];
  const file = values["file"];
  const contains = typeof values["contains"] === "string" ? values["contains"] : undefined;
  if (typeof pid === "string" && typeof file === "string") {
    return err(["pass one of --pid or --file, not both"]);
  }
  if (typeof pid === "string") {
    const parsed = Number(pid);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return err(["--pid must be a positive whole number"]);
    }
    return contains === undefined
      ? ok({ kind: "pid", pid: parsed })
      : err(["--contains only means something with --file"]);
  }
  if (typeof file === "string") {
    return ok({ contains, kind: "file", path: file });
  }
  return err(["pass --pid <n> or --file <path> to say what to wait on"]);
}

/**
 * Parse one `wait` invocation. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after `wait`
 * @returns the resolved target and timeout, or every problem found
 */
export function parseWaitArgs({ rest }: { rest: readonly string[] }): Result<WaitArgs> {
  const parsed = parseFlags({ args: rest, spec: FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const target = targetOf({ values });
  if (target.isErr()) {
    return err(target.error);
  }
  const options = parseWaitOptions({ values: { ...values, wait: true } });
  if (options.isErr()) {
    return err(options.error);
  }
  return ok({ target: target.value, timeoutSeconds: options.value.timeoutSeconds });
}

/** The reads a wait performs, injectable so a test drives the whole verb without a process or a file. */
export interface WaitDeps {
  readonly clock: WaitClock;
  readonly readPid: (args: { pid: number }) => PidReading;
  readonly readFile: (args: { path: string; contains: string | undefined }) => FileReading;
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

/** How a target is named in every line this verb prints. */
function targetLabel({ target }: { target: WaitTarget }): string {
  if (target.kind === "pid") {
    return `pid ${String(target.pid)}`;
  }
  return target.contains === undefined ? `file ${target.path}` : `file ${target.path} for "${target.contains}"`;
}

/** Wait on a process. */
async function waitOnPid({
  deps,
  pid,
  timeoutSeconds,
}: {
  deps: WaitDeps;
  pid: number;
  timeoutSeconds: number;
}): Promise<number> {
  const label = targetLabel({ target: { kind: "pid", pid } });
  const outcome = await waitUntilSettled({
    ceilingMs: LOCAL_WAIT_CEILING_MS,
    clock: deps.clock,
    emit: deps.out,
    lines: () => [`${label} still running`],
    read: () => Promise.resolve(deps.readPid({ pid })),
    schedule: LOCAL_WAIT_SCHEDULE_MS,
    settled: (reading) => reading.kind === "exited",
    timeoutSeconds,
  });
  if (outcome.kind === "timed-out") {
    deps.out(`WAIT-TIMEOUT ${label} still running after ${String(timeoutSeconds)}s`);
    return EXIT_DEFERRED;
  }
  deps.out(`WAIT-DONE ${label} exited (read ${String(outcome.reads)} time(s))`);
  return EXIT_OK;
}

/** The line an unsettled file reading prints. */
function fileLine({ label, reading }: { label: string; reading: FileReading }): string {
  return reading.kind === "absent" ? `${label}: not there yet` : `${label}: there, without the text yet`;
}

/** Wait on a file. */
async function waitOnFile({
  deps,
  target,
  timeoutSeconds,
}: {
  deps: WaitDeps;
  target: Extract<WaitTarget, { kind: "file" }>;
  timeoutSeconds: number;
}): Promise<number> {
  const label = targetLabel({ target });
  const { path, contains } = target;
  const outcome = await waitUntilSettled({
    ceilingMs: LOCAL_WAIT_CEILING_MS,
    clock: deps.clock,
    emit: deps.out,
    lines: (reading) => [fileLine({ label, reading })],
    read: () => Promise.resolve(deps.readFile({ contains, path })),
    schedule: LOCAL_WAIT_SCHEDULE_MS,
    settled: (reading) => fileSettled({ contains, reading }),
    timeoutSeconds,
  });
  if (outcome.kind === "timed-out") {
    deps.out(`WAIT-TIMEOUT ${fileLine({ label, reading: outcome.reading })} after ${String(timeoutSeconds)}s`);
    return EXIT_DEFERRED;
  }
  if (outcome.reading.kind === "unreadable") {
    deps.error(`wait: ${path} exists but could not be read: ${outcome.reading.reason}`);
    return EXIT_ERROR;
  }
  deps.out(`WAIT-DONE ${label} (read ${String(outcome.reads)} time(s))`);
  return EXIT_OK;
}

/**
 * Run `wait` over injected reads.
 *
 * @param rest the argv tail after `wait`
 * @param deps the clock, the two reads and the output sinks
 * @returns `EXIT_OK` once the target settled, `EXIT_DEFERRED` on a timeout, `EXIT_ERROR` for a file that
 *   exists but cannot be read, `EXIT_USAGE` on a bad flag
 */
export async function runWaitWithDeps({ rest, deps }: { rest: readonly string[]; deps: WaitDeps }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out(WAIT_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWaitArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, WAIT_USAGE].forEach((line) => {
      deps.error(line);
    });
    return EXIT_USAGE;
  }
  const { target, timeoutSeconds } = parsed.value;
  deps.out(`WAIT ${targetLabel({ target })} timeout=${String(timeoutSeconds)}s`);
  return target.kind === "pid"
    ? waitOnPid({ deps, pid: target.pid, timeoutSeconds })
    : waitOnFile({ deps, target, timeoutSeconds });
}

/**
 * The production reads.
 *
 * @returns the real clock, `kill -0`, the file read and the logger
 */
export function productionWaitDeps(): WaitDeps {
  return {
    clock: realWaitClock(),
    error: (line) => {
      logger.error({ msg: line });
    },
    out: (line) => {
      logger.out({ line });
    },
    readFile: readFileForWait,
    readPid,
  };
}

/** `slopweaver wait` — the tail starts at index 3, because `wait` is a bare noun. */
export const waitCommand = defineCommand({
  run: (argv) => runWaitWithDeps({ deps: productionWaitDeps(), rest: argv.slice(3) }),
});
