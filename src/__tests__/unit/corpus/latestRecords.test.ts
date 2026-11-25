/**
 * The logical latest-record view. The case that matters most here is the GitHub one: `sourceId` is unique
 * only WITHIN a repository, so a key that omits `container` merges unrelated issues and drops the losers
 * from every answer. Linear and Slack ids happen to be globally unique, so a suite exercising either alone
 * passes over that defect.
 */
import { describe, expect, it } from "vitest";

import { latestRecords, recordIdentity, supersededCount, supersedes } from "../../../corpus/latestRecords.js";
import type { CorpusRecord } from "../../../corpus/types.js";

function record({
  source = "github",
  container = "acme/one",
  sourceId = "#1",
  tsIso = "2026-01-01T00:00:00.000Z",
  text = "body",
  kind = "issue",
  attrs,
}: {
  source?: CorpusRecord["source"];
  container?: string;
  sourceId?: string;
  tsIso?: string;
  text?: string;
  kind?: CorpusRecord["kind"];
  attrs?: CorpusRecord["attrs"];
}): CorpusRecord {
  return {
    container,
    kind,
    refs: [],
    source,
    sourceId,
    text,
    tsIso,
    url: "https://example.invalid/x",
    ...(attrs !== undefined ? { attrs } : {}),
  };
}

/**
 * The exact pair a Notion re-pull produces for one already-captured chunk: the same body at the same instant,
 * one row carrying the `capture: "partial"` marker the repair removed. The repaired row is the SHORTER of the
 * two, which is what made the length tie-break keep the truncated one.
 */
const TRUNCATED = record({
  attrs: { capture: "partial", chunkCount: 23, chunkIndex: 0 },
  source: "notion",
  sourceId: "page:abc:chunk:0",
  text: "the first chunk",
});
const REPAIRED = record({
  attrs: { chunkCount: 112, chunkIndex: 0 },
  source: "notion",
  sourceId: "page:abc:chunk:0",
  text: "the first chunk",
});

describe("supersedes — the capture marker", () => {
  it("lets the repaired row beat the truncated one at the same instant and text", () => {
    expect(supersedes({ candidate: REPAIRED, incumbent: TRUNCATED })).toBe(true);
  });

  it("never lets the truncated row beat the repaired one, whichever order they arrive in", () => {
    expect(supersedes({ candidate: TRUNCATED, incumbent: REPAIRED })).toBe(false);
  });

  it("picks the repaired row out of a mixed bag, whichever way round it is fed", () => {
    expect(latestRecords({ records: [TRUNCATED, REPAIRED] })[0]!.attrs?.["chunkCount"]).toBe(112);
    expect(latestRecords({ records: [REPAIRED, TRUNCATED] })[0]!.attrs?.["chunkCount"]).toBe(112);
  });

  it("does NOT let a complete-but-emptier row evict a fuller partial one — the databases-lane counterexample", () => {
    const fullerPartial = record({
      attrs: { capture: "partial" },
      source: "notion",
      sourceId: "page:abc",
      text: "a body, plus the comments, plus more of the body",
    });
    const commentsOnlyComplete = record({ source: "notion", sourceId: "page:abc", text: "just the comments" });

    expect(supersedes({ candidate: commentsOnlyComplete, incumbent: fullerPartial })).toBe(false);
    expect(latestRecords({ records: [fullerPartial, commentsOnlyComplete] })[0]!.text).toBe(
      "a body, plus the comments, plus more of the body",
    );
  });

  it("still lets a NEWER capture win, marked or not — the marker only ever breaks a tie", () => {
    const newerTruncated = record({
      attrs: { capture: "partial" },
      source: "notion",
      sourceId: "page:abc",
      text: "the first chunk",
      tsIso: "2026-02-01T00:00:00.000Z",
    });
    const olderComplete = record({ source: "notion", sourceId: "page:abc", text: "the first chunk" });

    expect(supersedes({ candidate: newerTruncated, incumbent: olderComplete })).toBe(true);
  });
});

