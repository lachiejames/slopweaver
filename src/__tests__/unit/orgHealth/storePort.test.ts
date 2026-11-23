/**
 * `orgHealth/storePort.ts` and `orgHealth/storeAcknowledgements.ts` — the store-backed lane's every branch, over the
 * in-memory rows (`../../orgHealthStoreFixture.ts`) and the real legacy files under a throwaway home.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "../../../lib/result.js";
import { type AcknowledgementRow, acknowledgementRowFor } from "../../../orgHealth/acknowledgement.js";
import { OrgHealthErrors } from "../../../orgHealth/errors.js";
import { fileAcknowledgementId } from "../../../orgHealth/importFiles.js";
import type { OrgHealthPort } from "../../../orgHealth/port.js";
import { appendAcknowledgementWith, readAcknowledgementsWith } from "../../../orgHealth/storeAcknowledgements.js";
import { storeOrgHealthPort } from "../../../orgHealth/storePort.js";
import type { UnmeasurableIncidentSnapshot } from "../../../orgHealth/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type MemoryOrgHealthStore,
  memoryOrgHealthPort,
  memoryOrgHealthSeams,
  memoryOrgHealthStore,
} from "../../orgHealthStoreFixture.js";
import { measuredSnapshot, orgIncident } from "./orgIncidentFixture.js";

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

/** One press. */
const ROW: AcknowledgementRow = acknowledgementRowFor({
  acknowledgedIso: "2026-10-06T11:31:00.000Z",
  bySession: "work-console",
  incident: orgIncident(),
});

