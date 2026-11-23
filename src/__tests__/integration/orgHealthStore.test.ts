/**
 * The organisation-health lane's state against a REAL store: the facts the in-memory port cannot prove — the CHECKs,
 * the one-time imports deciding a real race, the compare-and-set a read generation is fenced by, and the measured
 * publication landing the snapshot and the sightings in one transaction or neither.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and whose `org_health_*`
 * rows ARE this install's incident state. This file deletes every row of those three tables before and after every
 * case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres org_health_store_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/org_health_store_proof slopweaver store push
 *   ORG_HEALTH_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/org_health_store_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/orgHealthStore.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { asc } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import { type AcknowledgementRow, acknowledgementRowFor } from "../../orgHealth/acknowledgement.js";
import { fileAcknowledgementId } from "../../orgHealth/importFiles.js";
import { storeOrgHealthPort } from "../../orgHealth/storePort.js";
import { orgHealthRowsOver, productionOrgHealthStoreSeams } from "../../orgHealth/storeRows.js";
import type { UnmeasurableIncidentSnapshot } from "../../orgHealth/types.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import {
  orgHealthAcknowledgementTable,
  orgHealthIncidentTable,
  orgHealthSightingTable,
} from "../../store/schema/orgHealth.js";
import { measuredSnapshot, orgIncident } from "../unit/orgHealth/orgIncidentFixture.js";

const PROOF_URL = process.env["ORG_HEALTH_PROOF_URL"];

/** An under-way marker attempted at `iso`. */
const marker = ({ iso }: { iso: string }): UnmeasurableIncidentSnapshot => ({
  attemptedIso: iso,
  because: `an incident read started at ${iso}`,
  schemaVersion: 1,
  state: "unmeasurable",
});

/** One remembered incident. */
const SIGHTINGS = {
  "INC-98": {
    loud: { iso: "2026-10-04T08:00:00.000Z", kind: "new" as const },
    phase: "identified" as const,
    severity: "Critical",
    sinceIso: "2026-10-04T08:45:00.000Z",
  },
};

/** One press, distinguished by its instant. */
const press = ({ iso }: { iso: string }): AcknowledgementRow =>
  acknowledgementRowFor({ acknowledgedIso: iso, bySession: "work-console", incident: orgIncident() });

