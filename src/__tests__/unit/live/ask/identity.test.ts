/**
 * `AskIdentity`/`RecordedAskIdentity` — the one contract every capture, brief, poster and queue boundary
 * shares. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import {
  type AskIdentity,
  askIdentityOf,
  exactRecordedAskIdentity,
  isAskIdentity,
  parseRecordedAskIdentity,
  type RecordedAskIdentity,
  sameAskIdentity,
} from "../../../../live/ask/identity.js";

const IDENTITY: AskIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };

describe("askIdentityOf", () => {
  it("projects a source's three identity fields, dropping anything else it carries", () => {
    expect(askIdentityOf({ source: { ...IDENTITY, extra: "dropped" } as unknown as AskIdentity })).toEqual(IDENTITY);
  });

  it("returns a fresh object, not the same reference", () => {
    expect(askIdentityOf({ source: IDENTITY })).not.toBe(IDENTITY);
  });
});

describe("exactRecordedAskIdentity", () => {
  it("wraps an exact identity with quality: exact", () => {
    expect(exactRecordedAskIdentity({ askIdentity: IDENTITY })).toEqual({ ...IDENTITY, quality: "exact" });
  });
});

describe("isAskIdentity", () => {
  it("accepts a well-formed identity", () => {
    expect(isAskIdentity(IDENTITY)).toBe(true);
  });

  it("refuses a value missing messageTs", () => {
    expect(isAskIdentity({ channel: "C1", threadTs: "1.1" })).toBe(false);
  });

  it("refuses a blank channel, not merely a missing one", () => {
    expect(isAskIdentity({ channel: "  ", messageTs: "2.2", threadTs: "1.1" })).toBe(false);
  });

  it("refuses a non-record value", () => {
    expect(isAskIdentity("not a record")).toBe(false);
  });
});

describe("parseRecordedAskIdentity", () => {
  it("returns an exact recorded identity as its three fields plus its quality", () => {
    const recorded: RecordedAskIdentity = { ...IDENTITY, quality: "exact" };
    expect(parseRecordedAskIdentity({ value: { ...recorded, extra: "dropped" } })).toEqual(recorded);
  });

  it("returns a thread-only recorded identity carrying no messageTs", () => {
    const recorded: RecordedAskIdentity = { channel: "C1", quality: "thread-only", threadTs: "1.1" };
    expect(parseRecordedAskIdentity({ value: recorded })).toEqual(recorded);
  });

  it("reads the spelling answer messages already in Slack carry as thread-only", () => {
    expect(parseRecordedAskIdentity({ value: { channel: "C1", quality: "legacy", threadTs: "1.1" } })).toEqual({
      channel: "C1",
      quality: "thread-only",
      threadTs: "1.1",
    });
  });

  it("never lets a thread-only record keep a messageTs it did not earn", () => {
    const parsed = parseRecordedAskIdentity({
      value: { channel: "C1", messageTs: "2.2", quality: "thread-only", threadTs: "1.1" },
    });
    expect(parsed).toEqual({ channel: "C1", quality: "thread-only", threadTs: "1.1" });
  });

  it("refuses an exact-quality value that is missing messageTs, rather than falling back to thread-only", () => {
    expect(parseRecordedAskIdentity({ value: { channel: "C1", quality: "exact", threadTs: "1.1" } })).toBe(undefined);
  });

  it("refuses a thread-only value missing threadTs, under either spelling", () => {
    expect(parseRecordedAskIdentity({ value: { channel: "C1", quality: "thread-only" } })).toBe(undefined);
    expect(parseRecordedAskIdentity({ value: { channel: "C1", quality: "legacy" } })).toBe(undefined);
  });

  it("refuses an unrecognised quality", () => {
    expect(parseRecordedAskIdentity({ value: { channel: "C1", quality: "unknown", threadTs: "1.1" } })).toBe(undefined);
  });

  it("refuses a non-record value", () => {
    expect(parseRecordedAskIdentity({ value: 42 })).toBe(undefined);
  });
});

describe("sameAskIdentity", () => {
  it("is true when every field matches", () => {
    expect(sameAskIdentity({ left: IDENTITY, right: { ...IDENTITY } })).toBe(true);
  });

  it("is false when only the thread matches but the addressing message differs", () => {
    expect(sameAskIdentity({ left: IDENTITY, right: { ...IDENTITY, messageTs: "3.3" } })).toBe(false);
  });

  it("is false when the channel differs", () => {
    expect(sameAskIdentity({ left: IDENTITY, right: { ...IDENTITY, channel: "C2" } })).toBe(false);
  });
});