/** Write a legacy file, making its directory. */
function writeLegacy({ path, text }: { path: string; text: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe("the store-backed incident snapshot and sightings", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  let port: OrgHealthPort;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-store-port-"));
    store = memoryOrgHealthStore();
    port = memoryOrgHealthPort({ store });
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads null where no read has ever run and no file was left, recording that it imported nothing", async () => {
    expect(unwrap(await port.readSnapshot({ home }))).toBe(null);
    expect(store.homes.get(home)!.incident).toEqual({ document: null, revision: 1 });
    expect([store.opened, store.closed]).toEqual([1, 1]);
  });

  it("imports a legacy incidents.json once, and never reads the file again", async () => {
    const snapshot = measuredSnapshot({ incidents: [orgIncident()] });
    const path = stateHomePaths({ home }).orgHealthIncidentsJson;
    writeLegacy({ path, text: JSON.stringify(snapshot) });
    expect(unwrap(await port.readSnapshot({ home }))).toEqual(snapshot);
    writeLegacy({ path, text: "{ not json" });
    expect(unwrap(await port.readSnapshot({ home }))).toEqual(snapshot);
  });

  it("refuses a damaged legacy file, naming its path, and imports nothing so it can be repaired", async () => {
    const path = stateHomePaths({ home }).orgHealthIncidentsJson;
    writeLegacy({ path, text: "{ not json" });
    const refused = unwrapErr(await port.readSnapshot({ home }));
    expect([refused.code, refused.message.includes(path), store.homes.get(home)!.incident]).toEqual([
      "FILE_MALFORMED",
      true,
      undefined,
    ]);
  });

  it("answers a concurrent importer's committed row rather than a damaged file read after it", async () => {
    const snapshot = measuredSnapshot({ incidents: [orgIncident()] });
    writeLegacy({ path: stateHomePaths({ home }).orgHealthIncidentsJson, text: "{ not json" });
    const base = memoryOrgHealthSeams({ store });
    const racing = storeOrgHealthPort({
      seams: {
        ...base,
        // Another importer commits between this read's first look and its file read.
        readSnapshotFile: (request) => {
          store.homes.get(home)!.incident = { document: snapshot, revision: 1 };
          return base.readSnapshotFile(request);
        },
      },
    });
    expect(unwrap(await racing.readSnapshot({ home }))).toEqual(snapshot);
  });

  it("refuses as STORE_UNAVAILABLE when the recheck after a damaged file read fails, never as the file's error", async () => {
    writeLegacy({ path: stateHomePaths({ home }).orgHealthIncidentsJson, text: "{ not json" });
    const base = memoryOrgHealthSeams({ store });
    let reads = 0;
    const failing = storeOrgHealthPort({
      seams: {
        ...base,
        connect: async (request) =>
          (await base.connect(request)).map((rows) => ({
            ...rows,
            readDocument: (query) => {
              reads += 1;
              if (reads > 1) {
                return Promise.resolve(
                  err(OrgHealthErrors.storeUnavailable({ doing: "read", reason: "a fixture outage" })),
                );
              }
              return rows.readDocument(query);
            },
          })),
      },
    });
    expect(unwrapErr(await failing.readSnapshot({ home })).code).toBe("STORE_UNAVAILABLE");
  });

  it("refuses a stored snapshot that does not decode as STORED_INVALID, never as an empty one", async () => {
    store.homes.set(home, {
      acknowledgements: [],
      incident: { document: { state: "odd" }, revision: 4 },
      sightings: undefined,
    });
    expect(unwrapErr(await port.readSnapshot({ home })).code).toBe("STORED_INVALID");
  });

  it("begins a read over no row at revision 1, superseding even a damaged legacy file", async () => {
    writeLegacy({ path: stateHomePaths({ home }).orgHealthIncidentsJson, text: "{ not json" });
    const generation = unwrap(await port.beginRead({ home, marker: marker({ iso: "2026-10-04T09:00:00.000Z" }) }));
    expect([generation, unwrap(await port.readSnapshot({ home }))]).toEqual([
      { revision: 1 },
      marker({ iso: "2026-10-04T09:00:00.000Z" }),
    ]);
  });

  it("publishes a measured outcome and its sightings together against the generation it began", async () => {
    const snapshot = measuredSnapshot({ incidents: [orgIncident()] });
    unwrap(await port.readSnapshot({ home }));
    const generation = unwrap(await port.beginRead({ home, marker: marker({ iso: "2026-10-04T09:00:00.000Z" }) }));
    unwrap(await port.finishRead({ generation, home, outcome: { sightings: SIGHTINGS, snapshot, state: "measured" } }));
    expect([generation, unwrap(await port.readSnapshot({ home })), unwrap(await port.readSightings({ home }))]).toEqual(
      [{ revision: 2 }, snapshot, SIGHTINGS],
    );
  });

  it("refuses an older generation's outcome as REVISION_CONFLICT once a newer read began, changing nothing", async () => {
    const older = unwrap(await port.beginRead({ home, marker: marker({ iso: "2026-10-04T09:00:00.000Z" }) }));
    unwrap(await port.beginRead({ home, marker: marker({ iso: "2026-10-04T09:05:00.000Z" }) }));
    const measured = {
      sightings: SIGHTINGS,
      snapshot: measuredSnapshot({ incidents: [] }),
      state: "measured" as const,
    };
    const conflict = unwrapErr(await port.finishRead({ generation: older, home, outcome: measured }));
    const failed = { snapshot: marker({ iso: "2026-10-04T09:00:00.000Z" }), state: "unmeasurable" as const };
    const alsoConflict = unwrapErr(await port.finishRead({ generation: older, home, outcome: failed }));
    expect([conflict.code, alsoConflict.code, unwrap(await port.readSnapshot({ home }))]).toEqual([
      "REVISION_CONFLICT",
      "REVISION_CONFLICT",
      marker({ iso: "2026-10-04T09:05:00.000Z" }),
    ]);
    expect(unwrap(await port.readSightings({ home }))).toBe(undefined);
  });

  it("imports a legacy sightings.json once, and reads no memory at all where none was left", async () => {
    expect(unwrap(await port.readSightings({ home }))).toBe(undefined);
    const other = mkdtempSync(join(tmpdir(), "org-health-store-port-"));
    try {
      writeLegacy({
        path: stateHomePaths({ home: other }).orgHealthSightingsJson,
        text: JSON.stringify({ schemaVersion: 1, sightings: SIGHTINGS }),
      });
      expect(unwrap(await port.readSightings({ home: other }))).toEqual(SIGHTINGS);
    } finally {
      rmSync(other, { force: true, recursive: true });
    }
  });

  it("refuses STORE_UNAVAILABLE, never a file, when the store cannot be opened, carrying the store's own reason", async () => {
    writeLegacy({
      path: stateHomePaths({ home }).orgHealthIncidentsJson,
      text: JSON.stringify(measuredSnapshot({ incidents: [] })),
    });
    const down = storeOrgHealthPort({
      seams: {
        ...memoryOrgHealthSeams({ store }),
        connect: () =>
          Promise.resolve(err(OrgHealthErrors.storeUnavailable({ doing: "be opened", reason: "refused" }))),
      },
    });
    const refused = unwrapErr(await down.readSnapshot({ home }));
    expect([refused.code, refused.message]).toEqual([
      "STORE_UNAVAILABLE",
      expect.stringContaining("The store said: refused"),
    ]);
  });

  it("refuses STORE_UNAVAILABLE when a seam throws, and still closes the connection it opened", async () => {
    const seams = memoryOrgHealthSeams({ store });
    const throwing = storeOrgHealthPort({
      seams: {
        ...seams,
        readSnapshotFile: () => {
          throw new Error("a fixture throw");
        },
      },
    });
    const refused = unwrapErr(await throwing.readSnapshot({ home }));
    expect([refused.code, store.opened, store.closed]).toEqual(["STORE_UNAVAILABLE", 1, 1]);
  });
});

