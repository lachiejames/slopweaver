/*
 * Decoding what `gh pr list --json` returns. A pull request that fails to decode is COUNTED and reported rather
 * than silently dropped from the board, and the blocked-on and problem columns get the fields they read.
 */
import { describe, expect, it } from "vitest";
import type { PrRecord } from "../../../../../pane/sections/prStatus.js";
import { decodePr, parsePrList } from "../../../../../pane/sections/prStatusDecode.js";

/** One decoded pull request, throwing rather than branching when `gh` refused it. */
function decodedPr({ value }: { value: unknown }): PrRecord {
  const record = decodePr({ repo: "o/r", value });
  if (typeof record === "string") {
    throw new Error(`expected a decoded pull request, got: ${record}`);
  }
  return record;
}

describe("decodePr / parsePrList", () => {
  it("decodes the fields gh really returns", () => {
    const decoded = decodePr({
      repo: "o/r",
      value: {
        headRefName: "b",
        isDraft: true,
        mergeable: "CONFLICTING",
        number: 182,
        reviewDecision: "REVIEW_REQUIRED",
        title: "t",
        updatedAt: "2026-08-06T04:31:32Z",
        url: "u",
      },
    });

    expect(decoded).toEqual({
      author: "",
      body: "",
      headRefName: "b",
      isDraft: true,
      mergeable: "CONFLICTING",
      number: 182,
      repo: "o/r",
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequests: [],
      statusCheckRollup: undefined,
      title: "t",
      updatedAt: "2026-08-06T04:31:32Z",
      url: "u",
    });
  });

  it("refuses a pull request with no number rather than keying it zero", () => {
    expect(decodePr({ repo: "o/r", value: { title: "t" } })).toBe(
      "`gh pr list --json` returned a pull request with no number (in o/r)",
    );
  });

  it("counts an undecodable entry as REFUSED instead of shortening the list silently", () => {
    const parsed = parsePrList({ repo: "o/r", stdout: JSON.stringify([{ number: 1 }, { title: "no number" }]) });

    // A string here would be a whole-payload refusal; this asserts the shape by reading it, not by testing
    // its type. `parsePrList` returns the object form for a payload that parsed, and this throws rather
    // than pass for a refusal, which is what makes the check below falsifiable.
    if (typeof parsed === "string") {
      throw new Error(`expected a parsed pr list, got a whole-payload refusal: ${parsed}`);
    }
    expect(parsed.prs.map((entry) => entry.number)).toEqual([1]);
    expect(parsed.refused).toEqual(["`gh pr list --json` returned a pull request with no number (in o/r)"]);
  });

  it("refuses output that is not JSON", () => {
    expect(parsePrList({ repo: "o/r", stdout: "not json" })).toBe(
      "`gh pr list --json` returned output that is not JSON",
    );
  });

  it("refuses output that is not an array", () => {
    expect(parsePrList({ repo: "o/r", stdout: "{}" })).toBe("`gh pr list --json` did not return an array");
  });
});

describe("decodePr — the fields the blocked-on and problem columns need", () => {
  it("reads the author login out of the nested actor object", () => {
    expect(decodedPr({ value: { author: { login: "a-user" }, number: 1 } }).author).toBe("a-user");
  });

  it("keeps a requested USER and a requested TEAM apart, and addresses the team by its slug", () => {
    const record = decodedPr({
      value: {
        number: 1,
        reviewRequests: [
          { __typename: "User", login: "a-user" },
          { __typename: "Team", name: "A Team With Spaces", slug: "a-team" },
        ],
      },
    });

    expect(record.reviewRequests).toEqual([
      { handle: "a-user", kind: "user" },
      { handle: "a-team", kind: "team" },
    ]);
  });

  it("still types an entry when gh omitted __typename, which it is documented to support", () => {
    const record = decodedPr({ value: { number: 1, reviewRequests: [{ login: "a-user" }, { name: "a-team" }] } });

    expect(record.reviewRequests).toEqual([
      { handle: "a-user", kind: "user" },
      { handle: "a-team", kind: "team" },
    ]);
  });

  it("reads an absent author as the empty string rather than crashing", () => {
    const record = decodedPr({ value: { number: 1 } });

    expect(record.author).toBe("");
    expect(record.reviewRequests).toEqual([]);
  });
});
