/**
 * The one way the console runs a `slopweaver` verb: an argv ARRAY, no shell, a hard timeout, stderr kept.
 *
 * All four allowlist routes — the live read (`app/api/live/[verb]`), the sync take (`app/api/sync/[verb]`), the
 * act (`app/api/act/[verb]`) and the Store page's read (`app/api/store/[verb]`) — launch a child exactly this way, so
 * a second copy could not quietly drop the timeout kill, the resolution failure's sentence or the stderr tail.
 *
 * **The binary is the SERVING checkout's, never the inherited `PATH`'s** (`slopweaverBin.ts`, and the
 * `console-verb-binary` gate that keeps it that way). A bare name resolved off `PATH` decided invisibly
 * which checkout's CLI answered every tile, and a figure whose producing tree a reader cannot name is the
 * confident-but-wrong row this whole surface exists to make impossible. What the caller does with the output is its
 * own business: the live route parses and stamps stdout, the sync route discards it because the page
 * re-reads the ledger the verb just appended to, and the act and Store routes read a refusal's stdout off the
 * non-zero arm because a verb that said no in JSON said WHY there.
 *
 * **Every child runs with the launcher-quiet marker** (`launcherQuiet.ts`). The launcher's advisories and the
 * stale-seat warning are notes for a human at a terminal. Here they cost the stale-seat git work on every read
 * before the verb ran, and they were the stderr tail a failure was named by, so a verb that failed with little
 * stderr of its own was reported by an advisory. With the marker, the tail is the verb's own lines, or none.
 *
 * **And pinned to the checkout its binary was resolved from** (`consoleChildEnv`): the launcher runs
 * `${SLOPWEAVER_CLI_DIR:-$PLUGIN_ROOT}`, so the right `bin/slopweaver` alone still let an inherited `PLUGIN_ROOT` run
 * a supervisor worktree's stale build behind every tile (measured in that module).
 *
 * **And marked as a console child**, so a built CLI a pull has just made stale waits for the rebuild and restarts on
 * it rather than refusing — the window that drew "Organisation required" over every console page
 * (`src/builtCli/consoleRebuildWait.ts`). The marker selects waiting, never stale execution.
 */
import { spawn } from "node:child_process";

import { consoleChildEnv } from "./launcherQuiet";
import { slopweaverBin } from "./slopweaverBin";

/** How long a child killed at its bound gets to close, so its stdout drains, before its run resolves anyway. */
const KILL_DRAIN_MS = 1000;

/**
 * How long after its timer is armed a `spawnVerb` call has settled under normal scheduling: the bound, then the drain
 * cap. Not a wall-clock guarantee — a blocked event loop or a sleeping machine delays any timer — and it starts at
 * the arming, after the binary is resolved and the child spawned.
 *
 * @param timeoutMs the bound the call was given
 * @returns the settle time under normal scheduling, in milliseconds
 */
export function spawnSettleBoundMs({ timeoutMs }: { timeoutMs: number }): number {
  return timeoutMs + KILL_DRAIN_MS;
}

/**
 * What one child run came to: its stdout on exit 0, or one stated reason it did not answer.
 *
 * The failure arm keeps what the child wrote and how it exited. A timeout or a launch failure carries no
 * exit code, and that absence is the difference between "the verb refused" and "nobody knows whether the
 * verb ran" — the act route branches on exactly it.
 */
export type SpawnOutcome =
  | {
      readonly ok: true;
      readonly out: string;
      /** What it wrote to stderr on the way to a clean exit — progress, caveats, or a provider's words worth keeping. */
      readonly err: string;
      readonly tookMs: number;
    }
  | {
      readonly ok: false;
      readonly notMeasured: string;
      readonly tookMs: number;
      /** The child's exit code, or `undefined` when it was killed on the timeout or never launched. */
      readonly exitCode: number | undefined;
      readonly out: string;
      readonly err: string;
    };

/**
 * Run one allowlisted verb to completion.
 *
 * Spawned with an argv array and no shell, so there is no interpolation surface at all — every caller has
 * already resolved a slug to a literal argv before anything is launched, and the binary itself is resolved
 * from the serving checkout rather than from `PATH`. stderr is read and kept rather than discarded:
 * several verbs write progress and caveats there, and a non-zero exit whose reason was thrown away turns
 * into a blank tile.
 *
 * **`stdin` is the one way a value too sensitive for argv reaches a verb** — a pasted secret
 * (`app/api/secret`). An argv is visible to every process on the machine through `ps` for the child's whole
 * life; a pipe is read once by the child and by nothing else. Absent, the pipe is closed at once, so it reads empty.
 *
 * @param argv the verb's arguments after `slopweaver`, already literal
 * @param timeoutMs how long the child may run before it is killed and the run reported as not measured
 * @param title the verb line, for the reason a failure names — never a value, since a failure prints it
 * @param stdin what the child reads on its standard input, written whole and then closed
 * @param atCheckoutRoot run the child FROM the checkout its binary was resolved from rather than the server's
 *   cwd, so a verb that resolves its repository off cwd reads the same tree whose code is running — the act-pull
 *   lookup's search, which must name this install's own repository
 * @returns stdout on exit 0, or a stated reason — never a throw
 */
