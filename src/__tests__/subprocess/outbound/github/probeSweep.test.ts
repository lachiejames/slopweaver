/**
 * `probeSweep.ts` — `probeText` as a pure unit, plus `sweepMergeProbeRegressions` against a real temp git
 * repository and a real handovers directory. `gitInTemp` per `src/__tests__/tempGitRepo.ts` — a test may not
 * shell git any other way.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { probeText, sweepMergeProbeRegressions } from "../../../../outbound/github/probeSweep.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("probeText", () => {
  it("renders a present probe", () => {
    expect(probeText({ probe: { file: "src/a.ts", kind: "present", symbol: "x" } })).toBe("present: src/a.ts#x");
  });

  it("renders an absent probe", () => {
    expect(probeText({ probe: { file: "src/a.ts", kind: "absent", symbol: "x" } })).toBe("absent: src/a.ts#x");
  });

  it("renders a path probe", () => {
    expect(probeText({ probe: { kind: "path", path: "docs/x.md" } })).toBe("path: docs/x.md");
  });

  it("renders a command probe", () => {
    expect(probeText({ probe: { command: "yarn test", kind: "command" } })).toBe("command: yarn test");
  });
});

/** A fresh temp git repo on `main`, with committer identity set. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "probe-sweep-repo-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return dir;
}

/** A plain (non-git) directory of handover docs — `scanBoard` reads any directory it is pointed at. */
function handoversDirWith({ docs }: { docs: Readonly<Record<string, string>> }): string {
  const dir = mkdtempSync(join(tmpdir(), "probe-sweep-handovers-"));
  fixtureDirs.push(dir);
  for (const [name, text] of Object.entries(docs)) {
    writeFileSync(join(dir, name), text, "utf8");
  }
  return dir;
}

/** One doc declaring a single `present:` probe, targeting `repo`. */
function presentDoc({ slug, repo, status }: { slug: string; repo: string; status: string }): string {
  return (
    `---\nslug: ${slug}\nstatus: ${status}\nrepo: ${repo}\n` +
    "doneWhen:\n  - present: src/thing.ts#keepThis\n---\nbody\n"
  );
}

