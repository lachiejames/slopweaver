/**
 * `github stack audit`'s effect shell, driven through its own injected API, token and output edges.
 *
 * The pure relation and report are `stackAuditCore.test.ts`'s; this file pins what the shell adds on top: the
 * `--check` exit boundary, the `--mine` filter, the `--json` document, and the two refusals that stop before a
 * report — no token, and a list read that failed. Every API method but `listOpenPrs` throws, so a shell that
 * reached for anything else would fail here rather than pass quietly.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import { STACK_AUDIT_TRUNCATED_LINE } from "../../../../../cli/commands/github/stackAuditCore.js";
import { type GithubStackAuditDeps, runGithubStackAudit } from "../../../../../cli/commands/github/stackAuditRun.js";
import type { GithubWriteApi, PrStackMembership, WrittenPr } from "../../../../../corpus/github/write.js";
import { toIngestError } from "../../../../../lib/ingestError.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "github-stack-audit-home-"));
  fixtureDirs.push(home);
  return home;
}

/** The argv a caller types, with the verb's own flags after node, the CLI, "github", "stack" and "audit". */
function argvWith({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "github", "stack", "audit", ...flags];
}

function writtenPr({
  authorId,
  baseRef,
  headRef,
  number,
  stack,
}: {
  authorId: number;
  baseRef: string;
  headRef: string;
  number: number;
  stack: PrStackMembership | undefined;
}): WrittenPr {
  return {
    authorId,
    baseRef,
    baseRepoFullName: "o/r",
    body: "b",
    commits: undefined,
    draft: false,
    head: { label: `o:${headRef}`, ref: headRef, repoFullName: "o/r", sha: "a".repeat(40) },
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack,
    state: "open",
    title: "t",
    updatedAtIso: "2026-09-12T00:00:00Z",
  };
}

/**
 * Three open pull requests: 11 (author 1) is based on the head of 10 (author 2), and 12 (author 3) targets
 * `main` and chains onto nothing. `parentStack` is the native membership of 10.
 */
function openPrs({ parentStack }: { parentStack: PrStackMembership | undefined }): readonly WrittenPr[] {
  return [
    writtenPr({ authorId: 2, baseRef: "main", headRef: "lower", number: 10, stack: parentStack }),
    writtenPr({ authorId: 1, baseRef: "lower", headRef: "upper", number: 11, stack: undefined }),
    writtenPr({ authorId: 3, baseRef: "main", headRef: "solo", number: 12, stack: undefined }),
  ];
}

/** A method this verb must never call — reaching one throws, naming it. */
function landmine({ name }: { name: string }): () => never {
  return () => {
    throw new Error(`stack audit must not call ${name}`);
  };
}

/** Every write-surface method a landmine, except the one list read the audit makes. */
function auditApi({ listOpenPrs }: { listOpenPrs: GithubWriteApi["listOpenPrs"] }): GithubWriteApi {
  return {
    addIssueLabels: landmine({ name: "addIssueLabels" }),
    addToStack: landmine({ name: "addToStack" }),
    answerReviewThread: landmine({ name: "answerReviewThread" }),
    authenticatedUserId: landmine({ name: "authenticatedUserId" }),
    branchProtection: landmine({ name: "branchProtection" }),
    canAdmin: landmine({ name: "canAdmin" }),
    canPush: landmine({ name: "canPush" }),
    closePr: landmine({ name: "closePr" }),
    codeScanningAlert: landmine({ name: "codeScanningAlert" }),
    codeScanningAlerts: landmine({ name: "codeScanningAlerts" }),
    createIssueComment: landmine({ name: "createIssueComment" }),
    createPr: landmine({ name: "createPr" }),
    createStack: landmine({ name: "createStack" }),
    dependabotAlert: landmine({ name: "dependabotAlert" }),
    dependabotAlerts: landmine({ name: "dependabotAlerts" }),
    dequeuePr: landmine({ name: "dequeuePr" }),
    diffFiles: landmine({ name: "diffFiles" }),
    dismissCodeScanningAlert: landmine({ name: "dismissCodeScanningAlert" }),
    enqueuePr: landmine({ name: "enqueuePr" }),
    enqueueStackPr: landmine({ name: "enqueueStackPr" }),
    findOpenPrByHead: landmine({ name: "findOpenPrByHead" }),
    getIssueComment: landmine({ name: "getIssueComment" }),
    getPr: landmine({ name: "getPr" }),
    getRepoDescription: landmine({ name: "getRepoDescription" }),
    getStack: landmine({ name: "getStack" }),
    issueLabels: landmine({ name: "issueLabels" }),
    listIssueComments: landmine({ name: "listIssueComments" }),
    listOpenPrs,
    listOpenPrsAuthoredByMe: landmine({ name: "listOpenPrsAuthoredByMe" }),
    listPrs: landmine({ name: "listPrs" }),
    listRuns: landmine({ name: "listRuns" }),
    markPrDraft: landmine({ name: "markPrDraft" }),
    markPrReady: landmine({ name: "markPrReady" }),
    mergeGroupContexts: landmine({ name: "mergeGroupContexts" }),
    mergePr: landmine({ name: "mergePr" }),
    reopenReviewThread: landmine({ name: "reopenReviewThread" }),
    repoLabels: landmine({ name: "repoLabels" }),
    requestedReviewers: landmine({ name: "requestedReviewers" }),
    requestReviewers: landmine({ name: "requestReviewers" }),
    requiredStatusChecks: landmine({ name: "requiredStatusChecks" }),
    reviewThreadDetails: landmine({ name: "reviewThreadDetails" }),
    reviewThreads: landmine({ name: "reviewThreads" }),
    setRepoDescription: landmine({ name: "setRepoDescription" }),
    setRequiredStatusChecks: landmine({ name: "setRequiredStatusChecks" }),
    submitReviewRound: landmine({ name: "submitReviewRound" }),
    unstack: landmine({ name: "unstack" }),
    updateIssueComment: landmine({ name: "updateIssueComment" }),
    updatePr: landmine({ name: "updatePr" }),
  };
}

