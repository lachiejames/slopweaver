/**
 * `privateTermsSweep.ts` — `parseRawDiffTree` and `strictUtf8` as pure units, plus the merged-change-set read and its verdict against
 * a real temp git repository and a temp state home holding SYNTHETIC terms. `gitInTemp` per
 * `src/__tests__/tempGitRepo.ts` — a test may not shell git any other way.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changeSetPrivateTermsLines, judgeChangeSetPrivateTerms } from "../../../../hygiene/changeSetPrivateTerms.js";
import { loadPrivateTerms, parsePrivateTerms, WITHHELD_REFUSAL_LINE } from "../../../../hygiene/privateTerms.js";
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
const TERMS_TSV = `class\tflags\tpattern\tsource\nowner-address\ti\t${SYNTHETIC_VALUE}\tsynthetic\n`;

/** The terms {@link TERMS_TSV} parses to, read independently of the sweep so an expected verdict never quotes itself. */
const EXPECTED_TERMS = unwrap(parsePrivateTerms({ text: TERMS_TSV }));

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
  writeFileSync(path, TERMS_TSV, "utf8");
  chmodSync(path, 0o600);
  return home;
}

/** The terms file's path under `home`, as the loader names it. */
function termsPath({ home }: { home: string }): string {
  return join(home, "hygiene", "private-terms.tsv");
}

/** The whole report for one synthetic hit on `new.txt` line 2 — the shape every replaced-object case must still print. */
const NEW_TXT_HOLD_LINES = [
  "private terms: HOLD — this landing is refused",
  "  1 private-term finding(s) stand on lines this landing would merge",
  "  new.txt:2: [private-term] owner-address",
  "private terms have no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all do not reach this " +
    "hold. Reword each line named above (or repair the terms file), push, and land again; if a term is not private, " +
    "ask the chair to narrow that terms row.",
];

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

  it("refuses the whole change set when a changed blob will not read, rather than skipping that file", () => {
    const repo = forkedRepo({ feature: { "new.txt": `fine\nsays ${SYNTHETIC_VALUE}\n` } });
    const blob = git({ args: ["rev-parse", "feature:new.txt"], repo });
    // One side alone adds `new.txt`, so the merge takes its entry without reading the blob; only `cat-file` needs it.
    rmSync(join(repo, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
    const error = unwrapErr(readMergedChangeSet({ baseRef: "main", headRef: "feature", repo }));
    expect(error.code).toBe("BLOB_READ_FAILED");
    // Git's own wording sits inside the parentheses and varies by version; everything around it is ours.
    expect(error.message).toMatch(/^the merged content of new\.txt could not be read \(.+\)$/su);
  });
});

