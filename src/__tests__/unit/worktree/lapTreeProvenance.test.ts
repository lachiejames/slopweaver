/**
 * A lap tree's provenance: the marker round-trips through a real private gitdir written to a throwaway directory,
 * the path shape is exact, the lap's own report directories are told from anything else, and the witness set is an
 * ALLOWLIST — a ref in `refs/tmp/` or the tree's own `salvage/` branch keeps nothing, a ref under
 * `refs/slopweaver/operator-lap/` does. git is a plain fake answering by argv.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  LAP_TREE_MARKER_FILE,
  type LapTreeMarkerV1,
  lapTreeShape,
  lapWitnessFrom,
  parseLapTreeMarker,
  readLapTreeFacts,
  readLapTreeMarker,
  unexpectedLapWork,
  writeLapTreeMarker,
} from "../../../worktree/lapTreeProvenance.js";
import type { GitRunner } from "../../../worktree/pruneGit.js";

const HEAD = "c".repeat(40);
const ROOT = "/cache/lap-trees.noindex";
const TREE = `${ROOT}/sw-lap-HH2i6B`;

const MARKER: LapTreeMarkerV1 = {
  kind: "github-lap-tree",
  mintedHead: HEAD,
  pid: 4242,
  processStart: "Thu Nov 26 09:00:00 2026",
  version: 1,
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory standing in for a tree's private gitdir. */
function gitDirFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "lap-gitdir-"));
  dirs.push(dir);
  return dir;
}

/**
 * A fake git answering the private gitdir, HEAD, and the witness listing.
 *
 * @returns the runner, and every argv it was asked
 */
function fakeGit({ gitDir, listing }: { gitDir: string; listing: string | null }): {
  git: GitRunner;
  asked: string[][];
} {
  const asked: string[][] = [];
  const git: GitRunner = ({ args }) => {
    asked.push([...args]);
    if (args[0] === "rev-parse" && args[1] === "--absolute-git-dir") {
      return `${gitDir}\n`;
    }
    if (args[0] === "rev-parse") {
      return HEAD;
    }
    if (args[0] === "for-each-ref") {
      return listing;
    }
    return null;
  };
  return { asked, git };
}

describe("the lap-tree marker", () => {
  it("round-trips through a private gitdir", () => {
    const gitDir = gitDirFixture();
    expect(writeLapTreeMarker({ gitDir, marker: MARKER }).isOk()).toBe(true);
    expect(unwrap(readLapTreeMarker({ gitDir }))).toEqual(MARKER);
  });

  it("reads an absent marker as null, and a malformed one as invalid, never as absent", () => {
    const gitDir = gitDirFixture();
    expect(unwrap(readLapTreeMarker({ gitDir }))).toBeNull();
    writeFileSync(join(gitDir, LAP_TREE_MARKER_FILE), "{not json");
    expect(unwrapErr(readLapTreeMarker({ gitDir })).code).toBe("LAP_MARKER_INVALID");
  });

  it("refuses a marker with an extra field, a short commit id or no start stamp", () => {
    expect(unwrapErr(parseLapTreeMarker({ path: "m", text: JSON.stringify({ ...MARKER, extra: 1 }) })).code).toBe(
      "LAP_MARKER_INVALID",
    );
    expect(
      unwrapErr(parseLapTreeMarker({ path: "m", text: JSON.stringify({ ...MARKER, mintedHead: "abc" }) })).code,
    ).toBe("LAP_MARKER_INVALID");
    expect(
      unwrapErr(parseLapTreeMarker({ path: "m", text: JSON.stringify({ ...MARKER, processStart: "" }) })).code,
    ).toBe("LAP_MARKER_INVALID");
  });
});

describe("lapTreeShape", () => {
  it("accepts exactly sw-lap- plus six mkdtemp characters directly under a root spelling", () => {
    expect(lapTreeShape({ path: TREE, roots: [ROOT] })).toBe(true);
    expect(lapTreeShape({ path: TREE, roots: ["/elsewhere", `${ROOT}/`] })).toBe(true);
  });

  it("refuses a nested path, another prefix, or a suffix of the wrong length", () => {
    expect(lapTreeShape({ path: `${ROOT}/x/sw-lap-HH2i6B`, roots: [ROOT] })).toBe(false);
    expect(lapTreeShape({ path: `${ROOT}/sw-lop-HH2i6B`, roots: [ROOT] })).toBe(false);
    expect(lapTreeShape({ path: `${ROOT}/sw-lap-HH2i6`, roots: [ROOT] })).toBe(false);
    expect(lapTreeShape({ path: `${ROOT}/sw-lap-HH2i6B-`, roots: [ROOT] })).toBe(false);
  });
});

