/**
 * The register's SQL half driven through drizzle's REAL postgres-js query builder and result mapping, over a scripted
 * transport standing in for the `postgres` client (the shape `unit/store/newest.test.ts` proved): each statement is
 * answered from the script in order, so a test reads the exact statements a write, a delete or a read sent and what
 * it made of the answers — with no database. Whether Postgres honours the locks and predicates is the real-store
 * proof's, `src/__tests__/integration/workstreamStore.test.ts`.
 */
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import type { StoreClient } from "../../../../store/client.js";
import * as storeSchema from "../../../../store/schema.js";
import {
  WORKSTREAM_REGISTER_META_ID,
  workstreamEntryTable,
  workstreamLinkTable,
  workstreamMilestoneAfterTable,
  workstreamMilestoneTable,
  workstreamRegisterMetaTable,
  workstreamTable,
} from "../../../../store/schema.js";
import { deleteWorkstreamIn, writeAggregateIn } from "../../../../workstreams/store/aggregateWrite.js";
import { storedWorkstreamOf, type WorkstreamAggregateRows } from "../../../../workstreams/store/assembly.js";
import { applyWorkstreamBatchIn } from "../../../../workstreams/store/batchWrite.js";
import { writeMetaIn } from "../../../../workstreams/store/metaWrite.js";
import { workstreamRowsOver } from "../../../../workstreams/store/rows.js";
import type { WorkstreamAggregate } from "../../../../workstreams/store/types.js";
import { ACME_META, acmeLocal, acmeOutcome, FIXTURE_INSTANT, rowsOf } from "../../../workstreamStoreFixtures.js";

/** One statement the scripted transport was asked to run. */
interface Issued {
  readonly query: string;
  readonly params: readonly unknown[];
}

/**
 * A store client whose transport answers the Nth statement with `script[N]`, in postgres.js's `values()` shape, and
 * throws on a statement the script does not cover. A transaction runs its body over the same transport, and the
 * client counts both the transactions opened and the statements sent while none was open.
 *
 * @param script one answer per statement, in the order they are sent
 * @returns the client, every statement it was asked to run, and how they sat against transactions
 */
function scriptedClient({ script }: { script: readonly (readonly unknown[][])[] }): {
  readonly client: StoreClient;
  readonly issued: Issued[];
  readonly transactions: () => {
    readonly opened: number;
    readonly rolledBack: number;
    readonly statementsOutside: number;
  };
} {
  const issued: Issued[] = [];
  let opened = 0;
  let open = 0;
  let rolledBack = 0;
  let statementsOutside = 0;
  const transport = {
    // named-object-params-exempt: postgres.js's begin(fn) is called positionally by drizzle's session
    begin: async (body: (inner: unknown) => Promise<unknown>) => {
      opened += 1;
      open += 1;
      try {
        return await body(transport);
      } catch (thrown) {
        // postgres.js rolls a transaction back exactly when its body throws.
        rolledBack += 1;
        throw thrown;
      } finally {
        open -= 1;
      }
    },
    options: { parsers: {}, serializers: {} },
    // named-object-params-exempt: drizzle's postgres-js session calls the client's unsafe(query, params) positionally
    unsafe: (query: string, params: unknown[]) => {
      const answer = script[issued.length];
      issued.push({ params, query });
      if (open === 0) {
        statementsOutside += 1;
      }
      if (answer === undefined) {
        throw new Error(`unscripted statement ${issued.length}: ${query}`);
      }
      return Object.assign(Promise.resolve([]), { values: async () => answer });
    },
  };
  // The fake implements only the members drizzle's session touches, so it is cast to the client type.
  const db = drizzle({ client: transport as unknown as postgres.Sql, schema: storeSchema });
  return {
    client: { close: async () => {}, db },
    issued,
    transactions: () => ({ opened, rolledBack, statementsOutside }),
  };
}

/**
 * Rows as postgres.js's `values()` returns them for a whole-table select: one array per row, in column order.
 *
 * @returns the rows as arrays
 */
function valuesOf({ rows, table }: { rows: readonly Readonly<Record<string, unknown>>[]; table: Table }): unknown[][] {
  const columns = Object.keys(getTableColumns(table));
  return rows.map((row) => columns.map((column) => row[column]));
}

