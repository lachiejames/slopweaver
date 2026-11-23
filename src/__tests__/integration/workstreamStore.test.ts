/**
 * The store-backed workstream register against a REAL store: what fake seams cannot prove — the CHECKs and composite
 * foreign keys, the compare-and-set predicate deciding real races, the target lock keeping a `workstream` link from
 * dangling, a delete cascading, and a reader never seeing a write half done. A batch is `./workstreamStoreBatch.test.ts`.
 *
 * OPT-IN, and never in CI: it needs a real, migrated store, and there is none in any lane. Point it at a THROWAWAY
 * database in the running stack — never `postgres`, which is the live fleet's. This file deletes every workstream row
 * before and after every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres workstream_store_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/workstream_store_proof slopweaver store push
 *   WORKSTREAM_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/workstream_store_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/workstreamStore.test.ts
 *
 * (`store push` refuses a migration not yet on `origin/main`; before this lands, prefix it with
 * `SLOPWEAVER_ALLOW_UNLANDED_MIGRATION=1`, which is what that hatch is for.)
 */
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import type { StoreClient } from "../../store/client.js";
import {
  workstreamEntryTable,
  workstreamLinkTable,
  workstreamMilestoneAfterTable,
  workstreamMilestoneTable,
  workstreamTable,
} from "../../store/schema.js";
import { aggregateRowsOf, deleteWorkstreamIn, writeAggregateIn } from "../../workstreams/store/aggregateWrite.js";
import { workstreamStore } from "../../workstreams/store/port.js";
import { productionWorkstreamStoreSeams } from "../../workstreams/store/rows.js";
import { STORE_INTEGER_MAX, STORE_KEY_MAX_CHARACTERS } from "../../workstreams/store/storable.js";
import type { WorkstreamAggregate, WorkstreamLink } from "../../workstreams/store/types.js";
import { ACME_META, acmeLocal, acmeOutcome } from "../workstreamStoreFixtures.js";

import { gate, linkTo, PROOF_URL, useRealStore, waitForLockWaiters } from "./workstreamStoreProof.js";

