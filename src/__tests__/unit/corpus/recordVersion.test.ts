/**
 * The version clock: a diary row orders by the provider's modification time, never its start, and a row with no
 * modification time carries a fallback stamp that an authoritative one always outranks.
 */
import { describe, expect, it } from "vitest";
import {
  laterRecordVersion,
  ordersByModification,
  recordVersion,
  sameRecordVersion,
} from "../../../corpus/recordVersion.js";
import type { CorpusRecord } from "../../../corpus/types.js";

/** One record of `source` at `tsIso`, carrying `attrs` when given. */
function record({
  source,
  tsIso,
  attrs,
}: {
  source: CorpusRecord["source"];
  tsIso: string;
  attrs?: CorpusRecord["attrs"];
}): CorpusRecord {
  return {
    container: "primary",
    kind: "event",
    refs: [],
    source,
    sourceId: "primary:evt1",
    text: "Planning",
    tsIso,
    url: "https://example.invalid/evt1",
    ...(attrs !== undefined ? { attrs } : {}),
  };
}

describe("recordVersion", () => {
  it("stamps a Google diary row with its modification time, not its start", () => {
    const stamped = record({
      attrs: { updatedIso: "2026-11-20T09:00:00.000Z" },
      source: "calendar",
      tsIso: "2027-03-01T10:00:00Z",
    });
    expect(recordVersion({ record: stamped })).toEqual({ basis: "authoritative", tsIso: "2026-11-20T09:00:00.000Z" });
  });

  it("stamps an Outlook diary row with its modification time, not its start", () => {
    const stamped = record({
      attrs: { updatedIso: "2026-11-20T09:00:00.1234567Z" },
      source: "outlook-calendar",
      tsIso: "2027-03-01T10:00:00Z",
    });
    expect(recordVersion({ record: stamped })).toEqual({
      basis: "authoritative",
      tsIso: "2026-11-20T09:00:00.1234567Z",
    });
  });

  it("falls back to the start for a diary row with no modification time, and says so", () => {
    expect(recordVersion({ record: record({ source: "calendar", tsIso: "2027-03-01T10:00:00Z" }) })).toEqual({
      basis: "fallback",
      tsIso: "2027-03-01T10:00:00Z",
    });
    const empty = record({ attrs: { updatedIso: "" }, source: "outlook-calendar", tsIso: "2027-03-01T10:00:00Z" });
    expect(recordVersion({ record: empty })).toEqual({ basis: "fallback", tsIso: "2027-03-01T10:00:00Z" });
  });

  it("keeps every other source on its own tsIso, an incidental updatedIso attr ignored", () => {
    const other = record({
      attrs: { updatedIso: "2030-01-01T00:00:00Z" },
      source: "slack",
      tsIso: "2026-01-01T00:00:00Z",
    });
    expect(recordVersion({ record: other })).toEqual({ basis: "authoritative", tsIso: "2026-01-01T00:00:00Z" });
  });
});

describe("ordersByModification", () => {
  it("is the two diaries and nothing else", () => {
    expect(
      (["calendar", "outlook-calendar", "slack", "gmail", "chatgpt"] as const).map((source) =>
        ordersByModification({ source }),
      ),
    ).toEqual([true, true, false, false, false]);
  });
});