/**
 * The five answers an aggregate read-back takes — the row, then its edges, entries, links and milestones.
 *
 * @returns the answers, in the order `aggregateRowsOf` asks
 */
function readBackOf({ rows }: { rows: WorkstreamAggregateRows }): unknown[][][] {
  return [
    valuesOf({ rows: [rows.row], table: workstreamTable }),
    valuesOf({ rows: rows.edges, table: workstreamMilestoneAfterTable }),
    valuesOf({ rows: rows.entries, table: workstreamEntryTable }),
    valuesOf({ rows: rows.links, table: workstreamLinkTable }),
    valuesOf({ rows: rows.milestones, table: workstreamMilestoneTable }),
  ];
}

/**
 * The outcome workstream linking two others, given in reverse id order so the lock's id order is the code's.
 *
 * @returns the aggregate
 */
function linking(): WorkstreamAggregate {
  const link = ({ id, target }: { id: string; target: string }) =>
    ({ id, kind: "workstream", label: null, milestoneId: null, target }) as const;
  return acmeOutcome({
    links: [
      link({ id: "00000000-0000-4000-8000-0000000000a1", target: "acme-billing" }),
      link({ id: "00000000-0000-4000-8000-0000000000a2", target: "acme-a" }),
    ],
  });
}

/** Each statement's verb and table, enough to read the sequence a write sent. */
function statementHeads({ issued }: { issued: readonly Issued[] }): readonly string[] {
  return issued.map((one) => `${one.query.split(" ")[0]} ${/(?:from|into|update) "(\w+)"/u.exec(one.query)![1]}`);
}

const LOCK_SQL =
  'select "id" from "workstream" where "workstream"."id" in ($1, $2) order by "workstream"."id" collate "C" for key share';

describe("writeAggregateIn", () => {
  it("locks the targets in id order, creates the row, replaces every child and returns what it read back", async () => {
    const aggregate = linking();
    // The read-back differs from what was written, so an outcome built from the input instead fails here.
    const stored = rowsOf({ aggregate: { ...aggregate, name: "Acme onboarding, as the store holds it" } });
    const { client, issued } = scriptedClient({
      script: [
        [["acme-a"], ["acme-billing"]],
        [["acme-onboarding"]],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        ...readBackOf({ rows: stored }),
      ],
    });
    const outcome = await writeAggregateIn({ aggregate, expectedRevision: null, writer: client.db });

    expect(outcome).toEqual({ kind: "written", lockedTargets: ["acme-a", "acme-billing"], rows: stored });
    expect(issued[0]).toEqual({ params: ["acme-a", "acme-billing"], query: LOCK_SQL });
    expect(statementHeads({ issued })).toEqual([
      "select workstream",
      "insert workstream",
      "delete workstream_link",
      "delete workstream_entry",
      "delete workstream_milestone_after",
      "delete workstream_milestone",
      "insert workstream_milestone",
      "insert workstream_milestone_after",
      "insert workstream_entry",
      "insert workstream_link",
      "select workstream",
      "select workstream_milestone_after",
      "select workstream_entry",
      "select workstream_link",
      "select workstream_milestone",
    ]);
    expect(issued[1]!.query).toContain('on conflict ("id") do nothing returning "id"');
  });

  it("stops at the lock, writing nothing, when a target the aggregate links is not there", async () => {
    const { client, issued } = scriptedClient({ script: [[["acme-billing"]]] });
    const outcome = await writeAggregateIn({ aggregate: linking(), expectedRevision: null, writer: client.db });

    expect(outcome).toEqual({ kind: "missing-targets", missing: ["acme-a"] });
    expect(issued.length).toBe(1);
  });

  it("answers a lost compare-and-set as a conflict, having sent only the guarded update", async () => {
    const { client, issued } = scriptedClient({ script: [[]] });
    const outcome = await writeAggregateIn({ aggregate: acmeOutcome(), expectedRevision: 3, writer: client.db });

    expect(outcome).toEqual({ kind: "conflict" });
    expect(issued.length).toBe(1);
    expect(issued[0]!.query).toContain('where ("workstream"."id" = $7 and "workstream"."revision" = $8)');
    expect(issued[0]!.params.slice(-2)).toEqual(["acme-onboarding", 3]);
  });

  it("inserts no child rows for a workstream that has none, and throws when the row it wrote is not read back", async () => {
    const { client, issued } = scriptedClient({ script: [[["acme-scratch"]], [], [], [], [], []] });

    await expect(
      writeAggregateIn({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: null, writer: client.db }),
    ).rejects.toMatchObject({
      message: "workstream acme-scratch was written and then could not be read back in the same transaction",
    });
    expect(statementHeads({ issued }).filter((head) => head.startsWith("insert"))).toEqual(["insert workstream"]);
  });
});

