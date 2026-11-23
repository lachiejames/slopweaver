/**
 * The clone/duplication ratchet (code-quality survey item 17) — a 15-line normalised cross-file window
 * detector, gated as a ratchet on the FILE-PAIR count rather than a hard ban: it never blocks a legitimate
 * PR that happens to add a similar-looking block, and every clone that gets added has to be argued for in
 * review, because the tracked number can only hold or fall.
 *
 * ## Method
 *
 * Each in-scope file is reduced to its CODE LINES: blank lines and whole-line comments dropped, leading and
 * trailing whitespace stripped (so the same block at a different indentation depth still matches). Every
 * sliding window of {@link WINDOW_SIZE} consecutive code lines is hashed; a hash appearing under more than
 * one FILE (never within a single file — that is ordinary internal reuse, not the cross-file drift this
 * gate exists to catch) is a hit, and every pair of files sharing at least one hit contributes one FILE PAIR
 * to the ratcheted count.
 *
 * A window whose every line belongs to an import declaration is not hashed. Two modules importing the same
 * names from the same places share no logic, and once the formatter sorts every import list the same way
 * (Biome's organiser, which `yarn format` runs), five adapters reading one kit produce a fifteen-line
 * identical import block with nothing duplicated behind it. A window carrying even ONE code line past the
 * imports still counts, so a clone that starts right under them is caught exactly as before.
 *
 * This finds identical code only — not a family like `optStr` that drifted slightly across its copies. It
 * is a complement to the narrow AST ratchets that class of duplication needs, not a substitute —
 * `primitiveRatchet.ts` is that complement, landed for exactly this: `optStr` alone had drifted to 34
 * copies under a dozen different local names, none of them a WINDOW match with any other because every one
 * used its own parameter and function name.
 *
 * ## Ratchet shape
 *
 * Simpler than `coverage-ratchet`'s: the metric here is computed directly from the sources at gate-run
 * time, so there is no separate generated report that can go stale and no measured-vs-integrity split. A
 * committed baseline file names the file-pair count; the gate REFUSES an increase and otherwise passes.
 * `--rebaseline` tightens the committed number to the current one and refuses to raise it — the ratchet
 * only ever holds or falls. This does not chase the git-history anti-gaming `coverage-ratchet` does; a
 * committed number quietly edited up is still visible in review, the same as any other line in a diff.
 *
 * Pure cores ({@link codeLinesOf}, {@link windowsOf}, {@link findDuplicateFilePairs}) are unit-tested; the
 * thin {@link runDuplicateWindows} edge reads the sources, the baseline file, and prints.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { addInto } from "#lib/collections.js";
import { appendAll } from "../lib/arrays.js";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";
import { ts, withSourceFile } from "../lib/tsSyntax.js";
import { type DevLintInputError, DevLintInputErrors } from "./errors.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { gateSelfFiles, repoRoot, type ScanScope, scopedScanFiles } from "./scanScope.js";

/** The sliding-window size, in code lines. Chosen by threshold sweep: zero false positives at 15. */
export const WINDOW_SIZE = 15;

/** The committed floor, repo-relative. */
const BASELINE_FILE = ".baselines/clone-baseline.json";

/** One code line surviving comment/blank stripping, with its ORIGINAL line number (for reporting). */
export interface CodeLine {
  readonly line: number;
  readonly text: string;
}

/** A whole-line comment: `//…`, the start or end of a `/*…*‍/` block, or a JSDoc continuation `* …`. */
const COMMENT_ONLY_LINE = /^(?:\/\/|\/\*|\*\/|\*(?:\s|$))/;

/**
 * Reduce file content to its code lines: blanks and whole-line comments dropped, each line fully trimmed so
 * the same block at a different indentation depth still matches. Pure.
 *
 * @param content the file's text
 * @returns each surviving line, in file order, with its original 1-based line number
 */
export function codeLinesOf({ content }: { content: string }): readonly CodeLine[] {
  return content
    .split("\n")
    .map((text, index) => ({ line: index + 1, text: text.trim() }))
    .filter(({ text }) => text.length > 0 && !COMMENT_ONLY_LINE.test(text));
}

