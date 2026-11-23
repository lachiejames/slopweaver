import { describe, expect, it } from "vitest";
import { parseGithubCoderabbitYieldArgs, yieldWindow } from "../../../../../cli/commands/github/coderabbitYieldCore.js";
import { coderabbitYieldLines } from "../../../../../cli/commands/github/coderabbitYieldReport.js";
import {
  type GithubCoderabbitYieldDeps,
  runGithubCoderabbitYield,
} from "../../../../../cli/commands/github/coderabbitYieldRun.js";
import { githubManifest } from "../../../../../cli/manifests/github.js";
import { githubReportsManifest } from "../../../../../cli/manifests/githubReports.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../../live/github/read.js";
import { coderabbitYieldReport } from "../../../../../review/coderabbitYield.js";

const NOW = new Date("2026-09-23T08:30:06.789Z");

/** Plain recording edges; `answer` decides what every GraphQL call returns. */
function edges({ answer }: { answer: GithubReadGraphql }): {
  deps: GithubCoderabbitYieldDeps;
  out: string[];
  diag: string[];
  homes: (string | undefined)[];
  queries: string[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  const homes: (string | undefined)[] = [];
  const queries: string[] = [];
  return {
    deps: {
      graphql: ({ home }) => {
        homes.push(home);
        return async (args) => {
          queries.push(/query (\w+)/u.exec(args.query)![1]!);
          return answer(args);
        };
      },
      now: () => NOW,
      writeDiagnostic: (line) => diag.push(line),
      writeOut: (line) => out.push(line),
    },
    diag,
    homes,
    out,
    queries,
  };
}

const EMPTY_WINDOW: GithubReadGraphql = async ({ query }) =>
  query.includes("SlopweaverYieldViewer") ? ok({ viewer: { login: "octocat" } }) : ok({ search: { issueCount: 0 } });

describe("parseGithubCoderabbitYieldArgs", () => {
  it("requires --repo, defaults to 60 days, and dedupes the repositories case-insensitively", () => {
    expect(unwrapErr(parseGithubCoderabbitYieldArgs({ rest: [] }))).toEqual([
      "--repo is required: name every repository to measure, comma-separated",
    ]);
    expect(unwrap(parseGithubCoderabbitYieldArgs({ rest: ["--repo", "a/b,A/B,c/d"] }))).toEqual({
      author: undefined,
      days: 60,
      home: undefined,
      json: false,
      repos: ["a/b", "c/d"],
    });
  });

  it("refuses a slug or login that would widen the search", () => {
    expect(
      unwrapErr(parseGithubCoderabbitYieldArgs({ rest: ["--repo", "a/b is:open", "--author", "x author:y"] })),
    ).toEqual([
      "--repo takes owner/name slugs only — no spaces or search qualifiers",
      "--author takes one GitHub login — no spaces or search qualifiers",
    ]);
  });
});

describe("yieldWindow", () => {
  it("truncates to the second and reaches back whole days", () => {
    expect(yieldWindow({ days: 60, now: NOW })).toEqual({
      sinceIso: "2026-07-25T08:30:06.000Z",
      untilIso: "2026-09-23T08:30:06.000Z",
    });
  });
});

describe("runGithubCoderabbitYield", () => {
  it("refuses a usage error before building any transport", async () => {
    const run = edges({ answer: EMPTY_WINDOW });
    expect(await runGithubCoderabbitYield({ deps: run.deps, rest: ["--days", "0"] })).toBe(2);
    expect(run.homes).toEqual([]);
  });

  it("asks GitHub whose token it is when --author is omitted, and passes --home to the credential", async () => {
    const run = edges({ answer: EMPTY_WINDOW });
    const code = await runGithubCoderabbitYield({ deps: run.deps, rest: ["--repo", "a/b", "--home", "/h"] });
    expect([code, run.homes, run.queries]).toEqual([0, ["/h"], ["SlopweaverYieldViewer", "SlopweaverYieldCount"]]);
    expect(run.out[0]).toBe(
      "github coderabbit-yield: octocat's pull requests created 2026-07-25T08:30:06.000Z → 2026-09-23T08:30:06.000Z",
    );
  });

  it("skips the viewer read for an explicit author and emits one JSON document", async () => {
    const run = edges({ answer: EMPTY_WINDOW });
    const code = await runGithubCoderabbitYield({ deps: run.deps, rest: ["--repo", "a/b", "--author", "x", "--json"] });
    const document = JSON.parse(run.out.join("\n")) as { kind: string; read: { author: string } };
    expect([code, run.queries, run.out.length, document.kind, document.read.author]).toEqual([
      0,
      ["SlopweaverYieldCount"],
      1,
      "coderabbit-yield",
      "x",
    ]);
  });

  it("prints no numbers and exits 1 when the read fails", async () => {
    const run = edges({ answer: async () => err(GithubLiveErrors.readFailed({ message: "boom" })) });
    const code = await runGithubCoderabbitYield({ deps: run.deps, rest: ["--repo", "a/b", "--author", "x"] });
    expect([code, run.out, run.diag]).toEqual([
      1,
      [],
      ["github coderabbit-yield: the read failed, so no numbers are printed — boom"],
    ]);
  });
});

describe("coderabbitYieldLines", () => {
  it("prints no percentage over a zero denominator and says the coverage", () => {
    const lines = coderabbitYieldLines({
      facts: {
        author: "x",
        cost: 1,
        gaps: [],
        readFinishedAtIso: "f",
        readStartedAtIso: "s",
        repos: ["a/b"],
        requests: 1,
        sinceIso: "since",
        untilIso: "until",
      },
      report: coderabbitYieldReport({ prs: [], repos: ["a/b"] }),
    });
    expect(lines).toContain("    resolved-no-evidence: 0");
    expect(lines.at(-1)).toBe("  coverage: complete");
  });
});

describe("githubReportsManifest", () => {
  it("declares every reporting verb as an external read and keeps bottleneck's place in the github noun", () => {
    const entries = Object.entries(githubReportsManifest);
    expect(entries.map(([name, entry]) => [name, entry.meta.effect, entry.meta.doorRouted])).toEqual([
      ["bottleneck", "external-read", false],
      ["coderabbit-yield", "external-read", false],
      ["exposure", "external-read", false],
    ]);
    const names = Object.keys(githubManifest);
    expect(names.slice(names.indexOf("attach"), names.indexOf("attach") + 5)).toEqual([
      "attach",
      "bottleneck",
      "coderabbit-yield",
      "exposure",
      "bump-drive",
    ]);
  });
});
