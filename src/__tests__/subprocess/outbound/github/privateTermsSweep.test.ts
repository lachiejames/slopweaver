/**
 * `privateTermsSweep.ts` — `parseRawDiffTree` and `strictUtf8` as pure units, plus the merged-change-set read and its verdict against
 * a real temp git repository and a temp state home holding SYNTHETIC terms. `gitInTemp` per
 * `src/__tests__/tempGitRepo.ts` — a test may not shell git any other way.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changeSetPrivateTermsLines } from "../../../../hygiene/changeSetPrivateTerms.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  PrivateTermsSweepErrors,
  parseRawDiffTree,
  readMergedChangeSet,
  strictUtf8,
  sweepMergePrivateTerms,
} from "../../../../outbound/github/privateTermsSweep.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

/** The synthetic private value: every case that says it never prints carries it in its input. */
const SYNTHETIC_VALUE = "acmefixtureword";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory this file removes afterwards. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** Run git in the fixture repository. */
function git({ repo, args }: { repo: string; args: readonly string[] }): string {
  return gitInTemp({ args, cwd: repo });
}

/** Write `files` into `repo` and commit them on the current branch. */
function commit({ repo, files }: { repo: string; files: Readonly<Record<string, string>> }): void {
  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(repo, path), text, "utf8");
  }
  git({ args: ["add", "-A"], repo });
  git({ args: ["commit", "-m", "change"], repo });
}

/**
 * A repository whose `feature` branch was cut from `main`, after which `main` moved on a DISJOINT file — the shape
 * a landing over a base move without a rebase merges.
 */
function forkedRepo({ feature }: { feature: Readonly<Record<string, string>> }): string {
  const repo = tempDir({ prefix: "terms-sweep-repo-" });
  git({ args: ["init", "-b", "main"], repo });
  git({ args: ["config", "user.email", "test@example.invalid"], repo });
  git({ args: ["config", "user.name", "Test"], repo });
  git({ args: ["config", "commit.gpgsign", "false"], repo });
  commit({ files: { "base.txt": "base\n", "gone.txt": "old\n" }, repo });
  git({ args: ["checkout", "-b", "feature"], repo });
  commit({ files: feature, repo });
  git({ args: ["checkout", "main"], repo });
  commit({ files: { "moved.txt": "the base moved\n" }, repo });
  return repo;
}

/** A state home holding one synthetic private term, at the mode the loader requires. */
function homeWithTerms(): string {
  const home = tempDir({ prefix: "terms-sweep-home-" });
  mkdirSync(join(home, "hygiene"), { recursive: true });
  const path = join(home, "hygiene", "private-terms.tsv");
  writeFileSync(path, `class\tflags\tpattern\tsource\nowner-address\ti\t${SYNTHETIC_VALUE}\tsynthetic\n`, "utf8");
  chmodSync(path, 0o600);
  return home;
}

/** `main`'s tip, as the base a landing just fetched. */
function fetchedMain({ repo }: { repo: string }): { readonly kind: "fetched"; readonly sha: string } {
  return { kind: "fetched", sha: git({ args: ["rev-parse", "main"], repo }) };
}

describe("parseRawDiffTree", () => {
  it("reads one record per path, keeping the final mode, object and status", () => {
    const output = `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M\u0000src/a.ts\u0000:000000 120000 ${"0".repeat(40)} ${"c".repeat(40)} A\u0000link\u0000`;
    expect(parseRawDiffTree({ output })).toEqual([
      { mode: "100644", object: "b".repeat(40), path: "src/a.ts", status: "M" },
      { mode: "120000", object: "c".repeat(40), path: "link", status: "A" },
    ]);
  });

  it("reads an empty listing as no change", () => {
    expect(parseRawDiffTree({ output: "" })).toEqual([]);
  });

  it("refuses a shape it does not know rather than guessing", () => {
    expect(parseRawDiffTree({ output: "not a raw record\u0000" })).toBe(undefined);
  });
});

describe("strictUtf8", () => {
  it("decodes valid UTF-8 and refuses a byte that is not, rather than substituting one", () => {
    expect(strictUtf8({ bytes: Buffer.from("café.txt", "utf8") })).toBe("café.txt");
    expect(strictUtf8({ bytes: Buffer.from([0x62, 0x61, 0x64, 0xff]) })).toBe(undefined);
  });
});

