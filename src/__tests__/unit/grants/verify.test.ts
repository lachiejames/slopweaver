import { describe, expect, it } from "vitest";

import { absentAs } from "#lib/absent.js";
import { GRANT_CHECK_CODES, GrantCheckErrors, isGrantCheckCode } from "../../../grants/errors.js";
import type { GrantEntry } from "../../../grants/grant.js";
import { anchorShapeOf, verifyGrant } from "../../../grants/verify.js";
import { unwrap } from "../../../lib/result.js";

const ANCHOR = "transcript:a0000006-0000-4000-8000-000000000006#22222222-2222-2222-2222-222222222222";

const grantEntry = (over: Partial<{ id: string; change: string }> = {}): GrantEntry => ({
  grant: {
    anchor: ANCHOR,
    change: absentAs({ value: over.change, whenAbsent: "TIMEOUT = 30" }),
    changeKind: "literal",
    id: absentAs({ value: over.id, whenAbsent: "g-1a2b3c4d" }),
    pinnedAtRecord: false,
    recordedAtIso: "2026-09-04T01:00:00.000Z",
    recordedBySessionId: "session-a",
    target: { kind: "file", path: "src/config.ts" },
  },
  kind: "grant",
});

const performanceEntry = ({ grantId }: { grantId: string }): GrantEntry => ({
  kind: "performance",
  performance: {
    grantId,
    performedAtIso: "2026-09-04T01:05:00.000Z",
    performedBySessionId: "session-b",
    wrote: "TIMEOUT = 30",
  },
});

const FACTS = { anchorResolves: { kind: "resolved" }, proposedChange: undefined, targetPresent: true } as const;