/** One sliding window: which file, where it starts, and a content hash. */
export interface Window {
  readonly path: string;
  readonly startLine: number;
  readonly hash: string;
}

/**
 * The 1-based lines lying WHOLLY inside a top-level import declaration, read off the parsed tree rather than the
 * text, so a dynamic `import ("x")` expression, `import.meta` or an import-shaped line in a template literal is
 * never one. A line an import shares with anything else — a second statement, a trailing comment — is not in the
 * set, so the exclusion only ever errs towards hashing a window. Pure.
 *
 * @param path the file's name, which decides how it parses
 * @param content the file's text
 * @returns the line numbers, matching {@link CodeLine.line}
 */
export function importDeclarationLines({ path, content }: { path: string; content: string }): ReadonlySet<number> {
  const spans = withSourceFile({
    fileName: path,
    text: content,
    use: (sourceFile) =>
      sourceFile.statements
        .filter((statement) => ts.isImportDeclaration(statement))
        .map((statement) => ({
          end: sourceFile.getLineAndCharacterOfPosition(statement.getEnd()),
          start: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)),
        })),
  });
  const rawLines = content.split("\n");
  const lines = new Set<number>();
  for (const { start, end } of spans) {
    const alone =
      rawLines[start.line]!.slice(0, start.character).trim() === "" &&
      rawLines[end.line]!.slice(end.character).trim() === "";
    if (!alone) {
      continue;
    }
    for (let line = start.line; line <= end.line; line += 1) {
      lines.add(line + 1);
    }
  }
  return lines;
}

/** A stable, compact digest of a window's joined text. */
function hashOf({ text }: { text: string }): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Every sliding window of `size` consecutive code lines in one file, bar a window made ENTIRELY of import
 * declarations. Pure.
 *
 * @param path the file's repo-relative path
 * @param lines the file's code lines (see {@link codeLinesOf})
 * @param importLines the lines wholly inside an import declaration (see {@link importDeclarationLines})
 * @param size the window size, in code lines
 * @returns each window, in file order (empty when the file has fewer than `size` code lines)
 */
export function windowsOf({
  path,
  lines,
  importLines,
  size,
}: {
  path: string;
  lines: readonly CodeLine[];
  importLines: ReadonlySet<number>;
  size: number;
}): readonly Window[] {
  const windows: Window[] = [];
  for (let start = 0; start + size <= lines.length; start += 1) {
    const slice = lines.slice(start, start + size);
    if (slice.every((codeLine) => importLines.has(codeLine.line))) {
      continue;
    }
    const text = slice.map((codeLine) => codeLine.text).join("\n");
    windows.push({ hash: hashOf({ text }), path, startLine: slice[0]!.line });
  }
  return windows;
}

/** Two distinct files sharing at least one cross-file duplicate window. Always `a < b` (path order). */
interface FilePair {
  readonly a: string;
  readonly b: string;
}

/** The outcome of a cross-file duplicate sweep. */
export interface DuplicateReport {
  /** Every distinct pair of files that share a duplicate window, in path order. */
  readonly filePairs: readonly FilePair[];
  /** How many distinct window hashes are cross-file duplicates (may exceed `filePairs.length`). */
  readonly hitCount: number;
}

/** A stable key for an unordered file pair. */
function pairKey({ a, b }: { a: string; b: string }): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Every distinct cross-file duplicate window, collapsed to the file pairs that share one. Pure — takes
 * every file's windows directly, so a test can assert this without touching a filesystem.
 *
 * @param windows every window, across every in-scope file
 * @returns the distinct file pairs and how many window hashes produced them
 */
export function findDuplicateFilePairs({ windows }: { windows: readonly Window[] }): DuplicateReport {
  const filesByHash = new Map<string, Set<string>>();
  for (const w of windows) {
    addInto({ key: w.hash, sets: filesByHash, value: w.path });
  }
  const pairs = new Map<string, FilePair>();
  let hitCount = 0;
  for (const files of filesByHash.values()) {
    if (files.size < 2) {
      continue;
    }
    hitCount += 1;
    const sorted = [...files].toSorted();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        pairs.set(pairKey({ a, b }), { a, b });
      }
    }
  }
  return {
    filePairs: [...pairs.values()].toSorted((x, y) => (x.a === y.a ? x.b.localeCompare(y.b) : x.a.localeCompare(y.a))),
    hitCount,
  };
}

