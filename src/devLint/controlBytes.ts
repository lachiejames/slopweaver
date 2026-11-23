/**
 * The control-byte gate — a ratchet against a defect that removes a file from REVIEW rather than from
 * production.
 *
 * `src/outbound/linear/issueLedger.ts` shipped on main carrying a literal `U+0000` inside a string literal,
 * where the two-character escape was meant. The runtime string is identical, so nothing objected: tsc,
 * Biome, oxlint, ESLint and the whole unit suite passed, and the public hygiene gate reads `utf8` straight
 * through a NUL and reported clean.
 *
 * What it cost was the ability to look at the file at all:
 *
 *  - git applies a binary heuristic on a NUL, so `git diff` renders `Binary files differ`. All 239 lines
 *    were invisible in the pull request — the merged diff advertised 4,223 insertions over a real 4,462.
 *  - `git grep` reports `Binary file … matches` rather than the matching line.
 *  - `slopweaver codex review` REFUSES a diff containing a binary change, by design, rather than shipping
 *    encoded blobs to the model. So the review arm was not merely skipped on that PR — it could not run.
 *
 * A control byte is invisible in every editor and matches no lint rule, so the only symptom is a review
 * surface that silently shrinks. That is precisely the shape a ratchet exists for.
 *
 * Mirrors the other gates: a PURE {@link scanControlBytes} (unit-tested on inline fixtures, so this file
 * never scans itself) plus an effectful {@link runControlBytes} edge over the working tree. The forbidden
 * bytes are named by CODE POINT here, never written literally, so this module stays clean under its own rule.
 */

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { appendAll } from "../lib/arrays.js";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportEmptySelection } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/** One control-byte hit. */
export interface ControlByteHit {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly codePoint: number;
}

/** Tab, line feed and carriage return are the only control characters legitimate in a text source. */
const ALLOWED_CONTROLS: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d]);

/**
 * Whether a code point is a control character this gate refuses: C0 (below `U+0020`) other than tab/LF/CR,
 * plus DEL (`U+007F`).
 *
 * @param codePoint the code point to classify
 * @returns true when the character must not appear in a text source
 */
export function isForbiddenControl({ codePoint }: { codePoint: number }): boolean {
  if (codePoint === 0x7f) {
    return true;
  }
  return codePoint < 0x20 && !ALLOWED_CONTROLS.has(codePoint);
}

/**
 * Pure: every forbidden control character in a file's text, with 1-indexed line and column.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each hit (empty when clean)
 */
export function scanControlBytes({ path, content }: { path: string; content: string }): readonly ControlByteHit[] {
  const hits: ControlByteHit[] = [];
  content.split("\n").forEach((line, lineIndex) => {
    // Iterating by Unicode CODE POINT is exactly right here (codePointAt(0) below expects one scalar value
    // per `character`); code-unit indexing would be the actual bug (a split surrogate pair), not this.
    // oxlint-disable-next-line no-misused-spread
    [...line].forEach((character, columnIndex) => {
      const codePoint = character.codePointAt(0)!;
      if (isForbiddenControl({ codePoint })) {
        hits.push({ codePoint, column: columnIndex + 1, line: lineIndex + 1, path });
      }
    });
  });
  return hits;
}

/**
 * Extensions whose bytes are legitimately not text. Kept as a DENY list rather than scanning an allow list
 * of text extensions, because the allow list silently skipped every extensionless file — `LICENSE`,
 * `.gitignore`, `.nvmrc`, and `bin/slopweaver`, the plugin's own entry point. A control byte in any of those
 * hides the file from review exactly as it does in a `.ts`.
 *
 * The repository currently tracks NO file with any of these extensions; the list exists so that adding a
 * genuine binary asset does not fail the gate.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".wasm",
]);

/**
 * Whether a repo-relative path is in scope: everything git tracks except a known-binary extension.
 *
 * Recorded cassettes are deliberately NOT excluded. An earlier cut skipped `__recordings__/`, reasoning
 * that a cassette holds provider bytes this repo must not rewrite — which conflated not REWRITING a file
 * with not LOOKING at it. A HAR is JSON, and JSON forbids a raw control character inside a string, so a
 * legitimately recorded cassette cannot contain one; if a cassette ever trips this gate, its diff is hidden
 * from review exactly like any other file and the answer is to re-record it, not to look away.
 *
 * @param path the repo-relative path
 * @returns true when the file should be scanned
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return !BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

/** List every working-tree file (repo-relative), anchored at `root`. */
function scanFiles({ root }: { root: string }): readonly string[] {
  return workingTreeFilesOf({ root });
}

/** Render a hit as `U+XXXX`, so the report names the byte without printing it. */
function describe({ hit }: { hit: ControlByteHit }): string {
  return `U+${hit.codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * IO edge: scan every in-scope file, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code (0 clean, 1 a hit was found or not a git checkout)
 */
export function runControlBytes(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRoot();
    files = scanFiles({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("control-bytes: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const scanned = files.filter((path) => isScannablePath({ path }));
  const hits: ControlByteHit[] = [];
  const unreadable: string[] = [];
  for (const path of scanned) {
    let content: string;
    try {
      content = readFileSync(join(root, path), "utf8");
    } catch {
      // NOT skipped. A file the gate could not read is a file it did not check, and reporting clean
      // over it is the silent-failure shape this repo keeps paying for — a staged NUL-bearing blob whose
      // worktree copy is absent would read as ENOENT and pass.
      unreadable.push(path);
      continue;
    }
    appendAll({ from: scanControlBytes({ content, path }), into: hits });
  }
  return report({ hits, scanned: scanned.length, unreadable });
}

/**
 * Print the verdict: the unread files, the empty-selection fact, a clean line, or the four-line refusal.
 *
 * Split from {@link runControlBytes} so that function stays under the body cap.
 *
 * @param hits every control character found
 * @param scanned how many files the filter selected, for the clean line and the empty-selection check
 * @param unreadable files that could not be read, so were never checked
 * @returns 0 only when every selected file was read and none carried a control character, else 1
 */
function report({
  hits,
  scanned,
  unreadable,
}: {
  hits: readonly ControlByteHit[];
  scanned: number;
  unreadable: readonly string[];
}): number {
  if (unreadable.length > 0) {
    // devlint: not-a-refusal -- an input the gate needs is unreadable, so this reports the fact rather than refusing on policy
    process.stderr.write(`control-bytes: ${String(unreadable.length)} file(s) could not be read:\n`);
    for (const path of unreadable) {
      // devlint: not-a-refusal -- a file that was not read was not checked, so this reports the gap rather than a verdict
      process.stderr.write(`  ${path}\n`);
    }
    // devlint: not-a-refusal -- a file that was not read was not checked, so this reports the gap rather than a verdict
    process.stderr.write("A file that was not read was not checked, so this is a failure, not a skip.\n");
    return 1;
  }
  const unseen = reportEmptySelection({
    label: "control-bytes",
    selected: scanned,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (gateOutcome({ refused: hits.length, unseen }) === "incomplete") {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(`control-bytes: clean (${String(scanned)} files scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}:${String(hit.column)}: ${describe({ hit })}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "control-bytes" }),
      detail: `${String(hits.length)} control character(s) in text`,
    })}
`,
  );
  return 1;
}
