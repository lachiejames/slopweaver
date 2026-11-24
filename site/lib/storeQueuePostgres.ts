/**
 * The console server's store connection for the Queue's change push: the one module in `site/` that opens Postgres.
 * It selects the store exactly as the CLI does (`./storeQueueCore.ts`), opens a Postgres.js client in this process,
 * and runs the listen loop (`./storeQueueWatch.ts`) over it until the broker aborts or the store stops answering.
 *
 * In-process rather than a `slopweaver store watch-queue` child on purpose: the console server holds no long-lived
 * child process (AGENTS.md rule 2, the `no-headless` gate). The connection string is read here, handed to the driver,
 * and never logged, returned, or put in an event.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "neverthrow";
import postgres from "postgres";

import { consoleStoreUrlSecret } from "./consoleHome";
import {
  STORE_QUEUE_CHANNEL,
  STORE_QUEUE_HEARTBEAT_MS,
  type StoreQueueEvent,
  type StoreQueueSelectionError,
  selectStoreQueueUrl,
} from "./storeQueueCore";
import { type StoreQueueWatchError, watchStoreQueue } from "./storeQueueWatch";

/** The store-url secret exists but could not be read. */
export interface StoreSecretUnreadableError {
  readonly code: "STORE_SECRET_UNREADABLE";
  readonly message: string;
}

/** Why the console's store listener ended other than by the broker's abort. */
export type ConsoleStoreQueueError = StoreQueueSelectionError | StoreQueueWatchError | StoreSecretUnreadableError;

/** How long the driver may take to connect before the attempt counts as failed, in seconds. */
const CONNECT_TIMEOUT_S = 30;

/** How long an end waits for in-flight queries before destroying the connections, in seconds. */
const END_TIMEOUT_S = 5;

/** Read the store-url secret: its text, `undefined` when there is no such file, or the failure to read one there. */
function readStoreUrlSecret({ path }: { path: string }): Result<string | undefined, StoreSecretUnreadableError> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok(undefined);
    }
    return err({
      code: "STORE_SECRET_UNREADABLE",
      message: `secrets/store-url could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/** Wait `ms`, or less when `signal` aborts first. */
async function abortableDelay({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Listen to this console's store until `signal` aborts or the store stops answering.
 *
 * The connection is ended the moment `signal` aborts, not when the loop next looks: a round trip to a store that has
 * stopped answering never settles on its own, and ending the connection is what rejects it. The returned promise
 * settles only once the connection is ended, so a caller that waits on it never has two open at once.
 *
 * @param signal the broker's abort for this listener
 * @param emit where each event goes
 * @param home the state home whose secret is read; this console's own by default
 * @returns `ok` when aborted, else why it ended
 */
export async function watchConsoleStoreQueue({
  signal,
  emit,
  home,
}: {
  signal: AbortSignal;
  emit: (event: StoreQueueEvent) => void;
  home?: string;
}): Promise<Result<null, ConsoleStoreQueueError>> {
  const secret = readStoreUrlSecret({ path: consoleStoreUrlSecret(home === undefined ? {} : { home }) });
  if (secret.isErr()) {
    return err(secret.error);
  }
  const selected = selectStoreQueueUrl({
    environmentValue: process.env["SLOPWEAVER_STORE_URL"],
    secretValue: secret.value,
  });
  if (selected.isErr()) {
    return err(selected.error);
  }
  const sql = postgres(selected.value, {
    connect_timeout: CONNECT_TIMEOUT_S,
    max: 1,
    onnotice: () => undefined,
  });
  let ended: Promise<void> | undefined;
  const end = (): Promise<void> => {
    // An end that fails leaves nothing to retry: the driver has already destroyed the sockets by its timeout, and
    // the listener's end is decided whichever way this settles.
    ended ??= sql.end({ timeout: END_TIMEOUT_S }).catch(() => undefined);
    return ended;
  };
  const onAbort = (): void => {
    void end();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await watchStoreQueue({
      delay: abortableDelay,
      emit,
      heartbeatMs: STORE_QUEUE_HEARTBEAT_MS,
      nowMs: Date.now,
      port: {
        installedTriggers: async () =>
          sql<{ table: string; name: string }[]>`select c.relname as "table", t.tgname as "name"
            from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
            where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled = 'A'`,
        listen: async ({ onNotify, onReady }) => sql.listen(STORE_QUEUE_CHANNEL, onNotify, onReady),
      },
      signal,
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
    await end();
  }
}
