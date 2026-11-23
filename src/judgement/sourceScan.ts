/**
 * A small, bounded, generic file-tree scanner for judgement-mining sources — deliberately not the corpus
 * `self` connector's `scanSelfCorpus`, which is tuned for ingesting `CorpusRecord`s into the medallion
 * pipeline and carries assumptions (root naming, an extension allowlist, corpus-home exclusion) this feature
 * does not need. What IS reused is the same refusal posture: never follow a symlink out of the root, and
 * never read a binary file as if it were prose (`../corpus/sanitise.js`'s density check, not a blocklist).
 *
 * Format-agnostic on purpose: any text-shaped file (Markdown, JSON, plain text) is included verbatim, JSON
 * structure and all. A mining prompt is read by a model, which can pull a field like a transcript's own text
 * out of surrounding JSON without this scanner needing to know any source's specific export shape — a shape
 * hardcoded here would be exactly the installation-specific coupling this public repository avoids.
 *
 * This module is the effectful edge only: it ENUMERATES every admissible file, and `./sourceSelection.ts`
 * decides which of them reach the sample. Enumerating the whole tree, rather than stopping at the budget, is
 * what lets the sample say how much of the tree it did not show. Each file is read ONCE and held for the
 * selection, so selection never re-reads a file; the cost is memory proportional to the tree's text. The
 * determinism is the SELECTION's, over what was read: there is no filesystem snapshot, so a tree edited
 * while the scan walks it can yield a sample of file versions that never coexisted. The receipts' per-file
 * content hashes record exactly which versions were shown, and a re-scan of the settled tree supersedes it.
 */
import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { looksBinary, stripControlBytes } from "../corpus/sanitise.js";
import { sha256Text } from "../lib/hash.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import type { JudgementSourceSample } from "./miningBrief.js";
import { type JudgementSourceScanError, JudgementSourceScanErrors } from "./sourceScan.errors.js";
import { type JudgementCandidateFile, selectJudgementSample } from "./sourceSelection.js";

/** Directory names never walked — history and dependency trees are not first-person writing. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", ".cache", ".DS_Store"]);

/** Whether a directory entry is never walked: a symlink, or a history/dependency tree. */
function isSkippedEntry({ entry }: { entry: Dirent }): boolean {
  return entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name);
}

/** Read one file as a candidate, or nothing when it is binary. */
function readCandidate({
  path,
  relativePath,
  label,
}: {
  path: string;
  relativePath: string;
  label: string;
}): Result<JudgementCandidateFile | undefined, JudgementSourceScanError> {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "judgement.scanFile", path });
  if (read.isErr()) {
    return err(JudgementSourceScanErrors.unreadable({ detail: read.error.message, label, path }));
  }
  if (looksBinary({ text: read.value })) {
    return ok(undefined);
  }
  return ok({ relativePath, text: stripControlBytes({ text: read.value }).text });
}

/** Visit one directory entry: skip it, walk into it, or collect it as a candidate. */
function visitEntry({
  dir,
  entry,
  prefix,
  label,
  into,
}: {
  dir: string;
  entry: Dirent;
  prefix: string;
  label: string;
  into: JudgementCandidateFile[];
}): Result<void, JudgementSourceScanError> {
  if (isSkippedEntry({ entry })) {
    return ok(undefined);
  }
  const path = join(dir, entry.name);
  const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isDirectory()) {
    return walk({ dir: path, into, label, prefix: relativePath });
  }
  if (!entry.isFile()) {
    return ok(undefined);
  }
  const candidate = readCandidate({ label, path, relativePath });
  if (candidate.isErr()) {
    return err(candidate.error);
  }
  if (candidate.value !== undefined) {
    into.push(candidate.value);
  }
  return ok(undefined);
}

/** Walk one directory (never into a symlink), collecting every admissible file's cleaned text into `into`. */
function walk({
  dir,
  prefix,
  label,
  into,
}: {
  dir: string;
  prefix: string;
  label: string;
  into: JudgementCandidateFile[];
}): Result<void, JudgementSourceScanError> {
  const listed = safeFs({
    execute: (): Dirent[] => readdirSync(dir, { withFileTypes: true }),
    operation: "judgement.scanDirectory",
    path: dir,
  });
  if (listed.isErr()) {
    return err(JudgementSourceScanErrors.unreadable({ detail: listed.error.message, label, path: dir }));
  }
  for (const entry of listed.value) {
    const visited = visitEntry({ dir, entry, into, label, prefix });
    if (visited.isErr()) {
      return visited;
    }
  }
  return ok(undefined);
}

/**
 * Scan one private source root into a bounded, hashed sample ready for a mining brief.
 *
 * @param label a generic label for this source — never an installation-specific tool/product name
 * @param root the absolute directory to walk
 * @returns the bounded sample with its coverage and receipts; `undefined` when the root does not exist, is not
 *   a directory, or holds nothing readable; a typed refusal when part of the tree cannot be read
 */
export function scanJudgementSource({
  label,
  root,
}: {
  label: string;
  root: string;
}): Result<JudgementSourceSample | undefined, JudgementSourceScanError> {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return ok(undefined);
  }
  const candidates: JudgementCandidateFile[] = [];
  const walked = walk({ dir: root, into: candidates, label, prefix: "" });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const { text, selected, coverage } = selectJudgementSample({ candidates });
  if (selected.length === 0) {
    return ok(undefined);
  }
  return ok({
    contentHash: sha256Text({ text }),
    coverage,
    fileCount: selected.length,
    label,
    selected,
    text,
  });
}
