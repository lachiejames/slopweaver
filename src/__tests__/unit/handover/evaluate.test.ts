import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  aheadFromIndex,
  branchCandidates,
  candidateRefPatterns,
  commitsAhead,
  insideRepo,
  type RepoAheadIndex,
  refLookupOrder,
  repoProbeSeams,
  statedBranches,
} from "../../../handover/evaluate.js";
import type { CommandProbeOutcome } from "../../../handover/probe.js";

/** A lexical repo root: `insideRepo` decides before any read, so these cases need no filesystem at all. */
const REPO = "/repo/root";

const temps: string[] = [];

/**
 * A real temp directory seeded with byte-exact files, so the seams read a genuine filesystem rather than a map.
 * Directories are created for nested names, which is also how the "target is a directory" case is built.
 */
function repoFixture({ files }: { files: Readonly<Record<string, string>> }): string {
  const repo = mkdtempSync(join(tmpdir(), "slopweaver-evaluate-"));
  temps.push(repo);
  for (const [name, text] of Object.entries(files)) {
    const target = join(repo, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, "utf8");
  }
  return repo;
}

afterAll(() => {
  for (const repo of temps) {
    rmSync(repo, { force: true, recursive: true });
  }
});

describe("insideRepo", () => {
  it("resolves a nested repo-relative target to an absolute path", () => {
    expect(insideRepo({ repo: REPO, target: "src/handover/evaluate.ts" })).toBe("/repo/root/src/handover/evaluate.ts");
  });

  it("resolves a plain filename at the root", () => {
    expect(insideRepo({ repo: REPO, target: "AGENTS.md" })).toBe("/repo/root/AGENTS.md");
  });

  it("normalises a `./` prefix rather than rejecting it", () => {
    expect(insideRepo({ repo: REPO, target: "./docs/probes.md" })).toBe("/repo/root/docs/probes.md");
  });

  it("normalises an interior `..` that still lands inside", () => {
    expect(insideRepo({ repo: REPO, target: "src/gold/../silver/derive.ts" })).toBe("/repo/root/src/silver/derive.ts");
  });

  it("refuses an absolute target", () => {
    expect(insideRepo({ repo: REPO, target: "/etc/passwd" })).toBeUndefined();
  });

  it("refuses a `../` escape", () => {
    expect(insideRepo({ repo: REPO, target: "../../etc/passwd" })).toBeUndefined();
  });

  it("refuses an escape buried behind a real-looking prefix", () => {
    expect(insideRepo({ repo: REPO, target: "src/handover/../../../outside.ts" })).toBeUndefined();
  });

  it("refuses a sibling whose name merely STARTS with the repo's own name", () => {
    // `/repo/root-evil/x.ts` shares the prefix `/repo/root` textually, so a `startsWith(repo)` check would
    // admit it. The guard compares path SEGMENTS via `relative`, so this is an escape.
    expect(insideRepo({ repo: REPO, target: "../root-evil/x.ts" })).toBeUndefined();
  });

  it("refuses the parent directory itself", () => {
    expect(insideRepo({ repo: REPO, target: ".." })).toBeUndefined();
  });

  it("treats an empty target as the repo root, which is inside", () => {
    expect(insideRepo({ repo: REPO, target: "" })).toBe("/repo/root");
  });

  it("treats `.` as the repo root", () => {
    expect(insideRepo({ repo: REPO, target: "." })).toBe("/repo/root");
  });
});

describe("branchCandidates", () => {
  it("puts the recorded branch first, because the ledger's answer is exact", () => {
    expect(branchCandidates({ recordedBranch: "wt/derived-status", slug: "derived-status" })).toEqual([
      "wt/derived-status",
      "derived-status",
      "worktree-derived-status",
    ]);
  });

  it("falls back to exactly the two conventions when no run recorded a branch", () => {
    expect(branchCandidates({ recordedBranch: undefined, slug: "derived-status" })).toEqual([
      "derived-status",
      "worktree-derived-status",
    ]);
  });

  it("deduplicates when the recorded branch is the slug itself", () => {
    expect(branchCandidates({ recordedBranch: "derived-status", slug: "derived-status" })).toEqual([
      "derived-status",
      "worktree-derived-status",
    ]);
  });

  it("deduplicates when the recorded branch is the worktree convention", () => {
    expect(branchCandidates({ recordedBranch: "worktree-derived-status", slug: "derived-status" })).toEqual([
      "worktree-derived-status",
      "derived-status",
    ]);
  });

  it("still yields both conventions for an empty slug", () => {
    expect(branchCandidates({ recordedBranch: undefined, slug: "" })).toEqual(["", "worktree-"]);
  });
});

