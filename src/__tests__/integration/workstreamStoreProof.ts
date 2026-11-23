/**
 * The harness both real-store proofs of the workstream register share: the opt-in URL, a connection opened once per
 * file, every workstream row cleared before and after every case, a throwaway home per case, and the two tools a race
 * needs — a gate that holds a transaction open at an exact point, and a wait until a backend is blocked on a lock.
 *
 * OPT-IN, and never in CI: point `WORKSTREAM_STORE_PROOF_URL` at a THROWAWAY, migrated database — never `postgres`,
 * which is the live fleet's. `./workstreamStore.test.ts`'s header carries the commands. The integration lane runs one
 * file at a time (`fileParallelism: false`), so the two files never clear each other's rows mid-case.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";

import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { workstreamRegisterMetaTable, workstreamTable } from "../../store/schema.js";
import type { WorkstreamLink } from "../../workstreams/store/types.js";

/** The throwaway database a proof runs against; unset, every proof is skipped. */
export const PROOF_URL = process.env["WORKSTREAM_STORE_PROOF_URL"];

/**
 * A `workstream` link to the given target.
 *
 * @param n distinguishes the link's UUID
 * @returns the link
 */
export function linkTo({ n, target }: { n: number; target: string }): WorkstreamLink {
  return { id: `00000000-0000-4000-8000-0000000000b${n}`, kind: "workstream", label: null, milestoneId: null, target };
}

/**
 * A promise and the function that settles it, so a test can hold a transaction open at an exact point.
 *
 * @returns the gate
 */
export function gate(): { readonly open: () => void; readonly passed: Promise<void> } {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, passed };
}

/**
 * Wait until exactly `count` other backends are blocked on a lock — the race is set, not guessed at.
 *
 * @param client the connection that asks, which is never itself blocked
 * @returns once that many backends wait, or throws after five seconds
 */
export async function waitForLockWaiters({ client, count }: { client: StoreClient; count: number }): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [row] = await client.db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`,
    );
    if (row!.waiting === count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no ${count} backend(s) blocked on a lock within five seconds`);
}

/**
 * Register the hooks a real-store proof needs, inside the `describe` that calls it: open the connection once, clear the
 * register and mint a home before every case, remove the home after it, and clear and close at the end.
 *
 * @param onClient handed the connection once it is open
 * @param onHome handed each case's fresh home, which the test file removes in its own `afterEach` — a filesystem
 *   delete in a helper is a door-coverage seam, in a `*.test.ts` file it is outside that scan
 */
export function useRealStore({
  onClient,
  onHome,
}: {
  onClient: (client: StoreClient) => void;
  onHome: (home: string) => void;
}): void {
  let client: StoreClient | undefined;
  let home = "";

  const clearRegister = async (): Promise<void> => {
    await client!.db.delete(workstreamTable);
    await client!.db.delete(workstreamRegisterMetaTable);
  };

  beforeAll(() => {
    client = openStore({ max: 3, url: PROOF_URL! });
    onClient(client);
  });

  afterAll(async () => {
    await clearRegister();
    await client!.close();
  });

  beforeEach(async () => {
    // Per case: `setup-ambient-home.ts` clears the selector after every test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await clearRegister();
    home = mkdtempSync(join(tmpdir(), "workstream-store-proof-"));
    onHome(home);
  });
}
