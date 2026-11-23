/**
 * The store-backed door ledger's readiness gate, over the in-memory seams: what the port answers before the
 * one-time import has run, and that every connection it opens is closed again.
 */
import { describe, expect, it } from "vitest";

import { DoorStoreErrors } from "../../../admit/doorStoreErrors.js";
import { type DoorSourcePresence, type DoorStoreSeams, storeDoorLedgerPort } from "../../../admit/doorStorePort.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { type MemoryDoorStore, memoryDoorSeams, memoryDoorStore } from "../../doorLedgerFixture.js";

/** A store with no import record and nothing in it — a home that has never been imported. */
function unimportedStore(): MemoryDoorStore {
  return { ...memoryDoorStore(), imported: false };
}

/** The refusal code a refusal read answers, through a port over these seams. */
async function readCode({ seams }: { seams: DoorStoreSeams }): Promise<string> {
  const read = await storeDoorLedgerPort({ seams }).readRecentPreDoorRefusals({ home: "/fixture", limit: 5 });
  expect(read.isErr()).toBe(true);
  return unwrapErr(read).code;
}

describe("storeDoorLedgerPort readiness", () => {
  it("answers once the import has run, whatever the file says", async () => {
    const store = memoryDoorStore();
    const seams = memoryDoorSeams({ source: { kind: "present" }, store });

    const read = await storeDoorLedgerPort({ seams }).readRecentPreDoorRefusals({ home: "/fixture", limit: 5 });

    expect(unwrap(read)).toEqual([]);
    expect(store.closed).toBe(store.opened);
  });

  it("refuses DOOR_NOT_IMPORTED while the legacy file stands and the import has not run", async () => {
    const store = unimportedStore();

    const code = await readCode({ seams: memoryDoorSeams({ source: { kind: "present" }, store }) });

    expect(code).toBe("DOOR_NOT_IMPORTED");
    expect(store.closed).toBe(1);
  });

  it("refuses DOOR_IMPORT_STATE_UNAVAILABLE when the file's presence cannot be told", async () => {
    const source: DoorSourcePresence = { kind: "unknown", reason: "EACCES" };

    const code = await readCode({ seams: memoryDoorSeams({ source, store: unimportedStore() }) });

    expect(code).toBe("DOOR_IMPORT_STATE_UNAVAILABLE");
  });

  it("refuses DOOR_NOT_IMPORTED over a mirror row with no record, even with the file gone", async () => {
    const store = unimportedStore();
    store.rows.push({
      action: "verb:slack.post",
      effect: "external-write",
      importKey: "mirror-1",
      occurredAt: new Date("2026-10-01T00:00:00.000Z"),
      provenance: "attributed",
      status: "pass",
    });

    const code = await readCode({ seams: memoryDoorSeams({ store }) });

    expect(code).toBe("DOOR_NOT_IMPORTED");
  });

  it("answers an empty trail when nothing was ever imported and there is nothing to import", async () => {
    const seams = memoryDoorSeams({ store: unimportedStore() });

    const read = await storeDoorLedgerPort({ seams }).readRecentPreDoorRefusals({ home: "/fixture", limit: 5 });

    expect(unwrap(read)).toEqual([]);
  });

  it("sees a legacy file created while the gate was awaiting the store, because the stat is its last step", async () => {
    const store = unimportedStore();
    const base = memoryDoorSeams({ store });
    const state = { created: false };
    const seams: DoorStoreSeams = {
      ...base,
      connect: async (request) => {
        const rows = unwrap(await base.connect(request));
        return ok({
          ...rows,
          unfilled: async () => {
            const answer = await rows.unfilled();
            state.created = true;
            return answer;
          },
        });
      },
      source: (request) => {
        const seen = base.source(request);
        return state.created ? { ...seen, presence: { kind: "present" } } : seen;
      },
    };

    expect(await readCode({ seams })).toBe("DOOR_NOT_IMPORTED");
  });

  it("refuses DOOR_STORE_UNAVAILABLE when the store cannot be opened, never reading the file instead", async () => {
    const unreachable = DoorStoreErrors.storeUnavailable({ doing: "be opened", reason: "fixture: down" });

    const code = await readCode({
      seams: memoryDoorSeams({ source: { kind: "present" }, store: memoryDoorStore(), unreachable }),
    });

    expect(code).toBe("DOOR_STORE_UNAVAILABLE");
  });
});
