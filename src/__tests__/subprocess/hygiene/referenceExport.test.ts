/**
 * The zero-references export over a REAL throwaway repository: `git archive` to a zip, `unzip`, and the scan of
 * what the zip holds. The map row is synthetic (`zorblatt`), and the home is a temp dir, so nothing here reads or
 * writes the operator's own home.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAuditReferences } from "../../../cli/commands/audit/referencesRun.js";
import { EXIT_ERROR } from "../../../cli/exitCodes.js";
import { exportAndScanReferences, readReferenceInputs } from "../../../hygiene/referenceExport.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { localPagePublisher } from "../../pagePublisherFake.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

let repo: string;
let home: string;

/** Write one file into the fixture repository. */
const put = ({ path, content }: { path: string; content: string }): void => {
  const absolute = join(repo, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
};

/** Stage everything and commit it. */
const commit = ({ message }: { message: string }): void => {
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: ["commit", "-q", "-m", message], cwd: repo });
};

/** The map and denylist, read off the temp home. */
const inputs = () => unwrap(readReferenceInputs({ home, mapPath: stateHomePaths({ home }).referenceMap }));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "zr-repo-"));
  home = mkdtempSync(join(tmpdir(), "zr-home-"));
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: repo });
  gitInTemp({ args: ["config", "user.email", "fixture@example.invalid"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "Fixture"], cwd: repo });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: repo });
  mkdirSync(join(home, "hygiene"), { recursive: true });
  writeFileSync(stateHomePaths({ home }).referenceMap, "class\tflags\tpattern\npeople\ti\t\\bzorblatt\\b\n");
});

afterEach(() => {
  rmSync(repo, { force: true, recursive: true });
  rmSync(home, { force: true, recursive: true });
});

