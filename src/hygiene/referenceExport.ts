/**
 * IO edge of the zero-references proof: export one commit as a zip with no `.git` — nothing but the tree, as
 * an outsider would be handed it — extract that zip, and scan the extracted files (`./referenceTree.ts`).
 *
 * The scan walks the FILESYSTEM of the extracted zip and never asks git what a file holds, so what is counted is
 * exactly what is in the zip: no index, no history, no ignored file left behind in a working tree. Git is asked
 * one other question, how many entries the commit has, and an extraction that holds a different number is
 * refused: an `export-ignore` attribute, or an extraction that lost a file, would otherwise certify a smaller
 * tree than the commit. A submodule and a Git LFS pointer are refused too, because the zip would carry a
 * reference to content rather than the content. An `export-subst` attribute is NOT refused: the zip, after its
 * substitution, is what an outsider is handed, so a name the substitution removes is not in it, and one it adds
 * (`$Format:%an$`, the author) is in the bytes scanned.
 *
 * Nothing leaves the machine. No fetch: the ref is read as this checkout holds it, and the run prints the SHA.
 *
 * What it writes is bounded to the proof directory and the OS temp dir, and both temp directories are removed on
 * every path, ON THE OPERATOR'S OWN SETUP: the home, and the environment git runs in, are trusted rather than
 * defended against. A proof directory the operator symlinked elsewhere is written where it points, and a
 * `GIT_TRACE` the operator set is written by git where it names, and closing
 * them would mean resolving every path and scrubbing git's environment, a sandbox this read-only verb does not
 * need. What a stranger could plant is closed: the zip is staged in a directory `mkdtempSync` creates, so no
 * predictable path exists for anything to stand at.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitEnv } from "../lib/gitRepo.js";
import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory, fsyncFile, renameStagedFile } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { type ReferenceExportError, ReferenceExportErrors } from "./referenceExportErrors.js";
import { parseReferenceMap, type ReferenceMapRow } from "./referenceMap.js";
import type { ReferenceSummary } from "./referenceSummary.js";
import { scanExtractedTree } from "./referenceTree.js";
import { loadDenylistResult } from "./scan.js";

/** The system unzip — absolute, so a `PATH` entry cannot stand in for it. */
const UNZIP = "/usr/bin/unzip";

/**
 * How long one git or unzip child may run before it is killed. MEASURED: a whole run over main's
 * 16,004 files took about three minutes, nearly all of it the scan, so ten minutes on one child is a hang, not a
 * slow export (`time slopweaver audit references --no-page`).
 */
const CHILD_TIMEOUT_MS = 600_000;

/** The folder every member of the zip sits under, so an unzipped copy is one directory rather than a spill. */
const ZIP_ROOT = "slopweaver";

/** A kept proof zip's name; only a file of exactly this shape is ever pruned. */
const PROOF_ZIP = /^slopweaver-[0-9a-f]{12}\.zip$/;

/** What a scan reads off the home: the reference map's rows and the private denylist's words. */
export interface ReferenceInputs {
  readonly map: readonly ReferenceMapRow[];
  readonly denylist: readonly string[];
}

/** What one proof run produced. */
export interface ReferenceProof {
  readonly ref: string;
  readonly sha: string;
  readonly committedIso: string;
  readonly zipPath: string;
  readonly zipBytes: number;
  readonly summary: ReferenceSummary;
}

/**
 * Run one git command against the repository, returning its trimmed stdout.
 *
 * @param root the repository to run in
 * @param args the git arguments
 * @returns stdout, trimmed
 */
function git({ root, args }: { root: string; args: readonly string[] }): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: gitEnv(),
    killSignal: "SIGKILL",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CHILD_TIMEOUT_MS,
  }).trim();
}

/**
 * Read the reference map and the private denylist off the home.
 *
 * @param mapPath the reference map to read
 * @param home the Slopweaver home holding the denylist
 * @returns the map's rows and the denylist's words, or why they cannot be trusted
 */
export function readReferenceInputs({
  mapPath,
  home,
}: {
  mapPath: string;
  home: string;
}): Result<ReferenceInputs, ReferenceExportError> {
  if (!existsSync(mapPath)) {
    return err(ReferenceExportErrors.mapAbsent({ path: mapPath }));
  }
  let text: string;
  try {
    text = readFileSync(mapPath, "utf8");
  } catch (error: unknown) {
    return err(ReferenceExportErrors.inputUnreadable({ path: mapPath, why: String(error) }));
  }
  const map = parseReferenceMap({ text });
  if (map.isErr()) {
    return err(map.error);
  }
  const denylist = loadDenylistResult({ home });
  if (denylist.kind === "unreadable") {
    return err(ReferenceExportErrors.inputUnreadable({ path: denylist.path, why: denylist.reason }));
  }
  return ok({ denylist: denylist.kind === "loaded" ? denylist.lines : [], map: map.value });
}

