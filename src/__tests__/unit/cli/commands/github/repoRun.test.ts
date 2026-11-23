import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { okAsync, ResultAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type GithubRepoDeps, runGithubRepo } from "../../../../../cli/commands/github/repoRun.js";
import type { GithubRepoAdministrationApi } from "../../../../../outbound/github/repoAdministration.js";
import type { GithubRepoDescriptionApi, RepoDescription } from "../../../../../outbound/github/repoDescription.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const OLD: RepoDescription = { description: "old text", htmlUrl: "https://github.com/o/r" };
const NEW: RepoDescription = { description: "new text", htmlUrl: "https://github.com/o/r" };

/** A plain fake whose second read observes the write. */
function repoApi({ reads, sets }: { reads: RepoDescription[]; sets: string[] }): GithubRepoDescriptionApi {
  return {
    read: () => ResultAsync.fromSafePromise(Promise.resolve(reads.shift()!)),
    setDescription: ({ description }) => {
      sets.push(description);
      return ResultAsync.fromSafePromise(Promise.resolve(NEW));
    },
  };
}

function depsFor({
  door = memoryDoorLedger().port,
  home,
  reads,
  sets,
  out,
  diagnostic,
}: {
  door?: DoorLedgerPort;
  home: string;
  reads: RepoDescription[];
  sets: string[];
  out: string[];
  diagnostic: string[];
}): GithubRepoDeps {
  return {
    doorLedger: door,
    home: () => home,
    makeActionsPolicyApi: () => {
      throw new Error("a description or administration run must never build the Actions policy client");
    },
    makeAdministrationApi: () => administrationApi({ sent: administrationSent }),
    makeApi: () => repoApi({ reads, sets }),
    makeLifecycleApi: () => {
      throw new Error("a description or administration run must never build the lifecycle client");
    },
    makeManifestApi: () => {
      throw new Error("a description or administration run must never build the settings client");
    },
    freshCutGit: {
      readGit: () => {
        throw new Error("a description or administration run must never read Git");
      },
      writeGit: () => {
        throw new Error("a description or administration run must never push");
      },
    },
    out: (line) => out.push(line),
    readText: () => {
      throw new Error("a description or administration run must never read an apply artifact");
    },
    token: () => "token",
    transferWait: { attempts: 1, intervalMs: 0, sleep: async () => {} },
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

/** Every administration write the dispatch reached, so a description run can prove it reached none. */
let administrationSent: string[] = [];

/** A plain administration fake: reads answer one fixed repository, writes are recorded. */
function administrationApi({ sent }: { sent: string[] }): GithubRepoAdministrationApi {
  return {
    archive: ({ owner, repo }) => {
      sent.push(`archive ${owner}/${repo}`);
      return okAsync(undefined);
    },
    read: () =>
      okAsync({
        archived: false,
        fullName: "o/r",
        htmlUrl: "https://github.com/o/r",
        id: 1,
        name: "r",
        ownerLogin: "o",
      }),
    rename: ({ owner, repo, newName }) => {
      sent.push(`rename ${owner}/${repo} ${newName}`);
      return okAsync(undefined);
    },
    transfer: ({ owner, repo, newOwner }) => {
      sent.push(`transfer ${owner}/${repo} ${newOwner}`);
      return okAsync(undefined);
    },
  };
}

describe("runGithubRepo", () => {
  beforeEach(() => {
    administrationSent = [];
  });

  it("dispatches an administration flag to a preview that sends nothing", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sets: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-admin-dispatch-"));
    const code = await runGithubRepo({
      deps: depsFor({ diagnostic, home, out, reads: [], sets }),
      rest: ["--repo", "o/r", "--archive"],
    });

    expect(code).toBe(0);
    expect(sets).toEqual([]);
    expect(administrationSent).toEqual([]);
    expect(out[0]).toBe("preview: archive o/r (id 1, not archived)");
    rmSync(home, { force: true, recursive: true });
  });

  it("is a no-op when the live description already matches", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sets: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-noop-"));
    const code = await runGithubRepo({
      deps: depsFor({ diagnostic, home, out, reads: [NEW], sets }),
      rest: ["--repo", "o/r", "--description", "new text"],
    });

    expect(code).toBe(0);
    expect(sets).toEqual([]);
    expect(out).toEqual(["already set o/r  https://github.com/o/r"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("dry-runs after a live read and performs no mutation", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sets: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-dry-"));
    const code = await runGithubRepo({
      deps: depsFor({ diagnostic, home, out, reads: [OLD], sets }),
      rest: ["--repo", "o/r", "--description", "new text", "--dry-run"],
    });

    expect(code).toBe(0);
    expect(sets).toEqual([]);
    expect(out).toEqual(["would set o/r  https://github.com/o/r"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("routes the mutation through the door and confirms it by a second read", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sets: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-live-"));
    const code = await runGithubRepo({
      deps: depsFor({ diagnostic, home, out, reads: [OLD, NEW], sets }),
      rest: ["--repo", "o/r", "--description", "new text"],
    });

    expect(code).toBe(0);
    expect(sets).toEqual(["new text"]);
    expect(out).toEqual(["set o/r  https://github.com/o/r"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("performs no mutation when the door cannot record it", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sets: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-down-"));
    const code = await runGithubRepo({
      deps: depsFor({ diagnostic, door: unreachableDoorLedger(), home, out, reads: [OLD, NEW], sets }),
      rest: ["--repo", "o/r", "--description", "new text"],
    });

    expect(code).toBe(1);
    expect(sets).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
    rmSync(home, { force: true, recursive: true });
  });

  it("reports a usage error for a missing write without touching the network", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const code = await runGithubRepo({
      deps: depsFor({ diagnostic, home: "/unused", out, reads: [], sets: [] }),
      rest: ["--repo", "o/r"],
    });

    expect(code).toBe(2);
    expect(diagnostic[0]).toBe(
      "one of --description, --rename-to, --transfer-to, --archive, --create, --set-public, --apply-manifest, --enable-actions or --push-fresh-cut is " +
        'required (pass --description "" to clear it)',
    );
    expect(administrationSent).toEqual([]);
  });
});
