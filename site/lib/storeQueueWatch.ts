/**
 * The console server's store listen loop, over a port the Postgres adapter (`./storeQueuePostgres.ts`) fills and a
 * test scripts: check every notify trigger is installed, hold a `LISTEN` on the Queue channel, and prove the store
 * still answers with a real round trip every interval, until a round trip fails or the caller aborts. Each round trip
 * re-reads the triggers, so one dropped or disabled while listening ends the loop at the next heartbeat.
 *
 * Two behaviours are what make a quiet listener trustworthy, and both are here rather than in the broker:
 *
 * - **`ready` follows every established `LISTEN`, not only the first.** Postgres.js re-establishes a dropped `LISTEN`
 *   connection on its own and never replays a notification committed while it was down, and the heartbeat rides a
 *   different connection, so it stays green through that gap. The port's `onReady` runs on each (re)established
 *   `LISTEN`, so the broker hears `ready` again and re-reads every store-kept register: that is the catch-up.
 * - **A store lacking a trigger never says `ready`.** A listener on a store that never notifies would report the
 *   Queue current while it went stale, so the trigger check comes first and a missing one ends the loop before
 *   `LISTEN`.
 */
import { err, ok, type Result } from "neverthrow";

import { missingStoreQueueTriggers, type StoreQueueEvent, storeQueueSlugOf } from "./storeQueueCore";

/** What the loop needs from a store connection; the adapter's is Postgres.js, a test's is a script. */
export interface StoreQueuePort {
  /** Every trigger the store reports enabled ALWAYS, by table and name: one real round trip to the store. */
  readonly installedTriggers: () => Promise<readonly { table: string; name: string }[]>;
  /** Hold the `LISTEN`; `onReady` runs on the first established one and on every re-established one. */
  readonly listen: (handlers: {
    onNotify: (payload: string) => void;
    onReady: () => void;
  }) => Promise<{ unlisten: () => Promise<void> }>;
}

/** The store's triggers could not be read. */
export interface TriggerReadFailedError {
  readonly code: "TRIGGER_READ_FAILED";
  readonly message: string;
}

/** The store lacks a notify trigger, so listening would hear nothing for the registers it covers. */
export interface TriggersMissingError {
  readonly code: "TRIGGERS_MISSING";
  readonly message: string;
  readonly missing: readonly string[];
}

/** The `LISTEN` could not be opened. */
export interface ListenFailedError {
  readonly code: "LISTEN_FAILED";
  readonly message: string;
}

/** A heartbeat's round trip failed: the store stopped answering. */
export interface HeartbeatFailedError {
  readonly code: "HEARTBEAT_FAILED";
  readonly message: string;
}

/** Why a listen loop ended other than by its caller's abort. */
export type StoreQueueWatchError =
  TriggerReadFailedError | TriggersMissingError | ListenFailedError | HeartbeatFailedError;

/** A cause's own message, never a connection string: the driver's errors name the host at most. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The loop's refusals. */
export const StoreQueueWatchErrors = {
  heartbeatFailed: ({ cause }: { cause: unknown }): HeartbeatFailedError => ({
    code: "HEARTBEAT_FAILED",
    message: `the store stopped answering: ${causeText({ cause })}`,
  }),
  listenFailed: ({ cause }: { cause: unknown }): ListenFailedError => ({
    code: "LISTEN_FAILED",
    message: `the store's LISTEN could not open: ${causeText({ cause })}`,
  }),
  triggerReadFailed: ({ cause }: { cause: unknown }): TriggerReadFailedError => ({
    code: "TRIGGER_READ_FAILED",
    message: `the store's triggers could not be read: ${causeText({ cause })}`,
  }),
  triggersMissing: ({ missing }: { missing: readonly string[] }): TriggersMissingError => ({
    code: "TRIGGERS_MISSING",
    message: `the store lacks ${missing.length} notify trigger(s): ${missing.join(", ")}; \`slopweaver store push\` installs them`,
    missing,
  }),
} as const;

/**
 * Listen to the store until a round trip fails, a trigger goes missing, or `signal` aborts.
 *
 * @param port the store connection's operations
 * @param signal aborts the loop; an abort is a clean end, whatever was in flight
 * @param emit where each event goes
 * @param heartbeatMs the round-trip interval
 * @param delay waits the interval, or less when the signal aborts first
 * @param nowMs the clock a heartbeat is stamped with
 * @returns `ok` when the caller aborted, else the failure that ended it
 */
export async function watchStoreQueue({
  port,
  signal,
  emit,
  heartbeatMs,
  delay,
  nowMs,
}: {
  port: StoreQueuePort;
  signal: AbortSignal;
  emit: (event: StoreQueueEvent) => void;
  heartbeatMs: number;
  delay: (wait: { ms: number; signal: AbortSignal }) => Promise<void>;
  nowMs: () => number;
}): Promise<Result<null, StoreQueueWatchError>> {
  // Read through a call, never the property: the signal aborts during an await, which a narrowed property hides.
  const aborted = (): boolean => signal.aborted;
  let installed: readonly { table: string; name: string }[];
  try {
    installed = await port.installedTriggers();
  } catch (cause) {
    return aborted() ? ok(null) : err(StoreQueueWatchErrors.triggerReadFailed({ cause }));
  }
  const missing = missingStoreQueueTriggers({ installed });
  if (missing.length > 0) {
    return err(StoreQueueWatchErrors.triggersMissing({ missing }));
  }
  if (aborted()) {
    return ok(null);
  }
  let listening: { unlisten: () => Promise<void> };
  try {
    listening = await port.listen({
      onNotify: (payload) => {
        const slug = storeQueueSlugOf({ payload });
        if (slug !== undefined && !aborted()) {
          emit({ kind: "changed", slug });
        }
      },
      onReady: () => {
        if (!aborted()) {
          emit({ kind: "ready" });
        }
      },
    });
  } catch (cause) {
    return aborted() ? ok(null) : err(StoreQueueWatchErrors.listenFailed({ cause }));
  }
  try {
    while (!aborted()) {
      let current: readonly { table: string; name: string }[];
      try {
        current = await port.installedTriggers();
      } catch (cause) {
        return aborted() ? ok(null) : err(StoreQueueWatchErrors.heartbeatFailed({ cause }));
      }
      const gone = missingStoreQueueTriggers({ installed: current });
      if (gone.length > 0) {
        return aborted() ? ok(null) : err(StoreQueueWatchErrors.triggersMissing({ missing: gone }));
      }
      if (!aborted()) {
        emit({ atMs: nowMs(), kind: "heartbeat" });
      }
      await delay({ ms: heartbeatMs, signal });
    }
    return ok(null);
  } finally {
    // An unlisten that fails changes nothing the caller can act on: the adapter ends the whole connection next, which
    // drops the `LISTEN` with it, and the end is already decided.
    await listening.unlisten().catch(() => undefined);
  }
}
