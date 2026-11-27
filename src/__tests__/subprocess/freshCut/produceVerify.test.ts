/**
 * `fresh-cut produce` and `verify` over real git. A source repository carries history the cut must not, an
 * untracked file, an ignored file and an uncommitted edit; the cut must hold exactly the named commit's tree as ONE
 * parentless commit signed with the injected identity, own every object it needs, and carry nothing else. A hostile
 * caller environment (a global config naming another identity, signing on, a hook that fails, `GIT_*` identity
 * variables) must change nothing. `verify` must refuse a tree difference and find an owner-address term.
 *
 * The identity is injected exactly as the shell injects the live GitHub read; its address is computed from
 * synthetic values, never written as a literal.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FRESH_CUT_MESSAGE, type FreshCutRecord } from "../../../freshCut/core.js";
import { produceFreshCut } from "../../../freshCut/produce.js";
import { verifyFreshCut } from "../../../freshCut/verify.js";
import { SOURCE_REPOSITORY } from "../../../hygiene/ownRepository.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { githubNoReplyAddress } from "../../../live/github/viewerIdentity.js";
import { writePrivateTerms } from "../../privateTermsFixture.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../tempGitRepo.js";

const LOGIN = "acme-dev";
const ADDRESS = githubNoReplyAddress({ identity: { databaseId: 4242, login: LOGIN } });
const IDENTITY = { address: ADDRESS, login: LOGIN };
const RECORD_ID = "0b7e7f8e-1f4a-4c2b-9d3e-5a6b7c8d9e0f";
const NOW = new Date("2026-11-20T01:02:03.000Z");

/** A transcripts root nothing is written under: these cuts carry no anchored entry for a verify to resolve. */
const noTranscripts = (): string => join(tmpdir(), "no-transcripts-here");

/** The hostile caller environment every test runs under, restored afterwards. */
const HOSTILE_ENV = ["GIT_CONFIG_GLOBAL", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL", "GIT_AUTHOR_NAME"] as const;

const roots: string[] = [];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of HOSTILE_ENV) {
    saved.set(name, process.env[name]);
  }
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** One commit in the fixture repository, as a synthetic committer. */
function commit({ repo, message }: { repo: string; message: string }): string {
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: ["commit", "-q", "-m", message], cwd: repo });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
}

/**
 * A fixture: a source repository whose first commit holds a file the second deletes, plus an untracked file, an
 * ignored file and an uncommitted edit; a side branch off main; and a hostile global config the cut must ignore.
 */
function fixture(): { root: string; repo: string; tip: string; firstOnly: string; side: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), "fresh-cut-"));
  roots.push(root);
  const repo = join(root, "source");
  gitInTemp({ args: ["init", "-q", "-b", "main", repo], cwd: root });
  gitInTemp({ args: ["config", "user.email", "fixture@example.invalid"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "Fixture"], cwd: repo });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: repo });
  writeFileSync(join(repo, "history-only.txt"), "this blob lives only in the first commit\n");
  writeFileSync(join(repo, "a.txt"), "one\n");
  commit({ message: "first", repo });
  const firstOnly = gitInTemp({ args: ["rev-parse", "HEAD:history-only.txt"], cwd: repo });
  rmSync(join(repo, "history-only.txt"));
  mkdirSync(join(repo, "nested"));
  writeFileSync(join(repo, "nested", "b.txt"), "two\n");
  writeFileSync(join(repo, ".gitignore"), "ignored.log\n");
  const tip = commit({ message: "second", repo });
  gitInTemp({ args: ["checkout", "-q", "-b", "side"], cwd: repo });
  writeFileSync(join(repo, "side.txt"), "side\n");
  const side = commit({ message: "side", repo });
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: repo });
  writeFileSync(join(repo, "untracked.txt"), "untracked\n");
  writeFileSync(join(repo, "ignored.log"), "ignored\n");
  writeFileSync(join(repo, "a.txt"), "edited but never committed\n");

  const hooks = join(root, "hooks");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const hostile = join(root, "hostile.gitconfig");
  writeFileSync(
    hostile,
    `[user]\n\temail = leak@example.invalid\n\tname = Leak\n[commit]\n\tgpgSign = true\n[core]\n\thooksPath = ${hooks}\n`,
  );
  process.env["GIT_CONFIG_GLOBAL"] = hostile;
  process.env["GIT_AUTHOR_EMAIL"] = "leak@example.invalid";
  process.env["GIT_COMMITTER_EMAIL"] = "leak@example.invalid";
  process.env["GIT_AUTHOR_NAME"] = "Leak";

  const home = join(root, "home");
  mkdirSync(home);
  return { firstOnly, home, repo, root, side, tip };
}