describe.skipIf(PROOF_URL === undefined)("the organisation-health state in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeOrgHealthPort({ seams: productionOrgHealthStoreSeams() });

  const deleteEveryRow = async (): Promise<void> => {
    await client.db.delete(orgHealthAcknowledgementTable);
    await client.db.delete(orgHealthSightingTable);
    await client.db.delete(orgHealthIncidentTable);
  };

  /** Write one legacy file at `path`, making its directory. */
  const seedLegacy = ({ path, text }: { path: string; text: string }): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
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
    home = mkdtempSync(join(tmpdir(), "org-health-store-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a second snapshot row, a document that is not an object, and a marker or press of the wrong shape", async () => {
    await expect(client.db.insert(orgHealthIncidentTable).values({ document: null, id: "another" })).rejects.toThrow();
    await expect(
      client.db.insert(orgHealthIncidentTable).values({ document: ["not", "an", "object"], id: "snapshot" }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(orgHealthSightingTable).values({ document: null, id: "sightings", revision: 0 }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(orgHealthAcknowledgementTable).values({ document: {}, id: "legacy-v1", kind: "legacy-import" }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(orgHealthAcknowledgementTable).values({ document: null, id: "a", kind: "acknowledgement" }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(orgHealthAcknowledgementTable).values({ document: {}, id: "b", kind: "other" }),
    ).rejects.toThrow();
  });

  it("imports incidents.json once at revision 1, and the row outranks the file from then on", async () => {
    const snapshot = measuredSnapshot({ incidents: [orgIncident()] });
    const path = stateHomePaths({ home }).orgHealthIncidentsJson;
    seedLegacy({ path, text: JSON.stringify(snapshot) });
    const imported = unwrap(await port.readSnapshot({ home }));
    seedLegacy({ path, text: "{ not json" });
    const reread = unwrap(await port.readSnapshot({ home }));
    const rows = await client.db.select().from(orgHealthIncidentTable);

    expect([imported, reread, rows.map((row) => row.revision)]).toEqual([snapshot, snapshot, [1]]);
  });

  it("imports each singleton exactly once when two importers race", async () => {
    seedLegacy({
      path: stateHomePaths({ home }).orgHealthSightingsJson,
      text: JSON.stringify({ schemaVersion: 1, sightings: SIGHTINGS }),
    });
    const reads = await Promise.all([port.readSightings({ home }), port.readSightings({ home })]);
    const rows = await client.db.select().from(orgHealthSightingTable);

    expect([reads.map((read) => unwrap(read)), rows.map((row) => row.revision)]).toEqual([[SIGHTINGS, SIGHTINGS], [1]]);
  });

  it("lets exactly ONE of two writers holding the same revision commit", async () => {
    unwrap(await port.readSnapshot({ home }));
    const first = orgHealthRowsOver({ client: openStore({ url: PROOF_URL! }) });
    const second = orgHealthRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      const [won, lost] = await Promise.all([
        first.replaceIncident({ document: marker({ iso: "2026-10-04T09:00:00.000Z" }), expectedRevision: 1 }),
        second.replaceIncident({ document: marker({ iso: "2026-10-04T09:00:01.000Z" }), expectedRevision: 1 }),
      ]);
      const committed = [unwrap(won), unwrap(lost)].filter((revision) => revision !== undefined);

      expect(committed).toStrictEqual([2]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("refuses an older read's outcome once a newer read began, and publishes the newer one's snapshot with its sightings", async () => {
    const older = unwrap(await port.beginRead({ home, marker: marker({ iso: "2026-10-04T09:00:00.000Z" }) }));
    const newer = unwrap(await port.beginRead({ home, marker: marker({ iso: "2026-10-04T09:05:00.000Z" }) }));
    const snapshot = measuredSnapshot({ incidents: [orgIncident()] });
    const outcome = { sightings: SIGHTINGS, snapshot, state: "measured" as const };
    const stale = unwrapErr(await port.finishRead({ generation: older, home, outcome }));
    const sightingsAfterStale = await client.db.select().from(orgHealthSightingTable);
    unwrap(await port.finishRead({ generation: newer, home, outcome }));

    expect([stale.code, sightingsAfterStale.length]).toEqual(["REVISION_CONFLICT", 0]);
    expect([unwrap(await port.readSnapshot({ home })), unwrap(await port.readSightings({ home }))]).toEqual([
      snapshot,
      SIGHTINGS,
    ]);
  });

  it("rolls the snapshot back when the sightings half of a publication fails", async () => {
    const generation = unwrap(await port.beginRead({ home, marker: marker({ iso: "2026-10-04T09:00:00.000Z" }) }));
    const rows = orgHealthRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      // An array violates `org_health_sighting_is_object`, so the second statement fails inside the transaction.
      const failed = unwrapErr(
        await rows.publishMeasured({
          expectedRevision: generation.revision,
          sightings: ["not", "an", "object"],
          snapshot: measuredSnapshot({ incidents: [orgIncident()] }),
        }),
      );
      const [after] = await client.db.select().from(orgHealthIncidentTable);

      expect([failed.code, after!.revision, after!.document]).toEqual([
        "STORE_UNAVAILABLE",
        generation.revision,
        marker({ iso: "2026-10-04T09:00:00.000Z" }),
      ]);
    } finally {
      await rows.close();
    }
  });

  it("imports the legacy ledger exactly once under a race, in file order, and orders every concurrent press after it", async () => {
    const lines = [press({ iso: "2026-10-06T11:31:00.000Z" }), press({ iso: "2026-10-06T11:32:00.000Z" })].map((row) =>
      JSON.stringify(row),
    );
    seedLegacy({ path: stateHomePaths({ home }).orgHealthAcknowledgementsJsonl, text: `${lines.join("\n")}\n` });
    const appended = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        port.appendAcknowledgement({ home, row: press({ iso: `2026-10-07T00:00:0${String(index)}.000Z` }) }),
      ),
    );
    const read = unwrap(await port.readAcknowledgements({ home }));
    const stored = await client.db
      .select({ id: orgHealthAcknowledgementTable.id, kind: orgHealthAcknowledgementTable.kind })
      .from(orgHealthAcknowledgementTable)
      .orderBy(asc(orgHealthAcknowledgementTable.position));

    expect(appended.map((result) => result.isOk())).toEqual([true, true, true, true, true, true]);
    expect([read.length, read[0], read[1]]).toEqual([
      8,
      press({ iso: "2026-10-06T11:31:00.000Z" }),
      press({ iso: "2026-10-06T11:32:00.000Z" }),
    ]);
    expect(stored.slice(0, 3)).toEqual([
      { id: "legacy-v1", kind: "legacy-import" },
      { id: fileAcknowledgementId({ line: 1, raw: lines[0]! }), kind: "acknowledgement" },
      { id: fileAcknowledgementId({ line: 2, raw: lines[1]! }), kind: "acknowledgement" },
    ]);
  });

  it("refuses a store whose password is wrong without printing the connection string", async () => {
    const wrong = PROOF_URL!.replace("postgres:postgres@", "postgres:wrong-FIXTURE@");
    process.env[STORE_URL_ENV] = wrong;
    const refused = unwrapErr(await port.readSnapshot({ home }));

    expect(refused.code).toBe("STORE_UNAVAILABLE");
    expect(refused.message).not.toContain("wrong-FIXTURE");
    expect(wrong).toContain("wrong-FIXTURE");
  });
});