describe("recordIdentity", () => {
  it("separates the three parts so a shared prefix cannot collide", () => {
    const a = recordIdentity({ record: record({ container: "acme/one", sourceId: "#12" }) });
    const b = recordIdentity({ record: record({ container: "acme/one#1", sourceId: "2" }) });

    expect(a === b).toBe(false);
  });

  it("gives the same sourceId in two repos two different identities", () => {
    const one = recordIdentity({ record: record({ container: "acme/one", sourceId: "#123" }) });
    const two = recordIdentity({ record: record({ container: "acme/two", sourceId: "#123" }) });

    expect(one === two).toBe(false);
  });

  // A part cannot FORGE the separator. `corpusStore` accepts any non-empty string for container/sourceId,
  // NUL included, so the old unescaped join let two unrelated records key identically — and `latestRecords`
  // would then drop one of them and count it as a superseded version. The NUL is written as an ESCAPE here,
  // never as a raw byte: a literal NUL in a source file makes git treat the file as binary.
  it("a NUL inside a part cannot forge the separator and collide two unrelated records", () => {
    const spliced = recordIdentity({ record: record({ container: "acme\u0000api", sourceId: "#1" }) });
    const plain = recordIdentity({ record: record({ container: "acme", sourceId: "api\u0000#1" }) });

    expect(spliced === plain).toBe(false);
  });

  it("leaves an ordinary key byte-identical — the escape moves nothing that exists today", () => {
    expect(recordIdentity({ record: record({ container: "acme/one", sourceId: "#123" }) })).toBe(
      "github\u0000acme/one\u0000#123",
    );
  });
});