/** Produce a cut of `tip` into `<root>/<name>`. */
function produce({ root, repo, tip, name }: { root: string; repo: string; tip: string; name: string }): FreshCutRecord {
  return unwrap(
    produceFreshCut({
      commit: tip,
      destination: join(root, name),
      identity: IDENTITY,
      now: NOW,
      recordId: RECORD_ID,
      source: repo,
    }),
  );
}

describe("produceFreshCut", REAL_GIT_SUITE, () => {
  it("writes ONE parentless commit over exactly the tip's tree, signed as the injected identity", () => {
    const { repo, root, tip } = fixture();
    const record = produce({ name: "cut", repo, root, tip });
    const cut = record.destination;

    expect(record.sourceSha).toBe(tip);
    expect(record.treeSha).toBe(gitInTemp({ args: ["rev-parse", `${tip}^{tree}`], cwd: repo }));
    expect(gitInTemp({ args: ["rev-parse", "HEAD^{tree}"], cwd: cut })).toBe(record.treeSha);
    expect(gitInTemp({ args: ["rev-list", "--all", "--count"], cwd: cut })).toBe("1");
    expect(gitInTemp({ args: ["rev-list", "--parents", "-n", "1", "HEAD"], cwd: cut })).toBe(record.rootSha);
    expect(gitInTemp({ args: ["show", "-s", "--format=%an|%ae|%cn|%ce|%B", "HEAD"], cwd: cut })).toBe(
      `${LOGIN}|${ADDRESS}|${LOGIN}|${ADDRESS}|${FRESH_CUT_MESSAGE}`,
    );
    expect(gitInTemp({ args: ["for-each-ref", "--format=%(refname)"], cwd: cut })).toBe("refs/heads/main");
    expect(gitInTemp({ args: ["remote"], cwd: cut })).toBe("");
  });

  it("carries only tracked files: no untracked, ignored or uncommitted content, and no history object", () => {
    const { firstOnly, repo, root, tip } = fixture();
    const cut = produce({ name: "cut", repo, root, tip }).destination;

    expect(gitInTemp({ args: ["ls-files"], cwd: cut }).split("\n")).toEqual([".gitignore", "a.txt", "nested/b.txt"]);
    expect([existsSync(join(cut, "untracked.txt")), existsSync(join(cut, "ignored.log"))]).toEqual([false, false]);
    expect(readFileSync(join(cut, "a.txt"), "utf8")).toBe("one\n");
    expect(() => gitInTemp({ args: ["cat-file", "-e", firstOnly], cwd: cut })).toThrow();
    expect(
      ["objects/info/alternates", "ORIG_HEAD", "logs", "hooks"].map((path) => existsSync(join(cut, ".git", path))),
    ).toEqual([false, false, false, false]);
    expect(gitInTemp({ args: ["fsck", "--full", "--no-dangling"], cwd: cut })).toBe("");
    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: cut })).toBe("");
  });

  it("is reproducible: a second cut of the same commit has the same root SHA", () => {
    const { repo, root, tip } = fixture();
    expect(produce({ name: "cut-a", repo, root, tip }).rootSha).toBe(
      produce({ name: "cut-b", repo, root, tip }).rootSha,
    );
  });

  it("refuses a ref name, a commit off main, a destination inside a checkout and a non-empty destination", () => {
    const { repo, root, side, tip } = fixture();
    const attempt = ({ commit: given, destination }: { commit: string; destination: string }) =>
      unwrapErr(
        produceFreshCut({
          commit: given,
          destination,
          identity: IDENTITY,
          now: NOW,
          recordId: RECORD_ID,
          source: repo,
        }),
      ).code;
    const occupied = join(root, "occupied");
    mkdirSync(occupied);
    writeFileSync(join(occupied, "x"), "x\n");

    expect([
      attempt({ commit: "main", destination: join(root, "c1") }),
      attempt({ commit: side, destination: join(root, "c2") }),
      attempt({ commit: tip, destination: join(repo, "nested", "inside") }),
      attempt({ commit: tip, destination: occupied }),
      attempt({ commit: tip, destination: "relative/cut" }),
    ]).toEqual([
      "COMMIT_INVALID",
      "COMMIT_NOT_ON_MAIN",
      "DESTINATION_REFUSED",
      "DESTINATION_REFUSED",
      "DESTINATION_REFUSED",
    ]);
    expect([
      existsSync(join(root, "c1")),
      existsSync(join(root, "c2")),
      existsSync(join(repo, "nested", "inside")),
    ]).toEqual([false, false, false]);
  });
});

