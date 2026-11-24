/**
 * The Queue's store notify triggers, proven on a real migrated store: a committed write to a register's table reaches
 * a `LISTEN` held by `watchQueueChanges` as that register's slug, a rolled-back one never does, and a shared table
 * notifies only for the one row a register reads, and a `LISTEN` killed under it says `ready` again once re-established. One throwaway database per file from
 * `./storeImportApplyHarness.ts`; skipped when `STORE_IMPORT_PROOF_ADMIN_URL` is unset, like every proof built on it.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { missingQueueTriggersIn, type QueueWatchLine, watchQueueChanges } from "../../store/queueChangeWatch.js";

import {
  ADMIN_URL,
  type AdminConnection,
  openAdmin,
  type ProofStore,
  throwawayStore,
} from "./storeImportApplyHarness.js";

/** Long enough that no heartbeat lands inside a case; the cases assert on `changed` lines only. */
const NO_HEARTBEAT_MS = 600_000;

/** How long a case waits for a notification it expects, and lets pass for one it expects NOT to arrive. */
const SETTLE_MS = 1_500;

/** Resolve once `lines` holds a line `matches` accepts, or after `SETTLE_MS` either way. */
async function settled({
  lines,
  matches,
}: {
  lines: readonly QueueWatchLine[];
  matches: (line: QueueWatchLine) => boolean;
}): Promise<void> {
  const deadline = Date.now() + SETTLE_MS;
  while (Date.now() < deadline && !lines.some(matches)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The slugs of every `changed` line, in order. */
function changedSlugs({ lines }: { lines: readonly QueueWatchLine[] }): readonly string[] {
  return lines.flatMap((line) => (line.kind === "changed" ? [line.slug] : []));
}

describe.skipIf(ADMIN_URL === undefined)("the Queue's store notify triggers on a real store", () => {
  let admin: AdminConnection;
  let store: ProofStore;
  const lines: QueueWatchLine[] = [];
  const stop = new AbortController();
  let watching: Promise<unknown>;

  beforeAll(async () => {
    admin = openAdmin();
    store = await throwawayStore({ admin });
    watching = watchQueueChanges({
      client: store.client,
      emit: (line) => {
        lines.push(line);
      },
      heartbeatMs: NO_HEARTBEAT_MS,
      signal: stop.signal,
    });
    await settled({ lines, matches: (line) => line.kind === "ready" });
  });

  afterAll(async () => {
    stop.abort();
    await watching;
    await store.close();
    await admin.sql.end();
  });

  it("installs every trigger in the apply's guard phase", async () => {
    expect(await missingQueueTriggersIn({ client: store.client })).toEqual([]);
    expect(lines[0]).toEqual({ channel: "slopweaver_queue_change", kind: "ready" });
  });

  it("names the register a committed write touched, even one changing no row", async () => {
    lines.length = 0;
    await store.client.db.execute(sql`delete from public.workstream_link where false`);
    await settled({ lines, matches: (line) => line.kind === "changed" });
    expect(changedSlugs({ lines })).toEqual(["workstreams"]);
  });

  it("says nothing for a write that rolled back", async () => {
    lines.length = 0;
    await expect(
      store.client.db.transaction(async (writer) => {
        await writer.execute(sql`delete from public.standing_ask_coverage where false`);
        throw new Error("rolled back on purpose");
      }),
    ).rejects.toThrow("rolled back on purpose");
    await settled({ lines, matches: (line) => line.kind === "changed" });
    expect(changedSlugs({ lines })).toEqual([]);
  });

  it("says nothing for a singleton other than the identity roster", async () => {
    lines.length = 0;
    await store.client.db.execute(
      sql`insert into public.singleton_register (id, document) values ('browser-profile', '{}'::jsonb)`,
    );
    await settled({ lines, matches: (line) => line.kind === "changed" });
    expect(changedSlugs({ lines })).toEqual([]);
  });

  it("notifies the board and the reviewers for the identity roster's row", async () => {
    lines.length = 0;
    await store.client.db.execute(
      sql`insert into public.singleton_register (id, document) values ('identity-roster', '{}'::jsonb)`,
    );
    await settled({ lines, matches: (line) => line.kind === "changed" });
    expect(changedSlugs({ lines }).toSorted()).toEqual(["board", "reviewers"]);
  });

  it("says nothing for an import marker other than the standing asks'", async () => {
    lines.length = 0;
    await store.client.db.execute(
      sql`insert into public.home_file_import (register, source_state, records) values ('landing-reads', 'absent', 0)`,
    );
    await settled({ lines, matches: (line) => line.kind === "changed" });
    expect(changedSlugs({ lines })).toEqual([]);
  });

  it("notifies the standing asks when their import marker changes", async () => {
    lines.length = 0;
    await store.client.db.execute(
      sql`insert into public.home_file_import (register, source_state, records) values ('standing-asks', 'absent', 0)`,
    );
    await settled({ lines, matches: (line) => line.kind === "changed" });
    expect(changedSlugs({ lines })).toEqual(["standing-asks"]);
  });

  it("says ready again when a dropped LISTEN is re-established, so the broker catches up what it missed", async () => {
    lines.length = 0;
    const killed = await store.client.db.execute(
      sql`select pg_terminate_backend(pid) as killed from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid() and query ilike 'listen%'`,
    );
    expect(killed.length).toBe(1);
    await settled({ lines, matches: (line) => line.kind === "ready" });
    expect(lines).toEqual([{ channel: "slopweaver_queue_change", kind: "ready" }]);
  });
});
