/**
 * The store-backed fallback port's own contract, over in-memory seams: one insert-if-absent attempt per
 * write and never a retry, a typed refusal for every outage, a NUL refused before any connection, and every
 * connection it opens closed.
 */
import { describe, expect, it } from "vitest";

import { FallbackStoreErrors } from "../../../codex/fallbackStoreErrors.js";
import { type FallbackRows, storeFallbackRegisterPort } from "../../../codex/fallbackStorePort.js";
import { ok } from "../../../lib/result.js";
import {
  FALLBACK_FIXTURE_OUTAGE,
  memoryFallbackRegisterPort,
  memoryFallbackStore,
  unavailableFallbackRegisterPort,
} from "../../fallbackRegisterFixture.js";

const HOME = "/h/unused-by-the-memory-store";

describe("the store-backed fallback port", () => {
  it("refuses a second request under an id it already holds, leaving the first text standing", async () => {
    const store = memoryFallbackStore();
    const port = memoryFallbackRegisterPort({ store });
    expect((await port.writeRequest({ home: HOME, requestId: "r-1", requestText: "first" })).isOk()).toBe(true);
    const again = await port.writeRequest({ home: HOME, requestId: "r-1", requestText: "second" });
    expect(again._unsafeUnwrapErr()).toEqual(FallbackStoreErrors.requestIdTaken({ requestId: "r-1" }));
    expect(store.rows.get("r-1")!.requestText).toBe("first");
  });

  it("refuses a second receipt for one request, leaving the first receipt standing", async () => {
    const store = memoryFallbackStore();
    const port = memoryFallbackRegisterPort({ store });
    await port.writeRequest({ home: HOME, requestId: "r-2", requestText: "req" });
    expect((await port.writeReceipt({ home: HOME, receiptText: "one", requestId: "r-2" })).isOk()).toBe(true);
    const again = await port.writeReceipt({ home: HOME, receiptText: "two", requestId: "r-2" });
    expect(again._unsafeUnwrapErr()).toEqual(FallbackStoreErrors.receiptAlreadyRecorded({ requestId: "r-2" }));
    expect(store.rows.get("r-2")!.receiptText).toBe("one");
  });

  it("answers FALLBACK_REQUEST_NOT_FOUND for an id no row carries", async () => {
    const read = await memoryFallbackRegisterPort().readRequest({ home: HOME, requestId: "absent" });
    expect(read._unsafeUnwrapErr()).toEqual(FallbackStoreErrors.requestNotFound({ requestId: "absent" }));
  });

  it("refuses a text holding a NUL byte before it opens any connection", async () => {
    const store = memoryFallbackStore();
    const port = memoryFallbackRegisterPort({ store });
    const request = await port.writeRequest({ home: HOME, requestId: "r-3", requestText: "a\u0000b" });
    const receipt = await port.writeReceipt({ home: HOME, receiptText: "a\u0000b", requestId: "r-3" });
    expect(request._unsafeUnwrapErr().code).toBe("FALLBACK_DOCUMENT_UNSTORABLE");
    expect(receipt._unsafeUnwrapErr()).toEqual(
      FallbackStoreErrors.documentUnstorable({ document: "receipt", reason: "it holds a NUL byte", requestId: "r-3" }),
    );
    expect(store.opened).toBe(0);
  });

  it("refuses every operation with the outage when the store cannot be opened — never an empty answer", async () => {
    const port = unavailableFallbackRegisterPort();
    expect((await port.scan({ home: HOME }))._unsafeUnwrapErr()).toEqual(FALLBACK_FIXTURE_OUTAGE);
    expect((await port.readRequest({ home: HOME, requestId: "x" }))._unsafeUnwrapErr()).toEqual(
      FALLBACK_FIXTURE_OUTAGE,
    );
    expect((await port.writeRequest({ home: HOME, requestId: "x", requestText: "t" }))._unsafeUnwrapErr()).toEqual(
      FALLBACK_FIXTURE_OUTAGE,
    );
    expect((await port.writeReceipt({ home: HOME, receiptText: "t", requestId: "x" }))._unsafeUnwrapErr()).toEqual(
      FALLBACK_FIXTURE_OUTAGE,
    );
  });

  it("closes every connection it opens, on success and on a lost insert alike", async () => {
    const store = memoryFallbackStore();
    const port = memoryFallbackRegisterPort({ store });
    await port.writeRequest({ home: HOME, requestId: "r-4", requestText: "t" });
    await port.writeRequest({ home: HOME, requestId: "r-4", requestText: "t" });
    await port.scan({ home: HOME });
    await port.readRequest({ home: HOME, requestId: "missing" });
    expect(store.opened).toBe(4);
    expect(store.closed).toBe(4);
  });

  it("turns a connect that throws, and a statement that throws, into the typed unavailable refusal", async () => {
    const throwingConnect = storeFallbackRegisterPort({
      seams: { connect: () => Promise.reject(new Error("socket hang up")) },
    });
    const opened = await throwingConnect.scan({ home: HOME });
    expect(opened._unsafeUnwrapErr()).toEqual(
      FallbackStoreErrors.storeUnavailable({ doing: "be opened", reason: "socket hang up" }),
    );

    let closed = 0;
    const rows: FallbackRows = {
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
      insertReceipt: () => Promise.reject(new Error("unused")),
      insertRequest: () => Promise.reject(new Error("deadlock detected")),
      readAll: () => Promise.reject(new Error("unused")),
      readOne: () => Promise.reject(new Error("unused")),
    };
    const throwingStatement = storeFallbackRegisterPort({ seams: { connect: () => Promise.resolve(ok(rows)) } });
    const written = await throwingStatement.writeRequest({ home: HOME, requestId: "r-5", requestText: "t" });
    expect(written._unsafeUnwrapErr()).toEqual(
      FallbackStoreErrors.storeUnavailable({ doing: "finish the operation", reason: "deadlock detected" }),
    );
    expect(closed).toBe(1);
  });

  it("keeps a lost insert's collision refusal when the close then fails, and refuses a won insert's failed close", async () => {
    const closingBadly = ({ inserted }: { inserted: boolean }): FallbackRows => ({
      close: () => Promise.reject(new Error("socket closed")),
      insertReceipt: () => Promise.resolve(ok(inserted)),
      insertRequest: () => Promise.resolve(ok(inserted)),
      readAll: () => Promise.reject(new Error("unused")),
      readOne: () => Promise.reject(new Error("unused")),
    });
    const lost = storeFallbackRegisterPort({
      seams: { connect: () => Promise.resolve(ok(closingBadly({ inserted: false }))) },
    });
    const won = storeFallbackRegisterPort({
      seams: { connect: () => Promise.resolve(ok(closingBadly({ inserted: true }))) },
    });

    expect(
      (await lost.writeRequest({ home: HOME, requestId: "taken", requestText: "new" }))._unsafeUnwrapErr(),
    ).toEqual(FallbackStoreErrors.requestIdTaken({ requestId: "taken" }));
    expect(
      (await lost.writeReceipt({ home: HOME, receiptText: "new", requestId: "taken" }))._unsafeUnwrapErr(),
    ).toEqual(FallbackStoreErrors.receiptAlreadyRecorded({ requestId: "taken" }));
    expect((await won.writeRequest({ home: HOME, requestId: "fresh", requestText: "new" }))._unsafeUnwrapErr()).toEqual(
      FallbackStoreErrors.storeUnavailable({ doing: "close its connection", reason: "socket closed" }),
    );
  });
});
