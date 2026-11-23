/**
 * The one way this repository loads `node:sqlite`: dynamically, and without its `ExperimentalWarning`.
 *
 * Two readers open another app's SQLite file read-only — Chrome's cookie jar (`../browser/cookieJar.ts`) and
 * Codex's thread history (`../store/fleet/codexMessageSource.ts`) — and neither should print a warning on a verb
 * whose output is one status line, or put `node:sqlite` on the import graph of every verb that never opens one.
 */
import type * as NodeSqlite from "node:sqlite";

/**
 * Import `node:sqlite` without its `ExperimentalWarning` reaching the operator's terminal.
 *
 * The warning is emitted once, at first import, from Node's default `warning` listener, so the only way to stop
 * it is to take that listener off for the duration of the import — every other listener is captured and put
 * back, so a genuine warning raised later still prints exactly as it would have.
 *
 * @returns the `node:sqlite` module
 */
export async function importSqliteQuietly(): Promise<typeof NodeSqlite> {
  const previous = process.listeners("warning");
  process.removeAllListeners("warning");
  try {
    return await import("node:sqlite");
  } finally {
    process.removeAllListeners("warning");
    for (const listener of previous) {
      process.on("warning", listener);
    }
  }
}