describe("latestRecords", () => {
  // This is not hypothetical: 12.2% of the records in a real corpus carry a `+10:00` offset rather than
  // `Z`. Comparing the RAW STRINGS ranks `…T00:30:00+10:00` above the `Z` row at midnight UTC while it is
  // the EARLIER instant, so the older row would win and
  // its stale prose would be handed to the only verb that spends tokens.
  it("compares INSTANTS, so an offset timestamp cannot outrank a later UTC one", () => {
    const collapsed = latestRecords({
      records: [
        record({ text: "OLD", tsIso: "2026-01-01T00:30:00+01:00" }), // = 2025-12-31T23:30:00Z
        record({ text: "NEW", tsIso: "2026-01-01T00:00:00Z" }),
      ],
    });

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.text).toBe("NEW");
  });

  it("picks the same winner whichever order the two spellings are read in", () => {
    const reversed = latestRecords({
      records: [
        record({ text: "NEW", tsIso: "2026-01-01T00:00:00Z" }),
        record({ text: "OLD", tsIso: "2026-01-01T00:30:00+01:00" }),
      ],
    });

    expect(reversed[0]!.text).toBe("NEW");
  });

  // The winner rule must be a TOTAL order, or the Map fold in `latestRecords` lets read order pick. A
  // review pass built this exact cycle out of a mixed parseable/unparseable trio: A beats B on serialised
  // length, B beats C on serialised length, C beats A on instant. Ranking an unparseable `tsIso` as
  // -Infinity — below every real timestamp — removes the cycle instead of hiding it.
  it("picks the same winner from a mixed parseable/unparseable trio, whichever order it is read in", () => {
    const a = record({ text: "A".repeat(100), tsIso: "2026-01-01T00:00:00Z" });
    const b = record({ text: "B".repeat(50), tsIso: "not-a-timestamp" });
    const c = record({ text: "C", tsIso: "2026-01-03T00:00:00Z" });

    const forward = latestRecords({ records: [a, b, c] });
    const reversed = latestRecords({ records: [c, b, a] });

    expect(forward).toHaveLength(1);
    expect(forward[0]!.text).toBe("C");
    expect(reversed[0]!.text).toBe("C");
  });

  it("ranks any dated record above an undated one, however long the undated row serialises", () => {
    const collapsed = latestRecords({
      records: [
        record({ text: "undated but very long ".repeat(20), tsIso: "not-a-timestamp" }),
        record({ text: "dated", tsIso: "2020-01-01T00:00:00Z" }),
      ],
    });

    expect(collapsed[0]!.text).toBe("dated");
  });

  // Content decides only once the timestamps are IDENTICAL — the rule is a lexicographic order on
  // (instant, tsIso string, serialised length, serialised row), so each part only runs when the one before
  // it ties. Two unparseable rows still order by their raw strings rather than by NaN or by read order.
  it("uses the content tie-break when two unparseable rows share the same tsIso", () => {
    const collapsed = latestRecords({
      records: [
        record({ text: "short", tsIso: "not-a-timestamp" }),
        record({ text: "the longer serialised row", tsIso: "not-a-timestamp" }),
      ],
    });

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.text).toBe("the longer serialised row");
  });

  it("orders two DIFFERENT unparseable timestamps by their strings, not by read order", () => {
    const forward = latestRecords({
      records: [record({ text: "aaa", tsIso: "aaa-not-a-time" }), record({ text: "zzz", tsIso: "zzz-not-a-time" })],
    });
    const reversed = latestRecords({
      records: [record({ text: "zzz", tsIso: "zzz-not-a-time" }), record({ text: "aaa", tsIso: "aaa-not-a-time" })],
    });

    expect(forward[0]!.text).toBe("zzz");
    expect(reversed[0]!.text).toBe("zzz");
  });

  // `Date.parse` truncates to the millisecond, so these are ONE instant to the rank comparison. Deciding
  // between them on serialised length would let the longer, EARLIER row win — which is what comparing the
  // raw strings before content prevents.
  it("keeps sub-millisecond ordering the instant comparison cannot see", () => {
    const collapsed = latestRecords({
      records: [
        record({ text: "earlier but much longer ".repeat(10), tsIso: "2026-01-01T00:00:00.0001Z" }),
        record({ text: "later", tsIso: "2026-01-01T00:00:00.0009Z" }),
      ],
    });

    expect(collapsed[0]!.text).toBe("later");
  });

  it("does not drop an unrelated record whose container and sourceId splice to the same key", () => {
    const collapsed = latestRecords({
      records: [
        record({ container: "acme\u0000api", sourceId: "#1", text: "unrelated A" }),
        record({ container: "acme", sourceId: "api\u0000#1", text: "unrelated B", tsIso: "2026-02-01T00:00:00.000Z" }),
      ],
    });

    expect(collapsed.map((r) => r.text)).toEqual(["unrelated A", "unrelated B"]);
  });

  it("keeps GitHub's same-numbered issues from different repos as separate records", () => {
    const collapsed = latestRecords({
      records: [
        record({ container: "acme/one", sourceId: "#123", text: "from repo one" }),
        record({ container: "acme/two", sourceId: "#123", text: "from repo two" }),
      ],
    });

    expect(collapsed.length).toBe(2);
    expect(collapsed.map((r) => r.text)).toEqual(["from repo one", "from repo two"]);
  });

  it("keeps only the newest version of one entity", () => {
    const collapsed = latestRecords({
      records: [
        record({ text: "old", tsIso: "2026-01-01T00:00:00.000Z" }),
        record({ text: "new", tsIso: "2026-06-01T00:00:00.000Z" }),
      ],
    });

    expect(collapsed.length).toBe(1);
    expect(collapsed[0]!.text).toBe("new");
  });

  it("is independent of the order records were read in", () => {
    const older = record({ text: "old", tsIso: "2026-01-01T00:00:00.000Z" });
    const newer = record({ text: "new", tsIso: "2026-06-01T00:00:00.000Z" });

    const forward = latestRecords({ records: [older, newer] });
    const reverse = latestRecords({ records: [newer, older] });

    expect(forward[0]!.text).toBe("new");
    expect(reverse[0]!.text).toBe("new");
  });

  it("prefers the richer capture when two versions share a timestamp", () => {
    const collapsed = latestRecords({
      records: [
        record({ text: "thin" }),
        record({ text: "a much fuller capture of the same entity at the same instant" }),
      ],
    });

    expect(collapsed[0]!.text).toBe("a much fuller capture of the same entity at the same instant");
  });

  it("preserves the position an identity first appeared at", () => {
    const collapsed = latestRecords({
      records: [
        record({ sourceId: "#1", text: "first" }),
        record({ sourceId: "#2", text: "second" }),
        record({ sourceId: "#1", text: "first, updated", tsIso: "2026-09-09T00:00:00.000Z" }),
      ],
    });

    expect(collapsed.map((r) => r.sourceId)).toEqual(["#1", "#2"]);
    expect(collapsed[0]!.text).toBe("first, updated");
  });

  it("returns an empty view for no records", () => {
    expect(latestRecords({ records: [] })).toEqual([]);
  });

  it("leaves records that share nothing but a sourceId across sources alone", () => {
    const collapsed = latestRecords({
      records: [
        record({ container: "linear/AAA", source: "linear", sourceId: "AAA-1" }),
        record({ container: "linear/AAA", source: "notion", sourceId: "AAA-1" }),
      ],
    });

    expect(collapsed.length).toBe(2);
  });
});

describe("supersedes", () => {
  it("is antisymmetric on a timestamp difference", () => {
    const older = record({ tsIso: "2026-01-01T00:00:00.000Z" });
    const newer = record({ tsIso: "2026-06-01T00:00:00.000Z" });

    expect(supersedes({ candidate: newer, incumbent: older })).toBe(true);
    expect(supersedes({ candidate: older, incumbent: newer })).toBe(false);
  });

  it("does not supersede an identical record, so a re-read cannot churn the view", () => {
    expect(supersedes({ candidate: record({}), incumbent: record({}) })).toBe(false);
  });
});

describe("supersededCount", () => {
  it("reports how many versions the view hides rather than dropping the number", () => {
    const records = [
      record({ text: "v1", tsIso: "2026-01-01T00:00:00.000Z" }),
      record({ text: "v2", tsIso: "2026-02-01T00:00:00.000Z" }),
      record({ text: "v3", tsIso: "2026-03-01T00:00:00.000Z" }),
      record({ sourceId: "#9", text: "other" }),
    ];

    expect(supersededCount({ collapsed: latestRecords({ records }), records })).toBe(2);
  });
});

