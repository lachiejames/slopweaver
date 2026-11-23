/**
 * The workstream register's batch against a REAL store: what fake seams cannot prove — several workstreams and the
 * register document committing together or not at all, a refusal after a write rolling every write back, and the
 * batch's locks ordering it against a concurrent document write, delete and create.
 *
 * OPT-IN, and never in CI, exactly as `./workstreamStore.test.ts` (whose header carries the commands); point it at the
 * same THROWAWAY database:
 *
 *   WORKSTREAM_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/workstream_store_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/workstreamStoreBatch.test.ts
 */
import { rmSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import type { StoreClient } from "../../store/client.js";
import { workstreamTable } from "../../store/schema.js";
import { deleteWorkstreamIn, writeAggregateIn } from "../../workstreams/store/aggregateWrite.js";
import { applyWorkstreamBatchIn } from "../../workstreams/store/batchWrite.js";
import { WorkstreamStoreErrors } from "../../workstreams/store/errors.js";
import { workstreamStore } from "../../workstreams/store/port.js";
import { productionWorkstreamStoreSeams } from "../../workstreams/store/rows.js";
import type { WorkstreamAggregate } from "../../workstreams/store/types.js";
import { ACME_META, acmeLocal, acmeOutcome } from "../workstreamStoreFixtures.js";

import { gate, linkTo, PROOF_URL, useRealStore, waitForLockWaiters } from "./workstreamStoreProof.js";

describe.skipIf(PROOF_URL === undefined)("a workstream batch in a real store", () => {
  let client: StoreClient;
  let home = "";
  const store = workstreamStore({ seams: productionWorkstreamStoreSeams() });

  useRealStore({
    onClient: (opened) => {
      client = opened;
    },
    onHome: (made) => {
      home = made;
    },
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const lockWaiters = ({ count }: { count: number }): Promise<void> => waitForLockWaiters({ client, count });

  const put = ({
    aggregate,
    expectedRevision = null,
  }: {
    aggregate: WorkstreamAggregate;
    expectedRevision?: number | null;
  }) => store.put({ aggregate, expectedRevision, home });

  /** Every workstream as `[id, revision]`, and the document's revision — what a rolled-back batch must not move. */
  const registerState = async (): Promise<unknown> => {
    const snapshot = unwrap(await store.read({ home }));
    return {
      meta: snapshot.meta === null ? null : snapshot.meta.revision,
      workstreams: snapshot.workstreams.map((one) => [one.id, one.revision, one.name]),
    };
  };

  const linking = ({ id, targets }: { id: string; targets: readonly string[] }): WorkstreamAggregate => ({
    ...acmeLocal({ id }),
    links: targets.map((target, n) => linkTo({ n, target })),
  });

  it("commits creates, an update, a delete and the document together — two new workstreams linking each other", async () => {
    unwrap(await put({ aggregate: acmeOutcome() }));
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-old" }) }));
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home }));
    const result = unwrap(
      await store.applyBatch({
        deletes: [{ expectedRevision: 1, workstreamId: "acme-old" }],
        home,
        meta: { document: { ...ACME_META, initiatives: [] }, expectedRevision: 1 },
        wholeRegister: { "acme-old": 1, "acme-onboarding": 1 },
        writes: [
          { aggregate: linking({ id: "acme-b", targets: ["acme-a"] }), expectedRevision: null },
          { aggregate: linking({ id: "acme-a", targets: ["acme-b", "acme-onboarding"] }), expectedRevision: null },
          { aggregate: acmeOutcome({ name: "Acme onboarding, batched" }), expectedRevision: 1 },
        ],
      }),
    );
    const snapshot = unwrap(await store.read({ home }));

    expect(result.written.map((one) => [one.id, one.revision])).toEqual([
      ["acme-a", 1],
      ["acme-b", 1],
      ["acme-onboarding", 2],
    ]);
    expect(snapshot.workstreams).toEqual(result.written);
    expect([result.meta!.revision, snapshot.meta!.revision, snapshot.meta!.document.initiatives]).toEqual([2, 2, []]);
  });

  it("refuses a delete naming an id no row could carry as invalid, before PostgreSQL refuses its U+0000", async () => {
    const alone = unwrapErr(await store.remove({ expectedRevision: 1, home, workstreamId: "\u0000" }));
    const batched = unwrapErr(
      await store.applyBatch({ deletes: [{ expectedRevision: 1, workstreamId: "\u0000" }], home, writes: [] }),
    );

    expect([alone.code, batched.code]).toEqual(["WORKSTREAM_INVALID", "WORKSTREAM_INVALID"]);
    await expect(
      client.db.select().from(workstreamTable).where(eq(workstreamTable.id, "\u0000")),
    ).rejects.toMatchObject({ cause: { code: "22021" } });
  });

  it("rolls back every write when one revision is stale, the document included", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-z" }) }));
    unwrap(await put({ aggregate: { ...acmeLocal({ id: "acme-z" }), name: "moved on" }, expectedRevision: 1 }));
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home }));
    const before = await registerState();
    const error = unwrapErr(
      await store.applyBatch({
        deletes: [],
        home,
        meta: { document: { ...ACME_META, initiatives: [] }, expectedRevision: 1 },
        writes: [
          { aggregate: acmeLocal({ id: "acme-new" }), expectedRevision: null },
          { aggregate: { ...acmeLocal({ id: "acme-a" }), name: "renamed" }, expectedRevision: 1 },
          { aggregate: acmeLocal({ id: "acme-z" }), expectedRevision: 1 },
        ],
      }),
    );

    expect(error).toEqual(WorkstreamStoreErrors.conflict({ expectedRevision: 1, workstreamId: "acme-z" }));
    expect(await registerState()).toEqual(before);
  });

  it("rolls back an update already written when a delete is still linked from a survivor, or the document is stale", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-z" }) }));
    unwrap(await put({ aggregate: linking({ id: "acme-y", targets: ["acme-z"] }) }));
    const before = await registerState();
    const renamed = { aggregate: { ...acmeLocal({ id: "acme-a" }), name: "renamed" }, expectedRevision: 1 };
    const referenced = unwrapErr(
      await store.applyBatch({ deletes: [{ expectedRevision: 1, workstreamId: "acme-z" }], home, writes: [renamed] }),
    );
    const staleMeta = unwrapErr(
      await store.applyBatch({
        deletes: [],
        home,
        meta: { document: ACME_META, expectedRevision: 1 },
        writes: [renamed],
      }),
    );

    expect([referenced.message, staleMeta.code]).toEqual([
      "workstream acme-z is linked from acme-y — remove those links first",
      "WORKSTREAM_META_REVISION_CONFLICT",
    ]);
    expect(await registerState()).toEqual(before);
  });

  it("deletes a workstream with its only linker together, and refuses a link to one the same batch deletes", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-z" }) }));
    unwrap(await put({ aggregate: linking({ id: "acme-y", targets: ["acme-z"] }) }));
    const dangling = unwrapErr(
      await store.applyBatch({
        deletes: [{ expectedRevision: 1, workstreamId: "acme-z" }],
        home,
        writes: [{ aggregate: linking({ id: "acme-new", targets: ["acme-z"] }), expectedRevision: null }],
      }),
    );
    unwrap(
      await store.applyBatch({
        deletes: [
          { expectedRevision: 1, workstreamId: "acme-y" },
          { expectedRevision: 1, workstreamId: "acme-z" },
        ],
        home,
        writes: [],
      }),
    );

    expect(dangling.message).toBe(
      "the workstream was refused, nothing written: acme-new links workstream acme-z, which the batch does not leave in the register",
    );
    expect(unwrap(await store.read({ home })).workstreams).toEqual([]);
  });

  it("holds a concurrent document write until it commits, so that write is judged against the batch's document", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home }));
    const applied = gate();
    const release = gate();
    const batching = client.db.transaction(async (writer) => {
      try {
        const outcome = await applyWorkstreamBatchIn({
          request: {
            deletes: [],
            meta: { document: { ...ACME_META, initiatives: [] }, expectedRevision: 1 },
            writes: [],
          },
          writer,
        });
        applied.open();
        await release.passed;
        return outcome.kind;
      } finally {
        applied.open();
      }
    });
    await applied.passed;
    const racing = store.putMeta({ document: ACME_META, expectedRevision: 1, home });
    await lockWaiters({ count: 1 });
    release.open();

    expect(await batching).toBe("applied");
    expect(unwrapErr(await racing)).toEqual(WorkstreamStoreErrors.metaConflict({ expectedRevision: 1 }));
    const meta = unwrap(await store.read({ home })).meta!;
    expect([meta.revision, meta.document.initiatives]).toEqual([2, []]);
  });

  it("waits on a delete that locked its row before the batch, then refuses a link to the workstream it removed", async () => {
    // A remove's `FOR UPDATE` does not conflict with the table lock: without the key-share lock first, the batch
    // would commit a link to acme-z here and the delete would land after it.
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-z" }) }));
    const locked = gate();
    const release = gate();
    const removing = client.db.transaction(async (writer) => {
      try {
        await writer.select().from(workstreamTable).where(eq(workstreamTable.id, "acme-z")).for("update");
        locked.open();
        await release.passed;
        return (await deleteWorkstreamIn({ expectedRevision: 1, workstreamId: "acme-z", writer })).kind;
      } finally {
        locked.open();
      }
    });
    await locked.passed;
    const batch = store.applyBatch({
      deletes: [],
      home,
      writes: [{ aggregate: linking({ id: "acme-new", targets: ["acme-z"] }), expectedRevision: null }],
    });
    await lockWaiters({ count: 1 });
    release.open();

    expect(await removing).toBe("deleted");
    expect(unwrapErr(await batch).message).toBe(
      "the workstream was refused, nothing written: acme-new links workstream acme-z, which the batch does not leave in the register",
    );
    expect(unwrap(await store.read({ home })).workstreams).toEqual([]);
  });

  it("waits on a concurrent create holding its transaction, then refuses a whole-register baseline it no longer matches", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    const created = gate();
    const release = gate();
    const creating = client.db.transaction(async (writer) => {
      try {
        const outcome = await writeAggregateIn({
          aggregate: acmeLocal({ id: "acme-new" }),
          expectedRevision: null,
          writer,
        });
        created.open();
        await release.passed;
        return outcome.kind;
      } finally {
        created.open();
      }
    });
    await created.passed;
    // The baseline is what a reader saw before the create commits; the table lock makes the batch wait for it.
    const batch = store.applyBatch({
      deletes: [{ expectedRevision: 1, workstreamId: "acme-a" }],
      home,
      meta: { document: null, expectedRevision: null },
      wholeRegister: { "acme-a": 1 },
      writes: [],
    });
    await lockWaiters({ count: 1 });
    release.open();

    expect(await creating).toBe("written");
    expect(unwrapErr(await batch)).toEqual(
      WorkstreamStoreErrors.wholeRegisterConflict({
        actual: { "acme-a": 1, "acme-new": 1 },
        expected: { "acme-a": 1 },
      }),
    );
    expect(unwrap(await store.read({ home })).workstreams.map((one) => one.id)).toEqual(["acme-a", "acme-new"]);
  });

  it("refuses a whole-register write read with no document once one was created since, keeping it and every row", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    // What the writer read: one row, no document. A second client creates the document before the writer commits.
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home }));
    const before = await registerState();
    const error = unwrapErr(
      await store.applyBatch({
        deletes: [],
        home,
        meta: { document: null, expectedRevision: null },
        wholeRegister: { "acme-a": 1 },
        writes: [{ aggregate: { ...acmeLocal({ id: "acme-a" }), name: "Acme scratch, renamed" }, expectedRevision: 1 }],
      }),
    );

    expect(error).toEqual(WorkstreamStoreErrors.metaConflict({ expectedRevision: 0 }));
    expect(await registerState()).toEqual(before);
    expect(unwrap(await store.read({ home })).meta?.document).toEqual(ACME_META);
  });

  it("deletes the document at its revision with the rows, and refuses that delete once the document has moved", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home }));
    unwrap(await store.putMeta({ document: { ...ACME_META, initiatives: [] }, expectedRevision: 1, home }));
    const before = await registerState();
    const stale = unwrapErr(
      await store.applyBatch({
        deletes: [{ expectedRevision: 1, workstreamId: "acme-a" }],
        home,
        meta: { document: null, expectedRevision: 1 },
        wholeRegister: { "acme-a": 1 },
        writes: [],
      }),
    );
    const afterStale = await registerState();
    const deleted = unwrap(
      await store.applyBatch({
        deletes: [{ expectedRevision: 1, workstreamId: "acme-a" }],
        home,
        meta: { document: null, expectedRevision: 2 },
        wholeRegister: { "acme-a": 1 },
        writes: [],
      }),
    );

    expect(stale).toEqual(WorkstreamStoreErrors.metaConflict({ expectedRevision: 1 }));
    expect(afterStale).toEqual(before);
    expect(deleted).toEqual({ meta: null, written: [] });
    expect(await registerState()).toEqual({ meta: null, workstreams: [] });
  });
});