describe("sweepMergeProbeRegressions", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports not-evaluated when the handovers directory does not exist", () => {
    const repo = initRepo();
    const missing = join(tmpdir(), "probe-sweep-does-not-exist-9d3f1a");
    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: missing,
      headRef: "main",
      repoRoot: repo,
    });
    expect(sweep.kind).toBe("not-evaluated");
  });

  it("reports not-evaluated when a ref cannot be resolved, never as zero regressions", () => {
    const repo = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: repo });
    };
    writeFileSync(join(repo, "kept.txt"), "x\n");
    git("add", "-A");
    git("commit", "-m", "base");
    const handovers = handoversDirWith({ docs: {} });

    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: handovers,
      headRef: "no-such-branch",
      repoRoot: repo,
    });

    expect(sweep.kind).toBe("not-evaluated");
  });

  it("reports zero regressions and the count checked when nothing regresses", () => {
    const repo = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: repo });
    };
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "thing.ts"), "export const keepThis = 1;\n");
    git("add", "-A");
    git("commit", "-m", "base");
    git("checkout", "-b", "feature");
    writeFileSync(join(repo, "other.txt"), "unrelated\n");
    git("add", "-A");
    git("commit", "-m", "unrelated work");
    const handovers = handoversDirWith({ docs: { "doc.md": presentDoc({ repo, slug: "a-doc", status: "ready" }) } });

    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: handovers,
      headRef: "feature",
      repoRoot: repo,
    });

    expect(sweep).toEqual({ docsChecked: 1, kind: "evaluated", regressions: [] });
  });

  it("reports a regression for a probe that passes on base and fails on head — the incident this exists to catch", () => {
    const repo = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: repo });
    };
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "thing.ts"), "export const keepThis = 1;\n");
    git("add", "-A");
    git("commit", "-m", "base has the symbol");
    git("checkout", "-b", "feature");
    writeFileSync(join(repo, "src", "thing.ts"), "// removed\n");
    git("add", "-A");
    git("commit", "-m", "214: quietly removes the symbol");
    // Included with `status: done`, deliberately — the measured incident's own doc said `done` throughout.
    const handovers = handoversDirWith({
      docs: { "doc.md": presentDoc({ repo, slug: "distil-latest-collapse", status: "done" }) },
    });

    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: handovers,
      headRef: "feature",
      repoRoot: repo,
    });

    expect(sweep).toEqual({
      docsChecked: 1,
      kind: "evaluated",
      regressions: [{ probe: "present: src/thing.ts#keepThis", slug: "distil-latest-collapse" }],
    });
  });

  it("does not raise a false regression when base gains a NON-overlapping commit after the fork", () => {
    // The measured incident: base gained a commit whose files the head branch never
    // touches. Evaluating the "after" state at head's own raw tip makes a probe naming one of those
    // base-only files read as newly absent — a false regression — because head's raw tip predates it. The
    // real post-merge tree keeps it, since nothing in head's diff touches it.
    const repo = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: repo });
    };
    writeFileSync(join(repo, "fork-point.txt"), "x\n");
    git("add", "-A");
    git("commit", "-m", "fork point");
    git("checkout", "-b", "feature");
    writeFileSync(join(repo, "unrelated-feature-work.txt"), "feature work\n");
    git("add", "-A");
    git("commit", "-m", "feature does its own, unrelated thing");
    git("checkout", "main");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "thing.ts"), "export const keepThis = 1;\n");
    git("add", "-A");
    git("commit", "-m", "main gains src/thing.ts, which feature never saw");
    const handovers = handoversDirWith({
      docs: { "doc.md": presentDoc({ repo, slug: "base-gained-doc", status: "ready" }) },
    });

    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: handovers,
      headRef: "feature",
      repoRoot: repo,
    });

    expect(sweep).toEqual({ docsChecked: 1, kind: "evaluated", regressions: [] });
  });

  it("still raises when a genuine regression exists even though base has also moved", () => {
    const repo = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: repo });
    };
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "thing.ts"), "export const keepThis = 1;\n");
    git("add", "-A");
    git("commit", "-m", "fork point");
    git("checkout", "-b", "feature");
    writeFileSync(join(repo, "src", "thing.ts"), "// removed\n");
    git("add", "-A");
    git("commit", "-m", "feature quietly removes the symbol");
    git("checkout", "main");
    writeFileSync(join(repo, "src", "gained.ts"), "export const gainedOnBase = 1;\n");
    git("add", "-A");
    git("commit", "-m", "main also gains an unrelated file");
    const handovers = handoversDirWith({
      docs: { "doc.md": presentDoc({ repo, slug: "distil-latest-collapse", status: "ready" }) },
    });

    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: handovers,
      headRef: "feature",
      repoRoot: repo,
    });

    expect(sweep).toEqual({
      docsChecked: 1,
      kind: "evaluated",
      regressions: [{ probe: "present: src/thing.ts#keepThis", slug: "distil-latest-collapse" }],
    });
  });

  it("never evaluates a doc that names a DIFFERENT repository — exact match only, no fuzzy matching", () => {
    const repo = initRepo();
    const otherRepo = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: repo });
    };
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "thing.ts"), "export const keepThis = 1;\n");
    git("add", "-A");
    git("commit", "-m", "base has the symbol");
    git("checkout", "-b", "feature");
    writeFileSync(join(repo, "src", "thing.ts"), "// removed\n");
    git("add", "-A");
    git("commit", "-m", "removes the symbol");
    const handovers = handoversDirWith({
      docs: { "doc.md": presentDoc({ repo: otherRepo, slug: "unrelated-doc", status: "ready" }) },
    });

    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: handovers,
      headRef: "feature",
      repoRoot: repo,
    });

    expect(sweep).toEqual({ docsChecked: 0, kind: "evaluated", regressions: [] });
  });

  it("ignores a doc that declares no doneWhen probes at all", () => {
    const repo = initRepo();
    const git = (...args: string[]): void => {
      gitInTemp({ args, cwd: repo });
    };
    writeFileSync(join(repo, "kept.txt"), "x\n");
    git("add", "-A");
    git("commit", "-m", "base");
    git("checkout", "-b", "feature");
    writeFileSync(join(repo, "other.txt"), "y\n");
    git("add", "-A");
    git("commit", "-m", "work");
    const handovers = handoversDirWith({
      docs: { "doc.md": `---\nslug: no-probes\nstatus: ready\nrepo: ${repo}\n---\nbody\n` },
    });

    const sweep = sweepMergeProbeRegressions({
      baseRef: "main",
      handoversDir: handovers,
      headRef: "feature",
      repoRoot: repo,
    });

    expect(sweep).toEqual({ docsChecked: 0, kind: "evaluated", regressions: [] });
  });
});