describe("the store-backed acknowledgement ledger", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  let port: OrgHealthPort;
  let path: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-store-ack-"));
    store = memoryOrgHealthStore();
    port = memoryOrgHealthPort({ store });
    path = stateHomePaths({ home }).orgHealthAcknowledgementsJsonl;
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads empty before any press, committing the import marker", async () => {
    expect(unwrap(await port.readAcknowledgements({ home }))).toEqual([]);
    expect(store.homes.get(home)!.acknowledgements).toEqual([
      { document: null, id: "legacy-v1", kind: "legacy-import" },
    ]);
  });

  it("imports the legacy ledger once in file order, under deterministic ids, and appends after it", async () => {
    const second = { ...ROW, acknowledgedIso: "2026-10-07T00:00:00.000Z" };
    const third = { ...ROW, acknowledgedIso: "2026-10-08T00:00:00.000Z" };
    const lines = [JSON.stringify(ROW), "", JSON.stringify(second)];
    writeLegacy({ path, text: `${lines.join("\n")}\n` });
    unwrap(await port.appendAcknowledgement({ home, row: third }));
    rmSync(path);
    expect(unwrap(await port.readAcknowledgements({ home }))).toEqual([ROW, second, third]);
    expect(
      store.homes
        .get(home)!
        .acknowledgements.slice(1, 3)
        .map((row) => row.id),
    ).toEqual([fileAcknowledgementId({ line: 1, raw: lines[0]! }), fileAcknowledgementId({ line: 3, raw: lines[2]! })]);
  });

  it("refuses a legacy ledger with a line that will not read, importing nothing and recording no press", async () => {
    writeLegacy({ path, text: `${JSON.stringify(ROW)}\nnot json\n` });
    const read = unwrapErr(await port.readAcknowledgements({ home }));
    const append = unwrapErr(await port.appendAcknowledgement({ home, row: ROW }));
    expect([read.code, read.message, append.code, store.homes.get(home)!.acknowledgements]).toEqual([
      "LEDGER_IO",
      expect.stringContaining("1 line(s) did not read (2)"),
      "LEDGER_IO",
      [],
    ]);
  });

  it("answers a concurrent importer's committed ledger rather than a damaged file read after it", async () => {
    writeLegacy({ path, text: "not json\n" });
    const base = memoryOrgHealthSeams({ store });
    const racing = storeOrgHealthPort({
      seams: {
        ...base,
        // Another importer commits its marker and one press between this call's first look and its file read.
        readAcknowledgementsFile: (request) => {
          store.homes
            .get(home)!
            .acknowledgements.push(
              { document: null, id: "legacy-v1", kind: "legacy-import" },
              { document: ROW, id: "a-press", kind: "acknowledgement" },
            );
          return base.readAcknowledgementsFile(request);
        },
      },
    });
    expect(unwrap(await racing.readAcknowledgements({ home }))).toEqual([ROW]);
  });

  it("refuses a symlink at the legacy path as a ledger that cannot be trusted, never one never written", async () => {
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(join(home, "elsewhere.jsonl"), path);
    expect(unwrapErr(await port.readAcknowledgements({ home })).code).toBe("LEDGER_IO");
  });

  it("refuses the whole read as STORED_INVALID when one stored row does not decode", async () => {
    unwrap(await port.appendAcknowledgement({ home, row: ROW }));
    store.homes.get(home)!.acknowledgements.push({ document: { ref: "x" }, id: "a-bad-row", kind: "acknowledgement" });
    const refused = unwrapErr(await port.readAcknowledgements({ home }));
    expect([refused.code, refused.message]).toEqual([
      "STORED_INVALID",
      expect.stringContaining("1 row(s) do not decode"),
    ]);
  });

  it("refuses to record a press its own reader would refuse, opening no connection", async () => {
    const seams = memoryOrgHealthSeams({ store });
    const refused = unwrapErr(await appendAcknowledgementWith({ home, row: { ...ROW, ref: "not-a-ref" }, seams }));
    const read = unwrap(await readAcknowledgementsWith({ home, seams }));
    expect([refused.code, read, store.opened]).toEqual(["STORED_INVALID", [], 1]);
  });
});