/** What one run observed: its printed lines, every home a token was asked for, and every list read. */
interface Observed {
  readonly deps: GithubStackAuditDeps;
  readonly lines: string[];
  readonly tokenHomes: string[];
  readonly listed: { readonly owner: string; readonly repo: string }[];
}

function harness({
  prs,
  viewerId,
  tokenResolves = true,
  truncated = false,
}: {
  prs: readonly WrittenPr[];
  viewerId: number | undefined;
  /** False makes the token resolver answer `undefined`, the no-credential state. */
  tokenResolves?: boolean;
  /** True makes the list walk report it stopped at its page cap. */
  truncated?: boolean;
}): Observed {
  const lines: string[] = [];
  const tokenHomes: string[] = [];
  const listed: { owner: string; repo: string }[] = [];
  const listOpenPrs: GithubWriteApi["listOpenPrs"] = (input) => {
    listed.push({ owner: input.owner, repo: input.repo });
    return okAsync({ prs, truncated, viewerId });
  };
  const deps: GithubStackAuditDeps = {
    makeApi: () => auditApi({ listOpenPrs }),
    out: ({ line }) => lines.push(line),
    token: ({ home }) => {
      tokenHomes.push(home);
      return tokenResolves ? "fake-test-token" : undefined;
    },
  };
  return { deps, listed, lines, tokenHomes };
}

/** The report a neither-stacked chain of 11 onto 10 prints when the token authored 11. */
const NEITHER_STACKED_REPORT: readonly string[] = [
  "o/r: 3 open pull request(s) scanned, 1 chained without a native stack",
  "1 of them involve a pull request this token authored",
  "",
  "  #11 (upper) is based on #10 (lower) — neither-stacked: child stack none, parent stack none",
  "    https://example.invalid/pr/11",
  "    yours: check out upper and run `slopweaver github stack adopt --pr 11` (add --register-only if its " +
    "branch has drifted past a one-commit replay), forming a fresh native stack with it. Register a chain " +
    "from its LOWEST pair upward: if that parent is itself based on another open pull request, adopt that " +
    "pair first",
];

describe("runGithubStackAudit — a walk cut short at the page cap fails closed", () => {
  it("exits 1 under --check with zero violations, and says the scan was partial", async () => {
    const gate = harness({ prs: [], truncated: true, viewerId: 1 });
    const code = await runGithubStackAudit({
      argv: argvWith({ flags: ["--repo", "o/r", "--check", "--home", tempHome()] }),
      deps: gate.deps,
    });
    expect(code).toBe(1);
    expect(gate.lines).toEqual([
      "o/r: 0 open pull request(s) scanned, 0 chained without a native stack",
      STACK_AUDIT_TRUNCATED_LINE,
    ]);
  });

  it("still exits 0 under --check over a whole, empty walk", async () => {
    const gate = harness({ prs: [], viewerId: 1 });
    const code = await runGithubStackAudit({
      argv: argvWith({ flags: ["--repo", "o/r", "--check", "--home", tempHome()] }),
      deps: gate.deps,
    });
    expect(code).toBe(0);
  });
});

