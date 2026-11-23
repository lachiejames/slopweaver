/**
 * The pure core of `slopweaver compact`: the `--older-than` age grammar (a flag that DELETES records, so
 * a value we'd have to guess at is refused), the horizon arithmetic against a fixed clock, and the two
 * renderings — which must always state whether the pass was lossless or lossy.
 */
import { describe, expect, it } from "vitest";

import {
  compactHumanLines,
  compactJson,
  compactTotals,
  horizonIso,
  parseCompactOptions,
  parseOlderThanDays,
  partitionBySlot,
} from "../../../../../cli/commands/compact/core.js";
import type { CompactPlan } from "../../../../../corpus/compact.js";
import type { SlotVerdict } from "../../../../../lib/loadSlots.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const plan = (over: Partial<CompactPlan> = {}): CompactPlan => ({
  after: { bytes: 200, files: 1, records: 2 },
  before: { bytes: 500, files: 3, records: 5 },

  canonicalPath: "/bronze/github/compact.jsonl",
  duplicatesCollapsed: 3,
  orphanTemps: { bytes: 0, failures: [], removed: 0 },
  pruned: 0,
  rejected: 0,
  rejectedSamples: [],
  rekeyed: 0,
  source: "github",
  supersededPaths: [],
  ...over,
});

describe("parseOlderThanDays", () => {
  it("accepts a bare day count and the `d` suffix", () => {
    expect(unwrap(parseOlderThanDays({ value: "30" }))).toBe(30);
    expect(unwrap(parseOlderThanDays({ value: "30d" }))).toBe(30);
    expect(unwrap(parseOlderThanDays({ value: "1" }))).toBe(1);
  });

  it("refuses anything it would have to guess at", () => {
    expect(parseOlderThanDays({ value: "30days" }).isErr()).toBe(true);
    expect(parseOlderThanDays({ value: "d30" }).isErr()).toBe(true);
    expect(parseOlderThanDays({ value: "1.5" }).isErr()).toBe(true);
    expect(parseOlderThanDays({ value: "-1" }).isErr()).toBe(true);
    expect(parseOlderThanDays({ value: "0" }).isErr()).toBe(true);
    expect(parseOlderThanDays({ value: "" }).isErr()).toBe(true);
    expect(unwrapErr(parseOlderThanDays({ value: "soon" }))[0]!).toContain("positive whole number of days");
  });
});

describe("horizonIso", () => {
  it("places the horizon exactly N days before the injected now", () => {
    expect(horizonIso({ days: 30, now: new Date("2026-07-26T00:00:00.000Z") })).toBe("2026-06-26T00:00:00.000Z");
    expect(horizonIso({ days: 1, now: new Date("2026-01-01T12:30:00.000Z") })).toBe("2025-12-31T12:30:00.000Z");
  });
});

describe("parseCompactOptions", () => {
  it("defaults to every source, no pruning, human output", () => {
    const options = unwrap(parseCompactOptions({ defaultHome: "/h", rest: [] }));
    expect(options.home).toBe("/h");
    expect(options.sources).toStrictEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "self",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
    ]);
    expect(options.olderThanDays).toBeUndefined();
    expect(options.json).toBe(false);
  });

  it("narrows to one source and carries the explicit horizon + json switch", () => {
    const options = unwrap(
      parseCompactOptions({
        defaultHome: "/h",
        rest: ["--source", "slack", "--older-than", "90d", "--json", "--home", "/other"],
      }),
    );
    expect(options.sources).toStrictEqual(["slack"]);
    expect(options.olderThanDays).toBe(90);
    expect(options.json).toBe(true);
    expect(options.home).toBe("/other");
  });

  it("accumulates an unknown source AND a malformed horizon into one report", () => {
    const errors = unwrapErr(
      parseCompactOptions({ defaultHome: "/h", rest: ["--source", "jira", "--older-than", "soon"] }),
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]!).toContain("unknown source: jira");
    expect(errors[1]!).toContain("--older-than must be");
  });

  it("rejects an unknown flag before any value validation runs", () => {
    expect(unwrapErr(parseCompactOptions({ defaultHome: "/h", rest: ["--wat"] }))).toStrictEqual([
      "unknown flag: --wat",
    ]);
  });
});

describe("compactTotals", () => {
  it("sums every measure across sources", () => {
    const swept = { bytes: 7_211_295_966, failures: [], removed: 1 };
    const totals = compactTotals({
      plans: [plan(), plan({ orphanTemps: swept, pruned: 4, rejected: 2, source: "slack" })],
    });
    expect(totals).toStrictEqual({
      afterBytes: 400,
      afterFiles: 2,
      afterRecords: 4,
      beforeBytes: 1000,
      beforeFiles: 6,
      beforeRecords: 10,
      duplicatesCollapsed: 6,
      orphanTempBytes: 7_211_295_966,
      orphanTempsRemoved: 1,
      pruned: 4,
      rejected: 2,
    });
  });
});

describe("compactHumanLines — a dead writer's staged file", () => {
  const swept = plan({ orphanTemps: { bytes: 13_161_331_824, failures: [], removed: 1 }, source: "slack" });

  it("names the sweep on the source's line and in the totals, apart from every record figure", () => {
    const lines = compactHumanLines({ plans: [swept] });
    expect(lines).toContain(
      "  slack   3 file(s) → 1, 5 → 2 record(s), 500 → 200 byte(s), 3 duplicate(s) collapsed, " +
        "1 dead writer's staged file(s) swept (13161331824 byte(s))",
    );
    expect(lines).toContain(
      "1 staged file(s) of killed earlier runs swept, 13161331824 byte(s) reclaimed — they held no record",
    );
  });

  it("prints no sweep line at all when there was nothing to sweep", () => {
    expect(compactHumanLines({ plans: [plan()] }).filter((line) => line.includes("swept"))).toStrictEqual([]);
  });
});

