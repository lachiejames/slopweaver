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
});

describe("sameRecordVersion", () => {
  it("is one basis and one string, and nothing less", () => {
    const stamp = { basis: "authoritative", tsIso: "2026-11-20T09:00:00Z" } as const;
    expect(sameRecordVersion({ candidate: stamp, incumbent: { ...stamp } })).toBe(true);
    expect(sameRecordVersion({ candidate: stamp, incumbent: { ...stamp, basis: "fallback" } })).toBe(false);
    expect(sameRecordVersion({ candidate: stamp, incumbent: { ...stamp, tsIso: "2026-11-20T09:00:01Z" } })).toBe(false);
  });
});
