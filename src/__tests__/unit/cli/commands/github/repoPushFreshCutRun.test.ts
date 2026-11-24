import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { writePushRootBinding } from "../../../../../admit/pushRootStore.js";
import { type FreshCutPushGit, parseRemoteRefs } from "../../../../../cli/commands/github/repoPushFreshCutRun.js";
import { runGithubRepo } from "../../../../../cli/commands/github/repoRun.js";
import { writeFreshCutRecord, writeFreshCutVerification } from "../../../../../freshCut/store.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { approvedRepoDeps, type LifecycleWorld, lifecycleState } from "../../../../githubRepoWriteFakes.js";

const RECORD_ID = "0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const ROOT = "a".repeat(40);
const TREE = "b".repeat(40);
const OLD = "c".repeat(40);
const DESTINATION = "/cut/acme-widget";
const URL = "git@github.com:acme/widget.git";
const REST = ["--repo", "acme/widget", "--push-fresh-cut", RECORD_ID];

/** One commit the fake cut repository holds. */
interface FakeCommit {
  readonly parents: readonly string[];
  readonly tree: string;
}

/** The fake cut repository and remote the Git edges answer from. */
interface GitWorld {
  readonly commits: Map<string, FakeCommit>;
  remoteRefs: { sha: string; ref: string }[];
  readonly pushes: string[];
  /** When set, a push fails with this line and changes nothing. */
  pushFails?: string;
  /** When true, a push is accepted but the remote's refs do not change. */
  pushIgnored?: boolean;
  /** Runs once, just after the next `ls-remote` answered: another actor acting between two reads. */
  afterNextRefRead?: (() => void) | undefined;
}

/** Git edges over one world: the three reads the push makes, and the push. */
function gitFake({ world }: { world: GitWorld }): FreshCutPushGit {
  return {
    readGit: ({ args }) => {
      const [command, ...rest] = args;
      if (command === "ls-remote") {
        const text = world.remoteRefs.map((entry) => `${entry.sha}\t${entry.ref}`).join("\n");
        const after = world.afterNextRefRead;
        world.afterNextRefRead = undefined;
        after?.();
        return text;
      }
      const name = rest[rest.length - 1]!.replace(/\^\{(commit|tree)\}$/, "");
      const commit = world.commits.get(name);
      if (commit === undefined) {
        throw new Error(`fatal: bad object ${name}`);
      }
      if (command === "rev-list") {
        return [name, ...commit.parents].join(" ");
      }
      return commit.tree;
    },
    writeGit: ({ args }) => {
      world.pushes.push(args.join(" "));
      if (world.pushFails !== undefined) {
        return err(world.pushFails);
      }
      if (world.pushIgnored !== true) {
        const [source, ref] = args[args.length - 1]!.split(":");
        world.remoteRefs.push({ ref: ref!, sha: source! }, { ref: "HEAD", sha: source! });
      }
      return ok(undefined);
    },
  };
}

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A home holding the cut's record and, unless `bound` is null, a push-root binding. */
function homeWith({ bound = ROOT }: { bound?: string | null } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-push-fresh-cut-"));
  homes.push(home);
  unwrap(
    writeFreshCutRecord({
      home,
      record: {
        destination: DESTINATION,
        login: "acme",
        producedAtIso: "2026-11-23T10:00:00.000Z",
        recordId: RECORD_ID,
        rootSha: ROOT,
        schemaVersion: 1,
        source: "/checkout/acme-widget",
        sourceCommitterDate: "1763892000 +0000",
        sourceSha: "d".repeat(40),
        treeSha: TREE,
      },
    }),
  );
  if (bound !== null) {
    unwrap(
      writePushRootBinding({
        binding: { recordedAtIso: "2026-11-23T10:05:00.000Z", repository: "acme/widget", rootSha: bound },
        home,
      }),
    );
  }
  return home;
}

/** A cut repository holding the parentless root over the recorded tree, and an empty remote. */
function gitWorld(over: Partial<GitWorld> = {}): GitWorld {
  return {
    commits: new Map([[ROOT, { parents: [], tree: TREE }]]),
    pushes: [],
    remoteRefs: [],
    ...over,
  };
}

/** A lifecycle world holding one private repository, `acme/widget`. */
function lifecycleWorld(over: Partial<LifecycleWorld> = {}): LifecycleWorld {
  return {
    accounts: new Map(),
    me: { id: 10, login: "acme", type: "User" },
    nextId: 1,
    repos: new Map([["acme/widget", lifecycleState()]]),
    sent: [],
    ...over,
  };
}

