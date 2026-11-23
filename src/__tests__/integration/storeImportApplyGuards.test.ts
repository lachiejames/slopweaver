/**
 * What stands between `applyStagedImport` and a half-written or misdirected store, on a REAL Postgres: a failure in
 * the last register rolls back every one before it, as does a row a foreign trigger drops or rewrites, an instruction
 * left inactive one drops, and a receipt a rule or trigger drops, deletes or recounts, two applies of one batch racing
 * commit it once, a temporary table
 * shadowing the receipt's name is never read or written, a replica-mode session is refused, as is a store with an
 * append-only guard disabled, an id naming no batch, and a guard disabled or an answer written on another connection
 * held off until the apply ends. Each is a property of the database, not of the code, so only a database can show it.
 *
 * OPT-IN, and never in CI: it needs a running local stack. Each case creates its own throwaway database from the admin
 * connection, migrates it, and drops it afterwards — it never touches the database the admin URL names:
 *
 *   STORE_IMPORT_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/storeImportApplyGuards.test.ts
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { openStore } from "../../store/client.js";
import { memoriesTable } from "../../store/schema/memories.js";
import { memoryRecallsTable } from "../../store/schema/memoryRecalls.js";
import { ensureRegistersImported, readStoreContentsIn } from "../../store/transfer/bundleWrite.js";
import { decided, lockedBatch, lockRegisters, lockStaging } from "../../store/transfer/importApplyRead.js";
import { writtenAsDecided } from "../../store/transfer/importApplyReadBack.js";
import { ACTIVE, CHANGED_MEMORY_LINE } from "../unit/store/transfer/stagedBatch.js";
import {
  ADMIN_URL,
  type AdminConnection,
  applied,
  closeAll,
  openAdmin,
  type ProofStore,
  rowCounts,
  stagedAndAnswered,
  throwawayStore,
  totalRows,
} from "./storeImportApplyHarness.js";

/** The driver's own message under drizzle's "Failed query" wrapper. */
function innermost({ cause }: { cause: unknown }): string {
  let inner = cause;
  while (inner instanceof Error && inner.cause instanceof Error) {
    inner = inner.cause;
  }
  return inner instanceof Error ? inner.message : String(inner);
}