describe("deleteWorkstreamIn", () => {
  it("answers a conflict when the row is gone, and when it is at another revision", async () => {
    const gone = scriptedClient({ script: [[]] });
    const moved = scriptedClient({ script: [[[2]]] });

    expect([
      await deleteWorkstreamIn({ expectedRevision: 1, workstreamId: "acme-onboarding", writer: gone.client.db }),
      await deleteWorkstreamIn({ expectedRevision: 1, workstreamId: "acme-onboarding", writer: moved.client.db }),
    ]).toEqual([{ kind: "conflict" }, { kind: "conflict" }]);
    expect(gone.issued[0]!.query).toBe('select "revision" from "workstream" where "workstream"."id" = $1 for update');
  });

  it("refuses while another workstream links to it, naming each linker", async () => {
    const { client, issued } = scriptedClient({ script: [[[1]], [["acme-a"], ["acme-billing"]]] });
    const outcome = await deleteWorkstreamIn({
      expectedRevision: 1,
      workstreamId: "acme-onboarding",
      writer: client.db,
    });

    expect(outcome).toEqual({ kind: "referenced", referencedBy: ["acme-a", "acme-billing"] });
    expect(issued[1]!.params).toEqual(["workstream", "acme-onboarding", "acme-onboarding"]);
  });

  it("deletes the row when it is at the revision and nothing links to it", async () => {
    const { client, issued } = scriptedClient({ script: [[[1]], [], []] });
    const outcome = await deleteWorkstreamIn({
      expectedRevision: 1,
      workstreamId: "acme-onboarding",
      writer: client.db,
    });

    expect(outcome).toEqual({ kind: "deleted" });
    expect(issued[2]).toEqual({
      params: ["acme-onboarding"],
      query: 'delete from "workstream" where "workstream"."id" = $1',
    });
  });
});

describe("workstreamRowsOver, over a transport that answers", () => {
  it("reads all six tables inside one read-only, repeatable-read transaction", async () => {
    const stored = rowsOf({ aggregate: acmeOutcome() });
    const meta = { document: ACME_META, id: WORKSTREAM_REGISTER_META_ID, revision: 1, updatedAt: FIXTURE_INSTANT };
    const { client, issued, transactions } = scriptedClient({
      script: [
        [],
        valuesOf({ rows: stored.edges, table: workstreamMilestoneAfterTable }),
        valuesOf({ rows: stored.entries, table: workstreamEntryTable }),
        valuesOf({ rows: stored.links, table: workstreamLinkTable }),
        valuesOf({ rows: [meta], table: workstreamRegisterMetaTable }),
        valuesOf({ rows: stored.milestones, table: workstreamMilestoneTable }),
        valuesOf({ rows: [stored.row], table: workstreamTable }),
      ],
    });
    const rows = workstreamRowsOver({ client });
    const read = unwrap(await rows.readAll());
    await rows.close();

    const { row, ...children } = stored;
    expect(read).toEqual({ ...children, meta: [meta], workstreams: [row] });
    expect(issued[0]!.query).toBe("set transaction isolation level repeatable read read only");
    expect(transactions()).toEqual({ opened: 1, rolledBack: 0, statementsOutside: 0 });
  });

  it("writes an aggregate and deletes one, each inside its own transaction", async () => {
    const write = scriptedClient({ script: [[]] });
    const remove = scriptedClient({ script: [[]] });

    expect(
      unwrap(
        await workstreamRowsOver({ client: write.client }).writeAggregate({
          aggregate: acmeOutcome(),
          expectedRevision: 2,
        }),
      ),
    ).toEqual({ kind: "conflict" });
    expect(
      unwrap(
        await workstreamRowsOver({ client: remove.client }).deleteWorkstream({
          expectedRevision: 1,
          workstreamId: "acme-onboarding",
        }),
      ),
    ).toEqual({ kind: "conflict" });
    expect([write.transactions(), remove.transactions()]).toEqual([
      { opened: 1, rolledBack: 0, statementsOutside: 0 },
      { opened: 1, rolledBack: 0, statementsOutside: 0 },
    ]);
  });

  it("updates the register document only at the revision it expects, and answers undefined when it lost", async () => {
    const meta = { document: ACME_META, id: WORKSTREAM_REGISTER_META_ID, revision: 5, updatedAt: FIXTURE_INSTANT };
    const won = scriptedClient({ script: [valuesOf({ rows: [meta], table: workstreamRegisterMetaTable })] });
    const lost = scriptedClient({ script: [[]] });

    expect(
      unwrap(await workstreamRowsOver({ client: won.client }).writeMeta({ document: ACME_META, expectedRevision: 4 })),
    ).toEqual(meta);
    expect(
      unwrap(await workstreamRowsOver({ client: lost.client }).writeMeta({ document: ACME_META, expectedRevision: 4 })),
    ).toBe(undefined);
    expect(won.issued[0]!.query).toContain(
      'where ("workstream_register_meta"."id" = $2 and "workstream_register_meta"."revision" = $3)',
    );
    expect(won.issued[0]!.params.slice(-2)).toEqual([WORKSTREAM_REGISTER_META_ID, 4]);
  });

  it("creates the register document at revision 1, doing nothing when one is already there", async () => {
    const meta = { document: ACME_META, id: WORKSTREAM_REGISTER_META_ID, revision: 1, updatedAt: FIXTURE_INSTANT };
    const { client, issued } = scriptedClient({
      script: [valuesOf({ rows: [meta], table: workstreamRegisterMetaTable })],
    });

    expect(await writeMetaIn({ document: ACME_META, expectedRevision: null, writer: client.db })).toEqual(meta);
    expect(issued[0]!.query).toContain('on conflict ("id") do nothing');
    expect([issued[0]!.params[0], issued[0]!.params[2]]).toEqual([WORKSTREAM_REGISTER_META_ID, 1]);
  });
});