describe("runGithubStackAudit — the --check exit boundary", () => {
  it("prints the same report either way, and exits 0 without --check but 1 with it", async () => {
    const home = tempHome();
    const report = harness({ prs: openPrs({ parentStack: undefined }), viewerId: 1 });
    const reportCode = await runGithubStackAudit({
      argv: argvWith({ flags: ["--repo", "o/r", "--home", home] }),
      deps: report.deps,
    });
    const gate = harness({ prs: openPrs({ parentStack: undefined }), viewerId: 1 });
    const gateCode = await runGithubStackAudit({
      argv: argvWith({ flags: ["--repo", "o/r", "--check", "--home", home] }),
      deps: gate.deps,
    });
    expect(reportCode).toBe(0);
    expect(report.lines).toEqual(NEITHER_STACKED_REPORT);
    expect(gateCode).toBe(1);
    expect(gate.lines).toEqual(NEITHER_STACKED_REPORT);
    expect(gate.tokenHomes).toEqual([home]);
    expect(gate.listed).toEqual([{ owner: "o", repo: "r" }]);
  });

  it("under --mine, gates on a violation the token authored and passes one it authored neither half of", async () => {
    const flags = ["--repo", "o/r", "--mine", "--check", "--home", tempHome()];
    const mine = harness({ prs: openPrs({ parentStack: undefined }), viewerId: 1 });
    const mineCode = await runGithubStackAudit({ argv: argvWith({ flags }), deps: mine.deps });
    const theirs = harness({ prs: openPrs({ parentStack: undefined }), viewerId: 99 });
    const theirsCode = await runGithubStackAudit({ argv: argvWith({ flags }), deps: theirs.deps });
    expect(mineCode).toBe(1);
    expect(mine.lines).toEqual(NEITHER_STACKED_REPORT);
    expect(theirsCode).toBe(0);
    expect(theirs.lines).toEqual([
      "o/r: 3 open pull request(s) scanned, 0 chained without a native stack",
      "every open chain in this repository is an actual GitHub native stack",
    ]);
  });
});

describe("runGithubStackAudit --json", () => {
  it("emits one document carrying the scanned count, the repository and each violation, a missing stack as null", async () => {
    const observed = harness({
      prs: [
        ...openPrs({ parentStack: { id: 70, number: 7, position: 1, size: 1 } }),
        writtenPr({ authorId: 3, baseRef: "solo", headRef: "above-solo", number: 13, stack: undefined }),
      ],
      viewerId: 2,
    });
    const code = await runGithubStackAudit({
      argv: argvWith({ flags: ["--repo", "o/r", "--json", "--home", tempHome()] }),
      deps: observed.deps,
    });
    expect(code).toBe(0);
    expect(observed.lines.map((line): unknown => JSON.parse(line))).toEqual([
      {
        openPullRequests: 4,
        repo: "o/r",
        truncated: false,
        violations: [
          {
            child: 11,
            childBranch: "upper",
            childStack: null,
            kind: "child-unstacked",
            parent: 10,
            parentBranch: "lower",
            parentStack: 7,
            url: "https://example.invalid/pr/11",
            yours: true,
          },
          {
            child: 13,
            childBranch: "above-solo",
            childStack: null,
            kind: "neither-stacked",
            parent: 12,
            parentBranch: "solo",
            parentStack: null,
            url: "https://example.invalid/pr/13",
            yours: false,
          },
        ],
      },
    ]);
  });
});

describe("runGithubStackAudit's refusals", () => {
  it("refuses with exit 1 and builds no API when no token resolves", async () => {
    const home = tempHome();
    const observed = harness({ prs: [], tokenResolves: false, viewerId: undefined });
    const deps: GithubStackAuditDeps = {
      ...observed.deps,
      makeApi: () => {
        throw new Error("no API may be built without a token");
      },
    };
    const code = await runGithubStackAudit({ argv: argvWith({ flags: ["--repo", "o/r", "--home", home] }), deps });
    expect(code).toBe(1);
    expect(observed.lines).toEqual([
      "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)",
    ]);
    expect(observed.tokenHomes).toEqual([home]);
  });

  it("refuses with exit 1, naming the provider's message, when the open-pull-request list fails", async () => {
    const lines: string[] = [];
    const listOpenPrs: GithubWriteApi["listOpenPrs"] = () =>
      errAsync(toIngestError({ error: new Error("Bad Gateway"), operation: "github.pulls.list" }));
    const code = await runGithubStackAudit({
      argv: argvWith({ flags: ["--repo", "o/r", "--check", "--home", tempHome()] }),
      deps: {
        makeApi: () => auditApi({ listOpenPrs }),
        out: ({ line }) => lines.push(line),
        token: () => "fake-test-token",
      },
    });
    expect(code).toBe(1);
    expect(lines).toEqual(["refused: could not list o/r's open pull requests: Bad Gateway"]);
  });

  it("refuses a missing --repo with exit 2 before asking for a token", async () => {
    const observed = harness({ prs: [], viewerId: undefined });
    const code = await runGithubStackAudit({ argv: argvWith({ flags: ["--check"] }), deps: observed.deps });
    expect(code).toBe(2);
    expect(observed.lines).toEqual(["--repo owner/name is required"]);
    expect(observed.tokenHomes).toEqual([]);
  });
});
