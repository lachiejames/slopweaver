/*
 * `declaredTagsOf` — folding a journal's `tagged` events into a row's declared tags: replace or accumulate by
 * cardinality, drop by key or value, and keep what the registry no longer accepts as unrecognised. It moved here
 * when `rowTags.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { declaredTagsOf } from "../../../../handover/rowTagFold.js";
import { OWNER_AUDIENCE, writableAssignment } from "../../../../handover/rowTags.js";
import { unwrapErr } from "../../../../lib/result.js";
import { AT, LATER, tagged } from "./harness.js";

describe("declaredTagsOf", () => {
  it("accepts a write of the owner audience", () => {
    expect(OWNER_AUDIENCE).toBe("owner");
    expect(writableAssignment({ assignment: { key: "audience", value: OWNER_AUDIENCE } }).isOk()).toBe(true);
  });

  it("refuses an audience outside the closed set, naming the values a write may take", () => {
    const refused = unwrapErr(writableAssignment({ assignment: { key: "audience", value: "someone" } }));
    expect(refused.code).toBe("TAG_BAD_VALUE");
    expect(refused.message).toContain("owner | team | person | channel");
  });

  it("reads the owner audience back declared, and keeps a value outside the set as unrecognised", () => {
    expect(declaredTagsOf({ events: [tagged({ set: [{ key: "audience", value: OWNER_AUDIENCE }] })] })).toEqual([
      { key: "audience", source: "declared", value: "owner" },
    ]);
    expect(declaredTagsOf({ events: [tagged({ set: [{ key: "audience", value: "someone" }] })] })).toEqual([
      { key: "audience", source: "unrecognised", value: "someone" },
    ]);
  });

  it("lets a value drop remove the owner audience", () => {
    const events = [
      tagged({ set: [{ key: "audience", value: OWNER_AUDIENCE }] }),
      tagged({ atIso: LATER, drop: ["audience=owner"] }),
    ];
    expect(declaredTagsOf({ events })).toEqual([]);
  });

  it("is empty for a journal with no tagged event", () => {
    expect(declaredTagsOf({ events: [{ atIso: AT, branch: "b", docHash: "h", kind: "started" }] })).toEqual([]);
  });

  it("replaces a one-valued key and accumulates a many-valued one, deduplicated", () => {
    const events = [
      tagged({
        set: [
          { key: "impact", value: "low" },
          { key: "workstream", value: "iso-certification" },
        ],
      }),
      tagged({
        atIso: LATER,
        set: [
          { key: "impact", value: "high" },
          { key: "workstream", value: "board" },
          { key: "workstream", value: "iso-certification" },
        ],
      }),
    ];
    expect(declaredTagsOf({ events })).toEqual([
      { key: "workstream", source: "declared", value: "iso-certification" },
      { key: "workstream", source: "declared", value: "board" },
      { key: "impact", source: "declared", value: "high" },
    ]);
  });

  it("drops one value of a many-valued key, or the whole key", () => {
    const events = [
      tagged({
        set: [
          { key: "platform", value: "slack" },
          { key: "workstream", value: "iso-certification" },
          { key: "workstream", value: "board" },
        ],
      }),
      tagged({ atIso: LATER, drop: ["workstream=board", "platform"] }),
    ];
    expect(declaredTagsOf({ events })).toEqual([{ key: "workstream", source: "declared", value: "iso-certification" }]);
  });

  it("keeps an assignment the registry no longer accepts, marked unrecognised and after the registry's keys", () => {
    const events = [
      tagged({
        set: [
          { key: "colour", value: "red" },
          { key: "impact", value: "huge" },
          { key: "reply", value: "drafted" },
          { key: "platform", value: "slack" },
        ],
      }),
      tagged({ atIso: LATER, set: [{ key: "colour", value: "blue" }] }),
    ];
    expect(declaredTagsOf({ events })).toEqual([
      { key: "platform", source: "declared", value: "slack" },
      { key: "impact", source: "unrecognised", value: "huge" },
      { key: "reply", source: "unrecognised", value: "drafted" },
      { key: "colour", source: "unrecognised", value: "red" },
      { key: "colour", source: "unrecognised", value: "blue" },
    ]);
  });

  it("applies a hand-written value drop on a one-valued key, which the writer would refuse", () => {
    const events = [
      tagged({ set: [{ key: "impact", value: "high" }] }),
      tagged({ atIso: LATER, drop: ["impact=low"] }),
      tagged({ atIso: LATER, drop: ["platform=slack"] }),
    ];
    expect(declaredTagsOf({ events })).toEqual([{ key: "impact", source: "declared", value: "high" }]);
    expect(declaredTagsOf({ events: [...events, tagged({ atIso: LATER, drop: ["impact=high"] })] })).toEqual([]);
  });

  it("keeps a value with a trailing newline as unrecognised, by the rule the writer refuses it with", () => {
    const events = [tagged({ set: [{ key: "workstream", value: "board\n" }] })];
    expect(declaredTagsOf({ events })).toEqual([{ key: "workstream", source: "unrecognised", value: "board\n" }]);
    expect(unwrapErr(writableAssignment({ assignment: { key: "workstream", value: "board\n" } })).code).toBe(
      "TAG_PADDED",
    );
  });

  it("applies a hand-written drop of an empty value exactly as written", () => {
    const events = [
      tagged({ set: [{ key: "workstream", value: "" }] }),
      tagged({ atIso: LATER, drop: ["workstream="] }),
    ];
    expect(declaredTagsOf({ events })).toEqual([]);
  });

  it("drops an unrecognised key like any other", () => {
    const events = [tagged({ set: [{ key: "colour", value: "red" }] }), tagged({ atIso: LATER, drop: ["colour"] })];
    expect(declaredTagsOf({ events })).toEqual([]);
  });
});
