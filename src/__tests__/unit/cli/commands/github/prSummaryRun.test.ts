/**
 * `github pr summary`'s shell over plain recording edges: which address it refuses before reading, which exit a
 * failed read gets, and that a description the card cannot read is still an exit-0 answer.
 */
import { describe, expect, it } from "vitest";

import { type GithubPrSummaryDeps, runGithubPrSummary } from "../../../../../cli/commands/github/prSummaryRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../../live/github/read.js";

const PR = "https://github.com/lachiejames/slopweaver/pull/1296";
const READ_AT = "2026-09-27T03:00:00.000Z";

/** The node `github read` selects for a pull request with no description at all. */
const NODE = {
  __typename: "PullRequest",
  baseRefName: "main",
  body: null,
  headRefName: "supabase-carries-the-new-schema-with-every-table",
  isCrossRepository: false,
  isDraft: false,
  merged: true,
  mergedAt: "2026-09-25T10:00:00Z",
  number: 1296,
  state: "MERGED",
  title: "The autonomy import retires the rows of lines autonomy adopt rewrote",
  url: PR,
};

/** Plain recording edges; `answer` decides what the one GraphQL call returns. */
function edges({ answer }: { answer: GithubReadGraphql }): {
  deps: GithubPrSummaryDeps;
  out: string[];
  diag: string[];
  reads: number[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  const reads: number[] = [];
  return {
    deps: {
      graphql: () => async (args) => {
        reads.push(Number(args.variables["number"]));
        return answer(args);
      },
      nowIso: () => READ_AT,
      out: ({ line }) => out.push(line),
      writeDiagnostic: ({ line }) => diag.push(line),
    },
    diag,
    out,
    reads,
  };
}

const ANSWERS: GithubReadGraphql = async () => ok({ repository: { issueOrPullRequest: NODE } });

describe("runGithubPrSummary", () => {
  it("refuses a missing address as usage, before any read", async () => {
    const run = edges({ answer: ANSWERS });
    expect(await runGithubPrSummary({ deps: run.deps, rest: [] })).toBe(EXIT_USAGE);
    expect(run.reads).toEqual([]);
    expect(run.diag.at(-1)).toContain("usage: slopweaver github pr summary");
  });

  it("refuses an issue address as usage, before any read", async () => {
    const run = edges({ answer: ANSWERS });
    const issue = "https://github.com/lachiejames/slopweaver/issues/7";
    expect(await runGithubPrSummary({ deps: run.deps, rest: [issue] })).toBe(EXIT_USAGE);
    expect(run.reads).toEqual([]);
    expect(run.diag).toEqual([`${issue} is not a pull-request address`]);
  });

  it("exits 1 with the read's own message when the read fails", async () => {
    const run = edges({ answer: async () => err(GithubLiveErrors.readFailed({ message: "graphql 502" })) });
    expect(await runGithubPrSummary({ deps: run.deps, rest: [PR] })).toBe(EXIT_ERROR);
    expect(run.reads).toEqual([1296]);
    expect(run.diag).toEqual(["graphql 502"]);
    expect(run.out).toEqual([]);
  });

  it("prints a description it cannot read as a declined form in one JSON line, and exits 0", async () => {
    const run = edges({ answer: ANSWERS });
    expect(await runGithubPrSummary({ deps: run.deps, rest: [PR, "--json"] })).toBe(EXIT_OK);
    expect(run.out.length).toBe(1);
    const summary = JSON.parse(run.out[0]!) as Record<string, unknown>;
    expect(summary["number"]).toBe(1296);
    expect(summary["state"]).toBe("merged");
    expect(summary["crossRepository"]).toBe(false);
    expect(summary["readAtIso"]).toBe(READ_AT);
    const form = summary["form"] as Record<string, unknown>;
    expect(form["kind"]).toBe("declined");
    expect(form["reason"]).toContain("its description is not one this card can read");
  });

  it("prints the same answer as text lines without --json", async () => {
    const run = edges({ answer: ANSWERS });
    expect(await runGithubPrSummary({ deps: run.deps, rest: [PR] })).toBe(EXIT_OK);
    expect(run.out.slice(0, 2)).toEqual([`#1296 ${NODE.title}`, `merged · ${PR}`]);
    expect(run.out[2]).toContain("declined: its description is not one this card can read");
  });
});
