import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { GithubRefsErrors } from "../../../../../cli/commands/github/refsErrors.js";
import {
  parseGithubTagArgs,
  planTagCreate,
  tagCreateDoorRequest,
} from "../../../../../cli/commands/github/tagCreateCore.js";
import { type GithubTagDeps, runGithubTag } from "../../../../../cli/commands/github/tagCreateRun.js";
import { githubRefsManifest } from "../../../../../cli/manifests/githubRefs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { FAKE_ANNOTATION, type FakeRemote, fakeRefsApi, fakeRemote } from "./refsFake.js";

const SHA = "c".repeat(40);
const OTHER = "d".repeat(40);

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-tag-"));
  homes.push(home);
  return home;
}

describe("parseGithubTagArgs", () => {
  it("resolves an annotated tag request", () => {
    expect(
      unwrap(
        parseGithubTagArgs({
          argv: ["create", "--repo", "o/r", "--tag", "retired/x", "--sha", SHA, "--message", "why", "--json"],
        }),
      ),
    ).toEqual({
      dryRun: false,
      home: undefined,
      json: true,
      message: "why",
      owner: "o",
      repo: "r",
      sha: SHA,
      tag: "retired/x",
    });
  });

  it("refuses an abbreviated sha, a missing tag and a blank message, together", () => {
    expect(
      githubVerbErrorLines({
        error: unwrapErr(
          parseGithubTagArgs({ argv: ["create", "--repo", "o/r", "--sha", "33ca14ac3b", "--message", " "] }),
        ),
      }),
    ).toEqual([
      "--tag is required",
      "--sha must be a full 40-character lowercase commit sha",
      "--message must not be blank",
    ]);
  });
});

describe("planTagCreate", () => {
  it("creates, reports a same-commit tag as present, and refuses the rest by name", () => {
    expect(planTagCreate({ commitOnRemote: true, existingCommit: undefined, sha: SHA, tag: "t" })).toEqual({
      kind: "create",
    });
    expect(planTagCreate({ commitOnRemote: true, existingCommit: SHA, sha: SHA, tag: "t" })).toEqual({
      kind: "present",
    });
    expect(planTagCreate({ commitOnRemote: true, existingCommit: OTHER, sha: SHA, tag: "t" })).toEqual({
      kind: "refuse",
      reason: `tag t already points at ${OTHER}, not ${SHA}`,
    });
    expect(planTagCreate({ commitOnRemote: false, existingCommit: undefined, sha: SHA, tag: "t" })).toEqual({
      kind: "refuse",
      reason: `the remote does not hold commit ${SHA} — this verb writes a ref and pushes no objects`,
    });
  });
});

