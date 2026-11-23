/**
 * The pure verdict a branch-pair listing gives about a numberless create reservation, and the lines that
 * report it.
 *
 * `qualifiedHeadRef` is guarded here rather than incidentally: GitHub's `pulls.list` head filter IGNORES a
 * bare ref, so an unqualified head lists the whole repository and turns every absence check into a false
 * `ambiguous`. That failure is silent in production and this is the only thing that catches it.
 */
import { describe, expect, it } from "vitest";

import {
  absenceReadFailedLine,
  absenceVerdictFor,
  ambiguousPairLine,
  backfilledNumberLine,
  qualifiedHeadRef,
  releasedOnAbsenceLine,
} from "../../../../../cli/commands/github/reservationAbsence.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";

function pr({ number, state }: { number: number; state: string }): WrittenPr {
  return {
    authorId: 7,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "a body",
    commits: undefined,
    draft: false,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "f".repeat(40) },
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack: undefined,
    state,
    title: "a title",
    updatedAtIso: "2026-09-01T00:00:00Z",
  };
}

describe("qualifiedHeadRef", () => {
  it("qualifies a bare ref with the repository owner", () => {
    expect(qualifiedHeadRef({ head: "feature", owner: "octo-self" })).toBe("octo-self:feature");
  });

  it("passes a ref that already names its repository through untouched", () => {
    expect(qualifiedHeadRef({ head: "a-fork:feature", owner: "octo-self" })).toBe("a-fork:feature");
  });

  it("does not re-qualify a ref whose own name carries a colon", () => {
    expect(qualifiedHeadRef({ head: "o:feature", owner: "o" })).toBe("o:feature");
  });
});

describe("absenceVerdictFor", () => {
  it("reads an empty listing as absent — the create never landed", () => {
    expect(absenceVerdictFor({ candidates: [] })).toEqual({ kind: "absent" });
  });

  it("reads one pull request as single, carrying it whole so the number can be recovered", () => {
    const only = pr({ number: 4242, state: "open" });
    expect(absenceVerdictFor({ candidates: [only] })).toEqual({ kind: "single", pr: only });
  });

  it("reads two pull requests as ambiguous, with the count", () => {
    const verdict = absenceVerdictFor({
      candidates: [pr({ number: 1, state: "closed" }), pr({ number: 2, state: "open" })],
    });
    expect(verdict).toEqual({ count: 2, kind: "ambiguous" });
  });
});

describe("the reported lines name the locus and what decided it", () => {
  it("says why the release is safe, not just that it happened", () => {
    expect(releasedOnAbsenceLine({ locus: "o/r#main...feature" })).toBe(
      "releasing the reservation for o/r#main...feature: GitHub reports no pull request on these branches in " +
        "any state, so the create that claimed it never landed.",
    );
  });

  it("names the recovered number", () => {
    expect(backfilledNumberLine({ locus: "o/r#main...feature", number: 4242 })).toBe(
      "recovered #4242 onto the reservation for o/r#main...feature: the create landed and only its response " +
        "was lost.",
    );
  });

  it("names the count and the door an operator has instead", () => {
    expect(ambiguousPairLine({ count: 2, locus: "o/r#main...feature" })).toBe(
      "leaving the reservation for o/r#main...feature standing: GitHub reports at least 2 pull requests on " +
        "these branches — the listing stops at two — so which one it named cannot be decided here. Read them " +
        "back and use `github pr release-reservation`.",
    );
  });

  it("carries the provider's own message when the verifying read failed", () => {
    expect(absenceReadFailedLine({ locus: "o/r#main...feature", message: "other side closed" })).toBe(
      "leaving the reservation for o/r#main...feature standing: could not read the pull requests on these " +
        "branches (other side closed), so nothing here proves the create did not land.",
    );
  });
});
