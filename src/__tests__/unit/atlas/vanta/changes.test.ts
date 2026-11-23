import { describe, expect, it } from "vitest";

import {
  diffVantaGeneration,
  VANTA_CHANGE_ARM_EXAMPLES,
  VANTA_CHANGE_GROUP_EXAMPLES,
  VANTA_CHANGE_GROUPS,
  VANTA_CHANGE_VALUE_CHARS,
  type VantaKindChange,
  type VantaKindTransition,
  vantaChangeTotals,
  WHOLE_DETAIL_FIELD,
} from "../../../../atlas/vanta/changes.js";
import { vantaWindowStart } from "../../../../atlas/vanta/changesRecord.js";
import type { VantaEntity } from "../../../../atlas/vanta/model.js";

const BEFORE = "2026-09-30T00:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

/** One test entity whose Manage API channel holds `detail`, observed unless `stale` is set. */
const entity = ({ id, detail, stale = false }: { id: string; detail: unknown; stale?: boolean }): VantaEntity => ({
  channels: {
    browser: null,
    "manage-api": {
      channel: "manage-api",
      detail,
      firstSeenAt: BEFORE,
      lastSeenAt: BEFORE,
      source: null,
      state: stale ? "stale" : "observed",
    },
  },
  financialDetail: null,
  id: `test:${id}`,
  kind: "test",
  providerId: id,
  sensitivity: null,
});

const transition = (over: Partial<VantaKindTransition>): VantaKindTransition => ({
  after: [],
  before: [],
  complete: true,
  kind: "test",
  notes: [],
  reasons: [],
  since: BEFORE,
  ...over,
});

/** The single kind entry of a one-transition diff, narrowed to a complete read. */
const completeEntry = (over: Partial<VantaKindTransition>): Extract<VantaKindChange, { read: "complete" }> => {
  const entry = diffVantaGeneration({ at: AT, transitions: [transition(over)] }).kinds[0]!;
  if (entry.read !== "complete") {
    throw new Error(`expected a complete read, got ${entry.read}`);
  }
  return entry;
};