describe("a later capture wins a timestamp tie for the read-once kinds", () => {
  it("keeps the LONGER row on a tie for an ordinary network source", () => {
    const wide = record({ text: "the whole thing, captured wide" });
    const narrow = record({ text: "narrow" });

    expect(latestRecords({ records: [wide, narrow] })[0]!.text).toBe("the whole thing, captured wide");
  });

  it("keeps the LATER row for `self`, whose tsIso an edit does not move", () => {
    const before = record({ source: "self", text: "a longer sentence that was later cut down" });
    const after = record({ source: "self", text: "cut down" });

    expect(latestRecords({ records: [before, after] })[0]!.text).toBe("cut down");
  });

  it("keeps the LATER row for a `transcript`, so dropping the summary is not lost to its own predecessor", () => {
    const withSummary = record({
      kind: "transcript",
      source: "gmail",
      text: "Summary\nThe team met.\n\n## Transcript\nAna: hello\nBo: hi",
    });
    const rawOnly = record({ kind: "transcript", source: "gmail", text: "Ana: hello\nBo: hi" });

    expect(latestRecords({ records: [withSummary, rawOnly] })[0]!.text).toBe("Ana: hello\nBo: hi");
  });

  it("keeps the LATER row for a `chatgpt` message, whose instant a rename or a branch switch does not move", () => {
    const wasAlternate = record({ attrs: { branch: "alternate" }, kind: "message", source: "chatgpt" });
    const nowCurrent = record({ attrs: { branch: "current" }, kind: "message", source: "chatgpt" });

    expect(latestRecords({ records: [wasAlternate, nowCurrent] })[0]!.attrs).toEqual({ branch: "current" });
  });

  it("does not let a transcript at a DIFFERENT instant win on position alone", () => {
    const newer = record({
      kind: "transcript",
      source: "gmail",
      text: "long newer body",
      tsIso: "2026-02-01T00:00:00.000Z",
    });
    const older = record({ kind: "transcript", source: "gmail", text: "older", tsIso: "2026-01-01T00:00:00.000Z" });

    expect(latestRecords({ records: [newer, older] })[0]!.text).toBe("long newer body");
  });
});

describe("latestRecords — a diary event's tsIso is its start, so its versions order by modification time", () => {
  /** One event at `start`, modified at `updated` when given. */
  const event = ({ source, start, updated }: { source: CorpusRecord["source"]; start: string; updated?: string }) =>
    record({
      container: "primary",
      kind: "event",
      source,
      sourceId: "primary:evt1",
      text: "Planning",
      tsIso: start,
      ...(updated !== undefined ? { attrs: { updatedIso: updated } } : {}),
    });

  it.each(["calendar", "outlook-calendar"] as const)(
    "serves a %s event moved EARLIER, in either read order",
    (source) => {
      const before = event({ source, start: "2026-12-10T10:00:00Z", updated: "2026-11-01T08:00:00Z" });
      const moved = event({ source, start: "2026-12-03T10:00:00Z", updated: "2026-11-20T08:00:00Z" });

      expect(latestRecords({ records: [before, moved] })[0]!.tsIso).toBe("2026-12-03T10:00:00Z");
      expect(latestRecords({ records: [moved, before] })[0]!.tsIso).toBe("2026-12-03T10:00:00Z");
    },
  );

  it("serves a modified row over one with no modification time, in either read order", () => {
    const unstamped = event({ source: "calendar", start: "2027-03-01T10:00:00Z" });
    const stamped = event({ source: "calendar", start: "2027-02-01T10:00:00Z", updated: "2026-11-20T08:00:00Z" });

    expect(latestRecords({ records: [unstamped, stamped] })[0]!.tsIso).toBe("2027-02-01T10:00:00Z");
    expect(latestRecords({ records: [stamped, unstamped] })[0]!.tsIso).toBe("2027-02-01T10:00:00Z");
  });

  it("still orders any other source by tsIso, an updatedIso attr notwithstanding", () => {
    const later = record({
      attrs: { updatedIso: "2026-01-01T00:00:00Z" },
      text: "later",
      tsIso: "2026-02-01T00:00:00.000Z",
    });
    const earlier = record({ attrs: { updatedIso: "2030-01-01T00:00:00Z" }, text: "earlier" });

    expect(supersedes({ candidate: earlier, incumbent: later })).toBe(false);
    expect(supersedes({ candidate: later, incumbent: earlier })).toBe(true);
  });
});
