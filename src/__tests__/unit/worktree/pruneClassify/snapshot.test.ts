/*
 * The `snapshot` class: a one-off Codex snapshot left registered by a pass that died before release. Measured:
 * 31 of one hourly run's 87 held trees were these, read as ordinary detached trees and held forever.
 */
import { describe, expect, it } from "vitest";

import { snapshotDecision } from "../../../../worktree/pruneSnapshotClass.js";
import { classify, DAY_MS, facts, NOW_MS } from "./harness.js";

const HOUR_MS = 3_600_000;

/** A leaked snapshot as the scan reads it: detached, on no remote, clean, under the temp root. */
const LEAKED = {
  branch: null,
  freshSnapshot: true,
  headSha: "abc123",
  lastActivityMs: NOW_MS - 3 * DAY_MS,
  mergedIntoTrunk: null,
  path: "/private/var/folders/2g/abc/T/slopweaver-snap-1aIQkT/tree",
} as const;

describe("classifyWorktree — a one-off Codex snapshot", () => {
  it("takes one untouched for three days, deleting no branch", () => {
    expect(classify(LEAKED)).toEqual({
      branch: null,
      cls: "snapshot",
      deleteBranch: false,
      diskKib: 500_000,
      dropsDeps: false,
      path: LEAKED.path,
      reason: "a one-off Codex snapshot left behind 3d ago — a frozen copy, nothing is lost",
      scannedHead: "abc123",
    });
  });

  it("holds one whose HEAD could not be read, since its removal pins exactly the HEAD the scan read", () => {
    expect(classify({ ...LEAKED, headSha: null }).reason).toBe("its HEAD could not be read");
  });

  it("takes one exactly at the 25-hour age", () => {
    expect(classify({ ...LEAKED, lastActivityMs: NOW_MS - 25 * HOUR_MS }).cls).toBe("snapshot");
  });

  it("holds one touched just under 25 hours ago, which a pass may still be reading", () => {
    expect(classify({ ...LEAKED, lastActivityMs: NOW_MS - 25 * HOUR_MS + 1 }).reason).toBe(
      "a Codex snapshot touched 24h ago — a pass may still be reading it",
    );
  });

  it("holds one a live session or process still references, whatever its age", () => {
    expect(classify({ ...LEAKED, liveRefs: ["pid 4242"] })).toEqual({
      branch: null,
      cls: "hold",
      deleteBranch: false,
      diskKib: 500_000,
      dropsDeps: false,
      path: LEAKED.path,
      reason: "referenced by pid 4242",
    });
  });

  it("holds one whose activity could not be read, rather than guessing its age", () => {
    expect(classify({ ...LEAKED, lastActivityMs: null }).reason).toBe("no activity timestamp could be read");
  });

  it("leaves a detached tree outside the snapshot shape to the ordinary detached rules", () => {
    expect(classify({ ...LEAKED, freshSnapshot: false }).cls).toBe("hold");
  });

  it("leaves a missing snapshot to the stale-record class", () => {
    expect(classify({ ...LEAKED, missing: true }).cls).toBe("gone");
  });
});

describe("snapshotDecision — the class's own decision, before any rule about work", () => {
  it("decides nothing for a tree outside the snapshot shape, so the ordinary rules judge it", () => {
    expect(snapshotDecision({ facts: facts({ ...LEAKED, freshSnapshot: false }), nowMs: NOW_MS })).toBe(undefined);
  });

  it("decides nothing for the main checkout, even one wearing the snapshot shape", () => {
    expect(snapshotDecision({ facts: facts({ ...LEAKED, isMainCheckout: true }), nowMs: NOW_MS })).toBe(undefined);
  });

  it("carries the HEAD the scan read, which the removal is pinned to", () => {
    expect(snapshotDecision({ facts: facts(LEAKED), nowMs: NOW_MS })).toEqual({
      cls: "snapshot",
      deleteBranch: false,
      reason: "a one-off Codex snapshot left behind 3d ago — a frozen copy, nothing is lost",
      scannedHead: "abc123",
    });
  });
});
