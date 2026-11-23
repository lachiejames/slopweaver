/**
 * The door ledger's witness: decisions and pre-door refusals written through the REAL store-backed port and read
 * back in written order, the friction window the reflection reads, and the one-time import that fills a mirror row
 * the one-way mirror left without its record, reads back clean, marks itself, and only verifies after that — bar the
 * opted-in adoption of a line appended after the marker.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's; the suite refuses to start
 * there, because it clears the import marker and every imported row:
 *
 *   PGPASSWORD=postgres createdb -w -h 127.0.0.1 -p 55322 -U postgres door_ledger_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/door_ledger_proof \
 *     SLOPWEAVER_ALLOW_UNLANDED_MIGRATION=1 slopweaver store push
 *   DOOR_LEDGER_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/door_ledger_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/doorLedgerStore.test.ts
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import { storeDoorLedgerPort } from "../../admit/doorStorePort.js";
import { doorRowsOver } from "../../admit/doorStoreRows.js";
import type { DoorDecision, DoorRequest } from "../../admit/types.js";
import { doorImportStoreOver, runDoorLeg } from "../../cli/commands/store/importDoorLeg.js";
import { ok, unwrap, unwrapErr } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { LAST_PROVEN_TEST_WRITE_ISO, projectDoorLine } from "../../store/fleet/doorEvent.js";
import { doorEventTable, doorRegisterTable } from "../../store/schema/ledgers.js";
import { refuseLiveStore } from "../proofStoreUrl.js";

const PROOF_URL = process.env["DOOR_LEDGER_STORE_PROOF_URL"];

const request: DoorRequest = {
  action: { kind: "verb", noun: "demo", verb: "run" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe.skipIf(PROOF_URL === undefined)("the door ledger in the store (live store)", () => {
  const run = randomUUID().slice(0, 8);
  /** The port names a home; this proof's store is chosen by its own connection, so any path stands in. */
  const home = "/proof/home";
  let client: StoreClient;
  let port: DoorLedgerPort;
  let dir: string;
  let nonce = 0;

  beforeAll(async () => {
    refuseLiveStore({ url: PROOF_URL!, variable: "DOOR_LEDGER_STORE_PROOF_URL" });
    client = openStore({ url: PROOF_URL! });
    dir = mkdtempSync(join(tmpdir(), "door-proof-"));
    // A throwaway database: start from no import, so the import test below runs from the first step.
    await client.db.delete(doorRegisterTable);
    await client.db.delete(doorEventTable);
    // Each operation opens and closes its own connection, exactly as the production seams do.
    port = storeDoorLedgerPort({
      seams: {
        connect: () => Promise.resolve(ok(doorRowsOver({ client: openStore({ url: PROOF_URL! }) }))),
        source: () => ({ path: join(dir, "door.jsonl"), presence: { kind: "absent" } }),
        writeNonce: () => {
          nonce += 1;
          return `${run}-${String(nonce)}`;
        },
      },
    });
  });

  afterAll(async () => {
    rmSync(dir, { force: true, recursive: true });
    await client.close();
  });

  it("imports a legacy ledger once: fills the mirror's empty row, marks itself, and only verifies the second time", async () => {
    const lines = [1, 2, 3].map((n) =>
      JSON.stringify({
        action: "verb:slack.post",
        effect: "external-write",
        findings: [],
        overridden: [],
        runId: `proof-${run}-${String(n)}`,
        schemaVersion: 1,
        status: "pass",
        tsIso: "2026-10-01T00:00:00.000Z",
      }),
    );
    const path = join(dir, "door.jsonl");
    writeFileSync(path, `${lines.join("\n")}\n`);
    // What the one-way mirror wrote: the first line's row, projected, with no verbatim record.
    const mirrored = unwrap(
      projectDoorLine({ guardIso: LAST_PROVEN_TEST_WRITE_ISO, line: lines[0]!, lineNumber: 1, path }),
    );
    await client.db.insert(doorEventTable).values({ ...mirrored, record: null });

    const first = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store: doorImportStoreOver({ client }) });
    expect(first.refused).toEqual([]);
    expect(first.written).toBe(3);
    expect(first.notes).toEqual(["marked imported — the store is the door's ledger from here on"]);

    const again = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store: doorImportStoreOver({ client }) });
    expect(again.refused).toEqual([]);
    expect(again.written).toBe(0);
    expect(again.notes).toEqual([
      "already imported — verified only; the store is the ledger and the file is not read for it",
    ]);
    const stored = await client.db
      .select({ record: doorEventTable.record })
      .from(doorEventTable)
      .orderBy(asc(doorEventTable.seq));
    expect(stored.map((row) => row.record)).toEqual(lines.map((line) => JSON.parse(line)));
  });

  it("adopts a line a pre-switch seat appended after the marker only when asked, then verifies clean", async () => {
    const path = join(dir, "door.jsonl");
    const late = JSON.stringify({
      action: "verb:github.push",
      effect: "external-write",
      findings: [],
      overridden: [],
      runId: `proof-${run}-late`,
      schemaVersion: 1,
      status: "pass",
      tsIso: "2026-11-01T12:31:29.224Z",
    });
    appendFileSync(path, `${late}\n`);
    const lateKey = unwrap(projectDoorLine({ guardIso: LAST_PROVEN_TEST_WRITE_ISO, line: late, lineNumber: 4, path }));

    const refused = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store: doorImportStoreOver({ client }) });
    expect(refused.written).toBe(0);
    expect(refused.refused.map((error) => error.message)).toEqual([
      `${path} and door_event disagree at ${lateKey.importKey}: the file's line has no row; nothing was overwritten`,
    ]);

    const adopted = await runDoorLeg({ adoptUnmatchedDoorLines: true, path, store: doorImportStoreOver({ client }) });
    expect(adopted.refused).toEqual([]);
    expect(adopted.written).toBe(1);
    expect(adopted.notes).toEqual([
      `adopted door line ${path}:4 as ${lateKey.importKey}`,
      "adopted — the final read-back is clean; the store is the door's ledger",
    ]);

    const verified = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store: doorImportStoreOver({ client }) });
    expect(verified.refused).toEqual([]);
    expect(verified.written).toBe(0);
  });

  it("records decisions and refusals through the port and reads them back in written order", async () => {
    const held: DoorDecision = {
      findings: [{ code: "demo.hold", correction: "c", severity: "hold", summary: "s" }],
      overridden: [],
      status: "hold",
    };
    unwrap(
      await port.appendDecision({
        decision: held,
        doorRequest: request,
        home,
        runId: `proof-${run}-held`,
        tsIso: "2026-10-02T00:00:00.000Z",
      }),
    );
    for (const name of ["a", "b"]) {
      unwrap(
        await port.appendPreDoorRefusal({
          home,
          refusal: {
            findings: [{ code: "voice.wall", message: "too long", path: "body" }],
            gate: "above-the-fold-voice",
            hatch: "SLOPWEAVER_ALLOW_VOICE",
            runId: `proof-${run}-${name}`,
            surface: "slack",
            tsIso: "2026-10-02T00:00:01.000Z",
          },
        }),
      );
    }

    const refusals = unwrap(await port.readRecentPreDoorRefusals({ home, limit: 2 }));
    expect(refusals.map((entry) => entry.runId)).toEqual([`proof-${run}-a`, `proof-${run}-b`]);
    const friction = unwrap(
      await port.readDoorFriction({ fromIso: "2026-10-02T00:00:00.000Z", home, toIso: "2026-10-03T00:00:00.000Z" }),
    );
    expect(friction).toEqual([
      { action: "verb:demo.run", overridden: [], status: "hold", tsIso: "2026-10-02T00:00:00.000Z" },
    ]);
  });

  it("refuses a hand-written seq a JavaScript number cannot hold exactly, at either end", async () => {
    const line = JSON.stringify({
      action: "verb:demo.run",
      effect: "local",
      status: "pass",
      tsIso: "2026-10-01T00:00:00.000Z",
    });
    const row = unwrap(
      projectDoorLine({ guardIso: LAST_PROVEN_TEST_WRITE_ISO, line, lineNumber: 1, path: join(dir, "seq.jsonl") }),
    );
    const constraints: unknown[] = [];
    for (const seq of [0, 9_007_199_254_740_992]) {
      try {
        await client.db.insert(doorEventTable).values({ ...row, importKey: `seq-${run}-${String(seq)}`, seq });
        constraints.push("inserted");
      } catch (error: unknown) {
        constraints.push((error as { cause: { constraint_name: string } }).cause.constraint_name);
      }
    }
    expect(constraints).toEqual(["door_event_seq_is_safe", "door_event_seq_is_safe"]);
  });

  it("refuses a record holding a NUL as unstorable before the insert, rather than as a store outage", async () => {
    const refused = await port.appendPreDoorRefusal({
      home,
      refusal: {
        findings: [{ code: "voice.wall", message: "a\u0000b", path: "body" }],
        gate: "above-the-fold-voice",
        hatch: "SLOPWEAVER_ALLOW_VOICE",
        runId: `proof-${run}-nul`,
        surface: "slack",
        tsIso: "2026-10-02T00:00:02.000Z",
      },
    });
    expect(unwrapErr(refused).code).toBe("DOOR_EVENT_UNSTORABLE");
  });
});
