/**
 * The in-memory store refuses what the real one refuses, and a refused batch leaves it exactly as it was — so a verb
 * test driven over it proves the verb, not a looser double.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { WorkstreamAggregate } from "../../../../workstreams/store/types.js";
import { inMemoryWorkstreamStore } from "../../../workstreamStoreFake.js";
import { ACME_META, acmeLocal, acmeOutcome } from "../../../workstreamStoreFixtures.js";

const HOME = "/acme/home";
const NOW = "2026-11-07T05:00:00.000Z";

/**
 * A local workstream linking each of `targets`.
 *
 * @returns the aggregate
 */
function linking({ id, targets }: { id: string; targets: readonly string[] }): WorkstreamAggregate {
  return {
    ...acmeLocal({ id }),
    links: targets.map((target, at) => ({
      id: `00000000-0000-4000-8000-0000000000e${String(at)}`,
      kind: "workstream" as const,
      label: null,
      milestoneId: null,
      target,
    })),
  };
}

describe("inMemoryWorkstreamStore", () => {
  it("writes two new workstreams linking each other in one batch, at revision 1, stamped with its clock", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const result = unwrap(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        meta: { document: ACME_META, expectedRevision: null },
        writes: [
          { aggregate: linking({ id: "acme-b", targets: ["acme-a"] }), expectedRevision: null },
          { aggregate: linking({ id: "acme-a", targets: ["acme-b"] }), expectedRevision: null },
        ],
      }),
    );

    expect(result.written.map((one) => [one.id, one.revision, one.createdAtIso])).toEqual([
      ["acme-a", 1, NOW],
      ["acme-b", 1, NOW],
    ]);
    expect(result.meta).toEqual({ document: ACME_META, revision: 1, updatedAtIso: NOW });
  });

  it("leaves itself untouched when a batch is refused part-way, the earlier write included", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-z" }), expectedRevision: null, home: HOME }));
    const before = unwrap(await store.read({ home: HOME }));
    const error = unwrapErr(
      await store.applyBatch({
        deletes: [],
        home: HOME,
        meta: { document: ACME_META, expectedRevision: 4 },
        writes: [
          { aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null },
          { aggregate: { ...acmeLocal({ id: "acme-z" }), name: "Acme scratch, renamed" }, expectedRevision: 1 },
        ],
      }),
    );

    expect(error.code).toBe("WORKSTREAM_META_REVISION_CONFLICT");
    expect(unwrap(await store.read({ home: HOME }))).toEqual(before);
  });

  it("refuses a single put linking a workstream it does not hold, and a delete another one links to", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const put = unwrapErr(
      await store.put({
        aggregate: linking({ id: "acme-a", targets: ["acme-b"] }),
        expectedRevision: null,
        home: HOME,
      }),
    );
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-b" }), expectedRevision: null, home: HOME }));
    unwrap(
      await store.put({
        aggregate: linking({ id: "acme-a", targets: ["acme-b"] }),
        expectedRevision: null,
        home: HOME,
      }),
    );
    const remove = unwrapErr(await store.remove({ expectedRevision: 1, home: HOME, workstreamId: "acme-b" }));

    expect([put.message, remove.message]).toEqual([
      "the workstream was refused, nothing written: acme-a links workstream acme-b, which the register does not hold",
      "workstream acme-b is linked from acme-a — remove those links first",
    ]);
  });

  it("deletes a linked workstream with its only linker in one batch, and refuses a stale revision", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-b" }), expectedRevision: null, home: HOME }));
    unwrap(
      await store.put({
        aggregate: linking({ id: "acme-a", targets: ["acme-b"] }),
        expectedRevision: null,
        home: HOME,
      }),
    );
    const stale = unwrapErr(
      await store.applyBatch({ deletes: [{ expectedRevision: 2, workstreamId: "acme-a" }], home: HOME, writes: [] }),
    );
    unwrap(
      await store.applyBatch({
        deletes: [
          { expectedRevision: 1, workstreamId: "acme-a" },
          { expectedRevision: 1, workstreamId: "acme-b" },
        ],
        home: HOME,
        meta: { document: null, expectedRevision: null },
        wholeRegister: { "acme-a": 1, "acme-b": 1 },
        writes: [],
      }),
    );

    expect(stale.message).toBe("workstream acme-a is no longer at revision 2 — read it again and decide afresh");
    expect(unwrap(await store.read({ home: HOME })).workstreams).toEqual([]);
  });

  it("refuses a revision no row could carry as invalid, as the store does, never as a conflict", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null, home: HOME }));
    const put = unwrapErr(
      await store.put({ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: 1.5, home: HOME }),
    );
    const meta = unwrapErr(await store.putMeta({ document: ACME_META, expectedRevision: 0, home: HOME }));
    const removed = unwrapErr(await store.remove({ expectedRevision: 0.5, home: HOME, workstreamId: "acme-a" }));

    expect([put.code, meta.code, removed.code]).toEqual([
      "WORKSTREAM_INVALID",
      "WORKSTREAM_INVALID",
      "WORKSTREAM_INVALID",
    ]);
    expect(removed.message).toBe(
      "the workstream was refused, nothing written: the delete of acme-a names revision 0.5, which no stored workstream carries",
    );
  });

  it("refuses a value outside an enum column's set as invalid, every one named, as no outage", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const entry = {
      date: "2026-11-07",
      done: false,
      href: null,
      id: "00000000-0000-4000-8000-000000000001",
      kind: "memo",
      milestoneId: null,
      position: 0,
      text: "scratch",
    };
    const link = {
      id: "00000000-0000-4000-8000-000000000002",
      kind: "ticket",
      label: null,
      milestoneId: null,
      target: "ABC-1",
    };
    const bogus = {
      ...acmeLocal({ id: "acme-a" }),
      entries: [entry],
      kind: "draft",
      links: [link],
      status: "paused",
      workspace: "bogus",
    } as unknown as WorkstreamAggregate;
    const refused = unwrapErr(await store.put({ aggregate: bogus, expectedRevision: null, home: HOME }));

    expect(refused.code).toBe("WORKSTREAM_INVALID");
    expect(refused.message).toBe(
      [
        'the workstream was refused, nothing written: acme-a kind "draft" is not one of outcome, standing, linked, local, closing',
        'acme-a workspace "bogus" is not one of team, self',
        'acme-a status "paused" is not one of proven, validating, stalled, discovery',
        'acme-a entry 00000000-0000-4000-8000-000000000001 kind "memo" is not one of raised, discussion, dm, proposal, pr, pushback, announce, note',
        'acme-a link 00000000-0000-4000-8000-000000000002 kind "ticket" is not one of queue_card, alignment_card, automation, pull_request, linear_project, workstream',
      ].join("; "),
    );
    expect(unwrap(await store.read({ home: HOME })).workstreams).toEqual([]);
  });

  it("refuses a field whose runtime value is not its declared type, before any rule reads it, as no column coerces it", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const base = acmeOutcome();
    const mistyped = {
      ...base,
      entries: [{ ...base.entries[0]!, done: "off" }, ...base.entries.slice(1)],
      milestones: [{ ...base.milestones[0]!, position: "0" }, ...base.milestones.slice(1)],
    } as unknown as WorkstreamAggregate;
    const refused = unwrapErr(await store.put({ aggregate: mistyped, expectedRevision: null, home: HOME }));

    expect(refused.code).toBe("WORKSTREAM_INVALID");
    expect(refused.message).toBe(
      [
        "the workstream was refused, nothing written: the workstream.entries.0.done: Invalid input: expected boolean, received string",
        "the workstream.milestones.0.position: Invalid input: expected number, received string",
      ].join("; "),
    );
    expect(unwrap(await store.read({ home: HOME })).workstreams).toEqual([]);
  });

  it("stores an indexed text of the longest key's length, and refuses one character more, naming where it sits", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const longest = `a${"b".repeat(255)}`;
    const link = {
      id: "00000000-0000-4000-8000-000000000003",
      kind: "automation" as const,
      label: null,
      milestoneId: null,
      target: `${longest}c`,
    };
    const kept = unwrap(await store.put({ aggregate: acmeLocal({ id: longest }), expectedRevision: null, home: HOME }));
    const refused = unwrapErr(
      await store.put({
        aggregate: { ...acmeLocal({ id: `${longest}c` }), links: [link] },
        expectedRevision: null,
        home: HOME,
      }),
    );

    expect(kept.id).toBe(longest);
    expect(refused.code).toBe("WORKSTREAM_INVALID");
    expect(refused.message).toBe(
      [
        "the workstream was refused, nothing written: the workstream id is 257 characters, past the store's longest key of 256",
        "the target of link 00000000-0000-4000-8000-000000000003 is 257 characters, past the store's longest key of 256",
      ].join("; "),
    );
  });

  it("refuses a delete naming an id no stored row could carry as invalid, alone and in a batch, never quoting a long one", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const nul = unwrapErr(await store.remove({ expectedRevision: 1, home: HOME, workstreamId: "\u0000" }));
    const batch = unwrapErr(
      await store.applyBatch({
        deletes: [{ expectedRevision: 1, workstreamId: "z".repeat(257) }],
        home: HOME,
        writes: [],
      }),
    );

    expect([nul.code, batch.code]).toEqual(["WORKSTREAM_INVALID", "WORKSTREAM_INVALID"]);
    expect(nul.message).toBe(
      'the workstream was refused, nothing written: a delete names "\\u0000", which is not a workstream id',
    );
    expect(batch.message).toBe(
      "the workstream was refused, nothing written: a delete names a workstream id of 257 characters, past the store's longest key of 256",
    );
  });

  it("stamps its clock as the store's timestamps read back: UTC with milliseconds, whatever offset it was given", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: "2026-11-07T16:00:00+11:00" });
    const meta = unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    const created = unwrap(
      await store.put({ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null, home: HOME }),
    );

    expect([meta.updatedAtIso, created.createdAtIso, created.updatedAtIso]).toEqual([
      "2026-11-07T05:00:00.000Z",
      "2026-11-07T05:00:00.000Z",
      "2026-11-07T05:00:00.000Z",
    ]);
  });

  it("hands back a position of -0 as 0, as the store's integer column reads it back", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const first = { ...acmeOutcome().milestones[0]!, after: [], position: -0 };
    const created = unwrap(
      await store.put({
        aggregate: acmeOutcome({ entries: [], links: [], milestones: [first] }),
        expectedRevision: null,
        home: HOME,
      }),
    );

    expect(Object.is(first.position, -0)).toBe(true);
    expect(Object.is(created.milestones[0]!.position, 0)).toBe(true);
  });

  it("hands back a -0 inside detail as 0, as the store's jsonb column reads it back", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const gauge = { asOf: "2026-11-07", gate: 1, gateLabel: "one", of: 1, source: "fixture", value: -0 };
    const linked: WorkstreamAggregate = {
      ...acmeOutcome({ entries: [], links: [] }),
      detail: {
        boardMembership: null,
        ending: null,
        feedback: [],
        gauge,
        initiative: null,
        leads: "Acme",
        numbers: "one",
        people: [],
        priority: null,
        skeptic: null,
        tags: [],
        waitingOn: null,
        yourPart: "support",
      },
      kind: "linked",
      status: null,
    };
    const created = unwrap(await store.put({ aggregate: linked, expectedRevision: null, home: HOME }));
    const stored = created.detail as { readonly gauge: { readonly value: number } };

    expect(Object.is(gauge.value, -0)).toBe(true);
    expect(Object.is(stored.gauge.value, 0)).toBe(true);
  });

  it("drops a field no column holds, at every level, as the store's read-back does", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const base = acmeOutcome({ links: [] });
    const ghosted = {
      ...base,
      entries: base.entries.map((one) => ({ ...one, ghost: "entry" })),
      ghost: "aggregate",
      milestones: base.milestones.map((one) => ({ ...one, ghost: "milestone" })),
    };
    const created = unwrap(await store.put({ aggregate: ghosted, expectedRevision: null, home: HOME }));
    const {
      createdAtIso: _created,
      progress: _progress,
      revision: _revision,
      updatedAtIso: _updated,
      ...kept
    } = created;

    expect(kept).toEqual(base);
    expect(unwrap(await store.read({ home: HOME })).workstreams).toEqual([created]);
  });

  it("hands back copies, so a caller mutating what it got never moves what the store holds", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const created = unwrap(
      await store.put({ aggregate: acmeLocal({ id: "acme-a" }), expectedRevision: null, home: HOME }),
    );
    Object.defineProperty(created, "revision", { value: 2 });
    const read = unwrap(await store.read({ home: HOME }));
    Object.defineProperty(read.workstreams[0], "revision", { value: 3 });

    expect([created.revision, read.workstreams[0]!.revision]).toEqual([2, 3]);
    expect(unwrap(await store.read({ home: HOME })).workstreams.map((one) => one.revision)).toEqual([1]);
    expect(unwrap(await store.remove({ expectedRevision: 1, home: HOME, workstreamId: "acme-a" }))).toBeUndefined();
  });
});
