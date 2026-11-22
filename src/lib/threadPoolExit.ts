/**
 * The CLI's exit: wait until every thread-pool request in flight when the exit began has finished, then
 * `process.exit` — and when one never does, say what it is and end the process anyway, because `process.exit`
 * itself would never return.
 *
 * Node's exit handler shuts libuv down before it ends the process, and that shutdown JOINS every thread-pool thread.
 * A thread blocked in a syscall that never returns — an `open` of a FIFO with no writer, a `getaddrinfo` the resolver
 * never answers, a read on a wedged mount — is joined forever: no CPU, no child, and an event loop that no longer
 * services its sockets, so a parked keep-alive connection to GitHub sits in `CLOSED` with its descriptor still open.
 * That is exactly what `github merge --admin --dry-run` once showed for ten minutes after printing its last line.
 * MEASURED on node 24.21.0, darwin: `mkfifo p`, then `fs.readFile("p", cb)` and `process.exit(0)` 300 ms later —
 * "calling process.exit" printed and the process was still alive minutes on, until a SIGTERM. Reproduce with
 * `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/lib/threadPoolExit.test.ts`.
 *
 * The wait tracks request IDENTITY, never whether the pool is empty, because the two differ exactly where it
 * matters. `process.exit` joins only what is in flight at the instant it is called: no JavaScript runs once the join
 * has started, so a chain of finite requests — a directory walk, a retry loop — ends with the request in flight.
 * A wait that polls instead keeps the event loop turning, the chain keeps issuing, and "the pool is empty" never
 * comes. OBSERVED: a `codex review` run from source answered 0, an emptiness wait still saw an `FSReqCallback` ten
 * seconds on, and killed it with status 137. tsx walks its whole transform cache in the background on every source
 * run, one finite directory read after another, and that cache held 1,321,143 entries
 * (`ls -f "$TMPDIR/tsx-501" | wc -l`). So the wait snapshots the requests in flight when it begins and exits once
 * none of THOSE is still pending.
 *
 * That costs nothing a plain exit would not already have paid: a finite request in that snapshot holds
 * `process.exit` just as long, inside the join. Only an endless one changes the outcome, and there no ordering of
 * our own can help — a request already running cannot be cancelled. Past {@link THREAD_POOL_EXIT_WAIT_MS} the
 * process names the requests on stderr, synchronously, and ends itself with `SIGKILL`. Its status is then 137, not
 * the verb's own code, and the line says which code the verb answered: a caller judging the run by its exit status
 * reads a failure rather than waiting forever, which is the safe direction for a landing verb, and the line is what
 * tells a merge that DID land apart from one that did not.
 *
 * What the bound covers is stated, and only that. It covers the fs requests (callback and promise) and DNS
 * lookups in flight when the exit began — measured as the requests that can block without end. A request a
 * callback STARTS during the wait is joined by `process.exit` exactly as before, so one of those blocking forever
 * still hangs. A pool job of crypto or zlib is not a listed request at all: an async `pbkdf2` still computing
 * when the verb returns holds `process.exit` for as long as it computes, as it always did — finite CPU work with
 * the process visibly busy, a different failure from the one this module removes.
 *
 * The CLOSED socket in that incident was a bystander, not the cause: a socket, ref'd or not, cannot hold an explicit
 * `process.exit`. The request that run left pending was not captured — the only reading taken was `lsof -i`, which
 * lists network descriptors alone — so this module removes the hang for every such request, and its line names the
 * request's kind the next time one is left behind.
 */
import { errExact } from "./logger.js";

/**
 * How long the exit waits for the requests in flight when it began before it gives up on them. A policy ceiling,
 * not a measured latency: a pending request on a regular file or a healthy resolver settles in milliseconds.
 */
export const THREAD_POOL_EXIT_WAIT_MS = 10_000;

/** How often the wait looks again. Short, because the common case is a request that has already settled. */
const THREAD_POOL_EXIT_POLL_MS = 25;

/**
 * The constructor names of the thread-pool requests that can block in a syscall without end. Measured on node
 * 24.21.0 by starting each one and reading `process.getActiveResourcesInfo()`, which names a request by the same
 * class: `fs.readFile` gives `FSReqCallback`, `fs/promises` gives `FSReqPromise`, `dns.lookup` gives
 * `GetAddrInfoReqWrap`; `dns.lookupService` is its sibling. Async `pbkdf2` and `gzip` added nothing to the list.
 * Reproduce: `mkfifo p && node -e 'require("fs").readFile("p", () => {}); require("dns").lookup("localhost",
 * () => {}); console.log(process.getActiveResourcesInfo()); process.kill(process.pid, "SIGKILL")'`.
 */
const THREAD_POOL_REQUEST_NAMES: ReadonlySet<string> = new Set([
  "FSReqCallback",
  "FSReqPromise",
  "GetAddrInfoReqWrap",
  "GetNameInfoReqWrap",
]);

/**
 * The thread-pool requests among Node's in-flight requests, in the order Node gave them. A socket's write or
 * shutdown request is passed over: `process.exit` never waits on one.
 *
 * @param requests what `process._getActiveRequests()` answered
 * @returns only the thread-pool requests, the same objects
 */
export function threadPoolRequests({ requests }: { requests: readonly object[] }): readonly object[] {
  return requests.filter((request) => THREAD_POOL_REQUEST_NAMES.has(request.constructor.name));
}

