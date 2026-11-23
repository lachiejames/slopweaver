/**
 * The store-backed register's decisions over plain fake seams — no database, no mocks: rows assembled into the
 * register a reader sees, and every refusal a read or write can answer, each with its own code.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { WORKSTREAM_REGISTER_META_ID } from "../../../../store/schema/workstreams.js";
import {
  assembleWorkstreamRegister,
  storedWorkstreamOf,
  type WorkstreamRegisterRows,
} from "../../../../workstreams/store/assembly.js";
import type { WorkstreamBatchOutcome } from "../../../../workstreams/store/batchPlan.js";
import { WorkstreamStoreErrors } from "../../../../workstreams/store/errors.js";
import type { WorkstreamBatchRequest } from "../../../../workstreams/store/judge.js";
import {
  type AggregateWriteOutcome,
  type WorkstreamDeleteOutcome,
  type WorkstreamRows,
  workstreamStore,
} from "../../../../workstreams/store/port.js";
import { ACME_META, acmeLocal, acmeOutcome, FIXTURE_INSTANT, rowsOf } from "../../../workstreamStoreFixtures.js";

const HOME = "/acme/home";

/**
 * Every row of a register holding the given aggregates.
 *
 * @returns the rows a read would return
 */
function registerRows({
  aggregates,
}: {
  aggregates: Parameters<typeof rowsOf>[0]["aggregate"][];
}): WorkstreamRegisterRows {
  const each = aggregates.map((aggregate) => rowsOf({ aggregate }));
  return {
    edges: each.flatMap((one) => one.edges),
    entries: each.flatMap((one) => one.entries),
    links: each.flatMap((one) => one.links),
    meta: [],
    milestones: each.flatMap((one) => one.milestones),
    workstreams: each.map((one) => one.row),
  };
}

/**
 * A store whose statements answer what the test says, and which records what it was asked to write.
 *
 * @returns the store, and the aggregates handed to `writeAggregate`
 */
function fakeStore({
  deleted = { kind: "deleted" },
  read = registerRows({ aggregates: [] }),
  written = { kind: "conflict" },
}: {
  deleted?: WorkstreamDeleteOutcome;
  read?: WorkstreamRegisterRows;
  written?: AggregateWriteOutcome;
}): { store: ReturnType<typeof workstreamStore>; writes: () => number } {
  let writes = 0;
  const rows: WorkstreamRows = {
    applyBatch: async () => ok({ expectedRevision: null, kind: "meta-conflict" }),
    close: async () => {},
    deleteWorkstream: async () => ok(deleted),
    readAll: async () => ok(read),
    writeAggregate: async () => {
      writes += 1;
      return ok(written);
    },
    writeMeta: async () => ok(undefined),
  };
  return { store: workstreamStore({ seams: { connect: async () => ok(rows) } }), writes: () => writes };
}

describe("assembleWorkstreamRegister", () => {
  it("reads an empty store as an empty register, never an error", () => {
    expect(unwrap(assembleWorkstreamRegister({ rows: registerRows({ aggregates: [] }) }))).toEqual({
      meta: null,
      workstreams: [],
    });
  });

  it("assembles each workstream in id order with its progress derived and its timestamps as ISO", () => {
    // Workstreams and `after` edges both handed in reverse, so the order read back is assembly's, not the input's.
    const milestones = acmeOutcome().milestones.map((one) => ({ ...one, after: one.after.toReversed() }));
    expect(milestones[2]!.after).toEqual(["scope", "pilot"]);
    const rows = registerRows({ aggregates: [acmeOutcome({ milestones }), acmeLocal({ id: "acme-a-scratch" })] });
    const snapshot = unwrap(assembleWorkstreamRegister({ rows }));

    expect(snapshot.workstreams.map((one) => one.id)).toEqual(["acme-a-scratch", "acme-onboarding"]);
    expect(snapshot.workstreams[1]!.progress!.doneCount).toBe(1);
    expect(snapshot.workstreams[1]!.milestones[2]!.after).toEqual(["pilot", "scope"]);
    expect(snapshot.workstreams[1]!.updatedAtIso).toBe("2026-11-06T13:31:00.000Z");
  });

  it("refuses two register documents, and a child row whose workstream is not there", () => {
    const meta = { document: ACME_META, id: WORKSTREAM_REGISTER_META_ID, revision: 1, updatedAt: FIXTURE_INSTANT };
    const orphan = rowsOf({ aggregate: acmeOutcome() });
    const rows = { ...registerRows({ aggregates: [] }), meta: [meta, meta], milestones: orphan.milestones };

    expect(unwrapErr(assembleWorkstreamRegister({ rows }))).toEqual([
      "workstream_milestone holds rows for acme-onboarding, which is not a workstream",
      "workstream_register_meta holds 2 rows; it is a singleton",
    ]);
  });
});

