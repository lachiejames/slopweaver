import { describe, expect, it } from "vitest";

import type { GrantEntry, GrantRow } from "../../../grants/grant.js";
import { GrantStoreErrors } from "../../../grants/storeErrors.js";
import { type GrantRows, storeGrantJournalPort } from "../../../grants/storePort.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { grantEntryRow } from "../../../store/fleet/grantRow.js";
import { GRANT_FIXTURE_OUTAGE, memoryGrantJournalPort, memoryGrantStore } from "../../grantJournalFixture.js";

const HOME = "/home-under-test";

const ROW: GrantRow = {
  anchor: "transcript:aaaa#bbbb",
  change: "TIMEOUT = 30",
  changeKind: "literal",
  id: "g-alpha",
  pinnedAtRecord: false,
  recordedAtIso: "2026-10-01T00:00:00.000Z",
  recordedBySessionId: "session-alpha",
  target: { kind: "system", name: "linear" },
};

const GRANT: GrantEntry = { grant: ROW, kind: "grant" };

const PERFORMANCE: GrantEntry = {
  kind: "performance",
  performance: {
    grantId: "g-alpha",
    performedAtIso: "2026-10-01T00:05:00.000Z",
    performedBySessionId: "session-bravo",
    wrote: "TIMEOUT = 30",
  },
};

/**
 * A refusal of the fixture grant.
 *
 * @returns the entry
 */
function refusal({ why }: { why: string }): GrantEntry {
  return {
    kind: "refusal",
    refusal: {
      code: "RAIL_CROSSED",
      grantId: "g-alpha",
      refusedAtIso: "2026-10-01T00:06:00.000Z",
      refusedBySessionId: "session-bravo",
      why,
    },
  };
}

/**
 * Row operations whose every call is answered as given, counting closes.
 *
 * @returns the rows and the close counter
 */
function scriptedRows({ insert, close }: { insert: GrantRows["insert"]; close: GrantRows["close"] }): GrantRows {
  return { close, insert, readAll: () => Promise.resolve(ok([])) };
}

describe("storeGrantJournalPort — writes", () => {
  it("writes a grant, a performance and refusals, and reads them back in written order", async () => {
    const store = memoryGrantStore();
    const port = memoryGrantJournalPort({ nonces: ["n-1", "n-2"], store });
    unwrap(await port.appendEntry({ entry: GRANT, home: HOME }));
    unwrap(await port.appendEntry({ entry: PERFORMANCE, home: HOME }));
    unwrap(await port.appendEntry({ entry: refusal({ why: "first" }), home: HOME }));
    unwrap(await port.appendEntry({ entry: refusal({ why: "second" }), home: HOME }));
    expect(unwrap(await port.readEntries({ home: HOME }))).toEqual([
      GRANT,
      PERFORMANCE,
      refusal({ why: "first" }),
      refusal({ why: "second" }),
    ]);
    expect(store.rows.map((row) => row.importKey)).toEqual([
      "written:grant:g-alpha",
      "written:performance:g-alpha",
      "written:refusal:g-alpha:n-1",
      "written:refusal:g-alpha:n-2",
    ]);
  });

  it("refuses a second grant under a recorded id as GRANT_ID_TAKEN, writing nothing and trying once", async () => {
    const store = memoryGrantStore();
    const port = memoryGrantJournalPort({ store });
    unwrap(await port.appendEntry({ entry: GRANT, home: HOME }));
    const second = await port.appendEntry({ entry: { grant: { ...ROW, change: "other" }, kind: "grant" }, home: HOME });
    expect(unwrapErr(second)).toEqual(GrantStoreErrors.idTaken({ grantId: "g-alpha" }));
    expect(store.rows.length).toBe(1);
    expect(store.inserts).toBe(2);
  });

  it("refuses a second performance as GRANT_ALREADY_PERFORMED — one row is one change", async () => {
    const store = memoryGrantStore();
    const port = memoryGrantJournalPort({ store });
    unwrap(await port.appendEntry({ entry: GRANT, home: HOME }));
    unwrap(await port.appendEntry({ entry: PERFORMANCE, home: HOME }));
    const again = await port.appendEntry({ entry: PERFORMANCE, home: HOME });
    expect(unwrapErr(again)).toEqual(GrantStoreErrors.alreadyPerformed({ grantId: "g-alpha" }));
    expect(store.rows.length).toBe(2);
  });

  it("refuses a performance against a LEGACY row's performance, which carries a line-hash key rather than a derived one", async () => {
    const store = memoryGrantStore();
    store.rows.push(unwrap(grantEntryRow({ entry: PERFORMANCE, importKey: "line-hash-0001", verbatim: PERFORMANCE })));
    const port = memoryGrantJournalPort({ store });
    const performed = await port.appendEntry({ entry: PERFORMANCE, home: HOME });
    expect(unwrapErr(performed)).toEqual(GrantStoreErrors.alreadyPerformed({ grantId: "g-alpha" }));
  });

  it("refuses a refusal whose generated key collides as GRANT_REFUSAL_KEY_TAKEN, never minting another", async () => {
    const store = memoryGrantStore();
    const port = memoryGrantJournalPort({ nonces: ["same", "same"], store });
    unwrap(await port.appendEntry({ entry: refusal({ why: "first" }), home: HOME }));
    const second = await port.appendEntry({ entry: refusal({ why: "second" }), home: HOME });
    expect(unwrapErr(second)).toEqual(GrantStoreErrors.refusalKeyTaken({ grantId: "g-alpha" }));
    expect(store.inserts).toBe(2);
  });

  it("refuses an entry holding a NUL byte before opening the store, never stripping it", async () => {
    const store = memoryGrantStore();
    const port = memoryGrantJournalPort({ store });
    const written = await port.appendEntry({
      entry: { grant: { ...ROW, change: "a\u0000b" }, kind: "grant" },
      home: HOME,
    });
    expect(unwrapErr(written)).toEqual(
      GrantStoreErrors.entryUnstorable({ grantId: "g-alpha", reason: "it holds a NUL byte" }),
    );
    expect(store.opened).toBe(0);
  });

  it("refuses an entry whose instant is not one", async () => {
    const port = memoryGrantJournalPort();
    const written = await port.appendEntry({
      entry: { grant: { ...ROW, recordedAtIso: "soon" }, kind: "grant" },
      home: HOME,
    });
    expect(unwrapErr(written)).toEqual(
      GrantStoreErrors.entryUnstorable({ grantId: "g-alpha", reason: "soon is not an instant" }),
    );
  });

  it("closes every connection it opens, on success and on a lost insert alike", async () => {
    const store = memoryGrantStore();
    const port = memoryGrantJournalPort({ store });
    unwrap(await port.appendEntry({ entry: GRANT, home: HOME }));
    unwrapErr(await port.appendEntry({ entry: GRANT, home: HOME }));
    unwrap(await port.readEntries({ home: HOME }));
    expect(store.opened).toBe(3);
    expect(store.closed).toBe(3);
  });
});

