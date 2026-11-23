/*
 * The once-per-repository CODEOWNERS read on its own: which slugs a fleet asks about, and what each
 * repository's answer becomes when GitHub returns a file, returns none, or fails the read.
 */
import { describe, expect, it } from "vitest";

import { readCodeowners, repoSlugsOf } from "../../../../../cli/commands/github/reviewStateCodeowners.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubReviewStateApi } from "../../../../../live/github/reviewState.js";
import { pr } from "./landingRun/fixtures.js";

type CodeownersAnswer = Result<{ readonly path: string; readonly content: string } | undefined, GithubLiveError>;

const UNUSED = GithubLiveErrors.readFailed({ message: "this fixture reads CODEOWNERS only" });

/** A plain fake whose CODEOWNERS edge answers per repository and records each owner/repo it was asked for. */
function fakeApi({
  answers,
  asked,
}: {
  answers: ReadonlyMap<string, CodeownersAnswer>;
  asked: string[];
}): GithubReviewStateApi {
  return {
    codeowners: ({ owner, repo }) => {
      asked.push(`${owner}/${repo}`);
      return Promise.resolve(answers.get(`${owner}/${repo}`)!);
    },
    fleetPage: () => Promise.resolve(err(UNUSED)),
    pr: () => Promise.resolve(err(UNUSED)),
  };
}

describe("repoSlugsOf", () => {
  it("names each non-empty slug once, in first-seen order", () => {
    const prs = [
      pr({ repoSlug: "acme/widgets" }),
      pr({ repoSlug: "" }),
      pr({ repoSlug: "acme/gadgets" }),
      pr({ repoSlug: "acme/widgets" }),
    ];
    expect(repoSlugsOf({ prs })).toEqual(["acme/widgets", "acme/gadgets"]);
  });

  it("answers an empty list for an empty fleet", () => {
    expect(repoSlugsOf({ prs: [] })).toEqual([]);
  });
});

describe("readCodeowners", () => {
  it("parses a returned file, maps a missing one to empty rules, and names a failed read", async () => {
    const asked: string[] = [];
    const problems: string[] = [];
    const answers = new Map<string, CodeownersAnswer>([
      ["acme/widgets", ok({ content: "* @acme/eng\n/docs/ @acme/docs\n", path: ".github/CODEOWNERS" })],
      ["acme/gadgets", ok(undefined)],
      ["acme/gizmos", err(GithubLiveErrors.readFailed({ message: "HTTP 502" }))],
    ]);
    const byslug = await readCodeowners({
      api: fakeApi({ answers, asked }),
      onProblem: (line) => {
        problems.push(line);
      },
      slugs: ["acme/widgets", "acme/gadgets", "acme/gizmos"],
    });
    expect([...byslug.entries()]).toEqual([
      [
        "acme/widgets",
        {
          path: ".github/CODEOWNERS",
          rules: [
            { owners: ["@acme/eng"], pattern: "*" },
            { owners: ["@acme/docs"], pattern: "/docs/" },
          ],
        },
      ],
      ["acme/gadgets", { path: "", rules: [] }],
      ["acme/gizmos", { path: "", rules: [] }],
    ]);
    expect(problems).toEqual(["could not read acme/gizmos's CODEOWNERS: HTTP 502"]);
    expect(asked).toEqual(["acme/widgets", "acme/gadgets", "acme/gizmos"]);
  });

  it("skips a slug that does not parse as owner/repo without asking GitHub", async () => {
    const asked: string[] = [];
    const byslug = await readCodeowners({
      api: fakeApi({ answers: new Map<string, CodeownersAnswer>(), asked }),
      onProblem: () => undefined,
      slugs: ["not-a-slug"],
    });
    expect(byslug.size).toBe(0);
    expect(asked).toEqual([]);
  });
});