describe("compactHumanLines", () => {
  it("names the pass LOSSLESS when no horizon was given", () => {
    const lines = compactHumanLines({ plans: [plan()] });
    expect(lines[0]).toBe("slopweaver compact — lossless (cross-window dedup only — no records dropped by age)");
    expect(lines).toContain("total: 3 → 1 file(s), 5 → 2 record(s), 500 → 200 byte(s)");
    expect(lines).toContain(
      "3 cross-window duplicate(s) collapsed, 0 record(s) age-pruned, 0 record(s) rejected (failed the required-field gate)",
    );
  });

  it("shouts the horizon when pruning ran — a lossy pass is never quiet", () => {
    const lines = compactHumanLines({ olderThanDays: 90, plans: [plan({ pruned: 7 })] });
    expect(lines[0]).toBe("slopweaver compact — AGE-PRUNING: dropping records older than 90 day(s)");
    expect(lines).toContain(
      "3 cross-window duplicate(s) collapsed, 7 record(s) age-pruned, 0 record(s) rejected (failed the required-field gate)",
    );
  });

  it("reports a rejected count in both the per-source line and the total, never silently", () => {
    const lines = compactHumanLines({
      plans: [plan({ rejected: 1, rejectedSamples: ["bronze/github/a.jsonl:12: missing required field"] })],
    });
    expect(lines).toContain(
      "  github  3 file(s) → 1, 5 → 2 record(s), 500 → 200 byte(s), 3 duplicate(s) collapsed, 1 rejected (bad record)",
    );
    expect(lines).toContain(
      "3 cross-window duplicate(s) collapsed, 0 record(s) age-pruned, 1 record(s) rejected (failed the required-field gate)",
    );
  });

  it("names how many rows were re-keyed onto a dashed Notion page id, and says nothing when none were", () => {
    const lines = compactHumanLines({ plans: [plan({ rekeyed: 4, source: "notion" }), plan()] });
    expect(lines).toContain(
      "  notion  3 file(s) → 1, 5 → 2 record(s), 500 → 200 byte(s), 3 duplicate(s) collapsed, 4 re-keyed onto a dashed page id",
    );
    expect(lines).toContain("  github  3 file(s) → 1, 5 → 2 record(s), 500 → 200 byte(s), 3 duplicate(s) collapsed");
  });

  it("names a failed source as UNFINISHED — the honest state, since it may be partly applied", () => {
    const lines = compactHumanLines({ failed: ["slack"], plans: [plan()] });
    expect(lines.at(-1)!).toBe("FAILED: slack — left UNFINISHED, no records lost; see the warnings above and re-run");
  });

  it("always states that the resume cursors were untouched", () => {
    expect(compactHumanLines({ plans: [plan()] }).at(-1)!).toContain("watermarks + thread/repo cursors untouched");
  });
});

describe("compactJson", () => {
  it("emits a stable machine shape with a null horizon by default", () => {
    const json = compactJson({ plans: [plan()] });
    expect(json["schemaVersion"]).toBe(1);
    expect(json["olderThanDays"]).toBeNull();
    expect(json["failed"]).toStrictEqual([]);
    expect(json["sources"]).toStrictEqual([
      {
        after: { bytes: 200, files: 1, records: 2 },
        before: { bytes: 500, files: 3, records: 5 },
        canonicalPath: "/bronze/github/compact.jsonl",
        duplicatesCollapsed: 3,
        orphanTemps: { bytes: 0, removed: 0 },
        pruned: 0,
        rejected: 0,
        rejectedSamples: [],
        rekeyed: 0,
        source: "github",
      },
    ]);
  });

  it("records the horizon that was actually applied", () => {
    expect(compactJson({ olderThanDays: 30, plans: [plan()] })["olderThanDays"]).toBe(30);
  });

  it("carries the failed sources", () => {
    expect(compactJson({ failed: ["notion"], plans: [plan()] })["failed"]).toStrictEqual(["notion"]);
  });
});

describe("partitionBySlot", () => {
  const HOLDER = { ceilingMib: 4096, pid: 4242, startedAtIso: "2026-09-24T02:30:00.000Z" };
  const OBSTACLE = "/slots/notion will not list (EACCES)";
  const take = ({ source }: { source: string }): SlotVerdict => {
    if (source === "slack") {
      return { admitted: false, holders: [HOLDER], limit: 1, obstacles: [] };
    }
    if (source === "notion") {
      return { admitted: false, holders: [], limit: 1, obstacles: [OBSTACLE] };
    }
    return { admitted: true, inFlight: 1, limit: 1 };
  };

  it("skips a source another writer holds and still admits the rest, in order", () => {
    expect(partitionBySlot({ sources: ["github", "slack", "linear"], take })).toStrictEqual({
      admitted: ["github", "linear"],
      held: [{ pid: 4242, source: "slack", startedAtIso: "2026-09-24T02:30:00.000Z" }],
      unavailable: [],
    });
  });

  it("skips a source whose slot names no holder as unavailable, never admitting it", () => {
    expect(partitionBySlot({ sources: ["notion", "github"], take })).toStrictEqual({
      admitted: ["github"],
      held: [],
      unavailable: [{ obstacles: [OBSTACLE], source: "notion" }],
    });
  });

  it("admits nothing when every source is held", () => {
    expect(partitionBySlot({ sources: ["slack"], take }).admitted).toStrictEqual([]);
  });

  it("admits everything when no slot is held", () => {
    expect(partitionBySlot({ sources: [], take }).held).toStrictEqual([]);
    expect(partitionBySlot({ sources: ["github"], take }).held).toStrictEqual([]);
  });
});
