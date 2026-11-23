/**
 * The cmux event state against a REAL store: the facts an in-memory port cannot prove — the CHECKs that tie a fold
 * to `session watch`'s row alone, the `jsonb` round trip of a fold, the compare-and-set predicate deciding a real
 * race, and two concurrent importers settling on one row.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and whose
 * `cmux_event_state` rows ARE this install's supervisor cursors. This file deletes every row of that table before
 * and after every case:
 *
 *   PGPASSWORD=postgres createdb -h localhost -p 55322 -U postgres -w cmux_event_state_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@localhost:55322/cmux_event_state_proof slopweaver store push
 *   CMUX_EVENT_STATE_PROOF_URL=postgresql://postgres:postgres@localhost:55322/cmux_event_state_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/cmuxEventStateStore.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { storeCmuxEventStatePort } from "../../cmux/eventState/storePort.js";
import { productionCmuxEventStateSeams } from "../../cmux/eventState/storeRows.js";
import type { SessionActivity } from "../../cmux/sessionActivity.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { cmuxEventStateTable } from "../../store/schema/cmuxEventState.js";

const PROOF_URL = process.env["CMUX_EVENT_STATE_PROOF_URL"];
const NOW = "2026-10-31T09:00:00.000Z";

const W1: SessionActivity = {
  agentSessionId: "agent-1",
  agentSource: "claude",
  attentionKind: "question",
  attentionSinceIso: "2026-10-31T08:59:00.000Z",
  cwd: undefined,
  lastEventAtIso: "2026-10-31T08:59:00.000Z",
  lastEventName: "agent.hook.AskUserQuestion",
  lastSeq: 38,
  lastTurnEndedAtIso: undefined,
  lastTurnStartedAtIso: undefined,
  sessionStartedAtIso: undefined,
  toolCalls: 2,
  workspaceId: "W1",
};

describe.skipIf(PROOF_URL === undefined)("the cmux event state in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeCmuxEventStatePort({ seams: productionCmuxEventStateSeams() });

  const deleteEveryRow = async (): Promise<void> => {
    await client.db.delete(cmuxEventStateTable);
  };

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await deleteEveryRow();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await deleteEveryRow();
    home = mkdtempSync(join(tmpdir(), "cmux-event-state-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a consumer it does not know, and a fold on any row but session watch's, by CHECK", async () => {
    const at = new Date(NOW);
    await expect(
      client.db
        .insert(cmuxEventStateTable)
        .values({ activities: null, consumer: "other", cursorSeq: 1, recordedAt: at }),
    ).rejects.toThrow();
    await expect(
      client.db
        .insert(cmuxEventStateTable)
        .values({ activities: {}, consumer: "cmux-events", cursorSeq: 1, recordedAt: at }),
    ).rejects.toThrow();
    await expect(
      client.db
        .insert(cmuxEventStateTable)
        .values({ activities: null, consumer: "session-watch", cursorSeq: 1, recordedAt: at }),
    ).rejects.toThrow();
  });

  it("imports the two retired files into one row, and a jsonb round trip decodes to the same fold", async () => {
    const paths = stateHomePaths({ home });
    writeFileSync(paths.cmuxEventCursorJson, JSON.stringify({ recordedAtIso: NOW, seq: 40 }));
    writeFileSync(paths.cmuxSessionActivityJson, JSON.stringify({ activities: { W1 }, recordedAtIso: NOW }));

    const imported = unwrap(await port.readSessionWatch({ home }));
    const reread = unwrap(await port.readSessionWatch({ home }));

    expect(imported).toEqual({ activities: { W1 }, cursorSeq: 38, revision: 1 });
    expect(reread).toEqual(imported);
  });

  it("settles two concurrent importers on one row", async () => {
    const paths = stateHomePaths({ home });
    writeFileSync(paths.cmuxEventCursorJson, JSON.stringify({ seq: 40 }));
    writeFileSync(paths.cmuxSessionActivityJson, JSON.stringify({ activities: { W1 }, recordedAtIso: NOW }));

    const [first, second] = await Promise.all([port.readSessionWatch({ home }), port.readSessionWatch({ home })]);

    expect([unwrap(first).revision, unwrap(second).revision]).toEqual([1, 1]);
    expect((await client.db.select().from(cmuxEventStateTable)).length).toBe(1);
  });

  it("lets exactly one of two writers pinned to the same revision commit, and never retries the other", async () => {
    unwrap(await port.writeSessionWatch({ activities: {}, cursorSeq: 40, expectedRevision: null, home, nowIso: NOW }));

    const [a, b] = await Promise.all([
      port.writeSessionWatch({ activities: { W1 }, cursorSeq: 45, expectedRevision: 1, home, nowIso: NOW }),
      port.writeSessionWatch({ activities: {}, cursorSeq: 50, expectedRevision: 1, home, nowIso: NOW }),
    ]);
    const codes = [a, b].map((result) => (result.isErr() ? result.error.code : "committed")).toSorted();
    const [row] = await client.db
      .select()
      .from(cmuxEventStateTable)
      .where(eq(cmuxEventStateTable.consumer, "session-watch"));

    expect(codes).toEqual(["CMUX_EVENT_REVISION_CONFLICT", "committed"]);
    expect(row!.revision).toBe(2);
  });

  it("keeps cmux events's cursor in its own row, never moving session watch's", async () => {
    unwrap(await port.writeSessionWatch({ activities: {}, cursorSeq: 40, expectedRevision: null, home, nowIso: NOW }));

    unwrap(await port.writeEventsCursor({ cursorSeq: 900, expectedRevision: null, home, nowIso: NOW }));

    expect(unwrap(await port.readSessionWatch({ home })).cursorSeq).toBe(40);
    expect(unwrap(await port.readEventsCursor({ home, importFile: false }))).toEqual({ cursorSeq: 900, revision: 1 });
  });

  it("refuses a stored fold that does not decode, and resets it to an empty one at the chosen sequence", async () => {
    await client.db
      .insert(cmuxEventStateTable)
      .values({ activities: { W1: "torn" }, consumer: "session-watch", cursorSeq: 40, recordedAt: new Date(NOW) });

    const refused = unwrapErr(await port.readSessionWatch({ home }));
    const reset = unwrap(await port.resetSessionWatch({ cursorSeq: 70, home, nowIso: NOW }));

    expect(refused.code).toBe("CMUX_EVENT_STORED_INVALID");
    expect(reset).toEqual({ activities: {}, cursorSeq: 70, revision: 2 });
  });
});
