/*
 * Question 8, the conflict answer. The property: GitHub's word decides whether there is a conflict at all,
 * and the local measurement only ever names its paths — a clean local merge says why the two disagree.
 */

import { describe, expect, it } from "vitest";

import { conflictState } from "../../../../../cli/commands/github/reviewStateConflict.js";

const CONFLICTING = { baseRefName: "main", mergeable: "CONFLICTING" } as const;

describe("conflictState", () => {
  it("measures nothing when GitHub reports no conflict, whatever the shell read", () => {
    expect(
      conflictState({
        conflictPathsRead: { kind: "paths", paths: ["a.ts"] },
        pr: { ...CONFLICTING, mergeable: "MERGEABLE" },
      }),
    ).toStrictEqual({ local: { kind: "not-requested" }, mergeable: "MERGEABLE" });
  });

  it("names the conflicting paths the local merge found", () => {
    expect(conflictState({ conflictPathsRead: { kind: "paths", paths: ["a.ts"] }, pr: CONFLICTING })).toStrictEqual({
      local: { kind: "measured", paths: ["a.ts"], why: "" },
      mergeable: "CONFLICTING",
    });
  });

  it("says why when a local merge comes out clean against GitHub's conflict", () => {
    expect(conflictState({ conflictPathsRead: { kind: "clean" }, pr: CONFLICTING }).local).toStrictEqual({
      kind: "measured",
      paths: [],
      why: "a local merge of the head into main came out clean, so GitHub's conflict read may be stale or the base has moved",
    });
  });

  it("reads unmeasured when the shell took no measurement, or could not", () => {
    expect(conflictState({ conflictPathsRead: undefined, pr: CONFLICTING }).local).toStrictEqual({
      kind: "unmeasured",
      why: "the conflicting paths were not measured",
    });
    expect(
      conflictState({ conflictPathsRead: { kind: "unmeasured", why: "no checkout" }, pr: CONFLICTING }).local,
    ).toStrictEqual({ kind: "unmeasured", why: "no checkout" });
  });
});
