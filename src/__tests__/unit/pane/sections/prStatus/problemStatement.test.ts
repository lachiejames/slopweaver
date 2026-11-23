/*
 * The problem statement a row carries: parsed out of a pull request's own body in each shape it comes in, cut at the
 * template's word cap, and reported as absent rather than invented.
 */
import { describe, expect, it } from "vitest";
import { PROBLEM_WORD_CAP, problemStatement } from "../../../../../pane/sections/prStatus.js";

/** The parsed problem statement, throwing rather than branching when there is none. */
function problemTextOf({ body }: { body: string }): string {
  const statement = problemStatement({ body });
  if (!statement.known) {
    throw new Error(`expected a parsed problem statement, got: ${statement.why}`);
  }
  return statement.value;
}

/** The reason there is no problem statement, throwing when there in fact is one. */
function problemWhyOf({ body }: { body: string }): string {
  const statement = problemStatement({ body });
  if (statement.known) {
    throw new Error(`expected no problem statement, got: ${statement.value}`);
  }
  return statement.why;
}

describe("problemStatement — PARSED from the body, never generated", () => {
  it("reads the Problem cell out of this repository's own HTML template", () => {
    const body =
      "<table>\n<tr><td><strong>Problem</strong></td><td>\n\n`repoFromRemote` required the host to be literally `github.com`.\n\n</td></tr>\n" +
      "<tr><td><strong>Solution</strong></td><td>a fix</td></tr>\n</table>";

    expect(problemStatement({ body }).known).toBe(true);
    expect(problemTextOf({ body })).toBe("`repoFromRemote` required the host to be literally `github.com`.");
  });

  it("reads a markdown table row when the body was not written from the template", () => {
    expect(problemTextOf({ body: "| **Problem** | the board goes stale |\n| Solution | push it |" })).toBe(
      "the board goes stale",
    );
  });

  it("reads a `## Problem` heading section", () => {
    expect(problemTextOf({ body: "## Problem\n\nThe console cannot be trusted.\n\n## Solution\n\nShrink it." })).toBe(
      "The console cannot be trusted.",
    );
  });

  it("strips the HTML inside a cell so the row prints one readable sentence", () => {
    expect(problemTextOf({ body: "<td><strong>Problem</strong></td><td><p>a <b>bold</b> claim</p></td>" })).toBe(
      "a bold claim",
    );
  });

  it("says there is NONE rather than inventing one — a team pull request has no such body", () => {
    expect(problemStatement({ body: "just some prose about a change" }).known).toBe(false);
    expect(problemWhyOf({ body: "just some prose about a change" })).toContain("PARSED here rather than generated");
  });

  it("says there is none for an empty body", () => {
    expect(problemStatement({ body: "" }).known).toBe(false);
  });

  it("CUTS at the template's own 50-word cap and says it cut, rather than printing an essay", () => {
    const long = Array.from({ length: 60 }, (_, index) => `word${String(index)}`).join(" ");

    const text = problemTextOf({ body: `<td><strong>Problem</strong></td><td>${long}</td>` });

    expect(text).toContain("word49 … [CUT at the template's 50-word cap; the body carries 60]");
    expect(text).not.toContain("word50 ");
  });

  it("keeps a statement exactly at the cap whole", () => {
    const exact = Array.from({ length: PROBLEM_WORD_CAP }, (_, index) => `word${String(index)}`).join(" ");

    expect(problemTextOf({ body: `<td><strong>Problem</strong></td><td>${exact}</td>` })).toBe(exact);
  });
});