describe("repoProbeSeams fileContains", () => {
  it("is true when the file carries the symbol", () => {
    const repo = repoFixture({ files: { "src/a.ts": "export const x = latestRecords;\n" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "src/a.ts", symbol: "latestRecords" })).toBe(true);
  });

  it("matches a literal substring, not an identifier", () => {
    const repo = repoFixture({ files: { "src/a.ts": "text.slice(0, 1200);\n" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "src/a.ts", symbol: ".slice(0, 1200)" })).toBe(true);
  });

  it("is false when the file was read and the symbol is not in it", () => {
    const repo = repoFixture({ files: { "src/a.ts": "export const x = 1;\n" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "src/a.ts", symbol: "latestRecords" })).toBe(false);
  });

  it("is FALSE, not undefined, for a file that does not exist", () => {
    // Load-bearing: ENOENT is knowledge, not ignorance. The symbol is definitively not in a file that isn't
    // there, so a `present:` probe over work-yet-to-be-created must be able to FAIL and an `absent:` one must
    // be able to PASS. Collapsing ENOENT into `undefined` was a real bug — such a probe could never fail, so
    // the doc stayed in RUN NOW forever.
    const repo = repoFixture({ files: { "src/a.ts": "anything" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "src/not-yet-written.ts", symbol: "latestRecords" })).toBe(false);
  });

  it("is false for a missing file inside a directory that does not exist either", () => {
    const repo = repoFixture({ files: { "src/a.ts": "anything" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "nope/deeper/x.ts", symbol: "y" })).toBe(false);
  });

  it("is undefined for a target that is a DIRECTORY — present but unreadable is never 'absent'", () => {
    // EISDIR is genuine ignorance: nothing was checked. Reporting `false` here would silently PASS an
    // `absent:` probe on the strength of a read that never happened.
    const repo = repoFixture({ files: { "docs/probes.md": "needle" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "docs", symbol: "needle" })).toBeUndefined();
  });

  it("is undefined for a path-traversal target, decided before any read", () => {
    const repo = repoFixture({ files: { "src/a.ts": "needle" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "../../etc/passwd", symbol: "root" })).toBeUndefined();
  });

  it("is undefined for an absolute target", () => {
    const repo = repoFixture({ files: { "src/a.ts": "needle" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "/etc/hosts", symbol: "localhost" })).toBeUndefined();
  });

  it("reads a file containing a raw NUL byte correctly — the measured grep-blindness case", () => {
    // Measured on this board's own docs: one raw NUL byte makes `file` call the whole file `data` and makes
    // grep silently blind to every line of it, so a grep-backed `absent:` probe reports "the symbol is gone"
    // having read nothing. Node reads the bytes, so the seam answers where a shell pipeline cannot.
    // The NUL is written as an ESCAPE (`\u0000`), never as a raw byte in this source: one literal NUL in
    // a `.ts` makes git treat the file as binary and hides every line of it from review.
    const repo = repoFixture({ files: { "docs/nul.md": "before\u0000after needle" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "docs/nul.md", symbol: "needle" })).toBe(true);
    expect(seams.fileContains({ file: "docs/nul.md", symbol: "missing" })).toBe(false);
  });

  it("finds a symbol in an empty-string search, and nothing in an empty file", () => {
    const repo = repoFixture({ files: { "empty.ts": "" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.fileContains({ file: "empty.ts", symbol: "" })).toBe(true);
    expect(seams.fileContains({ file: "empty.ts", symbol: "x" })).toBe(false);
  });
});

describe("repoProbeSeams pathExists", () => {
  it("is true for a file that exists", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.pathExists({ path: "docs/probes.md" })).toBe(true);
  });

  it("is true for a directory that exists", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.pathExists({ path: "docs" })).toBe(true);
  });

  it("is false for a path that does not exist", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.pathExists({ path: "docs/missing.md" })).toBe(false);
  });

  it("is false for a traversal attempt, even though the target really exists outside", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.pathExists({ path: "../" })).toBe(false);
  });

  it("is false for an absolute path", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });
    const seams = repoProbeSeams({ repo, runCommand: undefined });

    expect(seams.pathExists({ path: tmpdir() })).toBe(false);
  });
});

