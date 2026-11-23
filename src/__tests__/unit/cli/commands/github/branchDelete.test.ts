import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import {
  branchDeleteDoorRequest,
  parseGithubBranchArgs,
  planBranchDelete,
} from "../../../../../cli/commands/github/branchDeleteCore.js";
import { type GithubBranchDeps, runGithubBranch } from "../../../../../cli/commands/github/branchDeleteRun.js";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { githubRefsManifest } from "../../../../../cli/manifests/githubRefs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { type FakeRemote, fakeRefsApi, fakeRemote } from "./refsFake.js";

const TIP = "a".repeat(40);
const OTHER = "b".repeat(40);

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-branch-"));
  homes.push(home);
  return home;
}

describe("parseGithubBranchArgs", () => {
  it("resolves the address, the keep-tag and the modes", () => {
    expect(
      unwrap(
        parseGithubBranchArgs({
          argv: ["delete", "--repo", "o/r", "--branch", "old/work", "--keep-as-tag", "archive/old", "--dry-run"],
        }),
      ),
    ).toEqual({
      branch: "old/work",
      dryRun: true,
      expectTip: undefined,
      home: undefined,
      json: false,
      keepAsTag: "archive/old",
      owner: "o",
      repo: "r",
    });
  });

  it("names every problem, and refuses a refs/ path and an unknown sub-verb", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parseGithubBranchArgs({ argv: ["delete", "--repo", "broken", "--branch", "refs/heads/x"] })),
      }),
    ).toEqual([
      "--repo owner/name is required",
      "--branch takes the bare branch name, not a refs/ path",
      "--expect-tip <sha> is required for a real delete; --dry-run prints the tip to pass",
    ]);
    expect(
      githubVerbErrorLines({
        error: unwrapErr(
          parseGithubBranchArgs({ argv: ["delete", "--repo", "o/r", "--branch", "x", "--expect-tip", "abc"] }),
        ),
      }),
    ).toEqual(["--expect-tip must be a full 40-character lowercase commit sha"]);
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parseGithubBranchArgs({ argv: ["delete", "--repo", "o/r", "--branch", "x"] })),
      }),
    ).toEqual(["--expect-tip <sha> is required for a real delete; --dry-run prints the tip to pass"]);
    expect(
      githubVerbErrorLines({
        error: unwrapErr(parseGithubBranchArgs({ argv: ["create", "--repo", "o/r", "--branch", "x"] })),
      }),
    ).toEqual(["usage: slopweaver github branch delete [...]"]);
  });
});

describe("planBranchDelete", () => {
  const base = {
    branch: "old",
    defaultBranch: "main",
    expectTip: undefined,
    keepAsTag: undefined,
    keepTagCommit: undefined,
    openPrs: [],
  };

  it("refuses the default branch, a missing branch and one an open pull request names", () => {
    expect(planBranchDelete({ ...base, branch: "main", tip: TIP })).toEqual({
      kind: "refuse",
      reason: "main is the repository's default branch",
    });
    expect(planBranchDelete({ ...base, tip: undefined })).toEqual({
      kind: "refuse",
      reason: "the remote has no branch old — nothing to delete",
    });
    expect(planBranchDelete({ ...base, openPrs: [4, 9], tip: TIP })).toEqual({
      kind: "refuse",
      reason: "open pull request(s) #4, #9 name old as base or head",
    });
  });

  it("binds a real delete to the tip its dry run printed", () => {
    expect(planBranchDelete({ ...base, expectTip: TIP, tip: TIP })).toEqual({
      kind: "delete",
      tagFirst: false,
      tip: TIP,
    });
    expect(planBranchDelete({ ...base, expectTip: TIP, tip: OTHER })).toEqual({
      kind: "refuse",
      reason: `old is at ${OTHER}, not the --expect-tip ${TIP}; dry-run again`,
    });
  });

  it("tags first only when the keep-tag is absent, and refuses one at another commit", () => {
    expect(planBranchDelete({ ...base, tip: TIP })).toEqual({ kind: "delete", tagFirst: false, tip: TIP });
    expect(planBranchDelete({ ...base, keepAsTag: "k", tip: TIP })).toEqual({
      kind: "delete",
      tagFirst: true,
      tip: TIP,
    });
    expect(planBranchDelete({ ...base, keepAsTag: "k", keepTagCommit: TIP, tip: TIP })).toEqual({
      kind: "delete",
      tagFirst: false,
      tip: TIP,
    });
    expect(planBranchDelete({ ...base, keepAsTag: "k", keepTagCommit: OTHER, tip: TIP })).toEqual({
      kind: "refuse",
      reason: `tag k already points at ${OTHER}, not the tip ${TIP}`,
    });
  });
});

