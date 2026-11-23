/**
 * The guarantee that a walk's connect tab closes even when the walk does not finish.
 *
 * ## The defect this closes, and why it was not a call-site bug
 *
 * A walk opens exactly one tab — the relay's `connect.html` page — and `release` closes it. MEASURED
 * on this tree: twelve `transport.release()` call sites, and NOT ONE of them sat in a `finally`.
 * Every one was a straight-line statement on the happy path, so a thrown error, a visit timeout or a
 * Ctrl-C between attach and release stranded the tab in the owner's own browser. That is the mechanism
 * behind the four stacked `Playwright · Claude` tabs the owner once screenshotted while trying to read
 * something else. Reproduce the shape on any branch:
 *
 * ```sh
 * grep -rn "transport.release()" src --include="*.ts" | grep -v __tests__
 * ```
 *
 * Wrapping each of those twelve in a `try`/`finally` was the obvious fix and is the weaker one, for two
 * reasons that are the whole argument for this file. It covers a throw and nothing else — a `finally` does
 * not run when the process takes SIGINT, which is how a walk most often ends early, by the owner's own hand. And it
 * is a rule twelve places have to remember, so the thirteenth walk written next month reintroduces the
 * defect exactly the way the last twelve did. The lifetime belongs to whatever OWNS the tab, and that is
 * the transport, which is one place.
 *
 * ## Why the close may be synchronous, and must be
 *
 * A `process.on("exit")` handler cannot await anything — the event loop is already done, and a promise
 * created there never settles. `closeOwnedTab` is `execFileSync` throughout and swallows its own failures
 * by construction, so it is already the right shape to run from one. That is not a coincidence to rely on
 * silently: {@link OwnedTabClose} is typed as returning `void` so a future asynchronous rewrite of the
 * close path fails to compile here rather than becoming a handler that silently does nothing.
 *
 * ## What it deliberately does not cover
 *
 * `SIGKILL` and a power cut. Neither is catchable in any process, so a tab can still be stranded — the
 * honest bound is "every ending the process is told about", not "every ending".
 */

/**
 * The tab-closing work a dying process must still run.
 *
 * Synchronous on purpose — see this file's overview.
 */
type OwnedTabClose = () => void;

/** The subset of Node's process this guard touches, injected so the registry is testable without one. */
export interface GuardedProcess {
  readonly on: ({ event, handler }: { event: string; handler: () => void }) => void;
  readonly off: ({ event, handler }: { event: string; handler: () => void }) => void;
  readonly exit: ({ code }: { code: number }) => void;
}

/**
 * The endings a process is told about, and the exit code each one owes its shell.
 *
 * `exit` carries no code because the process already has one; the signals do, because a handled signal no
 * longer terminates the process on its own and a walk that swallowed Ctrl-C and reported success would be
 * a worse defect than the leak this file closes. 128 + the signal number is the shell's own convention.
 *
 * @internal
 */
export const GUARDED_ENDINGS: readonly { readonly event: string; readonly code: number | null }[] = [
  { code: null, event: "exit" },
  { code: 130, event: "SIGINT" },
  { code: 143, event: "SIGTERM" },
];

/**
 * Register a tab close against every ending the process is told about.
 *
 * The close runs AT MOST ONCE however many endings fire — a release followed by a normal exit is the
 * common path, and closing a tab twice would spawn a second client against a relay that has already let go.
 *
 * @param close the synchronous tab close to guarantee
 * @param guarded the process to register against
 * @returns a disposer that unregisters every handler and spends the close, for a walk that released cleanly
 */
export function guardOwnedTab({ close, guarded }: { close: OwnedTabClose; guarded: GuardedProcess }): () => void {
  let spent = false;
  const registered: readonly { readonly event: string; readonly handler: () => void }[] = GUARDED_ENDINGS.map(
    (ending) => ({
      event: ending.event,
      handler: (): void => {
        if (!spent) {
          spent = true;
          close();
        }
        if (ending.code !== null) {
          guarded.exit({ code: ending.code });
        }
      },
    }),
  );
  registered.forEach((entry) => {
    guarded.on({ event: entry.event, handler: entry.handler });
  });
  return (): void => {
    spent = true;
    registered.forEach((entry) => {
      guarded.off({ event: entry.event, handler: entry.handler });
    });
  };
}

/**
 * The real process, adapted to {@link GuardedProcess}.
 *
 * Here rather than inline at the call site so the transport names one dependency instead of reaching for a
 * global, and so a test never has to touch the actual process to exercise the transport.
 *
 * @returns the running process behind the guard's own interface
 */
export function nodeProcessGuard(): GuardedProcess {
  return {
    exit: ({ code }: { code: number }): void => {
      process.exit(code);
    },
    off: ({ event, handler }: { event: string; handler: () => void }): void => {
      process.off(event, handler);
    },
    on: ({ event, handler }: { event: string; handler: () => void }): void => {
      process.on(event, handler);
    },
  };
}