describe("repoProbeSeams runCommand", () => {
  it("passes the supplied runner straight through, unwrapped", () => {
    const runCommand = ({ command }: { command: string }): CommandProbeOutcome => ({
      launchFailure: undefined,
      signal: undefined,
      status: command === "yarn typecheck" ? 0 : 1,
      timedOutAfterMs: undefined,
    });
    const seams = repoProbeSeams({ repo: "/repo/root", runCommand });

    expect(seams.runCommand).toBe(runCommand);
    expect(seams.runCommand!({ command: "yarn typecheck" }).status).toBe(0);
    expect(seams.runCommand!({ command: "rm -rf /" }).status).toBe(1);
  });

  it("keeps the declining caller's undefined, so command probes stay not-evaluated", () => {
    const seams = repoProbeSeams({ repo: "/repo/root", runCommand: undefined });

    expect(seams.runCommand).toBeUndefined();
  });
});

describe("commitsAhead", () => {
  it("is 0 for a repository path that does not exist", () => {
    expect(
      commitsAhead({
        base: "main",
        candidates: ["derived-status", "worktree-derived-status"],
        repo: join(tmpdir(), "slopweaver-no-such-repo-9d3f1a"),
      }),
    ).toBe(0);
  });

  it("is 0 for a directory that exists but is not a checkout", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });

    expect(commitsAhead({ base: "main", candidates: ["derived-status"], repo })).toBe(0);
  });

  it("is 0 for a branch name that does not resolve", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });

    expect(commitsAhead({ base: "main", candidates: ["no-such-branch-4b21c7"], repo })).toBe(0);
  });

  it("is 0 for an empty candidate list, without asking git anything", () => {
    const repo = repoFixture({ files: { "docs/probes.md": "x" } });

    expect(commitsAhead({ base: "main", candidates: [], repo })).toBe(0);
  });
});

describe("a repository that is not there is IGNORANCE, not evidence", () => {
  /**
   * Found by an adversarial review pass. ENOENT on a file inside a real repo means the symbol is definitively
   * absent, so an `absent:` probe may pass. ENOENT because the whole REPOSITORY is missing means nothing was
   * examined — and conflating them let a doc pointing at a nonexistent repo pass every `absent:` probe and
   * compute `landed`, which made `start` refuse it as already shipped.
   */
  it("returns undefined, never false, for a symbol probe against a repo that does not exist", () => {
    const seams = repoProbeSeams({ repo: "/definitely/not/a/repo/here", runCommand: undefined });

    expect(seams.fileContains({ file: "src/a.ts", symbol: "anything" })).toBeUndefined();
  });

  it("does not report a path as existing under a repo that does not exist", () => {
    const seams = repoProbeSeams({ repo: "/definitely/not/a/repo/here", runCommand: undefined });

    expect(seams.pathExists({ path: "src" })).toBe(false);
  });
});

describe("statedBranches", () => {
  it("answers the recorded branch, then a different declared one", () => {
    expect(statedBranches({ declaredBranch: "declared", recordedBranch: "recorded" })).toEqual([
      "recorded",
      "declared",
    ]);
  });

  it("answers the recorded branch alone for an ask row that declared none", () => {
    expect(statedBranches({ declaredBranch: undefined, recordedBranch: "an-ask" })).toEqual(["an-ask"]);
  });

  it("deduplicates a declaration the run recorded too", () => {
    expect(statedBranches({ declaredBranch: "feature/one", recordedBranch: "feature/one" })).toEqual(["feature/one"]);
  });

  it("answers nothing for a row with neither, and drops an empty declaration", () => {
    expect(statedBranches({ declaredBranch: undefined, recordedBranch: undefined })).toEqual([]);
    expect(statedBranches({ declaredBranch: "", recordedBranch: undefined })).toEqual([]);
  });
});