/**
 * Resolve a ref to its commit, and count the entries its tree holds, refusing a submodule, whose content no zip
 * of this tree can carry.
 *
 * @param root the repository
 * @param ref the commit-ish
 * @returns the commit, when it was made, and how many entries it holds
 */
function resolveCommit({
  root,
  ref,
}: {
  root: string;
  ref: string;
}): Result<{ sha: string; committedIso: string; expected: number }, ReferenceExportError> {
  let sha: string;
  let committedIso: string;
  let listing: string;
  try {
    sha = git({ args: ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], root });
    committedIso = git({ args: ["log", "-1", "--format=%cI", sha], root });
  } catch (cause: unknown) {
    return err(ReferenceExportErrors.stepFailed({ cause, step: "resolve" }));
  }
  try {
    listing = git({ args: ["ls-tree", "-r", "-z", "--format=%(objectmode)", sha], root });
  } catch (cause: unknown) {
    return err(ReferenceExportErrors.stepFailed({ cause, step: "inventory" }));
  }
  const modes = listing.split("\u0000").filter((mode) => mode.length > 0);
  if (modes.includes("160000")) {
    return err(ReferenceExportErrors.incomplete({ why: "the commit holds a submodule, which a zip does not carry" }));
  }
  return ok({ committedIso, expected: modes.length, sha });
}

/**
 * Archive the commit into a staging directory `mkdtempSync` creates exclusively, never at a predictable name:
 * anything already standing at a fixed staging path, a symlink included, would have `git archive` write through it.
 *
 * @param root the repository
 * @param sha the commit
 * @param proofDir where the staging directory is made
 * @param zipName the zip's name inside it
 * @returns the staging directory and the zip in it, or why the archive failed (leaving nothing behind)
 */
function stageZip({
  root,
  sha,
  proofDir,
  zipName,
}: {
  root: string;
  sha: string;
  proofDir: string;
  zipName: string;
}): Result<{ stagingDir: string; staging: string }, ReferenceExportError> {
  let stagingDir: string;
  try {
    ensureDirectory({ directory: proofDir });
    stagingDir = mkdtempSync(join(proofDir, ".staging-"));
  } catch (cause: unknown) {
    return err(ReferenceExportErrors.stepFailed({ cause, step: "archive" }));
  }
  const staging = join(stagingDir, zipName);
  try {
    git({ args: ["archive", "--format=zip", `--prefix=${ZIP_ROOT}/`, "-o", staging, sha], root });
  } catch (cause: unknown) {
    rmSync(stagingDir, { force: true, recursive: true });
    return err(ReferenceExportErrors.stepFailed({ cause, step: "archive" }));
  }
  return ok({ staging, stagingDir });
}

/**
 * What scans one extracted tree: the direct proof's `scanExtractedTree`, or the indirect candidate scan. Both
 * read the SAME extraction, so the two modes can never certify different trees.
 */
export type ExportedTreeScan<T> = (tree: {
  readonly treeRoot: string;
  readonly expected: number;
}) => Result<T, ReferenceExportError>;

/** What one export-and-scan produced, whichever scan ran over it. */
export interface ExportedTreeProof<T> {
  readonly ref: string;
  readonly sha: string;
  readonly committedIso: string;
  readonly zipPath: string;
  readonly zipBytes: number;
  readonly result: T;
}

/**
 * Extract the staged zip into the OS temp dir and scan what it holds, removing the extraction on every path.
 *
 * @param staging the staged zip
 * @param expected how many entries the commit holds
 * @param scan what reads the extracted tree
 * @returns the scan's result, or the step that failed
 */
function scanZip<T>({
  staging,
  expected,
  scan,
}: {
  staging: string;
  expected: number;
  scan: ExportedTreeScan<T>;
}): Result<T, ReferenceExportError> {
  let extractRoot: string;
  try {
    extractRoot = mkdtempSync(join(tmpdir(), "zero-refs-"));
  } catch (cause: unknown) {
    return err(ReferenceExportErrors.stepFailed({ cause, step: "unzip" }));
  }
  try {
    try {
      execFileSync(UNZIP, ["-q", staging, "-d", extractRoot], {
        killSignal: "SIGKILL",
        stdio: ["ignore", "ignore", "pipe"],
        timeout: CHILD_TIMEOUT_MS,
      });
    } catch (cause: unknown) {
      return err(ReferenceExportErrors.stepFailed({ cause, step: "unzip" }));
    }
    return scan({ expected, treeRoot: join(extractRoot, ZIP_ROOT) });
  } finally {
    rmSync(extractRoot, { force: true, recursive: true });
  }
}

