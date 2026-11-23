/**
 * The supersession register's row operations over a store that cannot run a statement: Drizzle's connectionless
 * `drizzle.mock()` database builds every statement for real and then throws when asked to execute it, which is
 * exactly a driver failure. So what is under test is the refusal half — every operation answers a step failure
 * naming what it was doing, never a thrown error and never an empty row — and that `close` is the client's own.
 * What only a real database can prove (the insert-only conflict, the import marker, the round trip) is
 * `src/__tests__/integration/landingRegistersStore.test.ts`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import type { UnplaceableSupersession, WordingSupersession } from "../../../codex/supersession.js";
import { SupersessionStoreErrors } from "../../../codex/supersessionErrors.js";
import {
  type SupersessionPort,
  type SupersessionRows,
  storeSupersessionPort,
} from "../../../codex/supersessionPort.js";
import { supersessionRowsOver } from "../../../codex/supersessionStore.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import * as storeSchema from "../../../store/schema.js";
import { memorySupersessionPort, memorySupersessionStore } from "../../landingRegistersFixture.js";

const NO_TREE: UnplaceableSupersession = {
  artifactId: "b44980e5",
  atIso: "2026-09-30T03:00:00.000Z",
  branch: "feature",
  kind: "no-tree",
  mode: "plan",
  pass: "p2",
  reason: "re-planned",
  replacedBy: "224c5d1c",
};

const WORDING: WordingSupersession = {
  artifactId: "a",
  atIso: "2026-09-30T02:00:00.000Z",
  propertyId: "r1-01",
  reason: "the wording cannot be satisfied",
  replacedBy: "b",
};

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

const FAILED = { doing: "run the statement", reason: "the fake refuses it" };

/**
 * Row operations whose import is already done and whose every statement then answers as told, so the port's
 * own handling of a step that fails after the import — or of a collision nobody can read back — is reachable
 * without a database.
 *
 * @param readAll what a whole-register read answers
 * @param insert what an insert answers
 * @param readArtifact what a one-artifact read answers
 * @returns the rows
 */
function scriptedRows({
  insert = async () => err(FAILED),
  readAll = async () => err(FAILED),
  readArtifact = async () => err(FAILED),
}: Partial<Pick<SupersessionRows, "insert" | "readAll" | "readArtifact">>): SupersessionRows {
  return {
    claim: async () => ok(false),
    close: async () => undefined,
    marker: async () => ok({ records: 0, tableHasRows: false }),
    insert,
    readAll,
    readArtifact,
  };
}

/**
 * The port over scripted rows, with an old file that is never consulted because the import is done.
 *
 * @param rows the scripted rows
 * @returns the port
 */
function portOver({ rows }: { rows: SupersessionRows }): SupersessionPort {
  return storeSupersessionPort({
    seams: {
      connect: async () => ok(rows),
      readImportFile: () => ok({ state: "absent" }),
    },
  });
}

describe("the supersession port when a statement fails after the import", () => {
  const expected = SupersessionStoreErrors.storeUnavailable(FAILED).message;

  it("refuses a read whose whole-register statement fails, never an empty register", async () => {
    const error = unwrapErr(await portOver({ rows: scriptedRows({}) }).read({ home: "/unused" }));

    expect(error.message).toBe(expected);
  });

  it("refuses an append whose insert fails", async () => {
    const error = unwrapErr(await portOver({ rows: scriptedRows({}) }).append({ home: "/unused", row: NO_TREE }));

    expect(error.message).toBe(expected);
  });

  it("refuses an append whose collision cannot be read back", async () => {
    const rows = scriptedRows({ insert: async () => ok(undefined) });

    const error = unwrapErr(await portOver({ rows }).append({ home: "/unused", row: NO_TREE }));

    expect(error.message).toBe(expected);
  });

  it("refuses an append whose collision has vanished by the time it is read back", async () => {
    const rows = scriptedRows({ insert: async () => ok(undefined), readArtifact: async () => ok(undefined) });

    const error = unwrapErr(await portOver({ rows }).append({ home: "/unused", row: WORDING }));

    expect(error.message).toBe(
      SupersessionStoreErrors.storeUnavailable({
        doing: "read back the retirement its insert collided with",
        reason: "no row retires a",
      }).message,
    );
  });
});

describe("the supersession port over an import marker that outlived its rows", () => {
  it("refuses a read whose marker claims imported records over an empty table, never an empty register", async () => {
    const store = memorySupersessionStore();
    store.imported = true;
    store.importedRecords = 1;

    const error = unwrapErr(await memorySupersessionPort({ store }).read({ home: "/unused" }));

    expect(error.message).toBe(
      SupersessionStoreErrors.storeUnavailable({
        doing: "trust its import marker",
        reason: "the marker says 1 record(s) were imported from the old file, and the table holds none",
      }).message,
    );
  });

  it("reads an empty register when the marker imported nothing", async () => {
    const store = memorySupersessionStore();
    store.imported = true;
    store.importedRecords = 0;

    const rows = unwrap(await memorySupersessionPort({ store }).read({ home: "/unused" }));

    expect(rows.size).toBe(0);
  });
});

describe("the supersession register's row operations over a store that cannot run a statement", () => {
  it("refuses a whole-register read as a step failure naming the read", async () => {
    const rows = supersessionRowsOver({ client: unrunnableClient().client });

    expect(unwrapErr(await rows.readAll()).doing).toBe("read the supersession register");
  });

  it("refuses a one-artifact read the same way, naming it", async () => {
    const rows = supersessionRowsOver({ client: unrunnableClient().client });

    expect(unwrapErr(await rows.readArtifact({ artifactId: "a" })).doing).toBe("read a recorded retirement");
  });

  it("refuses inserting a no-tree retirement, naming the write", async () => {
    const rows = supersessionRowsOver({ client: unrunnableClient().client });

    expect(unwrapErr(await rows.insert({ row: NO_TREE })).doing).toBe("record a retirement");
  });

  it("refuses inserting a wording retirement the same way", async () => {
    const rows = supersessionRowsOver({ client: unrunnableClient().client });

    expect(unwrapErr(await rows.insert({ row: WORDING })).doing).toBe("record a retirement");
  });

  it("closes through the client it was given", async () => {
    const { client, closes } = unrunnableClient();
    const rows = supersessionRowsOver({ client });

    await rows.close();

    expect(closes()).toBe(1);
  });
});