describe("workstreamStore", () => {
  it("refuses an invalid aggregate before the store is asked to write anything", async () => {
    const { store, writes } = fakeStore({});
    const error = unwrapErr(
      await store.put({ aggregate: acmeOutcome({ status: null }), expectedRevision: null, home: HOME }),
    );

    expect(error.code).toBe("WORKSTREAM_INVALID");
    expect(error.message).toBe(
      "the workstream was refused, nothing written: acme-onboarding is outcome, so it states its outcome and its status",
    );
    expect(writes()).toBe(0);
  });

  it("answers a lost create as a conflict naming revision 0", async () => {
    const { store } = fakeStore({ written: { kind: "conflict" } });
    const error = unwrapErr(await store.put({ aggregate: acmeOutcome(), expectedRevision: null, home: HOME }));

    expect(error).toEqual(WorkstreamStoreErrors.conflict({ expectedRevision: 0, workstreamId: "acme-onboarding" }));
  });

  it("refuses a workstream link whose target the write found missing under lock", async () => {
    const links = [
      {
        id: "00000000-0000-4000-8000-0000000000a1",
        kind: "workstream" as const,
        label: null,
        milestoneId: null,
        target: "acme-gone",
      },
    ];
    const { store } = fakeStore({ written: { kind: "missing-targets", missing: ["acme-gone"] } });
    const error = unwrapErr(await store.put({ aggregate: acmeOutcome({ links }), expectedRevision: 1, home: HOME }));

    expect(error).toEqual(
      WorkstreamStoreErrors.invalid({
        problems: ["acme-onboarding links workstream acme-gone, which the register does not hold"],
      }),
    );
  });

  it("returns what the write transaction read back, decoded", async () => {
    // The row the transaction read back differs from what was submitted, so returning the input fails here.
    const aggregate = acmeOutcome();
    const readBack = acmeOutcome({ name: "Acme onboarding, as the store holds it" });
    const { store } = fakeStore({
      written: { kind: "written", lockedTargets: [], rows: rowsOf({ aggregate: readBack, revision: 2 }) },
    });
    const stored = unwrap(await store.put({ aggregate, expectedRevision: 1, home: HOME }));

    expect([aggregate.name, stored.name]).toEqual(["Acme onboarding", "Acme onboarding, as the store holds it"]);
    expect(stored.revision).toBe(2);
    expect(stored.progress!.next!.id).toBe("pilot");
  });

  it("refuses deleting a workstream another one links to", async () => {
    const { store } = fakeStore({ deleted: { kind: "referenced", referencedBy: ["acme-billing"] } });
    const error = unwrapErr(await store.remove({ expectedRevision: 1, home: HOME, workstreamId: "acme-onboarding" }));

    expect(error.code).toBe("WORKSTREAM_REFERENCED");
    expect(error.message).toBe("workstream acme-onboarding is linked from acme-billing — remove those links first");
  });

  it("refuses a register document carrying a NUL before the store sees it", async () => {
    const { store } = fakeStore({});
    const document = { ...ACME_META, channels: { C0FIXTURE1: "acme\u0000platform" } };
    const error = unwrapErr(await store.putMeta({ document, expectedRevision: null, home: HOME }));

    expect(error).toEqual(
      WorkstreamStoreErrors.invalid({
        problems: ["the register document.channels.C0FIXTURE1 carries U+0000 or a lone surrogate"],
      }),
    );
  });

  it("refuses a register-document write at the largest revision, and a put at it, before either reaches the store", async () => {
    const { store, writes } = fakeStore({});
    const meta = unwrapErr(await store.putMeta({ document: ACME_META, expectedRevision: 2_147_483_647, home: HOME }));
    const put = unwrapErr(await store.put({ aggregate: acmeOutcome(), expectedRevision: 2_147_483_647, home: HOME }));

    expect([meta.message, put.message]).toEqual([
      "the workstream was refused, nothing written: the register document is at revision 2147483647, the store's largest, so it cannot be written again",
      "the workstream was refused, nothing written: acme-onboarding is at revision 2147483647, the store's largest, so it cannot be written again",
    ]);
    expect(writes()).toBe(0);
  });

  it("refuses a put, a document write and a delete at a revision no row could carry, before any reaches the store", async () => {
    // Unjudged, 1.5 reaches the `integer` predicate and the store answers an outage where the in-memory one a conflict.
    const { store, writes } = fakeStore({});
    const put = unwrapErr(await store.put({ aggregate: acmeOutcome(), expectedRevision: 1.5, home: HOME }));
    const meta = unwrapErr(await store.putMeta({ document: ACME_META, expectedRevision: 0, home: HOME }));
    const removed = unwrapErr(
      await store.remove({ expectedRevision: -1, home: HOME, workstreamId: "acme-onboarding" }),
    );

    expect([put.message, meta.message, removed.message]).toEqual([
      "the workstream was refused, nothing written: acme-onboarding names revision 1.5, which no stored row carries",
      "the workstream was refused, nothing written: the register document names revision 0, which no stored row carries",
      "the workstream was refused, nothing written: the delete of acme-onboarding names revision -1, which no stored workstream carries",
    ]);
    expect(writes()).toBe(0);
  });

  it("answers a lost register-document write as a meta conflict", async () => {
    const { store } = fakeStore({});
    const error = unwrapErr(await store.putMeta({ document: ACME_META, expectedRevision: 4, home: HOME }));

    expect(error).toEqual(WorkstreamStoreErrors.metaConflict({ expectedRevision: 4 }));
  });

  it("refuses a read as unavailable when the store cannot be opened, never an empty register", async () => {
    const refusal = WorkstreamStoreErrors.unavailable({ doing: "be opened", reason: "no store selected" });
    const store = workstreamStore({ seams: { connect: async () => err(refusal) } });

    expect(unwrapErr(await store.read({ home: HOME }))).toEqual(refusal);
  });

  it("refuses a read whose rows break a rule as stored-invalid", async () => {
    const { store } = fakeStore({ read: registerRows({ aggregates: [acmeOutcome({ status: null })] }) });
    const error = unwrapErr(await store.read({ home: HOME }));

    expect(error.code).toBe("WORKSTREAM_STORED_INVALID");
    expect(error.message).toBe(
      "the store's workstream rows are not a valid register: acme-onboarding is outcome, so it states its outcome and its status",
    );
  });
});