describe("laterRecordVersion", () => {
  const authoritative = { basis: "authoritative", tsIso: "2026-11-20T09:00:00Z" } as const;
  const fallback = { basis: "fallback", tsIso: "2027-03-01T10:00:00Z" } as const;

  it("ranks an authoritative stamp above a fallback one, in both directions, whatever the strings say", () => {
    expect(laterRecordVersion({ candidate: authoritative, incumbent: fallback })).toBe(true);
    expect(laterRecordVersion({ candidate: fallback, incumbent: authoritative })).toBe(false);
  });

  it("orders stamps of one basis by instant, not by string", () => {
    const earlierInstant = { basis: "authoritative", tsIso: "2026-01-05T09:30:00+10:00" } as const;
    const laterInstant = { basis: "authoritative", tsIso: "2026-01-05T00:00:00Z" } as const;
    expect(laterRecordVersion({ candidate: laterInstant, incumbent: earlierInstant })).toBe(true);
    expect(laterRecordVersion({ candidate: earlierInstant, incumbent: laterInstant })).toBe(false);
  });

  it("orders two offsets inside one millisecond by instant, not by string", () => {
    // 00:00:00.0001Z against 00:00:00.0009Z: one millisecond to `Date.parse`, and the `+10:00` rendering sorts
    // ABOVE the `Z` one as a string while being the EARLIER moment.
    const earlierInstant = { basis: "authoritative", tsIso: "2026-01-01T10:00:00.0001+10:00" } as const;
    const laterInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.0009Z" } as const;
    expect(laterRecordVersion({ candidate: laterInstant, incumbent: earlierInstant })).toBe(true);
    expect(laterRecordVersion({ candidate: earlierInstant, incumbent: laterInstant })).toBe(false);
  });

  it("ranks a sub-millisecond fraction above a whole second, where a string ranks `Z` above `.`", () => {
    const earlierInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00Z" } as const;
    const laterInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.0005Z" } as const;
    expect(laterRecordVersion({ candidate: laterInstant, incumbent: earlierInstant })).toBe(true);
    expect(laterRecordVersion({ candidate: earlierInstant, incumbent: laterInstant })).toBe(false);
  });

  it("compares sub-millisecond fractions of different lengths as numbers", () => {
    // 0.00009s against 0.0001s: the shorter fraction is the later one.
    const earlierInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.00009Z" } as const;
    const laterInstant = { basis: "authoritative", tsIso: "2026-01-01T10:00:00.0001+10:00" } as const;
    expect(laterRecordVersion({ candidate: laterInstant, incumbent: earlierInstant })).toBe(true);
    expect(laterRecordVersion({ candidate: earlierInstant, incumbent: laterInstant })).toBe(false);
  });

  it("still orders one rendering's sub-millisecond digits", () => {
    const earlierInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.0001Z" } as const;
    const laterInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.0009Z" } as const;
    expect(laterRecordVersion({ candidate: laterInstant, incumbent: earlierInstant })).toBe(true);
    expect(laterRecordVersion({ candidate: earlierInstant, incumbent: laterInstant })).toBe(false);
  });

  it("reads the fraction from every ISO-8601 spelling `Date.parse` accepts: `t`/`z`, a space, each offset shape", () => {
    // `+10:00`'s `T10` sorts above `T00` as text, so each later rendering would also LOSE on a string compare.
    const earlierInstant = { basis: "authoritative", tsIso: "2026-01-01T10:00:00.0001+10:00" } as const;
    const later = [
      "2026-01-01t00:00:00.0009z",
      "2026-01-01 00:00:00.0009Z",
      "2026-01-01T09:00:00.0009+0900",
      "+002026-01-01T00:00:00.0009Z",
    ].map((tsIso) => ({ basis: "authoritative", tsIso }) as const);
    expect(
      later.map((stamp) => [
        Date.parse(stamp.tsIso) - Date.parse(earlierInstant.tsIso),
        laterRecordVersion({ candidate: stamp, incumbent: earlierInstant }),
        laterRecordVersion({ candidate: earlierInstant, incumbent: stamp }),
      ]),
    ).toEqual([
      [0, true, false],
      [0, true, false],
      [0, true, false],
      [0, true, false],
    ]);
  });

  it("never reads a fraction out of a legacy rendering's comment, which `Date.parse` skips", () => {
    // The comments' fractions rank `a` later; the text ranks `b` later. A legacy string carries no fraction here,
    // so the pair falls through to the raw-string tie-break rather than to digits the parser never read.
    const commentFractionLarger = {
      basis: "authoritative",
      tsIso: "(a 00:00:00.0009) 01 Jan 2026 00:00:00.0001 GMT",
    } as const;
    const textLarger = { basis: "authoritative", tsIso: "(b 00:00:00.0001) 01 Jan 2026 00:00:00.0009 GMT" } as const;
    expect(Date.parse(commentFractionLarger.tsIso)).toBe(Date.UTC(2026, 0, 1));
    expect(Date.parse(textLarger.tsIso)).toBe(Date.UTC(2026, 0, 1));
    expect(laterRecordVersion({ candidate: textLarger, incumbent: commentFractionLarger })).toBe(true);
    expect(laterRecordVersion({ candidate: commentFractionLarger, incumbent: textLarger })).toBe(false);
  });

  it("orders two legacy renderings inside one millisecond by their text, the stated residue", () => {
    // The `00:00:00.0009` one is the later instant, and its text sorts below `0:0:0.0001`, since `"0" < ":"`.
    const laterInstant = { basis: "authoritative", tsIso: "01 Jan 2026 00:00:00.0009 GMT" } as const;
    const earlierInstant = { basis: "authoritative", tsIso: "01 Jan 2026 0:0:0.0001 GMT" } as const;
    expect(Date.parse(laterInstant.tsIso)).toBe(Date.parse(earlierInstant.tsIso));
    expect(laterRecordVersion({ candidate: earlierInstant, incumbent: laterInstant })).toBe(true);
  });

  it("compares a fraction past the ninth digit, so no fixed width cuts it", () => {
    const earlierInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.0000000001Z" } as const;
    const laterInstant = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.0000000002Z" } as const;
    expect(laterRecordVersion({ candidate: laterInstant, incumbent: earlierInstant })).toBe(true);
    expect(laterRecordVersion({ candidate: earlierInstant, incumbent: laterInstant })).toBe(false);
  });

  it("orders two unparseable strings by their text, never by a fraction read off them", () => {
    // By fraction `.0009` would win; by text the `b` one does. Neither denotes an instant.
    const fractionLarger = { basis: "authoritative", tsIso: "a 00:00:00.0009 not a date" } as const;
    const textLarger = { basis: "authoritative", tsIso: "b 00:00:00.0001 not a date" } as const;
    expect(Date.parse(fractionLarger.tsIso)).toBeNaN();
    expect(Date.parse(textLarger.tsIso)).toBeNaN();
    expect(laterRecordVersion({ candidate: textLarger, incumbent: fractionLarger })).toBe(true);
    expect(laterRecordVersion({ candidate: fractionLarger, incumbent: textLarger })).toBe(false);
  });

  it("is transitive across three renderings inside one millisecond", () => {
    const ascending = [
      { basis: "authoritative", tsIso: "2026-01-01T00:00:00Z" },
      { basis: "authoritative", tsIso: "2026-01-01T10:00:00.00009+10:00" },
      { basis: "authoritative", tsIso: "2026-01-01 00:00:00.0005Z" },
    ] as const;
    const pairs = [
      [0, 1],
      [1, 2],
      [0, 2],
    ] as const;
    expect(
      pairs.map(([low, high]) => [
        laterRecordVersion({ candidate: ascending[high], incumbent: ascending[low] }),
        laterRecordVersion({ candidate: ascending[low], incumbent: ascending[high] }),
      ]),
    ).toEqual([
      [true, false],
      [true, false],
      [true, false],
    ]);
  });

  it("breaks a tie between one instant written two ways in exactly one direction", () => {
    const zulu = { basis: "authoritative", tsIso: "2026-01-01T00:00:00.0005Z" } as const;
    const offset = { basis: "authoritative", tsIso: "2026-01-01T10:00:00.00050+10:00" } as const;
    expect([
      laterRecordVersion({ candidate: zulu, incumbent: offset }),
      laterRecordVersion({ candidate: offset, incumbent: zulu }),
    ]).toEqual([false, true]);
  });
});

describe("the parser the version order leans on", () => {
  it("truncates past the third fractional digit rather than rounding", () => {
    // The sub-millisecond comparison reads the digits `Date.parse` dropped; rounding would double-count them.
    expect(Date.parse("2026-01-01T00:00:00.9999Z")).toBe(Date.parse("2026-01-01T00:00:00.999Z"));
  });
});

describe("sameRecordVersion", () => {
  it("is one basis and one string, and nothing less", () => {
    const stamp = { basis: "authoritative", tsIso: "2026-11-20T09:00:00Z" } as const;
    expect(sameRecordVersion({ candidate: stamp, incumbent: { ...stamp } })).toBe(true);
    expect(sameRecordVersion({ candidate: stamp, incumbent: { ...stamp, basis: "fallback" } })).toBe(false);
    expect(sameRecordVersion({ candidate: stamp, incumbent: { ...stamp, tsIso: "2026-11-20T09:00:01Z" } })).toBe(false);
  });
});