describe("exportAndScanReferences", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("exports the commit as a zip with no .git, scans every file and file name, and keeps only the latest zip", () => {
    put({ content: "clean\n", path: "src/a.ts" });
    put({ content: "intro\nZorblatt wrote this\n", path: "docs/b.md" });
    put({ content: "x\n", path: "notes/zorblatt.txt" });
    commit({ message: "seed" });

    const first = unwrap(exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo }));
    expect(first.sha).toBe(gitInTemp({ args: ["rev-parse", "main"], cwd: repo }));
    expect(first.summary.filesScanned).toBe(3);
    expect(first.summary.totalHits).toBe(2);
    expect(first.summary.residue).toEqual([
      { area: "docs", classes: ["map:people"], path: "docs/b.md", pathCarriesReference: false },
      { area: "docs", classes: ["map:people"], path: "notes/zorblatt.txt", pathCarriesReference: true },
    ]);
    expect(existsSync(first.zipPath)).toBe(true);
    const listing = execUnzipList({ zip: first.zipPath });
    expect(listing.some((line) => line.includes(".git/"))).toBe(false);
    expect(listing.some((line) => line.endsWith("slopweaver/src/a.ts"))).toBe(true);

    rmSync(join(repo, "docs", "b.md"));
    rmSync(join(repo, "notes", "zorblatt.txt"));
    commit({ message: "clean" });
    const second = unwrap(exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo }));
    expect(second.summary.totalHits).toBe(0);
    expect(readdirSync(stateHomePaths({ home }).zeroReferencesProofDir)).toEqual([
      `slopweaver-${second.sha.slice(0, 12)}.zip`,
    ]);
  });

  it("refuses an export that drops a file, so a smaller tree is never certified", () => {
    put({ content: "kept\n", path: "a.ts" });
    put({ content: "zorblatt\n", path: "hidden.ts" });
    put({ content: "hidden.ts export-ignore\n", path: ".gitattributes" });
    commit({ message: "seed" });
    expect(unwrapErr(exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo })).code).toBe(
      "EXPORT_INCOMPLETE",
    );
  });

  it("refuses a Git LFS pointer, because the zip would carry a pointer rather than the content", () => {
    put({ content: "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n", path: "big.bin" });
    commit({ message: "seed" });
    const error = unwrapErr(exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo }));
    expect(error.code).toBe("EXPORT_INCOMPLETE");
    expect(error.message).toContain("big.bin is a Git LFS pointer");
  });

  it("withholds a refused file's path when the path itself carries a reference", () => {
    put({ content: "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n", path: "docs/Zorblatt.bin" });
    commit({ message: "seed" });
    const error = unwrapErr(exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo }));
    expect(error.message).toContain("(a file whose own path carries a reference) is a Git LFS pointer");
    expect(error.message).not.toContain("Zorblatt");
  });

  it("counts a name a binary file holds as UTF-16", () => {
    writeFileSync(
      join(repo, "blob.bin"),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("zorblatt", "utf16le")]),
    );
    commit({ message: "seed" });
    const proof = unwrap(exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo }));
    expect(proof.summary.binaryFiles).toBe(1);
    expect(proof.summary.residue).toEqual([
      { area: "code", classes: ["map:people"], path: "blob.bin", pathCarriesReference: false },
    ]);
  });

  it("refuses, leaving no staging zip, when the temp directory cannot be made", () => {
    put({ content: "a\n", path: "a.ts" });
    commit({ message: "seed" });
    // Every lane's setup sets TMPDIR to its per-file sandbox, so there is always a value to restore.
    const saved = process.env["TMPDIR"]!;
    process.env["TMPDIR"] = join(home, "no-such-temp");
    let result: ReturnType<typeof exportAndScanReferences>;
    try {
      result = exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo });
    } finally {
      process.env["TMPDIR"] = saved;
    }
    expect(unwrapErr(result).message).toContain("unzip failed");
    expect(readdirSync(stateHomePaths({ home }).zeroReferencesProofDir)).toEqual([]);
  });

  it("never writes through a symlink planted at the zip's own name, and leaves no staging behind", () => {
    put({ content: "a\n", path: "a.ts" });
    commit({ message: "seed" });
    const sha = gitInTemp({ args: ["rev-parse", "main"], cwd: repo });
    const proofDir = stateHomePaths({ home }).zeroReferencesProofDir;
    const victim = join(home, "victim.txt");
    writeFileSync(victim, "untouched\n");
    mkdirSync(proofDir, { recursive: true });
    const zipName = `slopweaver-${sha.slice(0, 12)}.zip`;
    symlinkSync(victim, join(proofDir, zipName));

    const proof = unwrap(exportAndScanReferences({ home, inputs: inputs(), ref: "main", root: repo }));
    expect(readFileSync(victim, "utf8")).toBe("untouched\n");
    expect(lstatSync(proof.zipPath).isFile()).toBe(true);
    expect(readdirSync(proofDir)).toEqual([zipName]);
  });

  it("refuses a ref that does not resolve, naming the step", () => {
    put({ content: "a\n", path: "a.ts" });
    commit({ message: "seed" });
    const error = unwrapErr(exportAndScanReferences({ home, inputs: inputs(), ref: "no-such-branch", root: repo }));
    expect(error.code).toBe("EXPORT_STEP_FAILED");
    expect(error.message).toContain("resolve failed");
  });
});

describe("runAuditReferences", () => {
  it("exits with the error code, never a throw, when git cannot be run", async () => {
    const lines: string[] = [];
    // Every lane inherits a PATH, so there is always a value to restore.
    const saved = process.env["PATH"]!;
    process.env["PATH"] = join(home, "no-such-bin");
    let code: number;
    try {
      code = await runAuditReferences({
        publish: localPagePublisher,
        rest: ["--home", home, "--no-page"],
        writeDiagnostic: (line) => lines.push(line),
        writeOut: (line) => lines.push(line),
      });
    } finally {
      process.env["PATH"] = saved;
    }
    expect(code).toBe(EXIT_ERROR);
    expect(lines.join("\n")).toContain("resolve failed");
  });
});

describe("readReferenceInputs", () => {
  it("refuses a home with no reference map rather than scanning on the committed rules alone", () => {
    rmSync(stateHomePaths({ home }).referenceMap);
    expect(unwrapErr(readReferenceInputs({ home, mapPath: stateHomePaths({ home }).referenceMap })).code).toBe(
      "REFERENCE_MAP_ABSENT",
    );
  });
});

/**
 * List a zip's members with the system unzip.
 *
 * @param zip the zip to list
 * @returns one line per member, as `unzip -Z1` prints it
 */
function execUnzipList({ zip }: { zip: string }): readonly string[] {
  return execFileSync("/usr/bin/unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n");
}
