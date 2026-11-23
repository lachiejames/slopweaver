/**
 * Every step of the store-backed organisation-health port that can meet a failed statement, each failed in turn
 * over the in-memory rows, and the connection helper's two throw paths. Each answers the store's own typed refusal,
 * never an empty answer and never a file read: the row is the authority, so what it holds is unknown when it cannot
 * be read. A row operation is failed by wrapping the fixture's own rows, never by stubbing a module.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { acknowledgementRowFor } from "../../../orgHealth/acknowledgement.js";
import { OrgHealthErrors } from "../../../orgHealth/errors.js";
import type { OrgHealthPort } from "../../../orgHealth/port.js";
import { storeOrgHealthPort } from "../../../orgHealth/storePort.js";
import { type OrgHealthRows, withOrgHealthRows } from "../../../orgHealth/storeSeams.js";
import type { UnmeasurableIncidentSnapshot } from "../../../orgHealth/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type MemoryOrgHealthStore, memoryOrgHealthSeams, memoryOrgHealthStore } from "../../orgHealthStoreFixture.js";
import { orgIncident } from "./orgIncidentFixture.js";

/** The refusal every failed fixture statement answers. */
const OUTAGE = OrgHealthErrors.storeUnavailable({ doing: "run the fixture step", reason: "a fixture failure" });

/** An under-way marker. */
const MARKER: UnmeasurableIncidentSnapshot = {
  attemptedIso: "2026-10-04T09:00:00.000Z",
  because: "an incident read started at 2026-10-04T09:00:00.000Z",
  schemaVersion: 1,
  state: "unmeasurable",
};

/** One press. */
const PRESS = acknowledgementRowFor({
  acknowledgedIso: "2026-10-06T11:31:00.000Z",
  bySession: "work-console",
  incident: orgIncident(),
});

/**
 * The port over the in-memory store with some row operations replaced, each replacement given the real rows.
 *
 * @param store the in-memory store
 * @param over the replacements, built over the connection's real rows
 * @returns the port
 */
function portWith({
  store,
  over,
}: {
  store: MemoryOrgHealthStore;
  over: (rows: OrgHealthRows) => Partial<OrgHealthRows>;
}): OrgHealthPort {
  const seams = memoryOrgHealthSeams({ store });
  return storeOrgHealthPort({
    seams: {
      ...seams,
      connect: async ({ home }) => (await seams.connect({ home })).map((rows) => ({ ...rows, ...over(rows) })),
    },
  });
}

/**
 * A count of calls that answers whether this one is at or past the `from`th.
 *
 * @param from the first call that fails, 1-based
 * @returns a function to call once per call, answering whether it fails
 */
function failsFrom({ from }: { from: number }): () => boolean {
  let calls = 0;
  return () => {
    calls += 1;
    return calls >= from;
  };
}

describe("the store-backed snapshot and sightings, one failed statement at a time", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-refusals-"));
    store = memoryOrgHealthStore();
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a snapshot read whose first row read fails", async () => {
    const port = portWith({ over: () => ({ readDocument: () => Promise.resolve(err(OUTAGE)) }), store });
    const refused = unwrapErr(await port.readSnapshot({ home }));
    expect([refused.code, refused.message]).toEqual(["STORE_UNAVAILABLE", OUTAGE.message]);
  });

  it("refuses a snapshot import whose insert fails", async () => {
    const port = portWith({ over: () => ({ insertDocument: () => Promise.resolve(err(OUTAGE)) }), store });
    const refused = unwrapErr(await port.readSnapshot({ home }));
    expect([refused.code, refused.message]).toEqual(["STORE_UNAVAILABLE", OUTAGE.message]);
  });

  it("refuses a snapshot import whose read-back fails", async () => {
    const failing = failsFrom({ from: 2 });
    const port = portWith({
      over: (rows) => ({
        readDocument: (request) => (failing() ? Promise.resolve(err(OUTAGE)) : rows.readDocument(request)),
      }),
      store,
    });
    const refused = unwrapErr(await port.readSnapshot({ home }));
    expect([refused.code, refused.message]).toEqual(["STORE_UNAVAILABLE", OUTAGE.message]);
  });

  it("refuses a snapshot import whose insert was refused and left no row to read back", async () => {
    const port = portWith({ over: () => ({ insertDocument: () => Promise.resolve(ok(undefined)) }), store });
    const refused = unwrapErr(await port.readSnapshot({ home }));
    expect(refused.code).toBe("STORE_UNAVAILABLE");
    expect(refused.message).toContain("the store could not import the incident snapshot");
  });

  it("refuses a stored sightings row that does not decode as STORED_INVALID, never as no memory", async () => {
    const port = portWith({ over: () => ({}), store });
    expect(unwrap(await port.readSightings({ home }))).toBe(undefined);
    store.homes.get(home)!.sightings = { document: { schemaVersion: 99 }, revision: 2 };
    expect(unwrapErr(await port.readSightings({ home })).code).toBe("STORED_INVALID");
  });

  it("refuses a read's begin whose first row read fails", async () => {
    const port = portWith({ over: () => ({ readDocument: () => Promise.resolve(err(OUTAGE)) }), store });
    expect(unwrapErr(await port.beginRead({ home, marker: MARKER })).message).toBe(OUTAGE.message);
  });

  it("refuses a read's begin over no row whose marker insert fails", async () => {
    const port = portWith({ over: () => ({ insertDocument: () => Promise.resolve(err(OUTAGE)) }), store });
    expect(unwrapErr(await port.beginRead({ home, marker: MARKER })).message).toBe(OUTAGE.message);
  });

  it("refuses a read's begin that lost the insert race and then cannot read the winner's row", async () => {
    const failing = failsFrom({ from: 2 });
    const port = portWith({
      over: (rows) => ({
        insertDocument: () => Promise.resolve(ok(undefined)),
        readDocument: (request) => (failing() ? Promise.resolve(err(OUTAGE)) : rows.readDocument(request)),
      }),
      store,
    });
    expect(unwrapErr(await port.beginRead({ home, marker: MARKER })).message).toBe(OUTAGE.message);
  });

  it("refuses a read's begin whose compare-and-set fails", async () => {
    const port = portWith({ over: () => ({ replaceIncident: () => Promise.resolve(err(OUTAGE)) }), store });
    unwrap(await port.beginRead({ home, marker: MARKER }));
    expect(unwrapErr(await port.beginRead({ home, marker: MARKER })).message).toBe(OUTAGE.message);
  });

  it("refuses a read's begin as REVISION_CONFLICT when its compare-and-set finds the row moved", async () => {
    const port = portWith({ over: () => ({ replaceIncident: () => Promise.resolve(ok(undefined)) }), store });
    unwrap(await port.beginRead({ home, marker: MARKER }));
    expect(unwrapErr(await port.beginRead({ home, marker: MARKER })).code).toBe("REVISION_CONFLICT");
  });
});