describe("verifyFreshCut", REAL_GIT_SUITE, () => {
  it("is clear on a clean cut, every file scanned", () => {
    const { home, repo, root, tip } = fixture();
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const record = produce({ name: "cut", repo, root, tip });

    const { verification } = unwrap(
      verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }),
    );
    expect([verification.status, verification.filesScanned, verification.findings]).toEqual(["clear", 3, []]);
  });

  it("scans every path of a blob two files share, which its one batch asks git for twice", () => {
    const { home, repo, root } = fixture();
    writeFileSync(join(repo, "copy.txt"), "one\n");
    gitInTemp({ args: ["add", "copy.txt"], cwd: repo });
    gitInTemp({ args: ["commit", "-q", "-m", "copy"], cwd: repo });
    const tip = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const record = produce({ name: "cut", repo, root, tip });

    expect(gitInTemp({ args: ["rev-parse", `${tip}:a.txt`], cwd: repo })).toBe(
      gitInTemp({ args: ["rev-parse", `${tip}:copy.txt`], cwd: repo }),
    );
    const { verification } = unwrap(
      verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }),
    );
    expect([verification.status, verification.filesScanned, verification.findings]).toEqual(["clear", 4, []]);
  });

  it("finds an owner-address term in a committed file, with no outbound exemption", () => {
    const { home, repo, root } = fixture();
    writeFileSync(join(repo, "AUTHORS"), `maintainer <${ADDRESS}>\n`);
    gitInTemp({ args: ["add", "AUTHORS"], cwd: repo });
    gitInTemp({ args: ["commit", "-q", "-m", "authors"], cwd: repo });
    const tip = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
    const escaped = ADDRESS.replaceAll(".", "\\.").replaceAll("+", "\\+");
    writePrivateTerms({ home, rows: [`owner-address\ti\t${escaped}\tsynthetic`] });
    const record = produce({ name: "cut", repo, root, tip });

    const { verification } = unwrap(
      verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }),
    );
    expect([verification.status, verification.findings]).toEqual([
      "refused",
      [{ className: "owner-address", kind: "private-term", line: 1, path: "AUTHORS" }],
    ]);
  });

  it("exempts the own address and a TEST-NET address, counting each, while the bare owner still refuses", () => {
    const { home, repo, root } = fixture();
    const owner = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));
    writeFileSync(join(repo, "NOTES"), `clone ${SOURCE_REPOSITORY}\nhost 192.0.2.7\nby ${owner}\n`);
    gitInTemp({ args: ["add", "NOTES"], cwd: repo });
    gitInTemp({ args: ["commit", "-q", "-m", "notes"], cwd: repo });
    const tip = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
    writePrivateTerms({
      home,
      rows: [`owner-handle\ti\t${owner}\tsynthetic`, "place\t-\t\\d{1,3}(?:\\.\\d{1,3}){3}\tsynthetic"],
    });
    const record = produce({ name: "cut", repo, root, tip });

    const { verification } = unwrap(
      verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }),
    );
    expect([verification.status, verification.exemptions, verification.findings]).toEqual([
      "refused",
      { "code-owner": 0, "documentation-address": 1, "own-address": 1, "owner-reference": 0 },
      [{ className: "owner-handle", kind: "private-term", line: 3, path: "NOTES" }],
    ]);
  });

  it("refuses a recorded tree the source does not re-derive", () => {
    const { home, repo, root, tip } = fixture();
    writePrivateTerms({ home });
    const record = produce({ name: "cut", repo, root, tip });

    expect(
      unwrapErr(
        verifyFreshCut({
          home,
          now: NOW,
          projectsDir: noTranscripts(),
          record: { ...record, treeSha: "0".repeat(40) },
          source: repo,
        }),
      ).code,
    ).toBe("CUT_MISMATCH");
  });

  it("refuses a cut that has gained a second commit", () => {
    const { home, repo, root, tip } = fixture();
    writePrivateTerms({ home });
    const record = produce({ name: "cut", repo, root, tip });
    gitInTemp({
      args: ["-c", "user.email=x@example.invalid", "-c", "user.name=X", "commit", "-q", "--allow-empty", "-m", "more"],
      cwd: record.destination,
    });

    expect(unwrapErr(verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo })).code).toBe(
      "CUT_MISMATCH",
    );
  });

  it("refuses a cut holding a pseudoref that for-each-ref never lists", () => {
    const { home, repo, root, tip } = fixture();
    writePrivateTerms({ home });
    const record = produce({ name: "cut", repo, root, tip });
    writeFileSync(join(record.destination, ".git", "ORIG_HEAD"), `${record.rootSha}\n`);

    const refused = unwrapErr(verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }));
    expect([refused.code, refused.message]).toEqual(["CUT_MISMATCH", expect.stringContaining("ORIG_HEAD")]);
  });

  it("refuses to scan without a private-terms file", () => {
    const { home, repo, root, tip } = fixture();
    const record = produce({ name: "cut", repo, root, tip });

    expect(unwrapErr(verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo })).code).toBe(
      "SCAN_INPUT_UNAVAILABLE",
    );
  });
});
