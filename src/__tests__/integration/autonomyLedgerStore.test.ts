/**
 * The autonomy ledger's witness: records written through the REAL store-backed port, read back in written order,
 * one act per id held by the partial unique index, and a one-time import that reports rather than overwrites a
 * stored act the legacy register disagrees with.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres autonomy_ledger_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/autonomy_ledger_proof slopweaver store push
 *   AUTONOMY_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/autonomy_ledger_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/autonomyLedgerStore.test.ts
 *
 * Every row it writes carries a per-run act id and is deleted afterwards.
 */
import { randomUUID } from "node:crypto";

import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AutonomyLedgerPort } from "../../autonomy/port.js";
import { qualifyStoredAct } from "../../autonomy/reviseStore.js";
import { buildAutonomyAction, buildAutonomySteer } from "../../autonomy/row.js";
import { storeAutonomyLedgerPort } from "../../autonomy/storePort.js";
import { autonomyRowsOver } from "../../autonomy/storeRows.js";
import type { AutonomyActionRow, AutonomyRecord } from "../../autonomy/types.js";
import { ok, unwrap, unwrapErr } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { autonomyImportDivergences, projectAutonomyLine } from "../../store/fleet/autonomyEvent.js";
import { importAutonomyEvents, readStoredAutonomyRows } from "../../store/fleet/autonomyStore.js";
import { FleetImportErrors } from "../../store/fleet/errors.js";
import { autonomyEventTable } from "../../store/schema/ledgers.js";

const PROOF_URL = process.env["AUTONOMY_STORE_PROOF_URL"];