describe("readMergedChangeSet", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads only what the merge adds or changes against the moved base, skipping a deletion", () => {
    const repo = forkedRepo({ feature: { "base.txt": "base, edited\n", "new.txt": "added\n" } });
    git({ args: ["checkout", "feature"], repo });
    git({ args: ["rm", "-q", "gone.txt"], repo });
    git({ args: ["commit", "-m", "drop"], repo });
    const files = unwrap(readMergedChangeSet({ baseRef: "main", headRef: "feature", repo }));
    expect(files.map((file) => [file.path, file.bytes.toString("utf8")])).toEqual([
      ["base.txt", "base, edited\n"],
      ["new.txt", "added\n"],
    ]);
  });

  it("names a ref that does not resolve", () => {
    const repo = forkedRepo({ feature: { "new.txt": "added\n" } });
    const error = unwrapErr(readMergedChangeSet({ baseRef: "main", headRef: "no-such-branch", repo }));
    expect(error.code).toBe("REF_UNRESOLVED");
  });

  it("refuses a changed path that is not valid UTF-8, rather than naming a lossy copy of it", () => {
    const repo = forkedRepo({ feature: { "new.txt": "added\n" } });
    git({ args: ["checkout", "feature"], repo });
    const blob = gitInTemp({ args: ["hash-object", "-w", "--stdin"], cwd: repo, input: "unnamed\n" });
    gitInTemp({
      args: ["update-index", "--index-info"],
      cwd: repo,
      input: Buffer.concat([Buffer.from(`100644 ${blob}\tbad`), Buffer.from([0xff]), Buffer.from(".txt\n")]),
    });
    git({ args: ["commit", "-m", "a path that is not UTF-8"], repo });
    const error = unwrapErr(readMergedChangeSet({ baseRef: "main", headRef: "feature", repo }));
    expect(error).toEqual(
      PrivateTermsSweepErrors.diffFailed({ why: "a changed path is not valid UTF-8, so it cannot be named" }),
    );
  });
});

describe("sweepMergePrivateTerms", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("holds on a private term a stale branch adds, naming path, line and class only", () => {
    const repo = forkedRepo({ feature: { "new.txt": `fine\nsays ${SYNTHETIC_VALUE}\n` } });
    const base = fetchedMain({ repo });
    const verdict = sweepMergePrivateTerms({ base, headRef: "feature", home: homeWithTerms(), repo });
    const lines = changeSetPrivateTermsLines({ verdict });
    expect(verdict.kind).toBe("hold");
    expect(lines).toContain("  new.txt:2: [private-term] owner-address");
    expect(lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("is clean when the term sits only on a line the merge does not change", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const base = fetchedMain({ repo });
    const verdict = sweepMergePrivateTerms({ base, headRef: "feature", home: homeWithTerms(), repo });
    expect(verdict).toEqual({
      accepted: 0,
      binaryFiles: 0,
      kind: "clean",
      terms: verdict.terms,
      textFiles: 1,
    });
    expect(verdict.terms).toHaveLength(1);
  });

  it("reads the pinned head itself, never a local replacement standing in for it", () => {
    const repo = forkedRepo({ feature: { "new.txt": `fine\nsays ${SYNTHETIC_VALUE}\n` } });
    const head = git({ args: ["rev-parse", "feature"], repo });
    // The commit `feature` was cut from: merged into `main` it changes nothing, so honouring it would read as clean.
    git({ args: ["replace", head, git({ args: ["rev-parse", "main~1"], repo })], repo });
    const verdict = sweepMergePrivateTerms({ base: fetchedMain({ repo }), headRef: head, home: homeWithTerms(), repo });
    expect(changeSetPrivateTermsLines({ verdict })).toContain("  new.txt:2: [private-term] owner-address");
  });

  it("is unchecked, reading no git, when the home holds no terms file", () => {
    const repo = forkedRepo({ feature: { "new.txt": SYNTHETIC_VALUE } });
    const home = tempDir({ prefix: "terms-sweep-empty-home-" });
    const verdict = sweepMergePrivateTerms({ base: fetchedMain({ repo }), headRef: "feature", home, repo });
    expect(verdict.kind).toBe("unchecked");
  });

  it("is unchecked, never clean, when the change set cannot be read whole", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const base = fetchedMain({ repo });
    const verdict = sweepMergePrivateTerms({ base, headRef: "missing", home: homeWithTerms(), repo });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual([
      `private terms: NOT CHECKED — could not resolve "${base.sha}" and/or "missing" as commits — the change set was not checked`,
    ]);
  });

  it("still loads the terms with no fetched base, so a detail carrying one is withheld", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const verdict = sweepMergePrivateTerms({
      base: { detail: `the base was not fetched (${SYNTHETIC_VALUE})`, kind: "unfetched" },
      headRef: "feature",
      home: homeWithTerms(),
      repo,
    });
    const lines = changeSetPrivateTermsLines({ verdict });
    expect(verdict.kind).toBe("unchecked");
    expect(lines).toHaveLength(1);
    expect(lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("holds with no fetched base when the terms file will not read, since nothing acknowledges that", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const home = homeWithTerms();
    chmodSync(join(home, "hygiene", "private-terms.tsv"), 0o644);
    const verdict = sweepMergePrivateTerms({
      base: { detail: "the base was not fetched (no checkout)", kind: "unfetched" },
      headRef: "feature",
      home,
      repo,
    });
    expect(verdict.kind).toBe("hold");
  });
});
