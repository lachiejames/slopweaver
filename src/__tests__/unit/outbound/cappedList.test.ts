import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cappedList } from "../../../outbound/cappedList.js";

const MESSAGE = "at most two names; keep the ones that matter.";

/** Every issue as `path: message`, so one assertion covers both. */
function issuesOf({
  result,
}: {
  result: { error?: { issues: { path: PropertyKey[]; message: string }[] } };
}): string[] {
  return result.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("cappedList", () => {
  const list = cappedList({ list: z.array(z.string().min(1)).min(1), max: 2, message: MESSAGE });

  it("admits a list at the cap", () => {
    expect(list.safeParse(["a", "b"]).success).toBe(true);
  });

  it("refuses one past the cap with its own message", () => {
    expect(issuesOf({ result: list.safeParse(["a", "b", "c"]) })).toEqual([`: ${MESSAGE}`]);
  });

  it("still names the cap after an item has failed, as `.max()` did", () => {
    expect(issuesOf({ result: list.safeParse(["a", "", "c"]) })).toEqual([
      "1: Too small: expected string to have >=1 characters",
      `: ${MESSAGE}`,
    ]);
  });

  it("keeps the cap nameable inside a plain union whose other arm never matched", () => {
    const union = z.union([z.strictObject({ names: list }), z.strictObject({ reason: z.string() })]);

    expect(issuesOf({ result: union.safeParse({ names: ["a", "b", "c"] }) })).toEqual([`names: ${MESSAGE}`]);
  });
});