/**
 * The requests from `initial` that are still in flight — the same objects, not merely the same kind.
 *
 * @param initial the thread-pool requests in flight when the exit began
 * @param current every request in flight now
 * @returns the members of `initial` still present in `current`
 */
export function stillInFlight({
  current,
  initial,
}: {
  current: readonly object[];
  initial: readonly object[];
}): readonly object[] {
  const now = new Set(current);
  return initial.filter((request) => now.has(request));
}

/**
 * The one stderr line for an exit the pool never let happen.
 *
 * @param code the exit code the verb itself answered
 * @param pending the class name of each thread-pool request still in flight
 * @param waitedMs how long the exit waited for them
 * @returns the line, without its newline
 */
export function stuckExitLine({
  code,
  pending,
  waitedMs,
}: {
  code: number;
  pending: readonly string[];
  waitedMs: number;
}): string {
  const named = [...new Set(pending)]
    .map((name) => `${name} x${String(pending.filter((entry) => entry === name).length)}`)
    .join(", ");
  return (
    `exit: libuv's thread pool still holds ${named} after ${String(waitedMs / 1_000)}s. Node joins that pool inside ` +
    `process.exit, so exiting would wait on it forever; ending this process with SIGKILL instead. ` +
    `The verb itself answered exit code ${String(code)}.`
  );
}

/** The process edges the exit runs through; a test passes plain functions. */
export interface ThreadPoolExitSeams {
  /** Every request Node has in flight, as the objects themselves, so two readings can be compared by identity. */
  readonly activeRequests: () => readonly object[];
  readonly nowMs: () => number;
  readonly sleep: (args: { ms: number }) => Promise<void>;
  /** Writes one line to stderr and returns only once it is written: a SIGKILL follows. */
  readonly writeError: (args: { line: string }) => void;
  readonly exit: (code: number) => void;
  readonly kill: () => void;
}

/**
 * Node's own list of in-flight requests. Undocumented and never removed, and chosen over both documented routes:
 * `process.getActiveResourcesInfo()` gives only names, and a name cannot tell one request still blocked from the
 * next request in a chain; `async_hooks` gives identities only for what it saw START, so it would have to run for
 * every verb's whole life to know what is in flight at exit, and enabled at exit alone it can only subtract newer
 * requests from a count — while Node emits their `destroy` hooks late, in a later tick, so the count would read
 * LOW and the exit would fire over a request still blocked, the one outcome this module exists to prevent. Present
 * on the pinned node (`grep -a -o "process._getActiveRequests = [A-Za-z_]*" "$(command -v node)"`); the subprocess
 * lane asserts it sees real requests by these names, and that its absence throws rather than reading as none.
 *
 * @returns every in-flight request object
 * @throws when this Node no longer has the accessor — the exit cannot see the pool, and saying so beats guessing
 */
function nodeActiveRequests(): readonly object[] {
  const accessor: unknown = Reflect.get(process, "_getActiveRequests");
  if (typeof accessor !== "function") {
    throw new TypeError("process._getActiveRequests is gone from this Node, so the CLI exit cannot see the pool");
  }
  const requests: unknown = Reflect.apply(accessor, process, []);
  if (!Array.isArray(requests)) {
    throw new TypeError("process._getActiveRequests answered something other than a list");
  }
  return requests.filter((request): request is object => typeof request === "object" && request !== null);
}

/**
 * The real process: its own in-flight requests, clock and timers, a synchronous stderr write, `process.exit` and a
 * `SIGKILL` to itself.
 *
 * @returns the production seams
 */
export function productionThreadPoolExitSeams(): ThreadPoolExitSeams {
  return {
    activeRequests: nodeActiveRequests,
    exit: (code) => {
      process.exit(code);
    },
    kill: () => {
      process.kill(process.pid, "SIGKILL");
    },
    nowMs: () => Date.now(),
    sleep: ({ ms }) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    writeError: ({ line }) => {
      errExact({ text: `${line}\n` });
    },
  };
}

/**
 * Exit with `code` once every thread-pool request in flight at the call has finished, or name the ones still in
 * flight and end the process when they outlast `waitMs`. See the module header for why it tracks those requests by
 * identity rather than waiting for an empty pool.
 *
 * @param code the verb's exit code
 * @param seams the process edges; omitted, the real process
 * @param waitMs how long to wait for those requests; omitted, {@link THREAD_POOL_EXIT_WAIT_MS}
 */
export async function exitWhenThreadPoolQuiet({
  code,
  seams = productionThreadPoolExitSeams(),
  waitMs = THREAD_POOL_EXIT_WAIT_MS,
}: {
  code: number;
  seams?: ThreadPoolExitSeams;
  waitMs?: number;
}): Promise<void> {
  const started = seams.nowMs();
  const initial = threadPoolRequests({ requests: seams.activeRequests() });
  let held = initial;
  while (held.length > 0 && seams.nowMs() - started < waitMs) {
    await seams.sleep({ ms: THREAD_POOL_EXIT_POLL_MS });
    held = stillInFlight({ current: seams.activeRequests(), initial });
  }
  if (held.length === 0) {
    seams.exit(code);
    return;
  }
  seams.writeError({
    line: stuckExitLine({ code, pending: held.map((request) => request.constructor.name), waitedMs: waitMs }),
  });
  seams.kill();
}