export async function spawnVerb({
  argv,
  timeoutMs,
  title,
  stdin,
  atCheckoutRoot = false,
}: {
  argv: readonly string[];
  timeoutMs: number;
  title: string;
  stdin?: string;
  atCheckoutRoot?: boolean;
}): Promise<SpawnOutcome> {
  const startedAt = Date.now();
  const resolved = slopweaverBin();
  if (!resolved.found) {
    // Named before anything is launched, because there is nothing to launch. The directories that were
    // looked in are the whole answer: the server is running somewhere that is not inside a checkout.
    return {
      err: "",
      exitCode: undefined,
      notMeasured:
        `no \`bin/slopweaver\` in the checkout serving this page; looked in ${resolved.searched.join(", ")}. ` +
        "The console runs the real verbs from the tree it is served out of, so it has to be inside one.",
      ok: false,
      out: "",
      tookMs: Date.now() - startedAt,
    };
  }
  return new Promise<SpawnOutcome>((resolve) => {
    const child = spawn(resolved.bin, [...argv], {
      ...(atCheckoutRoot ? { cwd: resolved.root } : {}),
      env: consoleChildEnv({ env: process.env, root: resolved.root }),
      stdio: "pipe",
    });
    // A child that exits before reading closes the pipe under the write; the exit code is the answer then,
    // so the EPIPE is swallowed rather than allowed to throw out of the server.
    child.stdin.on("error", () => undefined);
    // Closed at once when there is nothing to send, so a verb reading stdin sees end-of-file, as it did from `ignore`.
    if (stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(stdin);
    }
    let out = "";
    let err = "";
    let settled = false;
    let drain: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: SpawnOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      resolve(result);
    };
    const stated = ({ reason, exitCode }: { reason: string; exitCode: number | undefined }): SpawnOutcome => ({
      err,
      exitCode,
      notMeasured: reason,
      ok: false,
      out,
      tookMs: Date.now() - startedAt,
    });
    const timedOut = (): SpawnOutcome =>
      stated({ exitCode: undefined, reason: `${title} did not answer within ${String(timeoutMs / 1000)}s` });
    // Killed at the bound, the child may already have written what it had to say into the pipe without this side
    // having read it yet. Its `close` comes after its stdout has drained, so the outcome waits for that — capped,
    // because a pipe a grandchild inherited need never close — and a report finished before the kill is in `out`.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      drain = setTimeout(() => {
        finish(timedOut());
      }, KILL_DRAIN_MS);
    }, timeoutMs);
    // Decoded per stream, not per chunk, so a character split across two writes arrives whole.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", (cause: NodeJS.ErrnoException) => {
      // ENOENT still deserves its own sentence, but it can no longer mean "not on PATH" — the path was
      // resolved and checked a moment ago. It means the file went away, or is not executable, between the
      // resolution and the launch, so the sentence NAMES the path rather than the mechanism.
      let why = cause.message;
      if (cause.code === "ENOENT") {
        why = `${resolved.bin} could not be launched; it resolved a moment ago, so it has moved or lost its execute bit`;
      }
      finish(stated({ exitCode: undefined, reason: why }));
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (drain !== undefined) {
        finish(timedOut());
        return;
      }
      if (code !== 0) {
        // A null code is a kill by signal, which is the outcome-unknown arm; it is named rather than coalesced.
        let exitCode: number | undefined;
        if (code !== null) {
          exitCode = code;
        }
        finish(stated({ exitCode, reason: closedReason({ code, err, signal, title }) }));
        return;
      }
      finish({ err, ok: true, out, tookMs: Date.now() - startedAt });
    });
  });
}

/**
 * The sentence a child that closed without succeeding is reported by: its exit code, or the signal that killed it,
 * then its last three stderr lines.
 *
 * A child killed by a signal has no exit code, and printing that absence as "exited null" told nobody what
 * happened. When the console's own rebuild signals its server's whole tree while `talk offer`
 * is composing a call, /talk reads "talk offer … exited null", as if the verb had failed.
 *
 * @param title the verb line the sentence opens with
 * @param code the exit code `close` reported, `null` when a signal ended the child
 * @param signal the signal `close` reported, `null` when the child exited on its own
 * @param err everything the child wrote to stderr
 * @returns one sentence naming how it ended
 */
export function closedReason({
  title,
  code,
  signal,
  err,
}: {
  title: string;
  code: number | null;
  signal: string | null;
  err: string;
}): string {
  const tail = err.trim().split("\n").slice(-3).join(" · ");
  let how = `exited ${String(code)}`;
  if (code === null) {
    how =
      signal === null ? "ended with neither an exit code nor a signal" : `was killed by ${signal} before it answered`;
  }
  return `${title} ${how}${tail === "" ? "" : `: ${tail}`}`;
}