/** Run one `github repo` invocation. */
async function run({
  rest,
  home,
  git,
  lifecycle = lifecycleWorld(),
  door = memoryDoorLedger().port,
}: {
  rest: readonly string[];
  home: string;
  git: GitWorld;
  lifecycle?: LifecycleWorld;
  door?: DoorLedgerPort;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
  const out: string[] = [];
  const diagnostic: string[] = [];
  const deps = approvedRepoDeps({ diagnostic, door, freshCutGit: gitFake({ world: git }), home, lifecycle, out });
  const code = await runGithubRepo({ deps, rest });
  return { code, diagnostic, out };
}

/** A door that admits the write and, just before, lets another actor change what the send will read. */
function admittingThen({ act }: { act: () => void }): DoorLedgerPort {
  const memory = memoryDoorLedger();
  return {
    ...memory.port,
    appendDecision: (request) => {
      act();
      return memory.port.appendDecision(request);
    },
  };
}

/** The digest a `--json` preview prints. */
async function previewDigest({ home, git }: { home: string; git: GitWorld }): Promise<string> {
  const preview = await run({ git, home, rest: [...REST, "--json"] });
  return (JSON.parse(preview.out[0]!) as { digest: string }).digest;
}

describe("github repo --push-fresh-cut", () => {
  it("previews the push of the root as main and sends nothing", async () => {
    const git = gitWorld();
    const result = await run({ git, home: homeWith(), rest: REST });

    expect(result.code).toBe(0);
    expect(git.pushes).toEqual([]);
    expect(result.out[0]).toBe(
      `preview: push cut ${RECORD_ID}'s root ${ROOT} to acme/widget (id 101, private) as main`,
    );
  });

  it("pushes exactly the root to main on the preview's digest and confirms one ref at the root", async () => {
    const git = gitWorld();
    const home = homeWith();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ git, home });
    const result = await run({ door: door.port, git, home, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(0);
    expect(git.pushes).toEqual([`-c core.hooksPath=/dev/null push ${URL} ${ROOT}:refs/heads/main`]);
    expect(result.out).toEqual([
      `confirmed: acme/widget main is ${ROOT}: one branch holding one parentless commit  https://github.com/acme/widget`,
    ]);
    expect(door.records().length).toBe(1);
  });

  it("pushes to the private repository even when the cut's latest verification refused", async () => {
    const git = gitWorld();
    const home = homeWith();
    unwrap(
      writeFreshCutVerification({
        home,
        verification: {
          destinationTreeSha: TREE,
          exemptions: { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 },
          filesScanned: 3,
          findings: [{ kind: "hygiene", label: "token", line: 1, path: "a.ts" }],
          recordId: RECORD_ID,
          reviewedAccepted: 0,
          reviewedResidueSha256: "e".repeat(64),
          schemaVersion: 2,
          sourceTreeSha: TREE,
          status: "refused",
          verifiedAtIso: "2026-11-23T11:00:00.000Z",
        },
      }),
    );
    const approve = await previewDigest({ git, home });
    const result = await run({ git, home, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(0);
    expect(git.pushes.length).toBe(1);
  });

  it("refuses at the send when a ref appeared between the approved run's read and the push", async () => {
    const git = gitWorld();
    const home = homeWith();
    const approve = await previewDigest({ git, home });
    git.afterNextRefRead = () => git.remoteRefs.push({ ref: "refs/tags/v1", sha: OLD });
    const result = await run({ git, home, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(git.pushes).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("it now holds refs/tags/v1");
  });

  it("refuses at the send when the repository reads public once the door admits the approved write", async () => {
    const git = gitWorld();
    const home = homeWith();
    const lifecycle = lifecycleWorld();
    const approve = await previewDigest({ git, home });
    const door = admittingThen({
      act: () => lifecycle.repos.set("acme/widget", lifecycleState({ private: false, visibility: "public" })),
    });
    const result = await run({ door, git, home, lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(git.pushes).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain(
      "it reads public, and a fresh cut is pushed only to a private repository",
    );
  });

  it("refuses at the send when the repository is archived once the door admits the approved write", async () => {
    const git = gitWorld();
    const home = homeWith();
    const lifecycle = lifecycleWorld();
    const approve = await previewDigest({ git, home });
    const door = admittingThen({ act: () => lifecycle.repos.set("acme/widget", lifecycleState({ archived: true })) });
    const result = await run({ door, git, home, lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(git.pushes).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("it is archived");
  });

  // The register refuses a rebind, so a binding that changes under an approved write is one its file lost.
  it("refuses at the send when the repository's binding is gone once the door admits the write", async () => {
    const git = gitWorld();
    const home = homeWith();
    const approve = await previewDigest({ git, home });
    const door = admittingThen({ act: () => rmSync(stateHomePaths({ home }).pushRootsJson) });
    const result = await run({ door, git, home, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(git.pushes).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("the push-root register binds it to no root");
  });

  it("refuses at the send when the repository's id moved once the door admits the approved write", async () => {
    const git = gitWorld();
    const home = homeWith();
    const lifecycle = lifecycleWorld();
    const approve = await previewDigest({ git, home });
    const door = admittingThen({ act: () => lifecycle.repos.set("acme/widget", lifecycleState({ id: 202 })) });
    const result = await run({ door, git, home, lifecycle, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(git.pushes).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain(
      "it now reads as acme/widget (id 202), not the approved acme/widget (id 101)",
    );
  });

  it("refuses a repository the push-root register does not bind", async () => {
    const git = gitWorld();
    const result = await run({ git, home: homeWith({ bound: null }), rest: REST });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("the push-root register binds it to no root");
  });

  it("refuses a repository bound to another root", async () => {
    const git = gitWorld();
    const result = await run({ git, home: homeWith({ bound: OLD }), rest: REST });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain(`binds it to ${OLD}, not this cut's root ${ROOT}`);
  });

  it("refuses a root that has a parent", async () => {
    const git = gitWorld({ commits: new Map([[ROOT, { parents: [OLD], tree: TREE }]]) });
    const result = await run({ git, home: homeWith(), rest: REST });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain(`${ROOT} has 1 parent(s), so it is not a root`);
  });

  it("refuses a root over a tree other than the recorded one", async () => {
    const git = gitWorld({ commits: new Map([[ROOT, { parents: [], tree: OLD }]]) });
    const result = await run({ git, home: homeWith(), rest: REST });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain(`${ROOT} is over tree ${OLD}, not the recorded ${TREE}`);
  });

  it("refuses a repository that reads public", async () => {
    const git = gitWorld();
    const lifecycle = lifecycleWorld({
      repos: new Map([["acme/widget", lifecycleState({ private: false, visibility: "public" })]]),
    });
    const result = await run({ git, home: homeWith(), lifecycle, rest: REST });

    expect(result.code).toBe(1);
    expect(git.pushes).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("it reads public, and a fresh cut is pushed only to a private");
  });

  it("refuses a repository that already holds a ref", async () => {
    const git = gitWorld({ remoteRefs: [{ ref: "refs/heads/main", sha: OLD }] });
    const result = await run({ git, home: homeWith(), rest: REST });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("it already holds refs/heads/main");
  });

  it("refuses a cut record that does not exist", async () => {
    const git = gitWorld();
    const rest = ["--repo", "acme/widget", "--push-fresh-cut", "11111111-2222-4333-8444-555555555555"];
    const result = await run({ git, home: homeWith(), rest });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("re-cut records say could not be read");
  });

  it("holds the approval when a ref appeared on the remote since the preview", async () => {
    const git = gitWorld();
    const home = homeWith();
    const approve = await previewDigest({ git, home });
    git.remoteRefs.push({ ref: "refs/heads/other", sha: OLD });
    const result = await run({ git, home, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(git.pushes).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("it already holds refs/heads/other");
  });

  it("reports a push git accepted whose refs do not read back as main at the root", async () => {
    const git = gitWorld();
    const home = homeWith();
    const approve = await previewDigest({ git, home });
    git.pushIgnored = true;
    const result = await run({ git, home, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("its refs read back as none, not main at the root alone");
  });

  it("reports a push git refused, naming how it ended", async () => {
    const git = gitWorld();
    const home = homeWith();
    const approve = await previewDigest({ git, home });
    git.pushFails = "git exited 128";
    const result = await run({ git, home, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(result.diagnostic.join("\n")).toContain("git push failed: git exited 128");
  });

  it("refuses a record id that is not a UUID before reading anything", async () => {
    const git = gitWorld();
    const result = await run({ git, home: homeWith(), rest: ["--repo", "acme/widget", "--push-fresh-cut", "abc"] });

    expect(result.code).toBe(2);
    expect(result.diagnostic[0]).toBe("--push-fresh-cut takes the cut's record id, the UUID fresh-cut produce printed");
  });
});

describe("parseRemoteRefs", () => {
  it("drops HEAD and keeps every other ref", () => {
    const parsed = parseRemoteRefs({ text: `${ROOT}\tHEAD\n${ROOT}\trefs/heads/main\n` });

    expect(unwrap(parsed)).toEqual([{ ref: "refs/heads/main", sha: ROOT }]);
  });

  it("reads an empty repository as no refs", () => {
    expect(unwrap(parseRemoteRefs({ text: "" }))).toEqual([]);
  });

  it("refuses a line that is not a sha and a ref", () => {
    const parsed = parseRemoteRefs({ text: "warning: something\n" });

    expect(unwrapErr(parsed)).toBe("warning: something");
  });
});