describe("tagCreateDoorRequest and GithubRefsErrors", () => {
  it("names the exact tag ref as an external write", () => {
    const args = unwrap(parseGithubTagArgs({ argv: ["create", "--repo", "o/r", "--tag", "t", "--sha", SHA] }));
    expect(tagCreateDoorRequest({ args, home: "/h" })).toEqual({
      action: { kind: "verb", noun: "github", verb: "tag" },
      artifact: { id: "o/r:refs/tags/t" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });

  it("carries what GitHub accepted on every post-write failure", () => {
    expect(GithubRefsErrors.providerFailed({ cause: "500", kept: { tag: "k", tip: SHA }, step: "the delete" })).toEqual(
      {
        code: "REF_PROVIDER_FAILED",
        message: `the delete failed: 500 — GitHub accepted tag k at ${SHA}; read it back before any retry or cleanup`,
      },
    );
    expect(
      GithubRefsErrors.unconfirmed({ expected: SHA, kept: undefined, readBack: "undefined", ref: "tag t" }),
    ).toEqual({
      code: "REF_UNCONFIRMED",
      message: `GitHub accepted the write but tag t reads back undefined, not ${SHA}`,
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
}): GithubTagDeps {
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
  const code = await runGithubTag({
    deps: depsFor({ diagnostic, door, out, remote }),
    rest: ["create", "--repo", "o/r", "--tag", "retired/x", "--sha", SHA, "--home", tempHome(), ...extra],
  });
  return { code, diagnostic, out };
}

describe("runGithubTag", () => {
  it("is registered in the github noun as a door-routed external write", () => {
    expect(githubRefsManifest["tag"]!.meta.doorRouted).toBe(true);
    expect(githubRefsManifest["tag"]!.meta.effect).toBe("external-write");
  });

  it("dry-runs with no write", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    const result = await run({ extra: ["--dry-run"], remote });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([`would create o/r tag retired/x at ${SHA}`]);
    expect(remote.tags.size).toBe(0);
  });

  it("creates the tag once and confirms it", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    const result = await run({ extra: ["--message", "archive"], remote });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([`created o/r tag retired/x at ${SHA} (annotation object ${FAKE_ANNOTATION})`]);
    expect(remote.tags.get("retired/x")).toBe(SHA);
    expect(remote.calls.filter((call) => call.startsWith("createTag"))).toEqual(["createTag:retired/x"]);
  });

  it("writes nothing when the tag is already at that commit", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.tags.set("retired/x", SHA);
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([`already there: o/r tag retired/x at ${SHA}`]);
    expect(remote.calls.filter((call) => call.startsWith("createTag"))).toEqual([]);
  });

  it("creates nothing when the door cannot record the tag", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    const result = await run({ door: unreachableDoorLedger(), extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("not performed:");
    expect(remote.tags.size).toBe(0);
    expect(remote.calls.filter((call) => call.startsWith("createTag"))).toEqual([]);
  });

  it("refuses a commit the remote does not hold", async () => {
    const remote = fakeRemote();
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `refused: the remote does not hold commit ${SHA} — this verb writes a ref and pushes no objects`,
    ]);
    expect(remote.tags.size).toBe(0);
  });

  it("names a failed write", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.failing.add("createTag:retired/x");
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "tagging failed: github.git.createRef answered 500; tag retired/x reads back absent",
    ]);
  });

  it("reports the end state without claiming authorship when the write answered an error but the tag is there", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.lostAnswer.add("createTag:retired/x");
    const result = await run({ extra: ["--message", "archive"], remote });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      `there now: o/r tag retired/x at ${SHA}; this run's write answered an error, so this run or another writer made it`,
    ]);
    expect(result.diagnostic).toEqual(["this run's write answered: github.git.createRef answered 500"]);
    expect(remote.calls.filter((call) => call.startsWith("createTag"))).toEqual(["createTag:retired/x"]);
  });

  it("names the annotation object it made when the accepted tag is gone by the read-back", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.afterAcceptedWrite = () => {
      remote.tags.delete("retired/x");
    };
    const result = await run({ extra: ["--message", "archive"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `GitHub accepted the write but tag retired/x (annotation object ${FAKE_ANNOTATION} was created) reads back ` +
        `absent, not ${SHA}`,
    ]);
  });

  it("names the annotation object it made when the read-back after an accepted tag fails", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.failingAfterWrite.add("tagCommit:retired/x");
    const result = await run({ extra: ["--message", "archive"], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `the read-back after GitHub accepted the tag (annotation object ${FAKE_ANNOTATION} was created) failed: ` +
        `github.git.getRef answered 500 — GitHub accepted tag retired/x at ${SHA}; read it back before any retry or cleanup`,
    ]);
  });

  it("never reads a tag absent off a 404 when access is lost after an errored write", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.lostAnswer.add("createTag:retired/x");
    remote.afterAcceptedWrite = () => {
      remote.accessLost = true;
    };
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "tagging failed: github.git.createRef answered 500; reading it back failed too " +
        `(github.repos.get answered 500), so GitHub may or may not have made tag retired/x at ${SHA}`,
    ]);
  });

  it("never reads a tag absent off a 404 when access is lost after an accepted write", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.afterAcceptedWrite = () => {
      remote.accessLost = true;
    };
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "the read-back after GitHub accepted the tag failed: github.repos.get answered 500 — GitHub accepted tag " +
        `retired/x at ${SHA}; read it back before any retry or cleanup`,
    ]);
  });

  it("names the tag that may have landed when its answer is lost AND the read-back fails", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.lostAnswer.add("createTag:retired/x");
    remote.failingAfterWrite.add("tagCommit:retired/x");
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      "tagging failed: github.git.createRef answered 500; reading it back failed too (github.git.getRef answered " +
        `500), so GitHub may or may not have made tag retired/x at ${SHA}`,
    ]);
  });

  it("names the tag it made when the read-back after an accepted write fails", async () => {
    const remote = fakeRemote();
    remote.commits.add(SHA);
    remote.failingAfterWrite.add("tagCommit:retired/x");
    const result = await run({ extra: [], remote });

    expect(result.code).toBe(1);
    expect(result.diagnostic).toEqual([
      `the read-back after GitHub accepted the tag failed: github.git.getRef answered 500 — GitHub accepted tag retired/x at ${SHA}; read it back before any retry or cleanup`,
    ]);
    expect(remote.tags.get("retired/x")).toBe(SHA);
  });
});