describe("branchCandidates prefers stated facts over conventional guesses", () => {
  /**
   * The guesses measurably failed: a review of the live board found a real 14-commit worktree they missed,
   * because its branch was `v2-atlas-rebuild` while the slug was `v2-datadog-atlas-rebuild`. Name-similarity
   * matching is banned here, so the answer is to let the doc declare it.
   */
  it("puts a declared branch ahead of both conventions", () => {
    const candidates = branchCandidates({
      declaredBranch: "v2-atlas-rebuild",
      recordedBranch: undefined,
      slug: "v2-datadog-atlas-rebuild",
    });

    expect(candidates).toEqual(["v2-atlas-rebuild", "v2-datadog-atlas-rebuild", "worktree-v2-datadog-atlas-rebuild"]);
  });

  it("puts the ledger's recorded branch ahead of the doc's declaration", () => {
    const candidates = branchCandidates({ declaredBranch: "declared", recordedBranch: "recorded", slug: "s" });

    expect(candidates).toEqual(["recorded", "declared", "s", "worktree-s"]);
  });

  it("falls back to the conventions alone when nothing is stated", () => {
    expect(branchCandidates({ recordedBranch: undefined, slug: "s" })).toEqual(["s", "worktree-s"]);
  });

  it("deduplicates a declaration that repeats a convention", () => {
    expect(branchCandidates({ declaredBranch: "s", recordedBranch: undefined, slug: "s" })).toEqual([
      "s",
      "worktree-s",
    ]);
  });
});

describe("candidateRefPatterns", () => {
  it("expands every candidate to each spelling the index looks up, each once, in first-seen order", () => {
    expect(candidateRefPatterns({ candidates: ["atlas", "atlas", "tags/v1"] })).toEqual([
      "refs/atlas",
      "refs/tags/atlas",
      "refs/heads/atlas",
      "refs/remotes/atlas",
      "refs/remotes/atlas/HEAD",
      "refs/tags/v1",
      "refs/tags/tags/v1",
      "refs/heads/tags/v1",
      "refs/remotes/tags/v1",
      "refs/remotes/tags/v1/HEAD",
    ]);
  });

  it("is empty for no candidates", () => {
    expect(candidateRefPatterns({ candidates: [] })).toEqual([]);
  });
});

describe("refLookupOrder transcribes git's own ref precedence", () => {
  /**
   * The index replaced a `rev-list main..<name>`, so it has to resolve `<name>` the way git did. Git prefers
   * `refs/tags/<name>` over `refs/heads/<name>`, which is the one step a from-scratch reading would get
   * backwards — and getting it backwards answers a different number on any repository carrying both.
   */
  it("puts tags ahead of heads, and remotes last", () => {
    expect(refLookupOrder({ name: "atlas" })).toEqual([
      "refs/atlas",
      "refs/tags/atlas",
      "refs/heads/atlas",
      "refs/remotes/atlas",
      "refs/remotes/atlas/HEAD",
    ]);
  });
});

describe("aheadFromIndex", () => {
  /** A prebuilt index is a plain record of what one `for-each-ref` said — no seam, no fake, just data. */
  const indexOf = ({ byRef }: { byRef: ReadonlyMap<string, number> }): RepoAheadIndex => ({
    byRef,
    repo: "/repo/root",
    trunk: "refs/heads/main",
  });

  it("is 0 for every candidate when the trunk could not be resolved", () => {
    const index: RepoAheadIndex = { byRef: new Map([["refs/heads/atlas", 14]]), repo: "/repo/root", trunk: undefined };

    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(0);
  });

  it("reads a branch's count off the index", () => {
    const index = indexOf({ byRef: new Map([["refs/heads/atlas", 14]]) });

    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(14);
  });

  it("prefers a tag over a branch of the same name, as git does", () => {
    const index = indexOf({
      byRef: new Map([
        ["refs/heads/atlas", 14],
        ["refs/tags/atlas", 3],
      ]),
    });

    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(3);
  });

  it("resolves a remote-tracking candidate", () => {
    const index = indexOf({ byRef: new Map([["refs/remotes/origin/atlas", 9]]) });

    expect(aheadFromIndex({ candidates: ["origin/atlas"], index })).toBe(9);
  });

  it("takes the highest count any candidate carries", () => {
    const index = indexOf({
      byRef: new Map([
        ["refs/heads/atlas", 2],
        ["refs/heads/worktree-atlas", 14],
      ]),
    });

    expect(aheadFromIndex({ candidates: ["atlas", "worktree-atlas"], index })).toBe(14);
  });

  it("is 0 for a candidate no ref in the index names — the index covers every ref, so absence IS non-existence", () => {
    const index = indexOf({ byRef: new Map([["refs/heads/atlas", 14]]) });

    expect(aheadFromIndex({ candidates: ["no-such-branch-4b21c7"], index })).toBe(0);
  });

  it("is 0 for an empty candidate list", () => {
    expect(aheadFromIndex({ candidates: [], index: indexOf({ byRef: new Map([["refs/heads/atlas", 14]]) }) })).toBe(0);
  });
});