describe.skipIf(PROOF_URL === undefined)("the workstream register in a real store", () => {
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

  it("round-trips an aggregate exactly, progress derived, and bumps the revision on each write", async () => {
    const created = unwrap(await put({ aggregate: acmeOutcome() }));
    const updated = unwrap(
      await put({ aggregate: acmeOutcome({ name: "Acme onboarding, phase two" }), expectedRevision: created.revision }),
    );
    const snapshot = unwrap(await store.read({ home }));

    expect(created.revision).toBe(1);
    expect(updated.revision).toBe(2);
    expect(snapshot.workstreams).toEqual([updated]);
    expect(updated.milestones).toEqual(acmeOutcome().milestones);
    expect(updated.entries).toEqual(acmeOutcome().entries);
    expect(updated.progress!.next!.id).toBe("pilot");
  });

  it("reads back a put written in any order exactly as what the put returned", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    const scrambled = acmeOutcome({
      entries: acmeOutcome().entries.toReversed(),
      links: [
        linkTo({ n: 2, target: "acme-a" }),
        {
          ...linkTo({ n: 1, target: "00000000-0000-4000-8000-0000000000d1" }),
          kind: "linear_project",
        },
      ],
      milestones: acmeOutcome().milestones.toReversed(),
    });
    const stored = unwrap(await put({ aggregate: scrambled }));

    expect(unwrap(await store.read({ home })).workstreams[1]).toEqual(stored);
    expect(stored.links.map((link) => link.kind)).toEqual(["linear_project", "workstream"]);
    expect(stored.milestones.map((one) => one.id)).toEqual(["scope", "pilot", "rollout"]);
  });

  it("holds validation's edges exactly: the largest position and a paired surrogate round-trip, and the store itself refuses one past them", async () => {
    const [scope, pilot] = acmeOutcome().entries;
    const edge = acmeOutcome({ entries: [scope!, { ...pilot!, position: STORE_INTEGER_MAX, text: "pilot 🚀" }] });
    const stored = unwrap(await put({ aggregate: edge }));
    const raw = { date: "2026-11-05", kind: "note" as const, position: 7, text: "raw", workstreamId: edge.id };
    const insert = (over: Partial<typeof workstreamEntryTable.$inferInsert> & { id: string }) =>
      client.db.insert(workstreamEntryTable).values({ ...raw, ...over });

    expect(unwrap(await store.read({ home })).workstreams[0]).toEqual(stored);
    expect(stored.entries[1]!.text).toBe("pilot 🚀");
    // Each refusal pins the cause Postgres raised, its SQLSTATE and its exact text, which names the type. The wrapper
    // around it is drizzle's (the query and its params), so matching the whole error would pin the library instead.
    await expect(
      insert({ id: "00000000-0000-4000-8000-0000000000e1", position: STORE_INTEGER_MAX + 1 }),
    ).rejects.toMatchObject({
      cause: { code: "22003", message: 'value "2147483648" is out of range for type integer' },
    });
    await expect(insert({ id: "00000000-0000-4000-8000-0000000000e2", text: "nul\u0000here" })).rejects.toMatchObject({
      cause: { code: "22021", message: 'invalid byte sequence for encoding "UTF8": 0x00' },
    });
    await expect(insert({ date: "0000-01-01", id: "00000000-0000-4000-8000-0000000000e3" })).rejects.toMatchObject({
      cause: { code: "22008", message: 'date/time field value out of range: "0000-01-01"' },
    });
  });

  it("refuses a write at the largest revision as invalid, before the bump could overflow the column", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-worn" }) }));
    await client.db
      .update(workstreamTable)
      .set({ revision: STORE_INTEGER_MAX })
      .where(eq(workstreamTable.id, "acme-worn"));
    const error = unwrapErr(
      await put({ aggregate: acmeLocal({ id: "acme-worn" }), expectedRevision: STORE_INTEGER_MAX }),
    );

    expect(error.code).toBe("WORKSTREAM_INVALID");
    expect(error.message).toBe(
      "the workstream was refused, nothing written: acme-worn is at revision 2147483647, the store's largest, so it cannot be written again",
    );
    await expect(
      client.db
        .update(workstreamTable)
        .set({ revision: STORE_INTEGER_MAX + 1 })
        .where(eq(workstreamTable.id, "acme-worn")),
    ).rejects.toMatchObject({
      cause: { code: "22003", message: 'value "2147483648" is out of range for type integer' },
    });
  });

  it("refuses a value outside an enum column's set as invalid, before the column's own enum refuses it as an outage", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-a" }) }));
    const bogus = { ...acmeLocal({ id: "acme-b" }), workspace: "bogus" } as unknown as WorkstreamAggregate;
    const error = unwrapErr(await put({ aggregate: bogus }));

    expect(error.code).toBe("WORKSTREAM_INVALID");
    expect(error.message).toBe(
      'the workstream was refused, nothing written: acme-b workspace "bogus" is not one of team, self',
    );
    await expect(
      client.db
        .update(workstreamTable)
        .set({ workspace: "bogus" as never })
        .where(eq(workstreamTable.id, "acme-a")),
    ).rejects.toMatchObject({
      cause: { code: "22P02", message: 'invalid input value for enum workstream_workspace: "bogus"' },
    });
  });

  it("refuses a field mistyped at runtime as invalid, where the boolean column would coerce it silently", async () => {
    const base = acmeOutcome();
    const entry = base.entries[0]!;
    const mistyped = {
      ...base,
      entries: [{ ...entry, done: "off" }, ...base.entries.slice(1)],
    } as unknown as WorkstreamAggregate;
    const error = unwrapErr(await put({ aggregate: mistyped }));

    expect(error.code).toBe("WORKSTREAM_INVALID");
    expect(error.message).toBe(
      "the workstream was refused, nothing written: the workstream.entries.0.done: Invalid input: expected boolean, received string",
    );
    unwrap(await put({ aggregate: { ...base, entries: [{ ...entry, done: true }, ...base.entries.slice(1)] } }));
    await client.db
      .update(workstreamEntryTable)
      .set({ done: "off" as never })
      .where(eq(workstreamEntryTable.id, entry.id));
    const [row] = await client.db
      .select({ done: workstreamEntryTable.done })
      .from(workstreamEntryTable)
      .where(eq(workstreamEntryTable.id, entry.id));
    expect(row).toEqual({ done: false });
  });

  it("refuses an indexed text past the store's longest, which the B-tree itself refuses as an outage", async () => {
    const longest = `a${"b".repeat(STORE_KEY_MAX_CHARACTERS - 1)}`;
    const link = { ...linkTo({ n: 9, target: longest }), kind: "automation" as const };
    const kept = unwrap(await put({ aggregate: { ...acmeLocal({ id: longest }), links: [link] } }));
    const refused = unwrapErr(await put({ aggregate: acmeLocal({ id: `${longest}c` }) }));
    const incompressible = Array.from({ length: 100 }, (_, i) =>
      createHash("sha256").update(String(i)).digest("hex"),
    ).join("");

    expect(kept.links.map((one) => one.target)).toEqual([longest]);
    expect(refused.message).toBe(
      "the workstream was refused, nothing written: the workstream id is 257 characters, past the store's longest key of 256",
    );
    await expect(
      client.db.update(workstreamTable).set({ id: incompressible }).where(eq(workstreamTable.id, longest)),
    ).rejects.toMatchObject({ cause: { code: "54000" } });
  });

  it("writes an aggregate past one statement's bind parameters, and reads every child back", async () => {
    // Ten thousand entries of nine columns each: 90000 parameters, past the protocol's 65535 in one insert.
    const entries = Array.from({ length: 10_000 }, (_, i) => ({
      date: "2026-11-07",
      done: false,
      href: null,
      id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
      kind: "note" as const,
      milestoneId: null,
      position: i,
      text: "x",
    }));
    const written = unwrap(await put({ aggregate: { ...acmeLocal({ id: "acme-many" }), entries } }));
    const read = unwrap(await store.read({ home }));

    expect(written.entries).toEqual(entries);
    expect(read.workstreams.find((one) => one.id === "acme-many")!.entries).toEqual(entries);
  });

  it("refuses by CHECK a done entry with no proof link, and by foreign key a milestone another workstream owns", async () => {
    unwrap(await put({ aggregate: acmeOutcome() }));
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-scratch" }) }));
    // An explicit id, so each insert is refused by the constraint named and not by a missing key.
    const entry = {
      date: "2026-11-05",
      id: "00000000-0000-4000-8000-0000000000c1",
      kind: "note" as const,
      position: 9,
      text: "done",
      workstreamId: "acme-onboarding",
    };

    await expect(
      client.db.insert(workstreamEntryTable).values({ ...entry, done: true, milestoneId: "pilot" }),
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint_name: "workstream_entry_done_proven",
        message: 'new row for relation "workstream_entry" violates check constraint "workstream_entry_done_proven"',
      },
    });
    await expect(
      client.db.insert(workstreamEntryTable).values({ ...entry, milestoneId: "pilot", workstreamId: "acme-scratch" }),
    ).rejects.toMatchObject({
      cause: {
        code: "23503",
        constraint_name: "fk_workstream_entry_milestone",
        message:
          'insert or update on table "workstream_entry" violates foreign key constraint "fk_workstream_entry_milestone"',
      },
    });
  });

  it("lets exactly one of two concurrent creates win, and one of two updates at the same revision", async () => {
    const creates = await Promise.all([
      put({ aggregate: acmeOutcome() }),
      put({ aggregate: acmeOutcome({ name: "Acme rival" }) }),
    ]);
    expect(creates.filter((one) => one.isOk()).length).toBe(1);
    expect(creates.filter((one) => one.isErr()).map((one) => unwrapErr(one).code)).toEqual([
      "WORKSTREAM_REVISION_CONFLICT",
    ]);

    const updates = await Promise.all([
      put({ aggregate: acmeOutcome({ name: "A" }), expectedRevision: 1 }),
      put({ aggregate: acmeOutcome({ name: "B" }), expectedRevision: 1 }),
    ]);
    expect(updates.filter((one) => one.isOk()).length).toBe(1);
    expect(updates.filter((one) => one.isErr()).map((one) => unwrapErr(one).code)).toEqual([
      "WORKSTREAM_REVISION_CONFLICT",
    ]);
    expect(unwrap(await store.read({ home })).workstreams[0]!.revision).toBe(2);
  });

  it("cascades a delete to every child row", async () => {
    const pr: WorkstreamLink = {
      id: "00000000-0000-4000-8000-0000000000c1",
      kind: "pull_request",
      label: null,
      milestoneId: null,
      target: "acme/app#12",
    };
    unwrap(await put({ aggregate: acmeOutcome({ links: [pr] }) }));
    // Each child table counted directly, never through the parent, so an orphan row cannot hide behind it.
    const childCounts = async (): Promise<readonly number[]> =>
      Promise.all(
        [workstreamMilestoneTable, workstreamMilestoneAfterTable, workstreamEntryTable, workstreamLinkTable].map(
          async (table) =>
            (await client.db.select().from(table).where(eq(table.workstreamId, "acme-onboarding"))).length,
        ),
      );
    // Before: 3 milestones, 2 after edges, 2 entries, 1 link, so the after reading has something to lose.
    expect(await childCounts()).toEqual([3, 2, 2, 1]);

    unwrap(await store.remove({ expectedRevision: 1, home, workstreamId: "acme-onboarding" }));

    expect(await aggregateRowsOf({ reader: client.db, workstreamId: "acme-onboarding" })).toBeUndefined();
    expect(await childCounts()).toEqual([0, 0, 0, 0]);
  });

  it("refuses a link whose target a concurrent delete removed first: the lock comes back empty and the write names it", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-target" }) }));
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-linker" }) }));
    const deleted = gate();
    const release = gate();
    const deleting = client.db.transaction(async (writer) => {
      const outcome = await deleteWorkstreamIn({ expectedRevision: 1, workstreamId: "acme-target", writer });
      deleted.open();
      await release.passed;
      return outcome;
    });
    await deleted.passed;
    const linking = put({
      aggregate: { ...acmeLocal({ id: "acme-linker" }), links: [linkTo({ n: 1, target: "acme-target" })] },
      expectedRevision: 1,
    });
    await lockWaiters({ count: 1 });
    release.open();

    expect(await deleting).toEqual({ kind: "deleted" });
    expect(unwrapErr(await linking).message).toBe(
      "the workstream was refused, nothing written: acme-linker links workstream acme-target, which the register does not hold",
    );
  });

  it("refuses a delete when a concurrent write linked the target first", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-target" }) }));
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-linker" }) }));
    const linked = gate();
    const release = gate();
    const linker = { ...acmeLocal({ id: "acme-linker" }), links: [linkTo({ n: 1, target: "acme-target" })] };
    const linking = client.db.transaction(async (writer) => {
      const outcome = await writeAggregateIn({ aggregate: linker, expectedRevision: 1, writer });
      linked.open();
      await release.passed;
      return outcome.kind;
    });
    await linked.passed;
    const deleting = store.remove({ expectedRevision: 1, home, workstreamId: "acme-target" });
    await lockWaiters({ count: 1 });
    release.open();

    expect(await linking).toBe("written");
    expect(unwrapErr(await deleting).code).toBe("WORKSTREAM_REFERENCED");
    expect(unwrap(await store.read({ home })).workstreams.map((one) => [one.id, one.revision])).toEqual([
      ["acme-linker", 2],
      ["acme-target", 1],
    ]);
  });

  it("lets a second writer link the same targets while the first still holds its locks: key share never waits on key share", async () => {
    for (const id of ["acme-a", "acme-b", "acme-x", "acme-y"]) {
      unwrap(await put({ aggregate: acmeLocal({ id }) }));
    }
    // A link's key is (workstream, id), so both writers may carry the very same UUIDs.
    const linker = ({ id }: { id: string }): WorkstreamAggregate => ({
      ...acmeLocal({ id }),
      links: ["acme-a", "acme-b"].map((target, n) => linkTo({ n, target })),
    });
    const locked = gate();
    const release = gate();
    const first = client.db.transaction(async (writer) => {
      try {
        const outcome = await writeAggregateIn({ aggregate: linker({ id: "acme-x" }), expectedRevision: 1, writer });
        locked.open();
        await release.passed;
        return outcome.kind;
      } finally {
        locked.open();
      }
    });
    await locked.passed;
    // The first writer holds its target locks, uncommitted. A lock that conflicted with them (FOR UPDATE, say) would
    // hold the second writer until release, and the timer would win.
    const second = put({ aggregate: linker({ id: "acme-y" }), expectedRevision: 1 });
    let timer: NodeJS.Timeout | undefined;
    const blocked = new Promise<"blocked">((resolve) => {
      timer = setTimeout(() => resolve("blocked"), 3000);
    });
    const settled = await Promise.race([second.then(() => "committed" as const), blocked]);
    clearTimeout(timer);
    release.open();

    expect(settled).toBe("committed");
    expect(await first).toBe("written");
    expect(unwrap(await second).links.map((link) => link.target)).toEqual(["acme-a", "acme-b"]);
  });

  it("lets two writers swap link UUIDs between workstreams while the first is uncommitted, never a key collision", async () => {
    unwrap(await put({ aggregate: acmeLocal({ id: "acme-target" }) }));
    const holding = ({ id, n }: { id: string; n: number }): WorkstreamAggregate => ({
      ...acmeLocal({ id }),
      links: [linkTo({ n, target: "acme-target" })],
    });
    unwrap(await put({ aggregate: holding({ id: "acme-a", n: 1 }) }));
    unwrap(await put({ aggregate: holding({ id: "acme-b", n: 2 }) }));
    const written = gate();
    const release = gate();
    const first = client.db.transaction(async (writer) => {
      // Opened in `finally`: a table-wide key throws here, and the test must fail on that, not time out.
      try {
        const outcome = await writeAggregateIn({
          aggregate: holding({ id: "acme-a", n: 2 }),
          expectedRevision: 1,
          writer,
        });
        written.open();
        await release.passed;
        return outcome.kind;
      } finally {
        written.open();
      }
    });
    await written.passed;
    const second = await put({ aggregate: holding({ id: "acme-b", n: 1 }), expectedRevision: 1 });
    release.open();

    expect(await first).toBe("written");
    expect(unwrap(second).links[0]!.id).toBe(linkTo({ n: 1, target: "acme-target" }).id);
    expect(
      unwrap(await store.read({ home }))
        .workstreams.filter((one) => one.id !== "acme-target")
        .map((one) => [one.id, one.links[0]!.id]),
    ).toEqual([
      ["acme-a", linkTo({ n: 2, target: "acme-target" }).id],
      ["acme-b", linkTo({ n: 1, target: "acme-target" }).id],
    ]);
  });

  it("never shows a reader a write half done: an uncommitted replace-all reads as the old aggregate", async () => {
    unwrap(await put({ aggregate: acmeOutcome() }));
    const written = gate();
    const release = gate();
    const writing = client.db.transaction(async (writer) => {
      await writeAggregateIn({ aggregate: acmeOutcome({ entries: [] }), expectedRevision: 1, writer });
      written.open();
      await release.passed;
    });
    await written.passed;
    const during = unwrap(await store.read({ home }));
    release.open();
    await writing;
    const after = unwrap(await store.read({ home }));

    expect(during.workstreams[0]!.revision).toBe(1);
    expect(during.workstreams[0]!.entries.length).toBe(2);
    expect(after.workstreams[0]!.revision).toBe(2);
    expect(after.workstreams[0]!.entries).toEqual([]);
  });

  it("creates the register document once and updates it only at its revision", async () => {
    const created = unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home }));
    const second = unwrapErr(await store.putMeta({ document: ACME_META, expectedRevision: null, home }));
    const updated = unwrap(
      await store.putMeta({ document: { ...ACME_META, initiatives: [] }, expectedRevision: 1, home }),
    );
    // A writer still holding revision 1 after it moved to 2 is refused, and its document is not written.
    const stale = unwrapErr(await store.putMeta({ document: ACME_META, expectedRevision: 1, home }));

    expect(created.revision).toBe(1);
    expect(second.code).toBe("WORKSTREAM_META_REVISION_CONFLICT");
    expect(updated.revision).toBe(2);
    expect(stale.code).toBe("WORKSTREAM_META_REVISION_CONFLICT");
    const meta = unwrap(await store.read({ home })).meta!;
    expect([meta.revision, meta.document.initiatives]).toEqual([2, []]);
  });
});