describe("diffVantaGeneration", () => {
  it("names added, removed, returned, changed and unchanged entities", () => {
    const entry = completeEntry({
      after: [
        entity({ detail: { name: "Kept", status: "OK" }, id: "kept" }),
        entity({ detail: { name: "Flipped", status: "NEEDS_ATTENTION" }, id: "flipped" }),
        entity({ detail: { name: "New" }, id: "new" }),
        entity({ detail: { name: "Back" }, id: "back" }),
        entity({ detail: { name: "Gone" }, id: "gone", stale: true }),
      ],
      before: [
        entity({ detail: { name: "Kept", status: "OK" }, id: "kept" }),
        entity({ detail: { name: "Flipped", status: "OK" }, id: "flipped" }),
        entity({ detail: { name: "Back" }, id: "back", stale: true }),
        entity({ detail: { name: "Gone" }, id: "gone" }),
        entity({ detail: { name: "Dropped" }, id: "dropped" }),
      ],
    });
    expect(entry.counts).toEqual({ added: 1, changed: 1, removed: 2, returned: 1, unchanged: 1 });
    expect(entry.added).toEqual([
      { name: "Back", providerId: "back", returned: true },
      { name: "New", providerId: "new", returned: false },
    ]);
    expect(entry.removed).toEqual([
      { name: "Dropped", providerId: "dropped" },
      { name: "Gone", providerId: "gone" },
    ]);
    expect(entry.changedGroups).toEqual([
      {
        count: 1,
        examples: [
          {
            fields: [{ after: '"NEEDS_ATTENTION"', before: '"OK"', field: "status" }],
            name: "Flipped",
            providerId: "flipped",
          },
        ],
        fields: ["status"],
      },
    ]);
    expect(entry.fieldTally).toEqual({ status: 1 });
    expect(entry.since).toBe(BEFORE);
  });

  it("lists the rarest changed group first, so a few status flips are not buried under timestamp churn", () => {
    const churned = ["a", "b", "c"].map((id) => ({
      after: entity({ detail: { lastRun: "2", status: "OK" }, id }),
      before: entity({ detail: { lastRun: "1", status: "OK" }, id }),
    }));
    const flipped = {
      after: entity({ detail: { lastRun: "2", status: "FAIL" }, id: "z" }),
      before: entity({ detail: { lastRun: "1", status: "OK" }, id: "z" }),
    };
    const pairs = [...churned, flipped];
    const entry = completeEntry({ after: pairs.map((pair) => pair.after), before: pairs.map((pair) => pair.before) });
    expect(entry.changedGroups.map((group) => [group.fields, group.count])).toEqual([
      [["lastRun", "status"], 1],
      [["lastRun"], 3],
    ]);
    expect(entry.fieldTally).toEqual({ lastRun: 4, status: 1 });
  });

  it("caps examples per group, groups per kind and the added arm, counting what it cut", () => {
    const groupCount = VANTA_CHANGE_GROUPS + 2;
    const before: VantaEntity[] = [];
    const after: VantaEntity[] = [];
    for (let index = 0; index < groupCount; index += 1) {
      before.push(entity({ detail: { [`f${String(index)}`]: 1 }, id: `g${String(index).padStart(2, "0")}` }));
      after.push(entity({ detail: { [`f${String(index)}`]: 2 }, id: `g${String(index).padStart(2, "0")}` }));
    }
    const bigGroup = VANTA_CHANGE_GROUP_EXAMPLES + 5;
    for (let index = 0; index < bigGroup; index += 1) {
      before.push(entity({ detail: { shared: 1 }, id: `s${String(index).padStart(2, "0")}` }));
      after.push(entity({ detail: { shared: 2 }, id: `s${String(index).padStart(2, "0")}` }));
    }
    for (let index = 0; index < VANTA_CHANGE_ARM_EXAMPLES + 3; index += 1) {
      after.push(entity({ detail: { name: "new" }, id: `n${String(index).padStart(2, "0")}` }));
    }
    const entry = completeEntry({ after, before });
    expect(entry.changedGroups).toHaveLength(VANTA_CHANGE_GROUPS);
    // Fourteen one-member groups and one big one, kept rarest first: the last two singletons and the big
    // group are cut.
    expect(entry.groupsOmitted).toEqual({ entities: 2 + bigGroup, groups: 3 });
    expect(entry.added).toHaveLength(VANTA_CHANGE_ARM_EXAMPLES);
    expect(entry.addedMore).toBe(3);
    expect(entry.counts.changed).toBe(groupCount + bigGroup);
  });

  it("keeps at most the example cap of one group's members", () => {
    const size = VANTA_CHANGE_GROUP_EXAMPLES + 4;
    const ids = Array.from({ length: size }, (_unused, index) => `e${String(index).padStart(2, "0")}`);
    const entry = completeEntry({
      after: ids.map((id) => entity({ detail: { status: "B" }, id })),
      before: ids.map((id) => entity({ detail: { status: "A" }, id })),
    });
    expect(entry.changedGroups[0]!.count).toBe(size);
    expect(entry.changedGroups[0]!.examples).toHaveLength(VANTA_CHANGE_GROUP_EXAMPLES);
  });

  it("cuts a long value, saying how much it dropped", () => {
    const long = "x".repeat(VANTA_CHANGE_VALUE_CHARS + 10);
    const entry = completeEntry({
      after: [entity({ detail: { body: long }, id: "a" })],
      before: [entity({ detail: { body: "short" }, id: "a" })],
    });
    const change = entry.changedGroups[0]!.examples[0]!.fields[0]!;
    expect(change.after).toBe(`${`"${long}"`.slice(0, VANTA_CHANGE_VALUE_CHARS)}…(+12 chars)`);
    expect(change.before).toBe('"short"');
  });

  it("records a non-object detail as one whole-detail field", () => {
    const entry = completeEntry({
      after: [entity({ detail: "two", id: "a" })],
      before: [entity({ detail: "one", id: "a" })],
    });
    expect(entry.changedGroups[0]!.fields).toEqual([WHOLE_DETAIL_FIELD]);
  });

  it("treats key order as no change", () => {
    const entry = completeEntry({
      after: [entity({ detail: { a: 1, b: { c: 2, d: 3 } }, id: "a" })],
      before: [entity({ detail: { b: { d: 3, c: 2 }, a: 1 }, id: "a" })],
    });
    expect(entry.counts).toEqual({ added: 0, changed: 0, removed: 0, returned: 0, unchanged: 1 });
  });

  it("records a kind with no prior successful read as a baseline, comparing nothing", () => {
    const record = diffVantaGeneration({
      at: AT,
      transitions: [transition({ after: [entity({ detail: {}, id: "a" })], since: null })],
    });
    expect(record.kinds).toEqual([{ entities: 1, kind: "test", read: "baseline" }]);
  });

  it("lists a kind this sync did not read completely, with its reasons, rather than leaving it out", () => {
    const record = diffVantaGeneration({
      at: AT,
      transitions: [transition({ complete: false, reasons: ["HTTP 503"] })],
    });
    expect(record).toEqual({
      at: AT,
      kinds: [{ kind: "test", read: "incomplete", reasons: ["HTTP 503"] }],
      version: 1,
    });
  });
});