describe("sweepMergePrivateTerms", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("holds on a private term a stale branch adds, naming path, line and class only", () => {
    const repo = forkedRepo({ feature: { "new.txt": `fine\nsays ${SYNTHETIC_VALUE}\n` } });
    const base = fetchedMain({ repo });
    const verdict = sweepMergePrivateTerms({ base, headRef: "feature", home: homeWithTerms(), repo });
    expect(verdict).toEqual({
      hits: [{ className: "owner-address", line: 2, locus: "new.txt" }],
      kind: "hold",
      reasons: ["1 private-term finding(s) stand on lines this landing would merge"],
      terms: EXPECTED_TERMS,
    });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual(NEW_TXT_HOLD_LINES);
  });

  it("is clean when the term sits only on a line the merge does not change", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const base = fetchedMain({ repo });
    const verdict = sweepMergePrivateTerms({ base, headRef: "feature", home: homeWithTerms(), repo });
    expect(verdict).toEqual({
      accepted: 0,
      binaryFiles: 0,
      kind: "clean",
      terms: EXPECTED_TERMS,
      textFiles: 1,
    });
  });

  it("reads the pinned head itself, never a local replacement standing in for it", () => {
    const repo = forkedRepo({ feature: { "new.txt": `fine\nsays ${SYNTHETIC_VALUE}\n` } });
    const head = git({ args: ["rev-parse", "feature"], repo });
    // The commit `feature` was cut from: merged into `main` it changes nothing, so honouring it would read as clean.
    git({ args: ["replace", head, git({ args: ["rev-parse", "main~1"], repo })], repo });
    const verdict = sweepMergePrivateTerms({ base: fetchedMain({ repo }), headRef: head, home: homeWithTerms(), repo });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual(NEW_TXT_HOLD_LINES);
  });

  it("reads the fetched base itself, never a local replacement standing in for it", () => {
    const repo = forkedRepo({ feature: { "new.txt": `fine\nsays ${SYNTHETIC_VALUE}\n` } });
    const base = fetchedMain({ repo });
    // `feature` itself: honoured, the merge would change nothing against its own base and read as clean.
    git({ args: ["replace", base.sha, git({ args: ["rev-parse", "feature"], repo })], repo });
    const verdict = sweepMergePrivateTerms({ base, headRef: "feature", home: homeWithTerms(), repo });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual(NEW_TXT_HOLD_LINES);
  });

  it("reads the head's own tree, never a local replacement standing in for it", () => {
    const repo = forkedRepo({ feature: { "new.txt": `fine\nsays ${SYNTHETIC_VALUE}\n` } });
    const headTree = git({ args: ["rev-parse", "feature^{tree}"], repo });
    // The fork point's tree: honoured, the head would add nothing to the base and read as clean.
    git({ args: ["replace", headTree, git({ args: ["rev-parse", "main~1^{tree}"], repo })], repo });
    const verdict = sweepMergePrivateTerms({
      base: fetchedMain({ repo }),
      headRef: "feature",
      home: homeWithTerms(),
      repo,
    });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual(NEW_TXT_HOLD_LINES);
  });

  it("is unchecked, reading no git, when the home holds no terms file", () => {
    const repo = forkedRepo({ feature: { "new.txt": SYNTHETIC_VALUE } });
    const home = tempDir({ prefix: "terms-sweep-empty-home-" });
    const verdict = sweepMergePrivateTerms({ base: fetchedMain({ repo }), headRef: "feature", home, repo });
    expect(verdict).toEqual({
      detail: `the private terms file is not present at ${termsPath({ home })}, so no file this landing changes was checked for them`,
      kind: "unchecked",
      terms: [],
    });
  });

  it("holds on a malformed terms file before reading any git, whatever the change set holds", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const home = homeWithTerms();
    writeFileSync(
      termsPath({ home }),
      "class\tflags\tpattern\tsource\nowner-address\ti\t(unclosed\tsynthetic\n",
      "utf8",
    );
    const load = loadPrivateTerms({ home });
    const verdict = sweepMergePrivateTerms({ base: fetchedMain({ repo }), headRef: "feature", home, repo });
    expect(load.kind).toBe("invalid");
    expect(verdict.kind).toBe("hold");
    // No change set at all: the same verdict as judging zero files, so not one git read reached the judgement.
    expect(verdict).toEqual(judgeChangeSetPrivateTerms({ files: [], load, residue: { entries: [], kind: "read" } }));
  });

  it("is unchecked, never clean, when the change set cannot be read whole", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const base = fetchedMain({ repo });
    const verdict = sweepMergePrivateTerms({ base, headRef: "missing", home: homeWithTerms(), repo });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual([
      `private terms: NOT CHECKED — could not resolve "${base.sha}" and/or "missing" as commits — the change set was not checked`,
    ]);
  });

  it("is unchecked when the pinned head commit was never fetched here, the shape enqueue hands it", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const base = fetchedMain({ repo });
    const absent = "f".repeat(40);
    const verdict = sweepMergePrivateTerms({ base, headRef: absent, home: homeWithTerms(), repo });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual([
      `private terms: NOT CHECKED — could not resolve "${base.sha}" and/or "${absent}" as commits — the change set was not checked`,
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
    expect(verdict).toEqual({
      detail: `the base was not fetched (${SYNTHETIC_VALUE})`,
      kind: "unchecked",
      terms: EXPECTED_TERMS,
    });
    expect(changeSetPrivateTermsLines({ verdict })).toEqual([WITHHELD_REFUSAL_LINE]);
  });

  it("holds with no fetched base when the terms file will not read, since nothing acknowledges that", () => {
    const repo = forkedRepo({ feature: { "new.txt": "fine\n" } });
    const home = homeWithTerms();
    chmodSync(termsPath({ home }), 0o644);
    const verdict = sweepMergePrivateTerms({
      base: { detail: "the base was not fetched (no checkout)", kind: "unfetched" },
      headRef: "feature",
      home,
      repo,
    });
    const path = termsPath({ home });
    expect(verdict).toEqual({
      hits: [],
      kind: "hold",
      reasons: [
        `hygiene: private terms UNREADABLE at ${path} (mode 644 lets others read it; chmod 600 it) — every guarded write refuses`,
        `hygiene: the private terms file ${path} could not be relied on (mode 644 lets others read it; chmod 600 it).`,
      ],
      terms: [],
    });
  });
});
