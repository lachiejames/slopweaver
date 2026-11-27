/**
 * The shared harness for the salvage secrets-scan test files: the synthetic token and object names, the
 * `cat-file --batch` builder, and the real-git fixture the three real-git files run in.
 *
 * `useSalvageRepos()` gives each case its own copy of a bare destination and a working repository, built once per
 * describe, in a `beforeEach`, and removes both in the `afterEach` it registers, so read `root` and `origin` only
 * inside a case. Each is its own `mkdtempSync` directory:
 * git runs in them through `gitInTemp`, and `commit` writes the file each case names under `root`, every caller
 * passing a plain file name.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

import {
  type ForbiddenIdentifierRules,
  type IdentifierScanner,
  identifierDigest,
} from "../../../../hygiene/identifierScan.js";
import { repositoryContentIdentifierScanner } from "../../../../hygiene/ownRepository.js";
import { gitSalvageEdges, salvageScanDecline } from "../../../../worktree/salvageScan.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

/** A GitHub token shape, built at runtime so this file never carries one for the repository gate to find. */
export const TOKEN = "ghp_" + "a".repeat(36);

/** The synthetic organisation, the one forbidden word the scans below are given. */
export const ORG = "acme";

const SYNTHETIC_RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [identifierDigest({ text: ORG })],
    wordCs: [],
  },
  providerLocations: [],
};

/** The repository-content scanner the prune builds, over the synthetic rules. */
export const IDENTIFIERS: IdentifierScanner = repositoryContentIdentifierScanner({ rules: SYNTHETIC_RULES });

export const SHA_A = "a".repeat(40);
/** The salvage branch the push would create, clean unless a case says otherwise. */
export const REF = "salvage/old-work-2ba73fd1";
export const SHA_B = "b".repeat(40);

/**
 * A `cat-file --batch` answer for literal objects.
 *
 * @param objects each object's name and content
 * @returns the bytes git would write
 */
export function batchOf({ objects }: { objects: readonly { sha: string; content: string }[] }): Buffer {
  return Buffer.concat(
    objects.map(({ sha, content }) => {
      const body = Buffer.from(content, "utf8");
      return Buffer.concat([Buffer.from(`${sha} blob ${String(body.length)}\n`), body, Buffer.from("\n")]);
    }),
  );
}

/** The case's working repository; a live binding, assigned before each case and read only inside one. */
export let root: string;
/** The case's bare destination repository; a live binding, assigned before each case and read only inside one. */
export let origin: string;
/**
 * Run git in the fixture with an explicit identity: CI runners carry none.
 *
 * @returns git's trimmed standard output
 */
export const git = (...args: readonly string[]): string =>
  gitInTemp({ args: ["-c", "user.email=a@b.c", "-c", "user.name=t", ...args], cwd: root });
/**
 * Write a file and commit everything, answering the new commit. A nested `file` needs its directory made first.
 *
 * @returns the new commit's sha
 */
export const commit = ({ file, content, message }: { file: string; content: string; message: string }): string => {
  writeFileSync(join(root, file), content);
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
};
/**
 * Scan what a salvage push of `sha` would send to the fixture's destination, with no denylist.
 *
 * @returns the decline line, or null when the push is allowed
 */
export const scan = ({ sha = git("rev-parse", "HEAD") }: { sha?: string } = {}): string | null =>
  salvageScanDecline({
    denylist: { kind: "absent" },
    edges: gitSalvageEdges({ cwd: root, sha, url: origin }),
    identifiers: IDENTIFIERS,
    refName: REF,
  });

/**
 * Register the hooks that give every case a fresh destination holding one pushed base commit and a working
 * repository tracking it, and remove both after. Call it once, inside a describe whose cases read {@link root}.
 *
 * The pair is built once per describe and COPIED for each case, since every git process is a launch and the seed
 * alone was seven of them. A copy is the same pair: neither `.git` holds an absolute path but the working
 * repository's remote url, which each case points at its own copied destination.
 */
export function useSalvageRepos(): void {
  let seedOrigin = "";
  let seedRoot = "";

  beforeAll(() => {
    seedOrigin = mkdtempSync(join(tmpdir(), "salvage-seed-origin-"));
    gitInTemp({ args: ["init", "-q", "--bare", "-b", "main"], cwd: seedOrigin });
    seedRoot = mkdtempSync(join(tmpdir(), "salvage-seed-scan-"));
    root = seedRoot;
    git("init", "-q", "-b", "main");
    git("remote", "add", "origin", seedOrigin);
    commit({ content: "export const A = 1;\n", file: "a.ts", message: "base" });
    git("push", "-q", "origin", "main");
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(seedRoot, { force: true, recursive: true });
    rmSync(seedOrigin, { force: true, recursive: true });
  });

  beforeEach(() => {
    origin = mkdtempSync(join(tmpdir(), "salvage-origin-"));
    cpSync(seedOrigin, origin, { recursive: true });
    root = mkdtempSync(join(tmpdir(), "salvage-scan-"));
    cpSync(seedRoot, root, { recursive: true });
    git("remote", "set-url", "origin", origin);
  }, REAL_GIT_TIMEOUT_MS);

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(origin, { force: true, recursive: true });
  });
}