describe("a kind the sync published but still called failed", () => {
  it("is compared, carrying the sync's reason as a note, so its changes are never lost", () => {
    const entry = completeEntry({
      after: [entity({ detail: { status: "FAIL" }, id: "a" })],
      before: [entity({ detail: { status: "OK" }, id: "a" })],
      notes: ["companion write failed"],
    });
    expect(entry.notes).toEqual(["companion write failed"]);
    expect(entry.counts.changed).toBe(1);
  });
});

/** A test entity last seen at `seen`, observed unless `stale` is set. */
const seenAt = ({ id, seen, stale = false }: { id: string; seen: string; stale?: boolean }): VantaEntity => {
  const base = entity({ detail: {}, id, stale });
  return {
    ...base,
    channels: { ...base.channels, "manage-api": { ...base.channels["manage-api"]!, lastSeenAt: seen } },
  };
};

describe("vantaWindowStart", () => {
  it("starts at the latest instant an observed entity was merged, ignoring stale ones", () => {
    const before = [
      seenAt({ id: "a", seen: BEFORE }),
      seenAt({ id: "b", seen: "2026-09-30T04:00:00.000Z" }),
      seenAt({ id: "c", seen: "2026-09-30T08:00:00.000Z", stale: true }),
    ];
    expect(vantaWindowStart({ before, lastSuccessAt: BEFORE })).toBe("2026-09-30T04:00:00.000Z");
  });

  it("starts later than a manifest window the sync left behind when it published a read it called failed", () => {
    const before = [seenAt({ id: "a", seen: "2026-09-30T04:00:00.000Z" })];
    expect(vantaWindowStart({ before, lastSuccessAt: BEFORE })).toBe("2026-09-30T04:00:00.000Z");
  });

  it("falls back to the manifest for a kind holding no observed entity", () => {
    expect(vantaWindowStart({ before: [], lastSuccessAt: BEFORE })).toBe(BEFORE);
  });

  it("is null for a kind never read, which makes the read a baseline", () => {
    expect(vantaWindowStart({ before: [], lastSuccessAt: null })).toBe(null);
  });
});

describe("vantaChangeTotals", () => {
  it("sums complete kinds and counts baseline and unread ones", () => {
    const record = diffVantaGeneration({
      at: AT,
      transitions: [
        transition({
          after: [entity({ detail: { s: 2 }, id: "a" }), entity({ detail: {}, id: "b" })],
          before: [entity({ detail: { s: 1 }, id: "a" }), entity({ detail: {}, id: "c" })],
        }),
        transition({ kind: "control", since: null }),
        transition({ complete: false, kind: "policy", reasons: ["boom"] }),
      ],
    });
    expect(vantaChangeTotals({ record })).toEqual({ added: 1, baseline: 1, changed: 1, incomplete: 1, removed: 1 });
  });

  it("is all zeros for an empty record", () => {
    expect(vantaChangeTotals({ record: { at: AT, kinds: [], version: 1 } })).toEqual({
      added: 0,
      baseline: 0,
      changed: 0,
      incomplete: 0,
      removed: 0,
    });
  });
});