/**
 * Rows that answer every statement successfully and emptily, bar the ones the test replaces.
 *
 * @param over the statements to replace
 * @returns the rows
 */
function rowsWith(over: Partial<WorkstreamRows> = {}): WorkstreamRows {
  return {
    applyBatch: async () => ok({ expectedRevision: null, kind: "meta-conflict" }),
    close: async () => {},
    deleteWorkstream: async () => ok({ kind: "deleted" }),
    readAll: async () => ok(registerRows({ aggregates: [] })),
    writeAggregate: async () => ok({ kind: "conflict" }),
    writeMeta: async () => ok(undefined),
    ...over,
  };
}

const OUTAGE = WorkstreamStoreErrors.unavailable({ doing: "run a statement", reason: "connection reset" });

describe("workstreamStore, when the store fails part-way", () => {
  it("names what it was doing when opening, the operation or closing threw, and never echoes a thrown non-Error", async () => {
    const opening = workstreamStore({
      seams: {
        connect: async () => {
          throw "a bare string";
        },
      },
    });
    const operating = workstreamStore({
      seams: {
        connect: async () =>
          ok(
            rowsWith({
              readAll: async () => {
                throw new Error("socket hang up");
              },
            }),
          ),
      },
    });
    const closing = workstreamStore({
      seams: {
        connect: async () =>
          ok(
            rowsWith({
              close: async () => {
                throw new Error("already ended");
              },
            }),
          ),
      },
    });

    expect([
      unwrapErr(await opening.read({ home: HOME })).message,
      unwrapErr(await operating.read({ home: HOME })).message,
      unwrapErr(await closing.read({ home: HOME })).message,
    ]).toEqual([
      "the store could not be opened: unknown failure",
      "the store could not finish the operation: socket hang up",
      "the store could not close its connection: already ended",
    ]);
  });

  it("keeps a write's answer when the close fails after it, since the write already committed", async () => {
    const store = workstreamStore({
      seams: {
        connect: async () =>
          ok(
            rowsWith({
              applyBatch: async () => ok({ kind: "applied", meta: null, written: [] }),
              close: async () => {
                throw new Error("already ended");
              },
            }),
          ),
      },
    });

    expect(
      unwrap(
        await store.applyBatch({ deletes: [{ expectedRevision: 1, workstreamId: "acme-a" }], home: HOME, writes: [] }),
      ),
    ).toEqual({ meta: null, written: [] });
    expect(unwrap(await store.remove({ expectedRevision: 1, home: HOME, workstreamId: "acme-a" }))).toBe(undefined);
    expect(unwrapErr(await store.read({ home: HOME })).code).toBe("WORKSTREAM_STORE_UNAVAILABLE");
  });

  it("passes a statement's own outage through from every operation", async () => {
    const store = workstreamStore({
      seams: {
        connect: async () =>
          ok(
            rowsWith({
              applyBatch: async () => err(OUTAGE),
              deleteWorkstream: async () => err(OUTAGE),
              readAll: async () => err(OUTAGE),
              writeAggregate: async () => err(OUTAGE),
              writeMeta: async () => err(OUTAGE),
            }),
          ),
      },
    });

    expect([
      unwrapErr(await store.read({ home: HOME })),
      unwrapErr(await store.put({ aggregate: acmeOutcome(), expectedRevision: 1, home: HOME })),
      unwrapErr(await store.putMeta({ document: ACME_META, expectedRevision: 1, home: HOME })),
      unwrapErr(await store.remove({ expectedRevision: 1, home: HOME, workstreamId: "acme-onboarding" })),
      unwrapErr(
        await store.applyBatch({
          deletes: [],
          home: HOME,
          writes: [{ aggregate: acmeOutcome(), expectedRevision: 1 }],
        }),
      ),
    ]).toEqual([OUTAGE, OUTAGE, OUTAGE, OUTAGE, OUTAGE]);
  });

  it("answers a lost delete as a conflict at the revision it expected, and a won one as done", async () => {
    const lost = workstreamStore({
      seams: { connect: async () => ok(rowsWith({ deleteWorkstream: async () => ok({ kind: "conflict" }) })) },
    });
    const won = workstreamStore({ seams: { connect: async () => ok(rowsWith()) } });

    expect(unwrapErr(await lost.remove({ expectedRevision: 3, home: HOME, workstreamId: "acme-onboarding" }))).toEqual(
      WorkstreamStoreErrors.conflict({ expectedRevision: 3, workstreamId: "acme-onboarding" }),
    );
    expect(unwrap(await won.remove({ expectedRevision: 3, home: HOME, workstreamId: "acme-onboarding" }))).toBe(
      undefined,
    );
  });
});

