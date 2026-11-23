/**
 * A batch settles the register document four ways — assert none, create, update, delete — each compared inside the
 * batch, and a whole-register batch must state which. Driven over the in-memory store, which
 * answers through the port's own judges and refusal mapping, so this is the contract the real store is held to in
 * `src/__tests__/integration/workstreamStoreBatch.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { inMemoryWorkstreamStore } from "../../../workstreamStoreFake.js";
import { ACME_META, acmeLocal } from "../../../workstreamStoreFixtures.js";

const HOME = "/acme/home";
const NOW = "2026-11-07T05:00:00.000Z";

describe("a batch settling the register document", () => {
  it("asserts there is no document and writes none, so a whole-register create over an empty store commits", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const result = unwrap(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        meta: { document: null, expectedRevision: null },
        wholeRegister: {},
        writes: [{ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null }],
      }),
    );

    expect(result.meta).toBe(null);
    expect(unwrap(await store.read({ home: HOME })).meta).toBe(null);
    expect(unwrap(await store.read({ home: HOME })).workstreams.map((one) => one.id)).toEqual(["acme-a"]);
  });

  it("refuses an asserted absence once a document exists, rolling back the rows written beside it", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    const before = unwrap(await store.read({ home: HOME }));
    const error = unwrapErr(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        meta: { document: null, expectedRevision: null },
        wholeRegister: {},
        writes: [{ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null }],
      }),
    );

    expect(error.message).toBe(
      "the workstream register document already exists — read it and write its current revision",
    );
    expect(unwrap(await store.read({ home: HOME }))).toEqual(before);
  });

  it("deletes the document at its revision, alone, so a register can go back to having none", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    const result = unwrap(
      await store.applyBatch({ deletes: [], home: HOME, meta: { document: null, expectedRevision: 1 }, writes: [] }),
    );

    expect(result.meta).toBe(null);
    expect(unwrap(await store.read({ home: HOME })).meta).toBe(null);
  });

  it("refuses a delete at a revision the document has moved past, keeping the document and every row", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    unwrap(await store.putMeta({ document: { ...ACME_META, initiatives: [] }, expectedRevision: 1, home: HOME }));
    const before = unwrap(await store.read({ home: HOME }));
    const error = unwrapErr(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        meta: { document: null, expectedRevision: 1 },
        writes: [{ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null }],
      }),
    );

    expect(error.message).toBe("the workstream register document is no longer at revision 1 — read it again");
    expect(unwrap(await store.read({ home: HOME }))).toEqual(before);
  });

  it("refuses a whole-register batch that leaves the document out, before anything is compared", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const error = unwrapErr(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        wholeRegister: {},
        writes: [{ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null }],
      }),
    );

    expect(error.message).toBe(
      "the workstream was refused, nothing written: a whole-register batch states the register document it expects — its revision, or null for none — so the compare covers it too",
    );
    expect(unwrap(await store.read({ home: HOME })).workstreams).toEqual([]);
  });

  it("refuses an asserted absence with nothing else to do as a batch that changes nothing", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const error = unwrapErr(
      await store.applyBatch({ deletes: [], home: HOME, meta: { document: null, expectedRevision: null }, writes: [] }),
    );

    expect(error.message).toBe(
      "the workstream was refused, nothing written: the batch writes, deletes and changes nothing",
    );
  });

  it("refuses a delete of the document at a revision no row could carry, as invalid", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const error = unwrapErr(
      await store.applyBatch({ deletes: [], home: HOME, meta: { document: null, expectedRevision: 0 }, writes: [] }),
    );

    expect(error.message).toBe(
      "the workstream was refused, nothing written: the register document's delete names revision 0, which no stored workstream carries",
    );
  });
});
