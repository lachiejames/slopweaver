/**
 * The permanent CONVERSATION ignore registry — pure keying, encoding and folding. The channel-keyed sibling
 * of `ignore.test.ts`, with the added two-way KIND a channel-scoped registry needs to support `--remove`.
 */
import { describe, expect, it } from "vitest";

import {
  foldIgnoredConversations,
  IGNORED_CONVERSATION_SCHEMA_VERSION,
  type IgnoredConversation,
  ignoredConversationLine,
  isIgnoredConversation,
  parseIgnoredConversationsLog,
} from "../../../../live/ask/ignoredConversation.js";

const ENTRY: IgnoredConversation = {
  channel: "D0SYN000001",
  ignoredAtIso: "2026-08-31T22:40:00.000Z",
  kind: "ignore",
  reason: "the owner said every tag in their own DM is ignorable",
  schemaVersion: 1,
};

describe("ignoredConversationLine / parseIgnoredConversationsLog", () => {
  it("round-trips one entry", () => {
    const { entries, unreadable } = parseIgnoredConversationsLog({ text: ignoredConversationLine({ entry: ENTRY }) });

    expect(entries).toEqual([ENTRY]);
    expect(unreadable).toEqual([]);
  });

  it("reports an unparsable line's 1-indexed number without dropping the rest of the log", () => {
    const good = ignoredConversationLine({ entry: ENTRY });
    const { entries, unreadable } = parseIgnoredConversationsLog({ text: `not json\n${good}` });

    expect(unreadable).toEqual([1]);
    expect(entries).toEqual([ENTRY]);
  });

  it("skips a blank line without counting it as unreadable", () => {
    const good = ignoredConversationLine({ entry: ENTRY });
    const { entries, unreadable } = parseIgnoredConversationsLog({ text: `${good}\n\n` });

    expect(entries).toEqual([ENTRY]);
    expect(unreadable).toEqual([]);
  });

  it("rejects a line from a future schema version", () => {
    const { entries, unreadable } = parseIgnoredConversationsLog({
      text: JSON.stringify({ ...ENTRY, schemaVersion: 2 }),
    });

    expect(entries).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("rejects a line whose kind is neither ignore nor unignore", () => {
    const { entries, unreadable } = parseIgnoredConversationsLog({
      text: JSON.stringify({ ...ENTRY, kind: "sideways" }),
    });

    expect(entries).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("rejects a line missing a required field", () => {
    const { entries, unreadable } = parseIgnoredConversationsLog({
      text: JSON.stringify({ channel: "D1", schemaVersion: IGNORED_CONVERSATION_SCHEMA_VERSION }),
    });

    expect(entries).toEqual([]);
    expect(unreadable).toEqual([1]);
  });
});

describe("foldIgnoredConversations / isIgnoredConversation", () => {
  it("folds one `ignore` entry as currently ignored", () => {
    const ignored = foldIgnoredConversations({ entries: [ENTRY] });

    expect(isIgnoredConversation({ channel: ENTRY.channel, ignored })).toBe(true);
  });

  it("reports false for a channel never ignored", () => {
    const ignored = foldIgnoredConversations({ entries: [ENTRY] });

    expect(isIgnoredConversation({ channel: "C_UNRELATED", ignored })).toBe(false);
  });

  it("is idempotent — repeating the same ignore twice still yields one entry", () => {
    const ignored = foldIgnoredConversations({ entries: [ENTRY, ENTRY] });

    expect(ignored.size).toBe(1);
  });

  it("an `unignore` after an `ignore` lifts the suppression — the last entry wins", () => {
    const unignore: IgnoredConversation = { ...ENTRY, ignoredAtIso: "2026-09-01T00:00:00.000Z", kind: "unignore" };
    const ignored = foldIgnoredConversations({ entries: [ENTRY, unignore] });

    expect(isIgnoredConversation({ channel: ENTRY.channel, ignored })).toBe(false);
  });

  it("a re-`ignore` after an `unignore` re-suppresses — the last entry wins either direction", () => {
    const unignore: IgnoredConversation = { ...ENTRY, ignoredAtIso: "2026-09-01T00:00:00.000Z", kind: "unignore" };
    const reIgnore: IgnoredConversation = { ...ENTRY, ignoredAtIso: "2026-09-02T00:00:00.000Z", kind: "ignore" };
    const ignored = foldIgnoredConversations({ entries: [ENTRY, unignore, reIgnore] });

    expect(isIgnoredConversation({ channel: ENTRY.channel, ignored })).toBe(true);
  });

  it("folds an empty log to an empty registry", () => {
    const ignored = foldIgnoredConversations({ entries: [] });

    expect(ignored.size).toBe(0);
  });
});
