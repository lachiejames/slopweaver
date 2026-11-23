/**
 * The organisation-health row operations over a store that cannot run a statement: Drizzle's connectionless
 * `drizzle.mock()` database builds every statement for real and then throws when asked to execute it, which is
 * exactly a driver failure. So what is under test is the refusal half — every operation answers `STORE_UNAVAILABLE`
 * naming what it was doing, never a thrown error and never an empty row — and that `close` is the client's own. What
 * only a real database can prove (the compare-and-set, the two transactions, the marker's ON CONFLICT) is
 * `src/__tests__/integration/orgHealthStore.test.ts`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import { type Result, unwrapErr } from "../../../lib/result.js";
import { acknowledgementRowFor } from "../../../orgHealth/acknowledgement.js";
import type { OrgHealthStoreUnavailableError } from "../../../orgHealth/errors.js";
import {
  readAcknowledgementsImportFile,
  readSightingsImportFile,
  readSnapshotImportFile,
} from "../../../orgHealth/importFiles.js";
import { orgHealthRowsOver, productionOrgHealthStoreSeams } from "../../../orgHealth/storeRows.js";
import type { OrgHealthRows } from "../../../orgHealth/storeSeams.js";
import type { StoreClient } from "../../../store/client.js";
import * as storeSchema from "../../../store/schema.js";
import { measuredSnapshot, orgIncident } from "./orgIncidentFixture.js";

/**
 * A client whose database builds statements but cannot run one, and which counts its own closes.
 *
 * @returns the client, and how many times it has been closed so far
 */
function unrunnableClient(): { client: StoreClient; closes: () => number } {
  let closed = 0;
  const client: StoreClient = {
    close: async () => {
      closed += 1;
    },
    db: drizzle.mock({ schema: storeSchema }),
  };
  return { client, closes: () => closed };
}

const SNAPSHOT = measuredSnapshot({ incidents: [orgIncident()] });
const PRESS = acknowledgementRowFor({
  acknowledgedIso: "2026-10-04T08:50:00.000Z",
  bySession: "work-console",
  incident: orgIncident(),
});

/** Every row operation, each with the refusal's `doing` it must name. */
const OPERATIONS: readonly {
  readonly name: string;
  readonly run: (rows: OrgHealthRows) => Promise<Result<unknown, OrgHealthStoreUnavailableError>>;
  readonly doing: string;
}[] = [
  {
    doing: "read the incident snapshot",
    name: "the snapshot read",
    run: (rows) => rows.readDocument({ name: "incident" }),
  },
  {
    doing: "read the incident sightings",
    name: "the sightings read",
    run: (rows) => rows.readDocument({ name: "sightings" }),
  },
  {
    doing: "import the incident snapshot",
    name: "the snapshot's import insert",
    run: (rows) => rows.insertDocument({ document: SNAPSHOT, name: "incident" }),
  },
  {
    doing: "import the incident sightings",
    name: "the sightings' import insert",
    run: (rows) => rows.insertDocument({ document: { schemaVersion: 1, sightings: {} }, name: "sightings" }),
  },
  {
    doing: "write the incident snapshot",
    name: "the snapshot's compare-and-set",
    run: (rows) => rows.replaceIncident({ document: SNAPSHOT, expectedRevision: 3 }),
  },
  {
    doing: "publish the measured incident snapshot and its sightings",
    name: "the measured publication",
    run: (rows) => rows.publishMeasured({ expectedRevision: 3, sightings: {}, snapshot: SNAPSHOT }),
  },
  {
    doing: "read the incident acknowledgements",
    name: "the import marker's read",
    run: (rows) => rows.acknowledgementsImported(),
  },
  {
    doing: "read the incident acknowledgements",
    name: "the ordered ledger read",
    run: (rows) => rows.acknowledgementDocuments(),
  },
  {
    doing: "import the incident acknowledgements",
    name: "the ledger's import",
    run: (rows) => rows.importAcknowledgements({ entries: [{ id: "legacy-v1:abc", row: PRESS }] }),
  },
  {
    doing: "record the incident acknowledgement",
    name: "one press",
    run: (rows) => rows.insertAcknowledgement({ document: PRESS, id: "press-1" }),
  },
];

describe("the organisation-health row operations over a store that cannot run a statement", () => {
  it("covers every row operation but close", () => {
    expect(OPERATIONS.length).toBe(10);
  });

  it.each(OPERATIONS)("refuses $name as STORE_UNAVAILABLE, naming what it was doing", async ({ doing, run }) => {
    const rows = orgHealthRowsOver({ client: unrunnableClient().client });

    const error = unwrapErr(await run(rows));

    expect(error.code).toBe("STORE_UNAVAILABLE");
    expect(error.doing).toBe(doing);
  });

  it("closes through the client it was given", async () => {
    const { client, closes } = unrunnableClient();
    const rows = orgHealthRowsOver({ client });

    await rows.close();

    expect(closes()).toBe(1);
  });
});

describe("the production organisation-health store seams", () => {
  it("import the three files through the import-file reads", () => {
    const seams = productionOrgHealthStoreSeams();

    expect([seams.readAcknowledgementsFile, seams.readSightingsFile, seams.readSnapshotFile]).toEqual([
      readAcknowledgementsImportFile,
      readSightingsImportFile,
      readSnapshotImportFile,
    ]);
  });

  it("mint a fresh id for every press", () => {
    const seams = productionOrgHealthStoreSeams();

    const ids = [seams.newId(), seams.newId()];

    expect(new Set(ids).size).toBe(2);
  });
});
