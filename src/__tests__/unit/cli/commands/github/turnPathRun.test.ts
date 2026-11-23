import { describe, expect, it } from "vitest";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import {
  classifyPullRequestTurnPath,
  type GithubTurnPathDeps,
  runGithubTurnPath,
} from "../../../../../cli/commands/github/turnPathRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const REF = "refs/slopweaver/fetch/test";

/** A plain fake `GithubPushDeps` — no `vi.fn`, just closures over pre-scripted maps. */
function fakeGit({
  reads = {},
  writeOk = true,
  writeError = "fetch failed",
}: {
  reads?: Readonly<Record<string, string>>;
  writeOk?: boolean;
  writeError?: string;
} = {}): { git: GithubPushDeps; outLines: string[]; deletedRefs: string[] } {
  const outLines: string[] = [];
  const deletedRefs: string[] = [];
  return {
    deletedRefs,
    git: {
      cwd: () => "/repo",
      doorLedger: memoryDoorLedger().port,
      out: ({ line }) => outLines.push(line),
      readGit: ({ args }) => {
        const command = args.join(" ");
        const value = reads[command];
        if (value !== undefined) {
          return value;
        }
        throw new Error(`unexpected read: ${command}`);
      },
      writeGit: ({ args }) => {
        if (args[0] === "update-ref") {
          deletedRefs.push(args[2]!);
        }
        return writeOk ? ok(undefined) : err(writeError);
      },
    },
    outLines,
  };
}

function depsFor({ git }: { git: GithubPushDeps }): GithubTurnPathDeps {
  return { git, newPrivateRef: () => REF };
}

describe("classifyPullRequestTurnPath", () => {
  it("reports clean when no diffed path matches the turn-path prefix set", () => {
    const { git } = fakeGit({
      reads: {
        "rev-parse --verify origin/main^{commit}": BASE_SHA,
        [`rev-parse ${REF}^{commit}`]: HEAD_SHA,
        [`diff --name-only ${BASE_SHA}...${HEAD_SHA}`]: "README.md\ndocs/security.md\n",
      },
    });
    const result = classifyPullRequestTurnPath({
      base: "origin/main",
      cwd: "/repo",
      deps: depsFor({ git }),
      headRefName: "a-branch",
      remote: "origin",
    });
    expect(unwrap(result)).toEqual({ baseSha: BASE_SHA, headSha: HEAD_SHA, matched: [], turnPath: false });
  });

  it("reports turn-path with the matched files when a diffed path matches", () => {
    const { git } = fakeGit({
      reads: {
        "rev-parse --verify origin/main^{commit}": BASE_SHA,
        [`rev-parse ${REF}^{commit}`]: HEAD_SHA,
        [`diff --name-only ${BASE_SHA}...${HEAD_SHA}`]: "README.md\nsrc/live/github/checks.ts\n",
      },
    });
    const result = classifyPullRequestTurnPath({
      base: "origin/main",
      cwd: "/repo",
      deps: depsFor({ git }),
      headRefName: "a-branch",
      remote: "origin",
    });
    expect(unwrap(result)).toEqual({
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      matched: ["src/live/github/checks.ts"],
      turnPath: true,
    });
  });

  it("cleans up the private ref after a successful classification", () => {
    const { deletedRefs, git } = fakeGit({
      reads: {
        "rev-parse --verify origin/main^{commit}": BASE_SHA,
        [`rev-parse ${REF}^{commit}`]: HEAD_SHA,
        [`diff --name-only ${BASE_SHA}...${HEAD_SHA}`]: "",
      },
    });
    classifyPullRequestTurnPath({
      base: "origin/main",
      cwd: "/repo",
      deps: depsFor({ git }),
      headRefName: "a-branch",
      remote: "origin",
    });
    expect(deletedRefs).toEqual([REF]);
  });

  it("refuses an empty headRefName before ever calling git", () => {
    const { git } = fakeGit();
    const result = classifyPullRequestTurnPath({
      base: "origin/main",
      cwd: "/repo",
      deps: depsFor({ git }),
      headRefName: "   ",
      remote: "origin",
    });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })).toEqual([
      "headRefName is empty or whitespace — refusing before it reaches a refspec",
    ]);
  });

  it("refuses when the fetch fails, and still cleans up the ref", () => {
    const { deletedRefs, git } = fakeGit({
      reads: { "rev-parse --verify origin/main^{commit}": BASE_SHA },
      writeError: "invalid refspec",
      writeOk: false,
    });
    const result = classifyPullRequestTurnPath({
      base: "origin/main",
      cwd: "/repo",
      deps: depsFor({ git }),
      headRefName: "a-branch",
      remote: "origin",
    });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })).toEqual(["invalid refspec"]);
    expect(deletedRefs).toEqual([REF]);
  });

  it("refuses — rather than reporting a false clean — when the fetched head resolves equal to the base", () => {
    const { git } = fakeGit({
      reads: {
        "rev-parse --verify origin/main^{commit}": BASE_SHA,
        [`rev-parse ${REF}^{commit}`]: BASE_SHA,
      },
    });
    const result = classifyPullRequestTurnPath({
      base: "origin/main",
      cwd: "/repo",
      deps: depsFor({ git }),
      headRefName: "a-branch",
      remote: "origin",
    });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })).toEqual([
      `${REF} resolved to ${BASE_SHA}, identical to origin/main — this is the empty-refspec fail-open's own ` +
        "signature (an empty or misresolved head makes `git fetch` accept a refspec with no source and " +
        "resolve the destination to the remote's own HEAD), refusing rather than reporting a false clean",
    ]);
  });

  it("refuses when the base ref does not resolve", () => {
    const { git } = fakeGit();
    const result = classifyPullRequestTurnPath({
      base: "origin/main",
      cwd: "/repo",
      deps: depsFor({ git }),
      headRefName: "a-branch",
      remote: "origin",
    });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })).toEqual([
      '"origin/main" does not resolve to a commit in /repo: unexpected read: rev-parse --verify origin/main^{commit}',
    ]);
  });
});

