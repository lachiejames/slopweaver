/**
 * Wait until every byte already handed to `process.stdout` and `process.stderr` has reached the kernel, so
 * the `process.exit` that follows discards nothing.
 *
 * `process.stdout.write` is ASYNCHRONOUS when the stream is a pipe: it gives the kernel what the pipe buffer
 * takes and keeps the rest in Node's own queue, and `process.exit` throws that queue away. `logger.out` is
 * immune (`./logger.ts`'s `writeAllSync`), and the `stdout-data-channel` gate keeps every verb under
 * `src/cli/` on it — but the modules a verb CALLS are outside that gate, and the hygiene scan and the dev
 * gate both write through the stream. So `slopweaver dev gate | tail` ended mid-line inside the hygiene
 * listing, with no `dev gate: PASS|FAIL` and no reason: exactly where a red PR gate is read. MEASURED on
 * a pull request whose CI log ended at `src/__tests__` then exit 1.
 *
 * The barrier is an EMPTY write: a Writable queues it behind every earlier chunk and calls it back only once
 * they are flushed. MEASURED on node 24.21.0, darwin — 300,001 bytes to each stream, then an
 * 8-byte verdict, then exit, piped `2>&1 | wc -c`: 196,608 of 600,010 bytes arrive without it, all 600,010
 * with it. Reproduce with `yarn vitest run --config config/vitest/subprocess.ts
 * src/__tests__/subprocess/lib/drainStdio.test.ts`.
 *
 * **The `error` listener stays installed on purpose.** Behind a reader that closed early (`| head -c 1`)
 * the write's callback receives `EPIPE` first and the stream emits `error` on a LATER tick. A listener
 * removed in that callback leaves the event unhandled — `Unhandled 'error' event … write EPIPE`, exit 1 from
 * a verb that returned 0 — measured on the first draft of this function. The process exits right after, so
 * a listener left behind costs nothing.
 *
 * There is deliberately no timeout: a reader that stops consuming blocks the exit visibly, the stance
 * `writeAllSync` takes, because exiting with a prefix is the worse failure.
 *
 * Only `runCliProcess` and the hygiene entry drain today. The other `*.entry.ts` gates and `admit/*Cli.ts`
 * still call `process.exit` directly; their output is short, and any that grows past one pipe buffer has
 * this same class.
 */

/**
 * Resolve once every stream has flushed what was written to it before this call, or has failed.
 *
 * @param streams what to drain; omitted, the process's own stdout and stderr
 * @returns a promise that settles when every stream is flushed or errored — it never rejects, because a
 *   reader that went away has nothing left to lose and the exit code must stay the verb's own
 */
export async function drainStdio({
  streams = [process.stdout, process.stderr],
}: {
  streams?: readonly NodeJS.WritableStream[];
} = {}): Promise<void> {
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((resolve) => {
          const settle = (): void => {
            resolve();
          };
          stream.on("error", settle);
          stream.write("", settle);
        }),
    ),
  );
}
