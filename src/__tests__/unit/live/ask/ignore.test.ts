/**
 * The permanent ignore registry — pure keying, encoding and folding. "Never reconsider this exact message,"
 * distinct from a single judgement attempt's own `no-response`.
 */
import { describe, expect, it } from "vitest";

import {
  foldIgnoredAsks,
  type IgnoredAsk,
  ignoredAskKey,
  ignoredAskLine,
  isIgnoredAsk,
  parseIgnoredAsksLog,
  type UnignoredAsk,
} from "../../../../live/ask/ignore.js";

const ENTRY: IgnoredAsk = {
  channel: "C1",
  ignoredAtIso: "2026-08-12T00:00:00.000Z",
  messageTs: "1785000000.000100",
  reason: "the owner said this thread is closed",
  schemaVersion: 1,
};

describe("ignoredAskKey", () => {
  it("keys on channel and messageTs", () => {
    expect(ignoredAskKey({ askIdentity: ENTRY })).toBe(JSON.stringify(["C1", "1785000000.000100"]));
  });

  it("does not collide when a channel/messageTs boundary shift would fool a delimited join", () => {
    const left = { ...ENTRY, channel: "C:A", messageTs: "1" };
    const right = { ...ENTRY, channel: "C", messageTs: "A:1" };

    expect(ignoredAskKey({ askIdentity: left })).not.toBe(ignoredAskKey({ askIdentity: right }));
  });
});

describe("ignoredAskLine / parseIgnoredAsksLog", () => {
  it("round-trips one entry", () => {
    const { entries, unreadable } = parseIgnoredAsksLog({ text: ignoredAskLine({ entry: ENTRY }) });

    expect(entries).toEqual([ENTRY]);
    expect(unreadable).toEqual([]);
  });

  it("reports an unparsable line's 1-indexed number without dropping the rest of the log", () => {
    const good = ignoredAskLine({ entry: ENTRY });
    const { entries, unreadable } = parseIgnoredAsksLog({ text: `not json\n${good}` });

    expect(unreadable).toEqual([1]);
    expect(entries).toEqual([ENTRY]);
  });

  it("skips a blank line without counting it as unreadable", () => {
    const good = ignoredAskLine({ entry: ENTRY });
    const { entries, unreadable } = parseIgnoredAsksLog({ text: `${good}\n\n` });

    expect(entries).toEqual([ENTRY]);
    expect(unreadable).toEqual([]);
  });

  it("rejects a line from a future schema version", () => {
    const { entries, unreadable } = parseIgnoredAsksLog({ text: JSON.stringify({ ...ENTRY, schemaVersion: 2 }) });

    expect(entries).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("rejects a line missing a required field", () => {
    const { entries, unreadable } = parseIgnoredAsksLog({
      text: JSON.stringify({ channel: "C1", schemaVersion: 1 }),
    });

    expect(entries).toEqual([]);
    expect(unreadable).toEqual([1]);
  });
});

describe("foldIgnoredAsks / isIgnoredAsk", () => {
  it("folds one entry, findable by its key", () => {
    const ignored = foldIgnoredAsks({ entries: [ENTRY] });

    expect(isIgnoredAsk({ askIdentity: ENTRY, ignored })).toBe(true);
  });

  it("reports false for an ask never ignored", () => {
    const ignored = foldIgnoredAsks({ entries: [ENTRY] });

    expect(isIgnoredAsk({ askIdentity: { ...ENTRY, messageTs: "9999999999.000000" }, ignored })).toBe(false);
  });

  it("is idempotent — repeating the same ignore twice still yields one entry", () => {
    const ignored = foldIgnoredAsks({ entries: [ENTRY, ENTRY] });

    expect(ignored.size).toBe(1);
  });

  it("folds an empty log to an empty registry", () => {
    const ignored = foldIgnoredAsks({ entries: [] });

    expect(ignored.size).toBe(0);
  });
});

describe("lifting an ignore", () => {
  const LIFT: UnignoredAsk = {
    ...ENTRY,
    ignoredAtIso: "2026-08-13T00:00:00.000Z",
    kind: "unignore",
    reason: "wrong ask",
  };

  it("round-trips an unignore line with its kind", () => {
    const { entries, unreadable } = parseIgnoredAsksLog({ text: ignoredAskLine({ entry: LIFT }) });

    expect(unreadable).toEqual([]);
    expect(entries).toEqual([LIFT]);
  });

  it("reads an explicit ignore kind as an ignore", () => {
    const { entries } = parseIgnoredAsksLog({ text: JSON.stringify({ ...ENTRY, kind: "ignore" }) });

    expect(entries).toEqual([ENTRY]);
  });

  it("refuses a kind it does not know rather than guessing a direction", () => {
    const { entries, unreadable } = parseIgnoredAsksLog({ text: JSON.stringify({ ...ENTRY, kind: "mute" }) });

    expect(entries).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("reopens an ask whose last entry is an unignore", () => {
    const ignored = foldIgnoredAsks({ entries: [ENTRY, LIFT] });

    expect(isIgnoredAsk({ askIdentity: ENTRY, ignored })).toBe(false);
    expect(ignored.size).toBe(0);
  });

  it("ignores it again when a later ignore follows the lift", () => {
    const again = { ...ENTRY, ignoredAtIso: "2026-08-14T00:00:00.000Z" };
    const ignored = foldIgnoredAsks({ entries: [ENTRY, LIFT, again] });

    expect(ignored.get(ignoredAskKey({ askIdentity: ENTRY }))).toEqual(again);
  });

  it("lifts only the ask it names", () => {
    const other = { ...ENTRY, messageTs: "1785000000.000200" };
    const ignored = foldIgnoredAsks({ entries: [ENTRY, other, LIFT] });

    expect([...ignored.values()]).toEqual([other]);
  });
});