describe("runGithubTurnPath", () => {
  function runWith({ git, rest }: { git: GithubPushDeps; rest: readonly string[] }): {
    code: number;
    out: string[];
    diag: string[];
  } {
    const out: string[] = [];
    const diag: string[] = [];
    const code = runGithubTurnPath({
      cwd: () => "/repo",
      deps: depsFor({ git }),
      resolveRepo: () => ok({ owner: "acme", repo: "widget" }),
      rest,
      writeDiagnostic: (line) => diag.push(line),
      writeOut: (line) => out.push(line),
    });
    return { code, diag, out };
  }

  it("exits EXIT_OK and prints clean when nothing matches", () => {
    const { git } = fakeGit({
      reads: {
        "rev-parse --verify origin/main^{commit}": BASE_SHA,
        [`rev-parse ${REF}^{commit}`]: HEAD_SHA,
        [`diff --name-only ${BASE_SHA}...${HEAD_SHA}`]: "README.md\n",
      },
    });
    const { code, out } = runWith({ git, rest: ["--head", "a-branch"] });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(["clean — no changed path falls under a turn-path prefix"]);
  });

  it("exits EXIT_EXPECTED_EMPTY and names the matched files when turn-path", () => {
    const { git } = fakeGit({
      reads: {
        "rev-parse --verify origin/main^{commit}": BASE_SHA,
        [`rev-parse ${REF}^{commit}`]: HEAD_SHA,
        [`diff --name-only ${BASE_SHA}...${HEAD_SHA}`]: "src/outbound/linear/schema.ts\n",
      },
    });
    const { code, out } = runWith({ git, rest: ["--head", "a-branch"] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual(["turn-path (1 file(s)): src/outbound/linear/schema.ts"]);
  });

  it("exits EXIT_USAGE on a missing --head", () => {
    const { git } = fakeGit();
    const { code, diag } = runWith({ git, rest: [] });
    expect(code).toBe(EXIT_USAGE);
    expect(diag[0]).toBe("--head is required and must name a branch");
  });

  it("exits EXIT_ERROR when classification fails", () => {
    const { git } = fakeGit();
    const { code, diag } = runWith({ git, rest: ["--head", "a-branch"] });
    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      '"origin/main" does not resolve to a commit in /repo: unexpected read: rev-parse --verify origin/main^{commit}',
    ]);
  });
});
