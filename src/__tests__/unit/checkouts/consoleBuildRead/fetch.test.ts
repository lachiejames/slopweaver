import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CLAIM_FETCHED, fetchClaims, fetchedStampName } from "../../../../checkouts/consoleBuild.js";
import {
  claims,
  NOW_MS,
  read,
  SHA_A,
  SHA_B,
  STARTED,
  stem,
  UPSTREAM_READ,
  useConsoleBuildRoots,
  worldAt,
} from "./harness.js";

const ORIGIN_MAIN = "+refs/heads/main:refs/remotes/origin/main";

useConsoleBuildRoots();

describe("readConsoleBuild", () => {
  it("fetches when no fetch is stamped, then reads the served build, HEAD, the upstream and its history", () => {
    const world = worldAt();
    const report = read({ world });
    expect(world.fetched).toEqual(["origin +refs/heads/main:refs/remotes/origin/main"]);
    expect(report.problems).toEqual([]);
    expect(report.served).toEqual({
      kind: "production",
      live: true,
      port: 3000,
      sha: SHA_B,
      slot: ".next-serve-a",
      startedIso: STARTED,
    });
    expect(report.head).toEqual({ sha: SHA_B });
    expect(report.upstream).toEqual({
      ahead: 0,
      behind: 1,
      fetchedAtIso: "2026-09-28T07:00:30.000Z",
      ref: "origin/main",
      sha: SHA_A,
    });
    expect(report.mainline.commits.map((commit) => commit.pullRequest!.number)).toEqual([2, 1]);
    expect(report.rebuild).toEqual({ logPath: `${stem}.refresh.log`, running: false, waiting: undefined });
  });

  it("does not fetch again inside a minute of the last success", () => {
    const world = worldAt();
    world.files.set(join(claims, fetchedStampName({ refspec: ORIGIN_MAIN, remote: "origin" })), {
      mtimeMs: NOW_MS - 30_000,
      text: "origin/main",
    });
    const report = read({ world });
    expect(world.fetches).toBe(0);
    expect(report.upstream!.fetchedAtIso).toBe("2026-09-28T07:00:00.000Z");
  });

  it("never dates a fetch of another upstream as this one's", () => {
    const world = worldAt();
    world.fetchFailure = "network down";
    world.files.set(join(claims, fetchedStampName({ refspec: ORIGIN_MAIN, remote: "fork" })), {
      mtimeMs: NOW_MS - 30_000,
      text: "origin/other",
    });
    const report = read({ world });
    expect(report.upstream!.fetchedAtIso).toBe(undefined);
    expect(report.problems).toEqual([
      "could not fetch origin/main (network down) — compared against the refs already on disk",
    ]);
  });

  it("says another reading is fetching when this minute's claim is taken", () => {
    const world = worldAt();
    world.claimRefused = true;
    const report = read({ world });
    expect(world.fetches).toBe(0);
    expect(report.problems).toEqual([
      "another reading fetched origin inside the last minute, so this one compares against the refs on disk",
    ]);
  });

  it("holds off when the previous minute's claim fetched under a minute ago", () => {
    const world = worldAt();
    const previous = join(claims, fetchClaims({ nowMs: NOW_MS }).previous);
    world.files.set(previous, { mtimeMs: NOW_MS - 20_000, text: CLAIM_FETCHED });
    const report = read({ world });
    expect(world.fetches).toBe(0);
    expect(report.problems).toEqual([
      "another reading fetched origin inside the last minute, so this one compares against the refs on disk",
    ]);
  });

  it("fetches a remote whose name holds a slash as git's config names it, never by splitting the ref", () => {
    const world = worldAt();
    world.git.set(UPSTREAM_READ, "refs/remotes/corp/team/main\tcorp/team/main\tcorp/team\trefs/heads/main");
    world.git.set("rev-parse refs/remotes/corp/team/main", SHA_A);
    world.git.set("remote get-url corp/team", "git@github.com:lachiejames/slopweaver.git");
    const report = read({ world });
    expect(world.fetched).toEqual(["corp/team +refs/heads/main:refs/remotes/corp/team/main"]);
    expect(report.upstream!.ref).toBe("corp/team/main");
    expect(report.mainline.commits[0]!.pullRequest!.url).toBe("https://github.com/lachiejames/slopweaver/pull/2");
  });

  it("names an upstream with no remote rather than fetching", () => {
    const world = worldAt();
    world.git.set(UPSTREAM_READ, "refs/heads/trunk\ttrunk\t.\trefs/heads/trunk");
    world.git.set("rev-parse refs/heads/trunk", SHA_A);
    const report = read({ world });
    expect(world.fetches).toBe(0);
    expect(report.problems[0]).toBe("the upstream trunk names no remote, so nothing was fetched");
  });
});