describe("branchDeleteDoorRequest", () => {
  it("names the exact ref as an external write", () => {
    const args = unwrap(parseGithubBranchArgs({ argv: ["delete", "--repo", "o/r", "--branch", "old", "--dry-run"] }));
    expect(branchDeleteDoorRequest({ args, home: "/h" })).toEqual({
      action: { kind: "verb", noun: "github", verb: "branch" },
      artifact: { id: "o/r:refs/heads/old" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});

function depsFor({
  door = memoryDoorLedger().port,
  remote,
  out,
  diagnostic,
}: {
  door?: DoorLedgerPort | undefined;
  remote: FakeRemote;
  out: string[];
  diagnostic: string[];
}): GithubBranchDeps {
  return {
    doorLedger: door,
    home: () => "/never-the-ambient-home",
    makeApi: () => fakeRefsApi({ remote }),
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

async function run({
  door,
  remote,
  extra,
}: {
  door?: DoorLedgerPort;
  remote: FakeRemote;
  extra: readonly string[];
}): Promise<{
  code: number;
  out: string[];
  diagnostic: string[];
}> {
  const out: string[] = [];
  const diagnostic: string[] = [];
  const code = await runGithubBranch({
    deps: depsFor({ diagnostic, door, out, remote }),
    rest: ["delete", "--repo", "o/r", "--branch", "old", "--expect-tip", TIP, "--home", tempHome(), ...extra],
  });
  return { code, diagnostic, out };
}

function remoteWithOld(): FakeRemote {
  const remote = fakeRemote();
  remote.branches.set("old", TIP);
  remote.commits.add(TIP);
  return remote;
}

describe("runGithubBranch", () => {
  it("is registered in the github noun as a door-routed external write", () => {
    expect(githubRefsManifest["branch"]!.meta.doorRouted).toBe(true);
    expect(githubRefsManifest["branch"]!.meta.effect).toBe("external-write");
  });

  it("dry-runs the tip and the tag step with no write", async () => {
    const remote = remoteWithOld();
    const result = await run({ extra: ["--keep-as-tag", "archive/old", "--dry-run"], remote });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      `would tag ${TIP} as archive/old, then delete o/r old at ${TIP}; to perform it, pass --expect-tip ${TIP}`,
    ]);
    expect(remote.branches.get("old")).toBe(TIP);
    expect(remote.tags.size).toBe(0);
  });

  it("tags the live tip and deletes in one atomic write, then confirms both", async () => {
    const remote = remoteWithOld();
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([`deleted o/r old at ${TIP}, kept as tag archive/old`]);
    expect(remote.tags.get("archive/old")).toBe(TIP);
    expect(remote.branches.has("old")).toBe(false);
    expect(remote.calls.filter((call) => call.startsWith("deleteBranchAtTip"))).toEqual(["deleteBranchAtTip:old"]);
  });

  it("refuses a real run when the branch moved after the dry run printed its tip", async () => {
    const remote = remoteWithOld();
    remote.branches.set("old", OTHER);
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([`refused: old is at ${OTHER}, not the --expect-tip ${TIP}; dry-run again`]);
    expect(remote.tags.size).toBe(0);
    expect(remote.branches.get("old")).toBe(OTHER);
  });

  it("deletes nothing when the door cannot record the delete", async () => {
    const remote = remoteWithOld();
    const result = await run({ door: unreachableDoorLedger(), extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("not performed:");
    expect(remote.branches.get("old")).toBe(TIP);
    expect(remote.calls.filter((call) => call.startsWith("deleteBranchAtTip"))).toEqual([]);
  });

  it("refuses an open pull request before any write", async () => {
    const remote = remoteWithOld();
    remote.openPrs.set("old", [12]);
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual(["refused: open pull request(s) #12 name old as base or head"]);
    expect(remote.branches.get("old")).toBe(TIP);
  });

  it("refuses when the branch moves between the preflight and the door", async () => {
    const remote = remoteWithOld();
    remote.afterTipRead.set(1, () => remote.branches.set("old", OTHER));
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `refused on a fresh read: old is at ${OTHER}, not the --expect-tip ${TIP}; dry-run again`,
    ]);
    expect(remote.tags.size).toBe(0);
    expect(remote.branches.get("old")).toBe(OTHER);
  });

  it("refuses when the keep-tag disappears between the printed plan and the door", async () => {
    const remote = remoteWithOld();
    remote.tags.set("archive/old", TIP);
    // Tip read 2 is the door's re-read, which reads the keep-tag straight after it.
    remote.afterTipRead.set(2, () => remote.tags.delete("archive/old"));
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "refused on a fresh read: tag archive/old disappeared since the plan was printed",
    ]);
    expect(remote.branches.get("old")).toBe(TIP);
    expect(remote.calls.filter((call) => call.startsWith("deleteBranchAtTip"))).toEqual([]);
  });

  it("changes nothing when a push lands after the last read, because the write names the tip it expects", async () => {
    const remote = remoteWithOld();
    remote.beforeAtomicWrite = () => remote.branches.set("old", OTHER);
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `the atomic tag-and-delete failed: github.graphql.updateRefs answered 500; branch old reads back at ${OTHER}, tag archive/old reads back absent`,
    ]);
    expect(remote.branches.get("old")).toBe(OTHER);
    expect(remote.tags.size).toBe(0);
  });

  it("reports the end state without claiming authorship when the update answered an error but the branch is gone", async () => {
    const remote = remoteWithOld();
    remote.lostAnswer.add("deleteBranchAtTip:old");
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      `gone: o/r old at ${TIP}, kept as tag archive/old; this run's write answered an error, so this run or another writer removed it`,
    ]);
    expect(remote.calls.filter((call) => call.startsWith("deleteBranchAtTip"))).toEqual(["deleteBranchAtTip:old"]);
  });

  it("names the update that may have landed when its answer is lost AND the read-back fails", async () => {
    const remote = remoteWithOld();
    remote.lostAnswer.add("deleteBranchAtTip:old");
    remote.failingAfterWrite.add("branchTip:old");
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "the atomic tag-and-delete failed: github.graphql.updateRefs answered 500; reading it back failed too " +
        "(github.git.getRef answered 500), so GitHub may or may not have applied it: either branch old deleted at " +
        `${TIP} and tag archive/old created at ${TIP}, or nothing changed`,
    ]);
  });

  it("never reports a branch gone when access was lost, because a 404 then proves nothing", async () => {
    const remote = remoteWithOld();
    remote.beforeAtomicWrite = () => {
      remote.accessLost = true;
    };
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "the atomic tag-and-delete failed: github.repos.get answered 500; reading it back failed too " +
        "(github.repos.get answered 500), so GitHub may or may not have applied it: either branch old deleted at " +
        `${TIP}, or nothing changed`,
    ]);
    expect(remote.branches.get("old")).toBe(TIP);
  });

  it("never reports a branch gone when access is lost between the read-back reads", async () => {
    const remote = remoteWithOld();
    remote.failing.add("deleteBranchAtTip:old");
    // Tip reads: the preflight, the in-door re-read, then the read-back; access goes right after the read-back's.
    remote.afterTipRead.set(3, () => {
      remote.accessLost = true;
    });
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "the atomic tag-and-delete failed: github.graphql.updateRefs answered 500; reading it back failed too " +
        "(github.repos.get answered 500), so GitHub may or may not have applied it: either branch old deleted at " +
        `${TIP}, or nothing changed`,
    ]);
    expect(remote.branches.get("old")).toBe(TIP);
  });

  it("never confirms an accepted delete off a 404 when access is lost before the read-back", async () => {
    const remote = remoteWithOld();
    remote.afterAcceptedWrite = () => {
      remote.branches.set("old", "b".repeat(40));
      remote.accessLost = true;
    };
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `the read-back after GitHub accepted deleting old at ${TIP} failed: github.repos.get answered 500`,
    ]);
    expect(result.out).toEqual([]);
  });

  it("names the deleted branch and tip when the read-back after an untagged delete fails", async () => {
    const remote = remoteWithOld();
    remote.failingAfterWrite.add("branchTip:old");
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `the read-back after GitHub accepted deleting old at ${TIP} failed: github.git.getRef answered 500`,
    ]);
  });

  it("keeps the branch when another writer removes an existing keep-tag before the atomic write", async () => {
    const remote = remoteWithOld();
    remote.tags.set("archive/old", TIP);
    remote.beforeAtomicWrite = () => remote.tags.delete("archive/old");
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `the atomic tag-and-delete failed: github.graphql.updateRefs answered 500; branch old reads back at ${TIP}, tag archive/old reads back absent`,
    ]);
    expect(remote.branches.get("old")).toBe(TIP);
  });

  it("names both refs when the read-back after an accepted update fails", async () => {
    const remote = remoteWithOld();
    remote.failingAfterWrite.add("branchTip:old");
    const result = await run({ extra: ["--keep-as-tag", "archive/old"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `the read-back after GitHub accepted deleting old at ${TIP} and creating tag archive/old there failed: github.git.getRef answered 500 — GitHub accepted tag archive/old at ${TIP}; read it back before any retry or cleanup`,
    ]);
    expect(remote.branches.has("old")).toBe(false);
    expect(remote.tags.get("archive/old")).toBe(TIP);
  });
});