const TABLE_LOCK_SQL = 'lock table "workstream", "workstream_register_meta" in share row exclusive mode';

/** The four child deletes a workstream with no children takes, and nothing inserted. */
const NO_CHILDREN: unknown[][][] = [[], [], [], []];

describe("applyWorkstreamBatchIn", () => {
  it("locks the table, reads every revision, writes every parent before any child, deletes, writes the document and reads back", async () => {
    const created = rowsOf({ aggregate: acmeLocal({ id: "acme-a" }) });
    const updated = rowsOf({ aggregate: acmeLocal({ id: "acme-b" }), revision: 3 });
    const meta = { document: ACME_META, id: WORKSTREAM_REGISTER_META_ID, revision: 4, updatedAt: FIXTURE_INSTANT };
    const { client, issued } = scriptedClient({
      script: [
        [],
        [
          ["acme-b", 2],
          ["acme-z", 1],
        ],
        [["acme-a"]],
        [["acme-b"]],
        ...NO_CHILDREN,
        ...NO_CHILDREN,
        [],
        [],
        valuesOf({ rows: [meta], table: workstreamRegisterMetaTable }),
        ...readBackOf({ rows: created }),
        ...readBackOf({ rows: updated }),
      ],
    });
    const outcome = await applyWorkstreamBatchIn({
      request: {
        deletes: [{ expectedRevision: 1, workstreamId: "acme-z" }],
        meta: { document: ACME_META, expectedRevision: 3 },
        writes: [
          { aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null },
          { aggregate: acmeLocal({ id: "acme-b" }), expectedRevision: 2 },
        ],
      },
      writer: client.db,
    });

    const known = new Set(["acme-a", "acme-b"]);
    expect(outcome).toEqual({
      kind: "applied",
      meta,
      written: [
        unwrap(storedWorkstreamOf({ knownWorkstreamIds: known, rows: created })),
        unwrap(storedWorkstreamOf({ knownWorkstreamIds: known, rows: updated })),
      ],
    });
    expect(issued[0]).toEqual({ params: [], query: TABLE_LOCK_SQL });
    expect(statementHeads({ issued: issued.slice(1, 15) })).toEqual([
      "select workstream",
      "insert workstream",
      "update workstream",
      "delete workstream_link",
      "delete workstream_entry",
      "delete workstream_milestone_after",
      "delete workstream_milestone",
      "delete workstream_link",
      "delete workstream_entry",
      "delete workstream_milestone_after",
      "delete workstream_milestone",
      "select workstream_link",
      "delete workstream",
      "update workstream_register_meta",
    ]);
    expect(issued[12]!.params).toEqual(["workstream", "acme-z"]);
    expect(issued[13]).toEqual({
      params: ["acme-z"],
      query: 'delete from "workstream" where "workstream"."id" in ($1)',
    });
  });

  it("locks every link target the writes name for key share BEFORE the table lock, so a delete in flight finishes first", async () => {
    const { client, issued } = scriptedClient({
      script: [
        [["acme-a"], ["acme-billing"]],
        [],
        [
          ["acme-a", 1],
          ["acme-billing", 1],
        ],
      ],
    });
    const outcome = await applyWorkstreamBatchIn({
      request: { deletes: [], wholeRegister: {}, writes: [{ aggregate: linking(), expectedRevision: null }] },
      writer: client.db,
    });

    expect(outcome.kind).toBe("whole-register-conflict");
    expect(issued.slice(0, 2)).toEqual([
      { params: ["acme-a", "acme-billing"], query: LOCK_SQL },
      { params: [], query: TABLE_LOCK_SQL },
    ]);
  });

  it("stops after the read, writing nothing, when the whole-register baseline is stale", async () => {
    const { client, issued } = scriptedClient({
      script: [
        [],
        [
          ["acme-a", 1],
          ["acme-new", 1],
        ],
      ],
    });
    const outcome = await applyWorkstreamBatchIn({
      request: {
        deletes: [{ expectedRevision: 1, workstreamId: "acme-a" }],
        wholeRegister: { "acme-a": 1 },
        writes: [],
      },
      writer: client.db,
    });

    expect(outcome).toEqual({
      actual: { "acme-a": 1, "acme-new": 1 },
      expected: { "acme-a": 1 },
      kind: "whole-register-conflict",
    });
    expect(issued.length).toBe(2);
  });
});