describe("workstreamStore.putMeta", () => {
  it("refuses a register document that does not decode, before the store sees it", async () => {
    let metaWrites = 0;
    const writeMeta: WorkstreamRows["writeMeta"] = async () => {
      metaWrites += 1;
      return ok(undefined);
    };
    const store = workstreamStore({ seams: { connect: async () => ok(rowsWith({ writeMeta })) } });
    const document = { ...ACME_META, initiatives: [{ id: "Not Kebab", name: "Acme growth" }] };
    const error = unwrapErr(await store.putMeta({ document, expectedRevision: null, home: HOME }));

    expect(error.code).toBe("WORKSTREAM_INVALID");
    expect(error.message).toContain("register meta");
    expect(metaWrites).toBe(0);
  });

  it("returns the decoded document it wrote, at the revision and instant the store's row carries", async () => {
    // Revision 9 against an expected 4, so a revision computed as expected + 1 instead of read off the row fails here.
    const row = { document: ACME_META, id: WORKSTREAM_REGISTER_META_ID, revision: 9, updatedAt: FIXTURE_INSTANT };
    const store = workstreamStore({ seams: { connect: async () => ok(rowsWith({ writeMeta: async () => ok(row) })) } });

    expect(unwrap(await store.putMeta({ document: ACME_META, expectedRevision: 4, home: HOME }))).toEqual({
      document: ACME_META,
      revision: 9,
      updatedAtIso: "2026-11-06T13:31:00.000Z",
    });
  });
});

