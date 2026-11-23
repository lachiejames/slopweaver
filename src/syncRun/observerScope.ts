/**
 * The one hook a refresh run installs so every bronze commit and every connector heartbeat inside it reaches the
 * sync-run ledger, without threading a parameter through each connector.
 *
 * A scope rather than a parameter because the seams are many and keep growing: Slack, GitHub and Linear commit per
 * container through their own committers, Notion, Gmail, Calendar and Fathom each commit mid-crawl through
 * `writeCorpusRecords`, and the closing bulk write commits whatever is left. A parameter would have to reach all of
 * them, and the one a new connector forgot would be the one whose card read "nothing new" for a run that wrote
 * thousands. Every commit already funnels through `createBronzeCommitter` — the same reason the sync denylist lives
 * there — so the observer is read there, and a new connector is observed by existing.
 *
 * Async-local, so two refreshes in one process (a test file, a caller importing the verb) each see only their own run.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { SourceProgressEvent } from "../corpus/progress.js";
import type { CorpusRecord } from "../corpus/types.js";

/** What a run's recorder is told. Both callbacks are fire-and-forget: a recorder never fails a write. */
export interface SyncRunObserver {
  /** One commit returned: everything it was offered after the denylist, and the subset it appended. */
  readonly commit: (args: { offered: readonly CorpusRecord[]; written: readonly CorpusRecord[] }) => void;
  /** One connector heartbeat, as the connector emitted it. */
  readonly progress: (args: { event: SourceProgressEvent }) => void;
}

const scope = new AsyncLocalStorage<SyncRunObserver>();

/**
 * Run `body` with `observer` installed for everything it awaits.
 *
 * @param observer the run's recorder
 * @param body the work to observe
 * @returns whatever `body` returns
 */
export function withSyncRunObserver<T>({ observer, body }: { observer: SyncRunObserver; body: () => T }): T {
  return scope.run(observer, body);
}

/**
 * The observer installed for the current async context, or `undefined` outside a refresh run — a test, a
 * `compact`, any writer that is not a sync.
 *
 * @returns the observer, when one is installed
 */
export function currentSyncRunObserver(): SyncRunObserver | undefined {
  return scope.getStore();
}