describe("storeGrantJournalPort — reads", () => {
  it("reads an empty store as an empty journal", async () => {
    expect(unwrap(await memoryGrantJournalPort().readEntries({ home: HOME }))).toEqual([]);
  });

  it("refuses the whole read on a row that does not decode, naming its key", async () => {
    const store = memoryGrantStore();
    store.rows.push(unwrap(grantEntryRow({ entry: GRANT, importKey: "written:grant:g-alpha", verbatim: GRANT })));
    store.rows.push({
      ...unwrap(grantEntryRow({ entry: PERFORMANCE, importKey: "line-hash-0002", verbatim: PERFORMANCE })),
      entry: { kind: "revocation" },
    });
    const read = await memoryGrantJournalPort({ store }).readEntries({ home: HOME });
    expect(unwrapErr(read)).toEqual(GrantStoreErrors.rowUnreadable({ importKey: "line-hash-0002" }));
  });
});

describe("storeGrantJournalPort — an outage is a typed refusal", () => {
  it("refuses a read and a write when the store cannot be opened", async () => {
    const port = storeGrantJournalPort({
      seams: { connect: () => Promise.resolve(err(GRANT_FIXTURE_OUTAGE)), refusalNonce: () => "unused" },
    });
    expect(unwrapErr(await port.readEntries({ home: HOME }))).toEqual(GRANT_FIXTURE_OUTAGE);
    expect(unwrapErr(await port.appendEntry({ entry: GRANT, home: HOME }))).toEqual(GRANT_FIXTURE_OUTAGE);
  });

  it("refuses when opening the store throws rather than answering", async () => {
    const port = storeGrantJournalPort({
      seams: { connect: () => Promise.reject(new Error("socket hang up")), refusalNonce: () => "unused" },
    });
    expect(unwrapErr(await port.readEntries({ home: HOME }))).toEqual(
      GrantStoreErrors.storeUnavailable({ doing: "be opened", reason: "socket hang up" }),
    );
  });

  it("refuses an insert that throws, and still closes the connection", async () => {
    let closed = 0;
    const rows = scriptedRows({
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
      insert: () => Promise.reject(new Error("statement timeout")),
    });
    const port = storeGrantJournalPort({
      seams: { connect: () => Promise.resolve(ok(rows)), refusalNonce: () => "n" },
    });
    expect(unwrapErr(await port.appendEntry({ entry: GRANT, home: HOME }))).toEqual(
      GrantStoreErrors.storeUnavailable({ doing: "finish the operation", reason: "statement timeout" }),
    );
    expect(closed).toBe(1);
  });

  it("refuses a committed write whose close throws, so the caller never reads it as a clean success", async () => {
    const rows = scriptedRows({
      close: () => Promise.reject(new Error("connection reset")),
      insert: () => Promise.resolve(ok(true)),
    });
    const port = storeGrantJournalPort({
      seams: { connect: () => Promise.resolve(ok(rows)), refusalNonce: () => "n" },
    });
    expect(unwrapErr(await port.appendEntry({ entry: GRANT, home: HOME }))).toEqual(
      GrantStoreErrors.storeUnavailable({ doing: "close its connection", reason: "connection reset" }),
    );
  });

  it("keeps a lost insert's collision when the close then throws, rather than reporting an outage", async () => {
    const rows = scriptedRows({
      close: () => Promise.reject(new Error("connection reset")),
      insert: () => Promise.resolve(ok(false)),
    });
    const port = storeGrantJournalPort({
      seams: { connect: () => Promise.resolve(ok(rows)), refusalNonce: () => "n" },
    });
    expect(unwrapErr(await port.appendEntry({ entry: GRANT, home: HOME }))).toEqual(
      GrantStoreErrors.idTaken({ grantId: "g-alpha" }),
    );
  });
});
