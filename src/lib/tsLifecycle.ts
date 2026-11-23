/**
 * The one process-wide close for every TypeScript client a seam opens.
 *
 * On TypeScript 7.1 a seam's client is a Go server spoken to over a pipe (`typescript/sync`). Its FORCED death
 * needs nothing from here: the server exits on stdin EOF when its Node owner dies by any signal. What this module owns is the NORMAL path — a process that finishes its work closes its
 * clients deterministically before it exits, rather than leaving the server to notice the closed pipe.
 *
 * Three owners call {@link closeTypeScript}: `runCliProcess` (`src/cli/main.ts`) after pending effects and before
 * drain and exit, `runGateEntry` (`src/devLint/gateEntry.ts`) around every lint gate, and the shared Vitest setup
 * (`src/__tests__/setup-typescript-lifecycle.ts`) after each test file. It is never called from `main`, which
 * other verbs reach in-process and which does not own the process's lifetime.
 *
 * Behind those three sits one backstop: the first registration arms {@link closeTypeScript} on Node's `exit` event,
 * which fires on a `process.exit` from anywhere — a module's own top level, a callback deep in a verb — and on an
 * uncaught exception. So a process that ever opened a client closes it however it ends short of a signal, even where
 * no owner's `finally` was reached. On the normal path an owner has already closed, and the second close of an empty
 * registry does nothing.
 *
 * The residue, stated: an `exit` listener PREPENDED after the backstop arms runs ahead of it, and if that listener
 * throws, Node stops dispatching and the backstop never runs. No ordering of our own can beat a listener added
 * later. It costs the deterministic close only, never the server: the server still exits on its stdin's EOF when
 * this process dies, as on the forced path above. And a closer must return: one that ends the process itself skips
 * every closer after it and replaces the code the process was ending with. Every closer registered here is a seam's
 * own client close, which ends nothing.
 *
 * Each seam registers its client's close at the moment it starts that client, never at import, and forgets the
 * client when it closes, so a later use starts a fresh one — {@link lazyTypeScriptClient} is that getter. This module imports no TypeScript, on purpose: the CLI
 * entry loads it on every invocation, and a board read must load no compiler.
 */

const closers = new Set<() => void>();

/** Whether the exit-event backstop is armed. Once per process: a reused test worker keeps the one it armed. */
let armedOnExit = false;

/**
 * The backstop Node's `exit` event runs. A failed close is reported on stderr rather than thrown, because a throw
 * from inside `exit` would replace the code the process was already ending with.
 */
function closeAtExit(): void {
  try {
    closeTypeScript();
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/**
 * Register one TypeScript client's synchronous closer. Registering the same function twice holds it once. The
 * first registration also arms the exit-event backstop (see the module header).
 *
 * @param close closes that client; called at most once per registration
 * @returns an idempotent function that removes this registration without closing anything
 */
export function registerTypeScriptCloser({ close }: { close: () => void }): () => void {
  if (!armedOnExit) {
    armedOnExit = true;
    // Prepended: an exit listener that throws stops every listener after it, so the close goes first. Permanent, not
    // once: a hand-emitted `exit` that ends nothing must not spend it, and a close of an empty registry does nothing.
    process.prependListener("exit", closeAtExit);
  }
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}

/**
 * A seam's client getter: the first call opens the client and registers its close at that same moment, later calls
 * answer the same client, and a closed client is forgotten so the next call opens a fresh one (a reused test worker).
 * Generic over the client so this module still imports no TypeScript.
 *
 * @param open starts one client; called again only after the previous one was closed
 * @returns the getter a seam calls before every use
 */
export function lazyTypeScriptClient<C extends { close: () => void }>({ open }: { open: () => C }): () => C {
  let client: C | undefined;
  return () => {
    if (client !== undefined) {
      return client;
    }
    const opened = open();
    client = opened;
    registerTypeScriptCloser({
      close: () => {
        if (client === opened) {
          client = undefined;
        }
        opened.close();
      },
    });
    return opened;
  };
}

/**
 * Close every registered TypeScript client and clear the registry. The registry is cleared BEFORE any closer
 * runs, so a second call does nothing even after the first one threw. Every closer runs even when an earlier
 * one throws; the failures are thrown afterwards as one `AggregateError`, in the order they happened.
 */
export function closeTypeScript(): void {
  const pending = [...closers];
  closers.clear();
  const failures: unknown[] = [];
  for (const close of pending) {
    try {
      close();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${String(failures.length)} TypeScript client closer(s) failed`);
  }
}