/** This gate's declared scan predicate: production `.ts` under `src/`, `eval/` or `hooks/`, tests excluded. */
const SCOPE: ScanScope = {
  excludeTests: true,
  selfFiles: gateSelfFiles({ stem: "duplicateWindows" }),
  trees: ["src/", "eval/", "hooks/"],
};

const baselineSchema = z.object({ filePairs: z.number().int().nonnegative() });

/** The committed floor: how many duplicate file pairs the ratchet currently tolerates. */
export interface CloneBaseline {
  readonly filePairs: number;
}

/**
 * Decode a committed baseline file. Pure.
 *
 * @param text the baseline file text
 * @returns the baseline, or an error string
 */
export function parseBaselineJson({ text }: { text: string }): Result<CloneBaseline, DevLintInputError> {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return err(DevLintInputErrors.baselineMalformed({ detail: parsed.error.message, label: "clone baseline" }));
  }
  const decoded = baselineSchema.safeParse(parsed.value);
  if (!decoded.success) {
    return err(DevLintInputErrors.baselineShapeInvalid({ expected: "{ filePairs: number }", label: "clone baseline" }));
  }
  return ok({ filePairs: decoded.data.filePairs });
}

/**
 * Read every in-scope file's windows. IO edge — throws if the tree cannot be read.
 *
 * @param root the repository root
 * @returns every window, across every in-scope file
 */
function readAllWindows({ root }: { root: string }): readonly Window[] {
  const files = scopedScanFiles({ root, scope: SCOPE });
  const windows: Window[] = [];
  for (const path of files) {
    const content = readFileSync(join(root, path), "utf8");
    const importLines = importDeclarationLines({ content, path });
    appendAll({
      from: windowsOf({ importLines, lines: codeLinesOf({ content }), path, size: WINDOW_SIZE }),
      into: windows,
    });
  }
  return windows;
}

/**
 * IO edge: measure the current file-pair count against the committed baseline, or (`--rebaseline`) tighten
 * the baseline to the current count.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard
 *   error)
 */
export function runDuplicateWindows(): number {
  const rebaseline = process.argv.includes("--rebaseline");
  let root: string;
  try {
    root = repoRoot();
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("duplicate-windows: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const baselinePath = join(root, BASELINE_FILE);
  let baselineText: string;
  try {
    baselineText = readFileSync(baselinePath, "utf8");
  } catch {
    // devlint: not-a-refusal -- an input the gate needs is unreadable, so this reports the fact rather than refusing on policy
    process.stderr.write(`duplicate-windows: floor file missing or unreadable at ${baselinePath}\n`);
    return 1;
  }
  const baseline = parseBaselineJson({ text: baselineText });
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`duplicate-windows: ${baseline.error.message}\n`);
    return 1;
  }
  const report = findDuplicateFilePairs({ windows: readAllWindows({ root }) });
  const current = report.filePairs.length;
  if (rebaseline) {
    if (current > baseline.value.filePairs) {
      process.stderr.write(
        `${lintGateRefusal({
          declaration: lintDeclarationFor({ id: "duplicate-windows-rebaseline" }),
          detail: `${String(current)} against a committed floor of ${String(baseline.value.filePairs)}`,
        })}\n`,
      );
      return 1;
    }
    writeFileSync(baselinePath, `${JSON.stringify({ filePairs: current }, null, 2)}\n`);
    process.stdout.write(`duplicate-windows: baseline tightened to ${String(current)} file pair(s)\n`);
    return 0;
  }
  if (current > baseline.value.filePairs) {
    for (const pair of report.filePairs) {
      process.stderr.write(`  ${pair.a} <-> ${pair.b}\n`);
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "duplicate-windows" }),
        detail: `${String(current)} duplicate file pair(s) against a floor of ${String(baseline.value.filePairs)}`,
      })}
`,
    );
    return 1;
  }
  process.stdout.write(
    `duplicate-windows: clean (${String(current)} file pair(s), floor ${String(baseline.value.filePairs)})\n`,
  );
  return 0;
}
