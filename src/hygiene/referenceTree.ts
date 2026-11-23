/**
 * Walk an extracted zip and scan every entry with `./referenceScan.ts`: every file's bytes, a link's target, and
 * every path. The walk reads the FILESYSTEM, never git, so what is counted is exactly what the zip held, and an
 * extraction holding a different number of entries than the commit is refused rather than certified.
 */
import { type Dirent, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

import { appendAll } from "../lib/arrays.js";
import { err, ok, type Result } from "../lib/result.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "./forbiddenIdentifiers.js";
import type { IdentifierScanner } from "./identifierScan.js";
import { repositoryContentIdentifierScanner } from "./ownRepository.js";
import { type ReferenceExportError, ReferenceExportErrors } from "./referenceExportErrors.js";
import type { ReferenceMapRow } from "./referenceMap.js";
import {
  printablePath,
  type ReferenceHit,
  referenceClasses,
  scanFileReferences,
  scanReferences,
} from "./referenceScan.js";
import { type ReferenceSummary, summariseReferences } from "./referenceSummary.js";

/** The first line of every Git LFS pointer file. */
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";

/** What scanning one extracted entry found. */
type EntryScan =
  | { readonly kind: "unreadable" }
  | { readonly kind: "lfs-pointer" }
  | { readonly kind: "scanned"; readonly hits: readonly ReferenceHit[]; readonly binary: boolean };

/**
 * Read one entry: a link's target, or a file's bytes.
 *
 * @param absolute the entry's path on disk
 * @returns what it holds, or undefined when it could not be read
 */
function readEntry({ absolute }: { absolute: string }): { target: string } | { bytes: Buffer } | undefined {
  try {
    if (lstatSync(absolute).isSymbolicLink()) {
      return { target: readlinkSync(absolute) };
    }
    return { bytes: readFileSync(absolute) };
  } catch {
    return undefined;
  }
}

/**
 * Scan one extracted entry: a link by its target, a file by its bytes, and either by its path.
 *
 * @param absolute the entry's path on disk
 * @param path its tree-relative path
 * @param map the reference map's rows
 * @param denylist the private denylist's words
 * @param scanner the hygiene gate's repository-content scanner
 * @returns its references, or that it could not be read or is a Git LFS pointer
 */
function scanEntry({
  absolute,
  path,
  map,
  denylist,
  scanner,
}: {
  absolute: string;
  path: string;
  map: readonly ReferenceMapRow[];
  denylist: readonly string[];
  scanner: IdentifierScanner;
}): EntryScan {
  const read = readEntry({ absolute });
  if (read === undefined) {
    return { kind: "unreadable" };
  }
  if ("target" in read) {
    if (read.target.startsWith(LFS_POINTER)) {
      return { kind: "lfs-pointer" };
    }
    return {
      binary: false,
      hits: scanReferences({ content: read.target, denylist, map, path, scanner }),
      kind: "scanned",
    };
  }
  if (read.bytes.subarray(0, LFS_POINTER.length).toString("utf8") === LFS_POINTER) {
    return { kind: "lfs-pointer" };
  }
  return { kind: "scanned", ...scanFileReferences({ bytes: read.bytes, denylist, map, path, scanner }) };
}

/**
 * Walk the extracted tree and scan every entry: every file's bytes, a link's target, every path.
 *
 * @param treeRoot the extracted zip's root folder
 * @param expected how many entries the commit holds, which the extraction must match
 * @param map the reference map's rows
 * @param denylist the private denylist's words
 * @returns the summary, or why the extraction cannot be certified
 */
export function scanExtractedTree({
  treeRoot,
  expected,
  map,
  denylist,
}: {
  treeRoot: string;
  expected: number;
  map: readonly ReferenceMapRow[];
  denylist: readonly string[];
}): Result<ReferenceSummary, ReferenceExportError> {
  let entries: Dirent[];
  try {
    entries = readdirSync(treeRoot, { recursive: true, withFileTypes: true });
  } catch (cause: unknown) {
    return err(ReferenceExportErrors.stepFailed({ cause, step: "walk" }));
  }
  const files = entries.filter((entry) => !entry.isDirectory());
  if (files.length !== expected) {
    const why = `the commit holds ${String(expected)} entries and the extracted zip ${String(files.length)}`;
    return err(ReferenceExportErrors.incomplete({ why }));
  }
  // The archive is this repository's committed content, so it gets the gate's own repository-content policy.
  const scanner = repositoryContentIdentifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES });
  const hits: ReferenceHit[] = [];
  const unreadable: string[] = [];
  let binaryFiles = 0;
  for (const entry of files) {
    const absolute = join(entry.parentPath, entry.name);
    const path = relative(treeRoot, absolute);
    const scanned = scanEntry({ absolute, denylist, map, path, scanner });
    if (scanned.kind === "lfs-pointer") {
      const shown = printablePath({ denylist, map, path, scanner });
      return err(ReferenceExportErrors.incomplete({ why: `${shown} is a Git LFS pointer, not its content` }));
    }
    if (scanned.kind === "unreadable") {
      unreadable.push(printablePath({ denylist, map, path, scanner }));
      continue;
    }
    binaryFiles += scanned.binary ? 1 : 0;
    appendAll({ from: scanned.hits, into: hits });
  }
  if (unreadable.length > 0) {
    return err(ReferenceExportErrors.unreadableFiles({ paths: unreadable }));
  }
  return ok(summariseReferences({ binaryFiles, classes: referenceClasses({ map }), filesScanned: files.length, hits }));
}
