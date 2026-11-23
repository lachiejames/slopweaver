import { describe, expect, it } from "vitest";
import type { Candidate } from "../../../sessionStart/item.js";
import { asItem, itemIdentity, missingMandatory } from "../../../sessionStart/item.js";

/** A complete candidate, which every case below narrows from. */
const COMPLETE: Candidate = {
  background: "a pull request you opened in acme/app, changing how reviews are requested",
  doneWhen: "reply to the review comment, then ask for the overall review",
  nativeId: "acme/app#16341",
  source: "github",
  whenIso: "2026-08-28T02:10:34.000Z",
  where: "https://github.com/acme/app/pull/16341",
  who: "a-teammate",
};

describe("missingMandatory", () => {
  it("finds nothing missing on a complete candidate", () => {
    expect(missingMandatory({ candidate: COMPLETE })).toEqual([]);
  });

  it("names an absent field", () => {
    const { who: _who, ...withoutWho } = COMPLETE;
    expect(missingMandatory({ candidate: withoutWho })).toEqual(["who"]);
  });

  it("names a blank field, because a blank cell reaches the reader as a missing value", () => {
    expect(missingMandatory({ candidate: { ...COMPLETE, doneWhen: "   " } })).toEqual(["doneWhen"]);
  });

  it("names every missing field rather than the first", () => {
    expect(missingMandatory({ candidate: { nativeId: "JJJJ-1514", source: "linear" } })).toEqual([
      "who",
      "where",
      "whenIso",
      "doneWhen",
      "background",
    ]);
  });
});

describe("asItem", () => {
  it("promotes a complete candidate", () => {
    expect(asItem({ candidate: COMPLETE })!.nativeId).toBe("acme/app#16341");
  });

  it("refuses a candidate missing a mandatory field", () => {
    const { where: _where, ...withoutWhere } = COMPLETE;
    expect(asItem({ candidate: withoutWhere })).toBeUndefined();
  });

  it("refuses the V1 failure shape — a row that names no concrete finish", () => {
    expect(asItem({ candidate: { ...COMPLETE, doneWhen: "" } })).toBeUndefined();
  });
});

describe("itemIdentity", () => {
  it("keys on source and native id", () => {
    expect(itemIdentity({ item: asItem({ candidate: COMPLETE })! })).toBe("github:acme/app#16341");
  });

  it("is unchanged by a state change, which is what reconciliation turns on", () => {
    const before = asItem({ candidate: { ...COMPLETE, state: "checks failing" } })!;
    const after = asItem({ candidate: { ...COMPLETE, state: "review required" } })!;
    expect(itemIdentity({ item: after })).toBe(itemIdentity({ item: before }));
  });
});

describe("background is mandatory", () => {
  it("names background among the missing fields when a detector could not supply it", () => {
    const candidate = { doneWhen: "d", nativeId: "n", source: "github" as const, whenIso: "i", where: "w", who: "p" };
    expect(missingMandatory({ candidate })).toEqual(["background"]);
  });

  it("refuses the candidate outright rather than rendering a row nobody can answer", () => {
    const candidate = { doneWhen: "d", nativeId: "n", source: "github" as const, whenIso: "i", where: "w", who: "p" };
    expect(asItem({ candidate })).toBeUndefined();
  });

  it("treats a blank background as missing, because an empty cell reaches the reader as no value at all", () => {
    const candidate = {
      background: "   ",
      doneWhen: "d",
      nativeId: "n",
      source: "github" as const,
      whenIso: "i",
      where: "w",
      who: "p",
    };
    expect(missingMandatory({ candidate })).toEqual(["background"]);
  });

  it("carries the background onto the item when it is supplied", () => {
    const candidate = {
      background: "A pull request you opened in acme/widgets.",
      doneWhen: "d",
      nativeId: "n",
      source: "github" as const,
      whenIso: "i",
      where: "w",
      who: "p",
    };
    expect(asItem({ candidate })!.background).toBe("A pull request you opened in acme/widgets.");
  });
});