describe("workstreamRowsOver(...).applyBatch", () => {
  it("rolls the whole transaction back on a refusal found after a write, and answers the refusal", async () => {
    // `acme-y` still links `acme-z` after `acme-a` was already rewritten, so the update must not commit.
    const { client, issued, transactions } = scriptedClient({
      script: [
        [],
        [
          ["acme-a", 1],
          ["acme-y", 1],
          ["acme-z", 1],
        ],
        [["acme-a"]],
        ...NO_CHILDREN,
        [["acme-z", "acme-y"]],
      ],
    });
    const outcome = unwrap(
      await workstreamRowsOver({ client }).applyBatch({
        deletes: [{ expectedRevision: 1, workstreamId: "acme-z" }],
        writes: [{ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: 1 }],
      }),
    );

    expect(outcome).toEqual({ kind: "referenced", referencedBy: ["acme-y"], workstreamId: "acme-z" });
    expect(transactions()).toEqual({ opened: 1, rolledBack: 1, statementsOutside: 0 });
    expect(issued.length).toBe(8);
  });

  it("rolls back, rather than commits, a write whose read-back does not decode, and answers stored-invalid", async () => {
    // The read-back carries a link to `acme-gone`, which the batch does not leave: damage the commit must not keep.
    const damaged = rowsOf({
      aggregate: {
        ...acmeLocal({ id: "acme-a" }),
        links: [
          {
            id: "00000000-0000-4000-8000-0000000000a9",
            kind: "workstream",
            label: null,
            milestoneId: null,
            target: "acme-gone",
          },
        ],
      },
      revision: 2,
    });
    const { client, issued, transactions } = scriptedClient({
      script: [[], [["acme-a", 1]], [["acme-a"]], ...NO_CHILDREN, ...readBackOf({ rows: damaged })],
    });
    const outcome = unwrap(
      await workstreamRowsOver({ client }).applyBatch({
        deletes: [],
        writes: [{ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: 1 }],
      }),
    );

    expect(outcome).toEqual({
      kind: "stored-invalid",
      problems: [
        "acme-a link 00000000-0000-4000-8000-0000000000a9: it links workstream acme-gone, which the register does not hold",
      ],
    });
    expect(transactions()).toEqual({ opened: 1, rolledBack: 1, statementsOutside: 0 });
    expect(issued.length).toBe(12);
  });
});