describe.skipIf(ADMIN_URL === undefined)("the guards on applying a store import, on a real Postgres (opt-in)", () => {
  // Built in `beforeAll`, never at collection: `skipIf` still runs this body.
  let admin: AdminConnection;
  const opened: ProofStore[] = [];
  /** A fresh store holding one staged batch of the fixture export, every restored instruction activated by default. */
  const withBatch = async ({ activation = "activate" }: { activation?: "activate" | "leave-inactive" } = {}): Promise<{
    store: ProofStore;
    batchId: string;
  }> => {
    const store = await throwawayStore({ admin });
    opened.push(store);
    const { batchId } = await stagedAndAnswered({ answers: { activation }, contents: ACTIVE, store });
    return { batchId, store };
  };

  beforeAll(() => {
    admin = openAdmin();
  });

  afterEach(async () => {
    await closeAll({ stores: opened.splice(0) });
  });

  afterAll(async () => {
    await admin.sql.end();
  });

  it("rolls every register back when the last one's write fails, the receipt included", async () => {
    const { batchId, store } = await withBatch();
    // Every steer measurement is written last; this refuses any new one while leaving the rows there alone.
    await store.client.db.execute(
      sql`alter table steer_measurement add constraint sw_proof_refuse check (false) not valid`,
    );

    const refused = unwrapErr(await applied({ batchId, store }));

    expect(refused).toMatchObject({ code: "IMPORT_APPLICATION_FAILED", register: "the steer measurements" });
    expect(totalRows({ counts: await rowCounts({ client: store.client }) })).toBe(0);
  });

  // Each drops or rewrites a row without an error, so only reading the store back, or the receipt's own row, sees it.
  const swallow = sql`create function sw_proof_swallow() returns trigger language plpgsql as $$ begin return null; end $$`;
  const receiptFragment = "the receipt does not read back as written";
  it.each([
    {
      // Returning NULL skips the insert silently.
      activation: "activate",
      fragment: "2 row(s) it wrote do not read back as written",
      register: "the store read back",
      statements: [
        swallow,
        sql`create trigger sw_proof_swallow before insert on steer_measurement for each row execute function sw_proof_swallow()`,
      ],
      what: "a trigger swallowing a register's rows",
    },
    {
      // The row count is unchanged while its content is not.
      activation: "activate",
      fragment: "1 row(s) it wrote do not read back as written",
      register: "the store read back",
      statements: [
        sql`create function sw_proof_rewrite() returns trigger language plpgsql as $$ begin new.display_name := 'tampered'; return new; end $$`,
        sql`create trigger sw_proof_rewrite before insert on owner_profile for each row execute function sw_proof_rewrite()`,
      ],
      what: "a trigger rewriting a register's row",
    },
    {
      // A constraint trigger deferred to COMMIT would remove the row after every read; it fires before.
      activation: "activate",
      fragment: "2 row(s) it wrote do not read back as written",
      register: "the store read back",
      statements: [
        sql`create function sw_proof_deferred_remove() returns trigger language plpgsql as $$ begin delete from owner_profile where id = new.id; return null; end $$`,
        sql`create constraint trigger sw_proof_deferred_remove after insert on owner_profile deferrable initially deferred for each row execute function sw_proof_deferred_remove()`,
      ],
      what: "a deferred trigger removing a register's row at commit",
    },
    {
      // The receipt's own insert checked immediately too, so a deferred trigger cannot remove it later.
      activation: "activate",
      fragment: receiptFragment,
      register: "the receipt",
      statements: [
        sql`create or replace function public.store_import_application_immutable() returns trigger language plpgsql as $$ begin return old; end $$`,
        sql`create function sw_proof_deferred_unstore() returns trigger language plpgsql as $$ begin delete from store_import_application where batch_id = new.batch_id; return null; end $$`,
        sql`create constraint trigger sw_proof_deferred_unstore after insert on store_import_application deferrable initially deferred for each row execute function sw_proof_deferred_unstore()`,
      ],
      what: "a deferred trigger removing the receipt at commit",
    },
    {
      // The receipt's own insert removes a row already read back, so the read-back comes after it.
      activation: "activate",
      fragment: "2 row(s) it wrote do not read back as written",
      register: "the store read back",
      statements: [
        sql`create function sw_proof_receipt_removes() returns trigger language plpgsql as $$ begin delete from owner_profile; return new; end $$`,
        sql`create trigger sw_proof_receipt_removes after insert on store_import_application for each row execute function sw_proof_receipt_removes()`,
      ],
      what: "a trigger on the receipt's insert removing a register's row",
    },
    {
      // An instruction left inactive is outside the store's read, so it is found by the
      // question that admitted it instead.
      activation: "leave-inactive",
      fragment: "2 instruction(s) it wrote are not in the store under their question",
      register: "the store read back",
      statements: [
        swallow,
        sql`create trigger sw_proof_swallow before insert on owner_directive for each row execute function sw_proof_swallow()`,
      ],
      what: "a trigger swallowing an instruction left inactive",
    },
    {
      // Two directives' questions swapped leave every question and state present.
      activation: "activate",
      fragment: "2 instruction(s) it wrote are not in the store under their question",
      register: "the store read back",
      statements: [
        sql`create function sw_proof_swap() returns trigger language plpgsql as $$ declare other text; begin select q.id into other from store_import_question q join store_import_question mine on mine.id = new.import_question_id and mine.batch_id = q.batch_id and mine.part = q.part where q.id <> new.import_question_id; new.import_question_id := other; return new; end $$`,
        sql`create trigger sw_proof_swap before insert on owner_directive for each row execute function sw_proof_swap()`,
      ],
      what: "a trigger swapping two instructions' questions",
    },
    {
      // The receipt dropped, so a second apply would not find it.
      activation: "activate",
      fragment: receiptFragment,
      register: "the receipt",
      statements: [sql`create rule sw_proof_no_receipt as on insert to store_import_application do instead nothing`],
      what: "a rule dropping the receipt",
    },
    {
      // A trigger dropping the receipt, whatever it is named.
      activation: "activate",
      fragment: receiptFragment,
      register: "the receipt",
      statements: [
        swallow,
        sql`create trigger sw_proof_swallow before insert on store_import_application for each row execute function sw_proof_swallow()`,
      ],
      what: "a trigger dropping the receipt",
    },
    {
      // An insert returning its row proves nothing about what an AFTER trigger does next.
      // The receipt's own guard keeps its name, enabled, while its function is replaced to let the delete through.
      activation: "activate",
      fragment: receiptFragment,
      register: "the receipt",
      statements: [
        sql`create or replace function public.store_import_application_immutable() returns trigger language plpgsql as $$ begin return old; end $$`,
        sql`create function sw_proof_unstore() returns trigger language plpgsql as $$ begin delete from store_import_application where batch_id = new.batch_id; return null; end $$`,
        sql`create trigger sw_proof_unstore after insert on store_import_application for each row execute function sw_proof_unstore()`,
      ],
      what: "a trigger deleting the receipt once it is inserted",
    },
    {
      // A receipt stored with another count misreports what the apply wrote.
      activation: "activate",
      fragment: receiptFragment,
      register: "the receipt",
      statements: [
        sql`create function sw_proof_recount() returns trigger language plpgsql as $$ begin new.write_count := new.write_count + 1; return new; end $$`,
        sql`create trigger sw_proof_recount before insert on store_import_application for each row execute function sw_proof_recount()`,
      ],
      what: "a trigger rewriting the receipt's count",
    },
  ] as const)("refuses $what, writing nothing", async ({ activation, fragment, register, statements }) => {
    const { batchId, store } = await withBatch({ activation });
    for (const statement of statements) {
      await store.client.db.execute(statement);
    }

    const refused = unwrapErr(await applied({ batchId, store }));

    expect(refused.message).toContain(fragment);
    expect(refused).toMatchObject({ code: "IMPORT_APPLICATION_FAILED", register });
    expect(totalRows({ counts: await rowCounts({ client: store.client }) })).toBe(0);
  });

  it("reads back, before any write, every instruction left inactive as missing from the store", async () => {
    const { batchId, store } = await withBatch({ activation: "leave-inactive" });

    const refused = await store.client.db.transaction(async (tx) => {
      const batch = await lockedBatch({ batchId, writer: tx });
      const plan = unwrap(await decided({ batch: batch!, stopOnConflict: false, writer: tx }));
      return unwrapErr(await writtenAsDecided({ application: plan.application, writer: tx, written: plan.effects }));
    });

    expect(refused.message).toContain("3 instruction(s) it wrote are not in the store under their question");
    expect(refused).toMatchObject({ code: "IMPORT_APPLICATION_FAILED", register: "the store read back" });
  });

  it("refuses an activated instruction swallowed while an identical older version is activated in its place", async () => {
    const { batchId: first, store } = await withBatch({ activation: "leave-inactive" });
    unwrap(await applied({ batchId: first, store }));
    // A second export holding the same directives; its changed memory gives it its own digest, so its own questions.
    const contents = { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] };
    const { batchId } = await stagedAndAnswered({ answers: { activation: "activate" }, contents, store });
    await store.client.db.execute(
      sql`create function sw_proof_substitute() returns trigger language plpgsql as $$ begin update owner_directive set state = 'active' where directive_id = new.directive_id and state = 'inactive'; return null; end $$`,
    );
    await store.client.db.execute(
      sql`create trigger sw_proof_substitute before insert on owner_directive for each row execute function sw_proof_substitute()`,
    );
    const before = await rowCounts({ client: store.client });

    const refused = unwrapErr(await applied({ batchId, store }));

    expect(refused.message).toContain("2 instruction(s) it wrote are not in the store under their question");
    expect(refused).toMatchObject({ code: "IMPORT_APPLICATION_FAILED", register: "the store read back" });
    expect(await rowCounts({ client: store.client })).toEqual(before);
  });

  it("leaves only a gap in the knowledge sequences after a rollback, which every reader takes", async () => {
    const { batchId, store } = await withBatch();
    await store.client.db.execute(
      sql`alter table steer_measurement add constraint sw_proof_refuse check (false) not valid`,
    );
    unwrapErr(await applied({ batchId, store }));
    await store.client.db.execute(sql`alter table steer_measurement drop constraint sw_proof_refuse`);

    const outcome = unwrap(await applied({ batchId, store }));

    const memories = await store.client.db.select({ seq: memoriesTable.seq }).from(memoriesTable);
    const recalls = await store.client.db.select({ seq: memoryRecallsTable.seq }).from(memoryRecallsTable);
    const read = unwrap(await readStoreContentsIn({ reader: store.client }));
    expect(outcome.outcome).toBe("applied");
    // The rolled-back apply took seq 1 of each; the one that committed holds seq 2.
    expect([memories, recalls]).toEqual([[{ seq: 2 }], [{ seq: 2 }]]);
    expect([read.memoryLines.length, read.recallLines.length]).toEqual([1, 1]);
  });

  it("commits a batch once when two applies of it race on two connections", async () => {
    const { batchId, store } = await withBatch();
    const second = openStore({ url: store.url });

    const outcomes = await Promise.all([
      applied({ batchId, store }),
      applied({ batchId, client: second, store }),
    ]).finally(() => second.close());

    const [already, first] = outcomes.map((one) => unwrap(one)).toSorted((a, b) => a.outcome.localeCompare(b.outcome));
    const counts = await rowCounts({ client: store.client });
    expect([already!.outcome, first!.outcome]).toEqual(["already-applied", "applied"]);
    expect(already).toMatchObject({ receiptWrites: first!.writes, writes: 0 });
    expect(first!.writes).toBe(totalRows({ counts }));
    expect(counts["store_import_application"]).toBe(1);
  });

  it("reports an applied batch already applied before the home-file migration, which would now refuse", async () => {
    const { batchId, store } = await withBatch();
    const first = unwrap(await applied({ batchId, store }));
    // A home that is a regular file: every legacy read under it fails, so the migration refuses it outright.
    const unreadable = join(store.root, "home-is-a-file");
    writeFileSync(unreadable, "");
    const elsewhere = { ...store, home: unreadable };
    expect(unwrapErr(await ensureRegistersImported({ client: store.client, home: unreadable })).code).toBe(
      "SOURCE_UNREADABLE",
    );

    const again = unwrap(await applied({ batchId, store: elsewhere }));

    expect(again).toEqual({
      batchId,
      outcome: "already-applied",
      planDigest: first.planDigest,
      receiptWrites: first.writes,
      writes: 0,
    });
  });

  it("reports a batch already applied when the receipt read's own COMMIT goes unanswered", async () => {
    const { batchId, store } = await withBatch();
    const first = unwrap(await applied({ batchId, store }));
    // A connection whose every transaction runs its body for real, then loses the COMMIT's answer.
    const db = new Proxy(store.client.db, {
      get: (target, key, receiver): unknown => {
        if (key !== "transaction") {
          return Reflect.get(target, key, receiver);
        }
        return async (...args: Parameters<typeof target.transaction>): Promise<never> => {
          await target.transaction(...args);
          throw new Error("write CONNECTION_CLOSED");
        };
      },
    });

    const again = unwrap(await applied({ batchId, client: { ...store.client, db }, store }));

    expect(again).toEqual({
      batchId,
      outcome: "already-applied",
      planDigest: first.planDigest,
      receiptWrites: first.writes,
      writes: 0,
    });
  });

  it("reads and writes the real receipt table, never a temporary one shadowing its name", async () => {
    const { batchId, store } = await withBatch();
    // One connection, so the temporary table is on the session the apply runs in, searched first by default.
    await store.client.db.execute(
      sql`create temp table store_import_application (batch_id uuid primary key, plan_digest text not null, write_count integer not null)`,
    );
    await store.client.db.execute(sql`insert into store_import_application values (${batchId}, 'forged', 7)`);

    const outcome = unwrap(await applied({ batchId, store }));

    const forged = await store.client.db.execute<{ writes: number }>(
      sql`select write_count as writes from pg_temp.store_import_application`,
    );
    const real = await store.client.db.execute<{ writes: number }>(
      sql`select write_count as writes from public.store_import_application`,
    );
    expect(outcome.outcome).toBe("applied");
    expect([...forged]).toEqual([{ writes: 7 }]);
    expect([...real]).toEqual([{ writes: outcome.writes }]);
  });

  it("refuses a receipt naming another plan than its batch's, rather than reading it as already applied", async () => {
    const { batchId, store } = await withBatch();
    // The foreign key holds a receipt to its batch's own digest; only a store missing it can carry another one.
    await store.client.db.execute(
      sql`alter table store_import_application drop constraint fk_store_import_application_batch`,
    );
    const other = `sha256:${"0".repeat(64)}`;
    await store.client.db.execute(sql`insert into public.store_import_application values (${batchId}, ${other}, 1)`);

    const refused = unwrapErr(await applied({ batchId, store }));

    expect(refused.code).toBe("IMPORT_APPLICATION_FAILED");
    expect(refused.message).toContain(`its receipt names plan ${other}`);
  });

  it("refuses a replica-mode session, whose writes would skip every trigger, writing nothing", async () => {
    const { batchId, store } = await withBatch();
    await store.client.db.execute(sql`set session_replication_role = replica`);

    const refused = unwrapErr(await applied({ batchId, store }));
    await store.client.db.execute(sql`reset session_replication_role`);

    expect(refused.code).toBe("IMPORT_REPLICA_SESSION");
    expect(totalRows({ counts: await rowCounts({ client: store.client }) })).toBe(0);
  });

  it("refuses a store whose append-only guard is disabled, naming it and writing nothing", async () => {
    const { batchId, store } = await withBatch();
    await store.client.db.execute(sql`alter table steer_measurement disable trigger trg_steer_measurement_kept`);

    const refused = unwrapErr(await applied({ batchId, store }));

    expect(refused).toMatchObject({ code: "IMPORT_GUARDS_MISSING", missing: ["trg_steer_measurement_kept"] });
    expect(totalRows({ counts: await rowCounts({ client: store.client }) })).toBe(0);
  });

  it("holds every register against a writer on another connection while the apply's locks stand", async () => {
    const { store } = await withBatch();
    const writer = openStore({ url: store.url });
    // Row exclusive is what any insert, update or delete takes; share row exclusive refuses it.
    const write = async (): Promise<string> =>
      writer.db
        .transaction(async (other) => {
          await other.execute(sql`set local lock_timeout = '200ms'`);
          await other.execute(sql`lock table public.memories in row exclusive mode`);
          return "written";
        })
        .catch((cause: unknown) => innermost({ cause }));

    const unlocked = await write();
    const blocked = await store.client.db
      .transaction(async (tx) => {
        await lockRegisters({ writer: tx });
        return write();
      })
      .finally(() => writer.close());

    expect([unlocked, blocked]).toEqual(["written", "canceling statement due to lock timeout"]);
  });

  it("holds every guard it checks, and every answer, against another connection until the apply ends", async () => {
    const { store } = await withBatch();
    const other = openStore({ url: store.url });
    // `disable trigger` takes share row exclusive and an answer's insert row exclusive; the apply's locks refuse both.
    const attempt = async ({ statement }: { statement: ReturnType<typeof sql> }): Promise<string> =>
      other.db
        .transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '200ms'`);
          await tx.execute(statement);
          throw new Error("rolled back on purpose");
        })
        .catch((cause: unknown) => innermost({ cause }));
    const statements = [
      sql`alter table public.store_import_resolution disable trigger trg_store_import_resolution_immutable`,
      sql`lock table public.store_import_resolution in row exclusive mode`,
      sql`alter table public.steer_measurement disable trigger trg_steer_measurement_kept`,
    ];
    const attempts = async (): Promise<readonly string[]> => {
      const outcomes: string[] = [];
      for (const statement of statements) {
        outcomes.push(await attempt({ statement }));
      }
      return outcomes;
    };

    const unlocked = await attempts();
    const held = await store.client.db
      .transaction(async (tx) => {
        await lockStaging({ writer: tx });
        await lockRegisters({ writer: tx });
        return attempts();
      })
      .finally(() => other.close());

    expect(unlocked).toEqual(["rolled back on purpose", "rolled back on purpose", "rolled back on purpose"]);
    expect(held).toEqual([
      "canceling statement due to lock timeout",
      "canceling statement due to lock timeout",
      "canceling statement due to lock timeout",
    ]);
  });

  it("refuses an id naming no staged batch", async () => {
    const { store } = await withBatch();
    const batchId = randomUUID();

    expect(unwrapErr(await applied({ batchId, store }))).toMatchObject({ batchId, code: "IMPORT_BATCH_NOT_STAGED" });
  });
});
