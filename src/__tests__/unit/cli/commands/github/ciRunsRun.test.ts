import { describe, expect, it } from "vitest";
import type { GithubCiRunsDeps } from "../../../../../cli/commands/github/ciRunsRun.js";
import { runGithubCiRuns } from "../../../../../cli/commands/github/ciRunsRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import type { RunHistoryDocument } from "../../../../../live/github/runHistory.js";
import { GithubRunHistoryErrors } from "../../../../../live/github/runHistoryErrors.js";

/** A document with one measured job, enough for the shell to render either format. */
function documentOf(): RunHistoryDocument {
  return {
    branch: "main",
    event: "push",
    jobs: [
      {
        dependencyBlocked: false,
        name: "lint",
        queueMaxSeconds: 2,
        queueP50Seconds: 2,
        runs: 1,
        skipped: 0,
        unreadable: 0,
        wallMaxSeconds: 443,
        wallMinSeconds: 443,
        wallP50Seconds: 443,
        wallP95Seconds: 443,
      },
    ],
    readAtIso: "2026-09-20T00:00:00.000Z",
    repo: "octo-self/slopweaver",
    residue: [],
    runs: [
      {
        conclusion: "success",
        createdAtIso: "2026-09-19T10:00:00Z",
        event: "push",
        headSha: "a1b2c3d4",
        id: 1,
        runNumber: 101,
        status: "completed",
        url: "https://github.com/octo-self/slopweaver/actions/runs/1",
      },
    ],
    source: "github",
    steps: [],
    stepsRequested: false,
    workflow: "ci.yml",
  };
}

/** Plain fake seams and two output sinks that record what the shell wrote. Not a mock. */
function seams(): { deps: GithubCiRunsDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      read: async () => ok(documentOf()),
      resolveRepo: () => ok({ owner: "octo-self", repo: "slopweaver" }),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runGithubCiRuns", () => {
  it("renders the ranked table and exits clean", async () => {
    const { deps, out, diagnostics } = seams();
    const code = await runGithubCiRuns({ deps, rest: [] });
    expect(code).toBe(EXIT_OK);
    expect(diagnostics).toEqual([]);
    expect(out.length).toBe(1);
    expect(out[0]!).toContain("octo-self/slopweaver · ci.yml · main · event push");
    expect(out[0]!).toContain("lint");
  });

  it("emits one JSON document under --json", async () => {
    const { deps, out } = seams();
    const code = await runGithubCiRuns({ deps, rest: ["--json"] });
    expect(code).toBe(EXIT_OK);
    expect(out[0]!.startsWith("{")).toBe(true);
    expect(out[0]!).toContain('"wallP95Seconds": 443');
  });

  it("prints the usage problem and the help before touching a credential", async () => {
    const base = seams();
    const deps: GithubCiRunsDeps = {
      ...base.deps,
      read: async () => {
        throw new Error("the shell must refuse a bad argv before it reads");
      },
      resolveRepo: () => {
        throw new Error("the shell must refuse a bad argv before it resolves a repo");
      },
    };
    const code = await runGithubCiRuns({ deps, rest: ["--event", "schedule"] });
    expect(code).toBe(EXIT_USAGE);
    expect(base.diagnostics[0]!).toBe("--event must be one of push, pull_request, merge_group");
    expect(base.diagnostics[1]!).toContain("usage: slopweaver github ci-runs");
  });

  it("reports an unresolvable repository and stops", async () => {
    const base = seams();
    const deps: GithubCiRunsDeps = { ...base.deps, resolveRepo: () => err(["no origin remote"]) };
    const code = await runGithubCiRuns({ deps, rest: [] });
    expect(code).toBe(EXIT_ERROR);
    expect(base.diagnostics).toEqual(["no origin remote"]);
    expect(base.out).toEqual([]);
  });

  it("exits ERROR on a selection that matched no run, never an empty success", async () => {
    const base = seams();
    const deps: GithubCiRunsDeps = {
      ...base.deps,
      read: async () => err(GithubRunHistoryErrors.empty({ selection: "ci.yml on main (push)" })),
    };
    const code = await runGithubCiRuns({ deps, rest: [] });
    expect(code).toBe(EXIT_ERROR);
    expect(base.diagnostics[0]!).toContain("ci.yml on main (push)");
    expect(base.out).toEqual([]);
  });
});