describe("verifyGrant", () => {
  it("returns the row when every computable check passes", () => {
    const result = verifyGrant({ entries: [grantEntry()], facts: FACTS, grantId: "g-1a2b3c4d" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).change).toBe("TIMEOUT = 30");
  });

  it("refuses ROW_MISSING when nothing carries the id", () => {
    const result = verifyGrant({ entries: [grantEntry()], facts: FACTS, grantId: "g-nope" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("ROW_MISSING");
  });

  it("refuses ROW_MISSING on an empty journal, so an unreadable file fails closed", () => {
    const result = verifyGrant({ entries: [], facts: FACTS, grantId: "g-1a2b3c4d" });

    expect(result._unsafeUnwrapErr().code).toBe("ROW_MISSING");
  });

  it("refuses ANCHOR_UNRESOLVED before anything else about the row", () => {
    const result = verifyGrant({
      entries: [grantEntry()],
      facts: { ...FACTS, anchorResolves: { kind: "unresolved", why: "fixture anchor is absent" } },
      grantId: "g-1a2b3c4d",
    });

    expect(result._unsafeUnwrapErr()).toEqual(
      GrantCheckErrors.anchorUnresolved({ anchor: ANCHOR, why: "fixture anchor is absent" }),
    );
    expect(result._unsafeUnwrapErr().message).toBe(
      `the anchor ${ANCHOR} does not resolve to anything checkable — fixture anchor is absent; a row's origin must be readable`,
    );
  });

  it("refuses ALREADY_PERFORMED on a spent row, so one row stays one change", () => {
    const result = verifyGrant({
      entries: [grantEntry(), performanceEntry({ grantId: "g-1a2b3c4d" })],
      facts: FACTS,
      grantId: "g-1a2b3c4d",
    });

    expect(result._unsafeUnwrapErr().code).toBe("ALREADY_PERFORMED");
  });

  it("ignores a performance of a DIFFERENT row", () => {
    const result = verifyGrant({
      entries: [grantEntry(), performanceEntry({ grantId: "g-other" })],
      facts: FACTS,
      grantId: "g-1a2b3c4d",
    });

    expect(result.isOk()).toBe(true);
  });

  it("refuses STATE_ABSENT when the target is not there", () => {
    const result = verifyGrant({
      entries: [grantEntry()],
      facts: { ...FACTS, targetPresent: false },
      grantId: "g-1a2b3c4d",
    });

    expect(result._unsafeUnwrapErr().code).toBe("STATE_ABSENT");
    expect(result._unsafeUnwrapErr().message).toContain("file src/config.ts");
  });

  it("treats an unlookable target as ignorance, never as absence", () => {
    const result = verifyGrant({
      entries: [grantEntry()],
      facts: { ...FACTS, targetPresent: undefined },
      grantId: "g-1a2b3c4d",
    });

    expect(result.isOk()).toBe(true);
  });

  it("refuses CHANGE_MISMATCH when the proposed write is not the row's exact change", () => {
    const result = verifyGrant({
      entries: [grantEntry()],
      facts: { ...FACTS, proposedChange: "TIMEOUT = 9999" },
      grantId: "g-1a2b3c4d",
    });

    expect(result._unsafeUnwrapErr().code).toBe("CHANGE_MISMATCH");
  });

  it("accepts a proposed write that matches byte for byte", () => {
    const result = verifyGrant({
      entries: [grantEntry()],
      facts: { ...FACTS, proposedChange: "TIMEOUT = 30" },
      grantId: "g-1a2b3c4d",
    });

    expect(result.isOk()).toBe(true);
  });

  it("refuses a write differing only in trailing whitespace", () => {
    const result = verifyGrant({
      entries: [grantEntry()],
      facts: { ...FACTS, proposedChange: "TIMEOUT = 30 " },
      grantId: "g-1a2b3c4d",
    });

    expect(result._unsafeUnwrapErr().code).toBe("CHANGE_MISMATCH");
  });

  it("never produces RAIL_CROSSED — that judgement is the session's, and silence here is not permission", () => {
    const result = verifyGrant({
      entries: [grantEntry()],
      facts: { ...FACTS, proposedChange: "TIMEOUT = 30" },
      grantId: "g-1a2b3c4d",
    });

    expect(result.isOk()).toBe(true);
  });
});

describe("the refusal vocabulary", () => {
  it("is exactly the six checks a session may name", () => {
    expect([...GRANT_CHECK_CODES]).toEqual([
      "ROW_MISSING",
      "ANCHOR_UNRESOLVED",
      "CHANGE_MISMATCH",
      "ALREADY_PERFORMED",
      "STATE_ABSENT",
      "RAIL_CROSSED",
    ]);
  });

  it("has no code for disbelieving the sender", () => {
    expect(isGrantCheckCode("I_DONT_BELIEVE_YOU")).toBe(false);
    expect(isGrantCheckCode("UNVERIFIED_SENDER")).toBe(false);
    expect(isGrantCheckCode("IDENTITY_UNPROVEN")).toBe(false);
  });

  it("accepts every code it publishes", () => {
    expect(GRANT_CHECK_CODES.filter((code) => !isGrantCheckCode(code))).toEqual([]);
  });

  it("builds a RAIL_CROSSED refusal that routes to the owner", () => {
    const error = GrantCheckErrors.railCrossed({ rail: "this would widen access" });

    expect(error.code).toBe("RAIL_CROSSED");
    expect(error.message).toContain("route it to the owner");
  });
});

describe("anchorShapeOf", () => {
  it("recognises a transcript pointer", () => {
    expect(anchorShapeOf({ anchor: ANCHOR })).toBe("transcript");
  });

  it("recognises a permalink", () => {
    expect(anchorShapeOf({ anchor: "https://example.slack.com/archives/C1/p123" })).toBe("url");
  });

  it("reports anything else unrecognised", () => {
    expect(anchorShapeOf({ anchor: "the owner said so in the chat" })).toBe("unrecognised");
  });

  it("reports a blank anchor unrecognised", () => {
    expect(anchorShapeOf({ anchor: "   " })).toBe("unrecognised");
  });

  it("accepts a bare prefix with nothing after it, because it checks the prefix alone", () => {
    expect(anchorShapeOf({ anchor: "transcript:" })).toBe("transcript");
  });

  // A row anchored on the owner's console ruling once refused as unrecognised.
  it("classifies a relay turn and a call stretch as a console record the edge must resolve, a card landing apart", () => {
    expect([
      anchorShapeOf({ anchor: "talk:a0000015-0000-4000-8000-000000000016" }),
      anchorShapeOf({ anchor: "talk-call:a0000037-0000-4000-8000-000000000040#typed-owner-1111" }),
      anchorShapeOf({ anchor: "call:a0000037-0000-4000-8000-000000000040#s-1" }),
    ]).toEqual(["console-record", "console-record", "card-landing"]);
  });

  it("reads a console prefix untrimmed, as the resolver does, so a padded one is not a console record", () => {
    expect(anchorShapeOf({ anchor: " talk:a0000015-0000-4000-8000-000000000016" })).toBe("unrecognised");
  });
});