describe("the store-backed acknowledgement ledger, one failed statement at a time", () => {
  let home: string;
  let store: MemoryOrgHealthStore;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-ledger-refusals-"));
    store = memoryOrgHealthStore();
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a read whose marker check fails", async () => {
    const port = portWith({ over: () => ({ acknowledgementsImported: () => Promise.resolve(err(OUTAGE)) }), store });
    const refused = unwrapErr(await port.readAcknowledgements({ home }));
    expect(refused.code).toBe("STORE_UNAVAILABLE");
    expect(refused.message).toContain("could not run the fixture step");
  });

  it("refuses a read whose recheck after a damaged ledger fails, never as the file's error", async () => {
    const path = stateHomePaths({ home }).orgHealthAcknowledgementsJsonl;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json\n");
    const failing = failsFrom({ from: 2 });
    const port = portWith({
      over: (rows) => ({
        acknowledgementsImported: () => (failing() ? Promise.resolve(err(OUTAGE)) : rows.acknowledgementsImported()),
      }),
      store,
    });
    const refused = unwrapErr(await port.readAcknowledgements({ home }));
    expect(refused.code).toBe("STORE_UNAVAILABLE");
    expect(refused.message).toContain("could not run the fixture step");
  });

  it("refuses a read whose import write fails", async () => {
    const port = portWith({ over: () => ({ importAcknowledgements: () => Promise.resolve(err(OUTAGE)) }), store });
    expect(unwrapErr(await port.readAcknowledgements({ home })).message).toContain("could not run the fixture step");
  });

  it("refuses a read whose marker read-back after the import fails", async () => {
    const failing = failsFrom({ from: 2 });
    const port = portWith({
      over: (rows) => ({
        acknowledgementsImported: () => (failing() ? Promise.resolve(err(OUTAGE)) : rows.acknowledgementsImported()),
      }),
      store,
    });
    expect(unwrapErr(await port.readAcknowledgements({ home })).message).toContain("could not run the fixture step");
  });

  it("refuses a read whose import committed no marker to read back", async () => {
    const port = portWith({ over: () => ({ importAcknowledgements: () => Promise.resolve(ok(undefined)) }), store });
    const refused = unwrapErr(await port.readAcknowledgements({ home }));
    expect(refused.code).toBe("STORE_UNAVAILABLE");
    expect(refused.message).toContain("the import committed no marker to read back");
  });

  it("refuses a read whose ordered row read fails", async () => {
    const port = portWith({ over: () => ({ acknowledgementDocuments: () => Promise.resolve(err(OUTAGE)) }), store });
    expect(unwrapErr(await port.readAcknowledgements({ home })).message).toContain("could not run the fixture step");
  });

  it("refuses a press whose insert fails, after its import", async () => {
    const port = portWith({ over: () => ({ insertAcknowledgement: () => Promise.resolve(err(OUTAGE)) }), store });
    expect(unwrapErr(await port.appendAcknowledgement({ home, row: PRESS })).message).toContain(
      "could not run the fixture step",
    );
    expect(store.homes.get(home)!.acknowledgements.map((row) => row.kind)).toEqual(["legacy-import"]);
  });
});

describe("withOrgHealthRows", () => {
  const unavailable = ({ doing, reason }: { doing: string; reason: string }): string => `${doing}: ${reason}`;

  it("refuses a connect that throws as the caller's own store refusal", async () => {
    const seams = {
      ...memoryOrgHealthSeams({ store: memoryOrgHealthStore() }),
      connect: () => Promise.reject(new Error("the socket closed")),
    };
    const answered = await withOrgHealthRows<string, string>({
      body: () => Promise.resolve(ok("unreached")),
      home: "/nowhere",
      seams,
      unavailable,
    });
    expect(unwrapErr(answered)).toBe("be opened: the socket closed");
  });

  it("refuses a close that throws, even after the body answered", async () => {
    const store = memoryOrgHealthStore();
    const memory = memoryOrgHealthSeams({ store });
    const seams = {
      ...memory,
      connect: async ({ home }: { home: string }) =>
        (await memory.connect({ home })).map((rows) => ({
          ...rows,
          close: () => Promise.reject(new Error("the close failed")),
        })),
    };
    const answered = await withOrgHealthRows<string, string>({
      body: () => Promise.resolve(ok("done")),
      home: "/nowhere",
      seams,
      unavailable,
    });
    expect(unwrapErr(answered)).toBe("close its connection: the close failed");
  });
});