/** `acme-onboarding` linking `acme-billing`, a workstream only the batch creates. */
const LINKS_BILLING = [
  {
    id: "00000000-0000-4000-8000-0000000000b1",
    kind: "workstream" as const,
    label: null,
    milestoneId: null,
    target: "acme-billing",
  },
];

/**
 * A store whose batch statement answers `outcome`, recording every batch it was handed.
 *
 * @param outcome what the batch transaction answers
 * @returns the store, and the batches its statement received
 */
function batchStore({ outcome }: { outcome: WorkstreamBatchOutcome }): {
  store: ReturnType<typeof workstreamStore>;
  handed: WorkstreamBatchRequest[];
} {
  const handed: WorkstreamBatchRequest[] = [];
  const applyBatch: WorkstreamRows["applyBatch"] = async (request) => {
    handed.push(request);
    return ok(outcome);
  };
  return { handed, store: workstreamStore({ seams: { connect: async () => ok(rowsWith({ applyBatch })) } }) };
}

describe("workstreamStore.applyBatch", () => {
  it("refuses an empty batch, a repeated id and a bad delete revision before the store is asked", async () => {
    const { handed, store } = batchStore({ outcome: { expectedRevision: null, kind: "meta-conflict" } });
    const empty = unwrapErr(await store.applyBatch({ deletes: [], home: HOME, writes: [] }));
    const repeated = unwrapErr(
      await store.applyBatch({
        deletes: [{ expectedRevision: 0, workstreamId: "acme-onboarding" }],
        home: HOME,
        writes: [{ aggregate: acmeOutcome(), expectedRevision: 1 }],
      }),
    );

    expect([empty.message, repeated.message]).toEqual([
      "the workstream was refused, nothing written: the batch writes, deletes and changes nothing",
      "the workstream was refused, nothing written: the batch names acme-onboarding more than once; the delete of acme-onboarding names revision 0, which no stored workstream carries",
    ]);
    expect(handed).toEqual([]);
  });

  it("hands the store its writes and deletes in id order", async () => {
    const { handed, store } = batchStore({ outcome: { expectedRevision: null, kind: "meta-conflict" } });
    await store.applyBatch({
      deletes: [
        { expectedRevision: 2, workstreamId: "acme-z-old" },
        { expectedRevision: 1, workstreamId: "acme-c-old" },
      ],
      home: HOME,
      writes: [
        { aggregate: acmeLocal({ id: "acme-y-new" }), expectedRevision: null },
        { aggregate: acmeLocal({ id: "acme-b-new" }), expectedRevision: null },
      ],
    });

    expect(handed[0]!.writes.map((one) => one.aggregate.id)).toEqual(["acme-b-new", "acme-y-new"]);
    expect(handed[0]!.deletes.map((one) => one.workstreamId)).toEqual(["acme-c-old", "acme-z-old"]);
  });

  it("maps every refusal the transaction answers to its own code", async () => {
    const write = { deletes: [], home: HOME, writes: [{ aggregate: acmeOutcome(), expectedRevision: null }] };
    const refusals: WorkstreamBatchOutcome[] = [
      { expectedRevision: null, kind: "workstream-conflict", workstreamId: "acme-onboarding" },
      { kind: "missing-targets", missing: ["acme-billing"], workstreamId: "acme-onboarding" },
      { kind: "referenced", referencedBy: ["acme-onboarding"], workstreamId: "acme-billing" },
      { expectedRevision: 3, kind: "meta-conflict" },
      { actual: { "acme-billing": 1, "acme-onboarding": 2 }, expected: {}, kind: "whole-register-conflict" },
      { kind: "stored-invalid", problems: ["acme-onboarding links workstream acme-billing, which is not there"] },
    ];
    const messages: string[] = [];
    for (const outcome of refusals) {
      messages.push(unwrapErr(await batchStore({ outcome }).store.applyBatch(write)).message);
    }

    expect(messages).toEqual([
      "workstream acme-onboarding already exists — read it and write its current revision",
      "the workstream was refused, nothing written: acme-onboarding links workstream acme-billing, which the batch does not leave in the register",
      "workstream acme-billing is linked from acme-onboarding — remove those links first",
      "the workstream register document is no longer at revision 3 — read it again",
      "the register moved since it was read — read none, now acme-billing@1, acme-onboarding@2; read it again and decide afresh",
      "the store's workstream rows are not a valid register: acme-onboarding links workstream acme-billing, which is not there",
    ]);
  });

  it("answers exactly what the transaction decoded before it committed, and the document as written", async () => {
    const onboarding = acmeOutcome({ links: LINKS_BILLING, name: "Acme onboarding, as read back" });
    const decoded = unwrap(
      storedWorkstreamOf({
        knownWorkstreamIds: new Set(["acme-billing", "acme-onboarding"]),
        rows: rowsOf({ aggregate: onboarding, revision: 2 }),
      }),
    );
    const meta = { document: ACME_META, id: WORKSTREAM_REGISTER_META_ID, revision: 7, updatedAt: FIXTURE_INSTANT };
    const { store } = batchStore({ outcome: { kind: "applied", meta, written: [decoded] } });
    const result = unwrap(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        meta: { document: ACME_META, expectedRevision: 6 },
        writes: [
          { aggregate: acmeOutcome({ links: LINKS_BILLING }), expectedRevision: 1 },
          { aggregate: acmeLocal({ id: "acme-billing" }), expectedRevision: null },
        ],
      }),
    );

    expect(result.written).toEqual([decoded]);
    expect(result.written.map((one) => [one.id, one.name, one.revision])).toEqual([
      ["acme-onboarding", "Acme onboarding, as read back", 2],
    ]);
    expect(result.meta).toEqual({ document: ACME_META, revision: 7, updatedAtIso: "2026-11-06T13:31:00.000Z" });
  });
});
