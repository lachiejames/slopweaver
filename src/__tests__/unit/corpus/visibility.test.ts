import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { isAlwaysPrivateSource, stampVisibility, visibilityForRecord } from "../../../corpus/visibility.js";

const base: CorpusRecord = {
  container: "slack/C_PUBLIC",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "C_PUBLIC:1700000000.000100",
  text: "standup notes",
  tsIso: "2026-01-02T00:00:00.000Z",
  url: "https://example.com/r/1",
};

describe("stampVisibility", () => {
  it("stamps a private-lane record with visibility private", () => {
    const stamped = stampVisibility({ record: base, visibility: "private" });
    expect(stamped.visibility).toBe("private");
  });

  it("leaves a public record unchanged (no visibility field added)", () => {
    const stamped = stampVisibility({ record: base, visibility: "public" });
    expect(stamped.visibility).toBeUndefined();
    expect(stamped).toEqual(base);
  });

  it("preserves every other field when stamping private", () => {
    const stamped = stampVisibility({ record: base, visibility: "private" });
    expect(stamped).toEqual({ ...base, visibility: "private" });
  });
});

describe("visibilityForRecord", () => {
  it("reads an explicit private mark as private", () => {
    expect(visibilityForRecord({ record: { ...base, visibility: "private" } })).toBe("private");
  });

  it("reads an unmarked legacy record as public (migration default)", () => {
    expect(visibilityForRecord({ record: base })).toBe("public");
  });

  it("reads an explicit public mark as public", () => {
    expect(visibilityForRecord({ record: { ...base, visibility: "public" } })).toBe("public");
  });
});

/**
 * The `self` source has no public lane, so the mark is a property of the SOURCE. Both functions read it, which
 * is deliberate redundancy: the corpus default is public, an unmarked record reads back public, and one
 * projection path that forgot to stamp would leak the owner's internal thinking with nothing to show it had happened.
 */
describe("an always-private source", () => {
  const selfRecord: CorpusRecord = {
    ...base,
    container: "state/junkyard",
    kind: "document",
    source: "self",
    sourceId: "state/junkyard/an-old-idea.md#0.0:owned-paths",
  };

  it("names self and gmail, and nothing else", () => {
    expect(isAlwaysPrivateSource({ source: "self" })).toBe(true);
    expect(isAlwaysPrivateSource({ source: "gmail" })).toBe(true);
    expect(isAlwaysPrivateSource({ source: "slack" })).toBe(false);
    expect(isAlwaysPrivateSource({ source: "github" })).toBe(false);
    expect(isAlwaysPrivateSource({ source: "linear" })).toBe(false);
    expect(isAlwaysPrivateSource({ source: "notion" })).toBe(false);
    expect(isAlwaysPrivateSource({ source: "gold" })).toBe(false);
  });

  it("reads back private with no visibility field at all", () => {
    expect(visibilityForRecord({ record: selfRecord })).toBe("private");
  });

  it("is stamped private even when the caller asked for public", () => {
    expect(stampVisibility({ record: selfRecord, visibility: "public" }).visibility).toBe("private");
  });

  it("reads back private even if a hand-edited row claims public", () => {
    expect(visibilityForRecord({ record: { ...selfRecord, visibility: "public" } })).toBe("private");
  });

  /**
   * A mailbox is here for a stronger reason than `self`: its counterparties never joined this workspace and
   * cannot be asked, so there is no lane within mail a non-owner may read.
   */
  const mailRecord: CorpusRecord = {
    ...base,
    container: "mail/personal",
    kind: "message",
    source: "gmail",
    sourceId: "1a04220420e73f78",
  };

  it("reads a mail record back private with no visibility field at all", () => {
    expect(visibilityForRecord({ record: mailRecord })).toBe("private");
  });

  it("stamps a mail record private even when the caller asked for public", () => {
    expect(stampVisibility({ record: mailRecord, visibility: "public" }).visibility).toBe("private");
  });
});
