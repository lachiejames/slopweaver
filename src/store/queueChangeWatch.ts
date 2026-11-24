/**
 * What `slopweaver store watch-queue` prints, and the listen loop that produces it.
 *
 * A person's view of what the console's Queue hears from the store: the console holds the same `LISTEN` in its own
 * server process (`site/lib/storeQueueWatch.ts`, which restates this loop because `site/` never imports `src/`), and
 * this verb shows it from a terminal. Four lines exist: `not-ready` (the store lacks a notify trigger, so listening
 * would report the Queue current while it went stale, and the verb exits), `ready` (every trigger is installed and the
 * `LISTEN` is open), `changed` (a store-kept register's tables committed a write) and `heartbeat` (a round trip to the
 * store succeeded just now). The heartbeat is a real query rather than a timer: a stack that stopped answering stops
 * the heartbeats with it.
 */
import { sql } from "drizzle-orm";
import type { Sql } from "postgres";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient } from "./client.js";
import {
  missingQueueChangeTriggers,
  QUEUE_CHANGE_CHANNEL,
  type QueueStoreSlug,
  queueStoreSlugOf,
} from "./schema/queueChangeNotify.js";
import { alwaysTriggers } from "./transfer/importSession.js";

/** How often the verb proves the store still answers, in milliseconds. */
export const QUEUE_WATCH_HEARTBEAT_MS = 15_000;

/** One line `store watch-queue --json` prints. */
export type QueueWatchLine =
  | { readonly kind: "not-ready"; readonly missing: readonly string[] }
  | { readonly kind: "ready"; readonly channel: string }
  | { readonly kind: "changed"; readonly slug: QueueStoreSlug }
  | { readonly kind: "heartbeat"; readonly atIso: string };

/**
 * The text of one line, for `--json` or a person.
 *
 * @param line the event to print
 * @param json whether the reader is a program rather than a person
 * @returns the single line to write to stdout
 */
export function queueWatchLineText({ line, json }: { line: QueueWatchLine; json: boolean }): string {
  if (json) {
    return JSON.stringify(line);
  }
  switch (line.kind) {
    case "not-ready":
      return `store watch-queue: not listening — the store lacks ${line.missing.length} notify trigger(s): ${line.missing.join(", ")}; run \`slopweaver store push\` to install them`;
    case "ready":
      return `store watch-queue: listening on ${line.channel}`;
    case "changed":
      return `store watch-queue: ${line.slug} changed`;
    case "heartbeat":
      return `store watch-queue: store answered at ${line.atIso}`;
    default: {
      const unreachable: never = line;
      return unreachable;
    }
  }
}

/**
 * The notify triggers this store lacks, read in a transaction that changes nothing.
 *
 * @param client the open store
 * @returns the missing triggers' names, empty when every one is installed and enabled ALWAYS
 */
export async function missingQueueTriggersIn({ client }: { client: StoreClient }): Promise<readonly string[]> {
  const installed = await client.db.transaction(async (writer) => alwaysTriggers({ writer }));
  return missingQueueChangeTriggers({ installed });
}

/**
 * Hold a `LISTEN` on the Queue channel and report every event until the store stops answering or `signal` aborts.
 *
 * Resolves only on an end: `ok` when the caller aborted, `err` naming what failed when a heartbeat's round trip did.
 * Postgres.js re-establishes a dropped `LISTEN` connection on its own, and a notification committed while it was
 * down is never replayed — the heartbeat rides a different connection, so it stays green through that gap. So
 * `ready` is printed from the `onlisten` callback, which runs on the first `LISTEN` and again on every re-established
 * one, and the broker re-reads every store-kept register on each `ready`. A heartbeat failing is what says the store
 * is gone, and ending then hands the restart to the broker rather than hiding the gap.
 *
 * @param client the open store, whose connection carries the `LISTEN`
 * @param emit where each line goes
 * @param signal aborts the watch cleanly
 * @param heartbeatMs the round-trip interval
 * @returns how the watch ended
 */
export async function watchQueueChanges({
  client,
  emit,
  signal,
  heartbeatMs,
}: {
  client: StoreClient;
  emit: (line: QueueWatchLine) => void;
  signal: AbortSignal;
  heartbeatMs: number;
}): Promise<Result<null>> {
  const raw: unknown = Reflect.get(client.db, "$client");
  assertPostgresSql(raw);
  const listening = await raw.listen(
    QUEUE_CHANGE_CHANNEL,
    (payload) => {
      const slug = queueStoreSlugOf({ payload });
      if (slug !== undefined) {
        emit({ kind: "changed", slug });
      }
    },
    () => {
      emit({ channel: QUEUE_CHANGE_CHANNEL, kind: "ready" });
    },
  );
  try {
    return await heartbeatUntilEnd({ client, emit, heartbeatMs, signal });
  } finally {
    await listening.unlisten();
  }
}

/**
 * Assert `value` is the postgres-js client under the store's drizzle handle. `StoreDatabase` drops drizzle's `$client`
 * from its type so a `drizzle.mock()` fake still fits it, so the one caller needing `LISTEN` reads it back here.
 * `openStore` always builds the handle over one, so its absence is a broken invariant, never a store state.
 */
function assertPostgresSql(value: unknown): asserts value is Sql {
  if (typeof value !== "function" || typeof Reflect.get(value, "listen") !== "function") {
    throw new Error("invariant: the store's drizzle handle carries no postgres-js client");
  }
}

/** Run a round trip every interval, emitting a heartbeat for each, until one fails or the signal aborts. */
async function heartbeatUntilEnd({
  client,
  emit,
  signal,
  heartbeatMs,
}: {
  client: StoreClient;
  emit: (line: QueueWatchLine) => void;
  signal: AbortSignal;
  heartbeatMs: number;
}): Promise<Result<null>> {
  while (!signal.aborted) {
    try {
      await client.db.execute(sql`select 1`);
    } catch (cause) {
      return err([`the store stopped answering: ${cause instanceof Error ? cause.message : String(cause)}`]);
    }
    emit({ atIso: new Date().toISOString(), kind: "heartbeat" });
    await abortableDelay({ ms: heartbeatMs, signal });
  }
  return ok(null);
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