describe.skipIf(PROOF_URL === undefined)("the autonomy ledger in the store (live store)", () => {
  const run = randomUUID().slice(0, 8);
  /** The port names a home; this proof's store is chosen by its own connection, so any path stands in. */
  const home = "/proof/home";
  let client: StoreClient;
  let port: AutonomyLedgerPort;
  let nonce = 0;

  const act = ({ actionId, why = "CI green and mergeable" }: { actionId: string; why?: string }): AutonomyActionRow =>
    unwrap(
      buildAutonomyAction({
        actionId,
        bySession: "workspace:1 proof",
        doneIso: "2026-10-01T00:00:00.000Z",
        kind: "press-merge-when-ready",
        run: undefined,
        said: "I merged your pull request once every check had passed.",
        steer: undefined,
        subject: "https://github.com/acme/widgets/pull/1",
        why,
        witness: "slopweaver github enqueue --pr 1 -> queued",
      }),
    );
  const ofRun = async ({ actionId }: { actionId: string }): Promise<readonly AutonomyRecord[]> =>
    unwrap(await port.readRecords({ home })).filter((record) => record.actionId === actionId);

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
    // Each operation opens and closes its own connection, exactly as the production seams do.
    port = storeAutonomyLedgerPort({
      seams: {
        connect: () => Promise.resolve(ok(autonomyRowsOver({ client: openStore({ url: PROOF_URL! }) }))),
        source: () => ({ path: "/proof/home/ledgers/autonomy.jsonl", presence: { kind: "absent" } }),
        steerNonce: () => {
          nonce += 1;
          return `${run}-${String(nonce)}`;
        },
      },
    });
  });

  afterAll(async () => {
    await client.db.delete(autonomyEventTable).where(like(autonomyEventTable.actionId, `proof-${run}-%`));
    await client.close();
  });

  it("writes an act and two steers, takes an identical retry as recorded, refuses a different act, and reads back in written order", async () => {
    const actionId = `proof-${run}-ledger`;
    const steer = ({ words }: { words: string }): AutonomyRecord =>
      unwrap(
        buildAutonomySteer({ actionId, bySession: "supervisor", steer: words, steeredIso: "2026-10-02T00:00:00Z" }),
      );

    expect(unwrap(await port.appendRecord({ home, record: act({ actionId }) })).appended).toBe(true);
    expect(unwrap(await port.appendRecord({ home, record: act({ actionId }) })).appended).toBe(false);
    expect(unwrapErr(await port.appendRecord({ home, record: act({ actionId, why: "another reason" }) })).code).toBe(
      "ACTION_ID_CONFLICT",
    );
    unwrap(await port.appendRecord({ home, record: steer({ words: "fine" }) }));
    unwrap(await port.appendRecord({ home, record: steer({ words: "fine" }) }));

    expect(await ofRun({ actionId })).toEqual([act({ actionId }), steer({ words: "fine" }), steer({ words: "fine" })]);
  });

  it("stores the validated act even while an Object.prototype.toJSON is installed, so an identical retry still reads as recorded", async () => {
    const actionId = `proof-${run}-tojson`;
    // oxlint-disable-next-line no-extend-native -- a hostile shared serialiser is the attack under test; removed in the finally
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value(this: { actionId?: unknown }) {
        return this.actionId === actionId ? { ...this, why: "rewritten" } : this;
      },
    });
    let first: boolean;
    try {
      first = unwrap(await port.appendRecord({ home, record: act({ actionId }) })).appended;
    } finally {
      Reflect.deleteProperty(Object.prototype, "toJSON");
    }
    expect(first).toBe(true);
    expect(unwrap(await port.appendRecord({ home, record: act({ actionId }) })).appended).toBe(false);
    expect(await ofRun({ actionId })).toEqual([act({ actionId })]);
  });

  it("refuses a lone UTF-16 surrogate as unstorable before the insert, rather than as a store outage", async () => {
    const actionId = `proof-${run}-surrogate`;
    expect(unwrapErr(await port.appendRecord({ home, record: act({ actionId, why: "a\uD800b" }) })).code).toBe(
      "AUTONOMY_RECORD_UNSTORABLE",
    );
    expect(await ofRun({ actionId })).toEqual([]);
  });

  it("refuses year zero as unstorable before the insert, and stores year 1, the earliest Postgres holds", async () => {
    const zero = `proof-${run}-year-zero`;
    const yearOne = `proof-${run}-year-one`;
    const at = ({ actionId, doneIso }: { actionId: string; doneIso: string }): AutonomyActionRow => ({
      ...act({ actionId }),
      doneIso,
    });
    expect(
      unwrapErr(await port.appendRecord({ home, record: at({ actionId: zero, doneIso: "0000-01-01T00:00:00Z" }) }))
        .code,
    ).toBe("AUTONOMY_RECORD_UNSTORABLE");
    expect(await ofRun({ actionId: zero })).toEqual([]);
    expect(
      unwrapErr(
        await port.appendRecord({
          home,
          record: at({ actionId: `proof-${run}-past-9999`, doneIso: "9999-12-31T23:59:59-14:00" }),
        }),
      ).code,
    ).toBe("AUTONOMY_RECORD_UNSTORABLE");
    const last = at({ actionId: `proof-${run}-year-9999`, doneIso: "9999-12-31T23:59:59Z" });
    expect(unwrap(await port.appendRecord({ home, record: last })).appended).toBe(true);
    const first = at({ actionId: yearOne, doneIso: "0001-01-01T00:00:00Z" });
    expect(unwrap(await port.appendRecord({ home, record: first })).appended).toBe(true);
    expect(await ofRun({ actionId: yearOne })).toEqual([first]);
  });

  it("imports once, writes nothing the second time, and names a legacy line the stored act disagrees with", async () => {
    const actionId = `proof-${run}-import`;
    const project = ({ record, lineNumber }: { record: AutonomyActionRow; lineNumber: number }) => ({
      lineNumber,
      row: unwrap(projectAutonomyLine({ line: JSON.stringify(record), lineNumber, path: "/proof" })),
    });
    const first = [project({ lineNumber: 1, record: act({ actionId }) })];
    const edited = [project({ lineNumber: 2, record: act({ actionId, why: "edited by hand" }) })];

    expect(unwrap(await importAutonomyEvents({ client, rows: first.map(({ row }) => row) }))).toBe(1);
    expect(unwrap(await importAutonomyEvents({ client, rows: first.map(({ row }) => row) }))).toBe(0);
    expect(unwrap(await importAutonomyEvents({ client, rows: edited.map(({ row }) => row) }))).toBe(0);
    const stored = unwrap(await readStoredAutonomyRows({ client }));
    expect(autonomyImportDivergences({ path: "/proof", projected: first, stored })).toEqual([]);
    expect(autonomyImportDivergences({ path: "/proof", projected: edited, stored })).toEqual([
      FleetImportErrors.autonomyImportDiverged({ actionId, entryKind: "action", lineNumber: 2, path: "/proof" }),
    ]);
    expect(await ofRun({ actionId })).toEqual([act({ actionId })]);
  });

  it("qualifies a stored act in place, and the compare-and-swap refuses a record that has since changed", async () => {
    const actionId = `proof-${run}-qualify`;
    const bare = act({ actionId, why: "acme/widgets#2914 merged; #2913 lagged" });
    unwrap(await port.appendRecord({ home, record: bare }));
    const seams = {
      connect: () => Promise.resolve(ok(autonomyRowsOver({ client: openStore({ url: PROOF_URL! }) }))),
      source: () => ({ path: "/proof/home/ledgers/autonomy.jsonl", presence: { kind: "absent" as const } }),
      steerNonce: () => "unused",
    };

    const applied = unwrap(
      await qualifyStoredAct({
        actionId,
        apply: true,
        home,
        nowIso: "2026-11-02T11:00:00.000Z",
        repo: { owner: "acme", repo: "widgets" },
        seams,
      }),
    );

    const revised: AutonomyActionRow = {
      ...bare,
      why: "acme/widgets#2914 merged; acme/widgets#2913 lagged",
      witness: applied.witness,
    };
    expect(applied.applied).toBe(true);
    expect(await ofRun({ actionId })).toEqual([revised]);
    const rows = autonomyRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      expect(
        unwrap(
          await rows.revise({
            actionId,
            expected: { ...bare },
            row: { record: { ...bare }, why: bare.why, witness: bare.witness },
          }),
        ),
      ).toBe(false);
    } finally {
      await rows.close();
    }
    expect(await ofRun({ actionId })).toEqual([revised]);
  });

  it("leaves none of a register behind when a line in its second batch fails, so no partial ledger can be read", async () => {
    const prefix = `proof-${run}-atomic-`;
    // 501 lines is two batches of the store's 500; Postgres refuses a NUL byte in a text column, so the last fails.
    const rows = Array.from({ length: 501 }, (_, index) =>
      unwrap(
        projectAutonomyLine({
          line: JSON.stringify(act({ actionId: `${prefix}${String(index)}` })),
          lineNumber: index + 1,
          path: "/proof",
        }),
      ),
    );
    const poisoned = rows.map((row, index) => (index === 500 ? { ...row, why: "a\u0000b" } : row));

    expect(unwrapErr(await importAutonomyEvents({ client, rows: poisoned })).code).toBe("STORE_QUERY_FAILED");
    const stored = unwrap(await readStoredAutonomyRows({ client }));
    expect(stored.filter((row) => row.actionId.startsWith(prefix)).length).toBe(0);
  });
});