/**
 * Keep the staged zip as the latest proof — flushed, then renamed into place — and only then prune the older
 * ones, so an earlier proof is never removed before a new one stands.
 *
 * @param staging the staged zip
 * @param zipPath where it is kept
 * @param proofDir the proof directory
 * @returns the kept zip's size in bytes
 */
function keepZip({
  staging,
  zipPath,
  proofDir,
}: {
  staging: string;
  zipPath: string;
  proofDir: string;
}): Result<number, ReferenceExportError> {
  try {
    fsyncFile({ path: staging });
    renameStagedFile({ flushDirectory: true, from: staging, to: zipPath });
    pruneOlderZips({ keep: zipPath, proofDir });
    return ok(statSync(zipPath).size);
  } catch (cause: unknown) {
    return err(ReferenceExportErrors.stepFailed({ cause, step: "keep" }));
  }
}

/**
 * Export a commit as a zip, scan what the zip holds for the installation's own names, and keep the zip as the
 * latest proof.
 *
 * @param root the repository checkout to export from
 * @param ref the commit-ish to export
 * @param home the Slopweaver home the zip is kept under
 * @param inputs the reference map and denylist, read by {@link readReferenceInputs}
 * @returns the proof, or the step that failed
 */
export function exportAndScanReferences({
  root,
  ref,
  home,
  inputs,
}: {
  root: string;
  ref: string;
  home: string;
  inputs: ReferenceInputs;
}): Result<ReferenceProof, ReferenceExportError> {
  const proof = exportAndScanTree({
    home,
    ref,
    root,
    scan: ({ treeRoot, expected }) => scanExtractedTree({ ...inputs, expected, treeRoot }),
  });
  if (proof.isErr()) {
    return err(proof.error);
  }
  const { result, ...rest } = proof.value;
  return ok({ ...rest, summary: result });
}

/**
 * Export a commit as a zip, run one scan over the extracted zip, and keep the zip as the latest proof.
 *
 * @param root the repository checkout to export from
 * @param ref the commit-ish to export
 * @param home the Slopweaver home the zip is kept under
 * @param scan what reads the extracted tree
 * @returns the scan's result with the export's provenance, or the step that failed
 */
export function exportAndScanTree<T>({
  root,
  ref,
  home,
  scan,
}: {
  root: string;
  ref: string;
  home: string;
  scan: ExportedTreeScan<T>;
}): Result<ExportedTreeProof<T>, ReferenceExportError> {
  const commit = resolveCommit({ ref, root });
  if (commit.isErr()) {
    return err(commit.error);
  }
  const { sha, committedIso, expected } = commit.value;
  const proofDir = stateHomePaths({ home }).zeroReferencesProofDir;
  const zipName = `slopweaver-${sha.slice(0, 12)}.zip`;
  const zipPath = join(proofDir, zipName);
  const staged = stageZip({ proofDir, root, sha, zipName });
  if (staged.isErr()) {
    return err(staged.error);
  }
  try {
    const scanned = scanZip({ expected, scan, staging: staged.value.staging });
    if (scanned.isErr()) {
      return err(scanned.error);
    }
    const zipBytes = keepZip({ proofDir, staging: staged.value.staging, zipPath });
    if (zipBytes.isErr()) {
      return err(zipBytes.error);
    }
    return ok({ committedIso, ref, result: scanned.value, sha, zipBytes: zipBytes.value, zipPath });
  } finally {
    rmSync(staged.value.stagingDir, { force: true, recursive: true });
  }
}

/**
 * Remove every earlier proof zip, so the directory holds the one the latest run scanned. Only a regular file
 * named exactly like a proof zip is touched.
 *
 * @param proofDir the proof directory
 * @param keep the zip this run kept
 */
function pruneOlderZips({ proofDir, keep }: { proofDir: string; keep: string }): void {
  for (const name of readdirSync(proofDir)) {
    const path = join(proofDir, name);
    if (PROOF_ZIP.test(name) && path !== keep && lstatSync(path).isFile()) {
      unlinkSync(path);
    }
  }
}