describe("unexpectedLapWork", () => {
  it("keeps only what is neither a lap report directory nor inside one", () => {
    expect(
      unexpectedLapWork({ ignoredWork: [".vitest-reports/", "coverage/lcov.info", "coverage-x/", ".env.local"] }),
    ).toEqual(["coverage-x/", ".env.local"]);
  });
});

describe("lapWitnessFrom — an allowlist of refs somebody means to keep", () => {
  it("refuses a HEAD held only by refs/tmp/ and by the tree's own salvage branch", () => {
    const listing = ["refs/heads/salvage/sw-lap-HH2i6B-1", "refs/tmp/x"].join("\n");
    expect(lapWitnessFrom({ listing, treePath: TREE })).toBeNull();
  });

  it("admits the same HEAD once it sits under refs/slopweaver/operator-lap/", () => {
    const listing = ["refs/heads/salvage/sw-lap-HH2i6B-1", "refs/tmp/x", `refs/slopweaver/operator-lap/${HEAD}`].join(
      "\n",
    );
    expect(lapWitnessFrom({ listing, treePath: TREE })).toBe(`refs/slopweaver/operator-lap/${HEAD}`);
  });

  it("refuses the next lap's own ref, a stash and any namespace not listed", () => {
    const listing = ["refs/slopweaver/lap/pr-12", "refs/stash", "refs/notes/commits", "refs/bisect/good"].join("\n");
    expect(lapWitnessFrom({ listing, treePath: TREE })).toBeNull();
  });

  it("admits another tree's salvage branch, a local branch, a remote and a tag", () => {
    expect(lapWitnessFrom({ listing: "refs/heads/salvage/sw-lap-X8fqZn-1", treePath: TREE })).toBe(
      "refs/heads/salvage/sw-lap-X8fqZn-1",
    );
    expect(lapWitnessFrom({ listing: "refs/heads/main", treePath: TREE })).toBe("refs/heads/main");
    expect(lapWitnessFrom({ listing: "refs/remotes/origin/main", treePath: TREE })).toBe("refs/remotes/origin/main");
    expect(lapWitnessFrom({ listing: "refs/tags/v1", treePath: TREE })).toBe("refs/tags/v1");
  });
});

describe("readLapTreeFacts", () => {
  const notLive = (): boolean => false;

  it("answers undefined for a tree off the lap-trees path that carries no marker, asking only for its gitdir", () => {
    const { asked, git } = fakeGit({ gitDir: gitDirFixture(), listing: "" });
    expect(
      readLapTreeFacts({ git, holderLive: notLive, path: "/repo/.claude/worktrees/x", roots: [ROOT] }),
    ).toBeUndefined();
    expect(asked).toEqual([["rev-parse", "--absolute-git-dir"]]);
  });

  it("still reads a marked tree whose path no longer matches the lap-trees directory this process resolves", () => {
    const gitDir = gitDirFixture();
    unwrap(writeLapTreeMarker({ gitDir, marker: MARKER }));
    const { git } = fakeGit({ gitDir, listing: "" });
    expect(
      readLapTreeFacts({ git, holderLive: () => true, path: "/other-cache/lap-trees/sw-lap-ABC123", roots: [ROOT] }),
    ).toEqual({
      head: HEAD,
      holderLive: true,
      kind: "marked",
      marker: MARKER,
    });
  });

  it("reads an unmarked tree's HEAD and the ref admitting it", () => {
    const { git } = fakeGit({ gitDir: gitDirFixture(), listing: "refs/tmp/x\nrefs/remotes/origin/main\n" });
    expect(readLapTreeFacts({ git, holderLive: notLive, path: TREE, roots: [ROOT] })).toEqual({
      head: HEAD,
      kind: "unmarked",
      witness: "refs/remotes/origin/main",
    });
  });

  it("reads an unmarked tree whose witness listing failed as unreadable, never as unwitnessed", () => {
    const { git } = fakeGit({ gitDir: gitDirFixture(), listing: null });
    expect(readLapTreeFacts({ git, holderLive: notLive, path: TREE, roots: [ROOT] })).toEqual({
      head: HEAD,
      kind: "unmarked",
      witness: undefined,
    });
  });

  it("reads a marked tree and asks whether exactly the pid and stamp it names still run", () => {
    const gitDir = gitDirFixture();
    unwrap(writeLapTreeMarker({ gitDir, marker: MARKER }));
    const { git } = fakeGit({ gitDir, listing: "" });
    const holders: { pid: number; start: string }[] = [];
    const holderLive = (holder: { pid: number; start: string }): boolean => {
      holders.push(holder);
      return true;
    };
    expect(readLapTreeFacts({ git, holderLive, path: TREE, roots: [ROOT] })).toEqual({
      head: HEAD,
      holderLive: true,
      kind: "marked",
      marker: MARKER,
    });
    expect(holders).toEqual([{ pid: 4242, start: "Thu Nov 26 09:00:00 2026" }]);
  });
});
