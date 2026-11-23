/**
 * `@internal` enforcement (code-quality survey item 5) — knip's own reference tracing already decides which
 * exported symbol has no consumer outside its own file, or none outside a `*.test.ts` file: flipping
 * `ignoreExportsUsedInFile` to `false` and dropping `src/**\/*.test.ts` from `entry` makes knip report that
 * bucket directly, at near-zero cost (~5-9s, no whole-repo `ts.Program` — this is references, not resolved
 * types; see `devLint.ts`'s own note on why a checker-backed gate costs 2 GiB and this one does not).
 *
 * ## What "clean" means for one flagged symbol
 *
 * Knip flags a symbol; this gate never un-exports it (a pure function exported ONLY so `*.test.ts` can
 * reach it is the zero-mocks rule working as designed — `export` stays). It requires SOME resolution: an
 * inline `@internal` JSDoc tag directly above the declaration, or dropping `export` entirely (which simply
 * makes knip stop flagging it next run — nothing here forces that choice, it only requires one or the
 * other before a symbol counts as clean).
 *
 * "Attached" is checked by TEXT, not a second whole-repo AST pass: the comment block immediately above the
 * declaration line, broken only by a blank line — the same "no gap" rule `jsdocTags.ts`'s `attachedBlock`
 * enforces, line-scanned here since knip already names the exact line. A trailing same-line `// @internal`
 * is deliberately not recognised, matching the block-comment convention every other tag in this repo uses.
 *
 * ## Ratchet, not a mass annotation
 *
 * 855 symbols across 445 files were flagged the day this gate was built — retagging them is real, separate
 * work, not something Phase 0 does in passing. A committed baseline (keyed by path+name, never by line, so
 * an unrelated edit elsewhere in the file cannot spuriously break the ratchet) grandfathers today's
 * population; the gate refuses only a symbol newly flagged and left unresolved.
 * `yarn devlint:internal-rebaseline` shrinks the baseline as symbols get `@internal` or lose their `export`.
 *
 * ## Its blind spot, and who closes it
 *
 * This gate judges SYMBOLS, and `knip` counts a test import as a use. A whole module that only tests import
 * therefore reads clean in both while nothing at runtime loads it.
 * `src/__tests__/unit/canon/testOnlyModules.test.ts` finds those modules and requires a written reason for
 * every survivor, so the class cannot regrow unnoticed.
 *
 * Pure cores ({@link flaggedSymbolsOf}, {@link attachedCommentAbove}, {@link isInternallyMarked},
 * {@link violationsOf}, {@link parseKnipReport}, {@link parseBaselineJson}) are unit-tested; the thin
 * {@link runInternalExports} edge shells out to knip, reads the sources, reads the baseline, and prints.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { appendAll } from "../lib/arrays.js";
import { gitEnv } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { type Result } from "../lib/result.js";
import { decodeDebtList, readCommittedInput } from "./decodeDebtList.js";
import { type DevLintInputError } from "./errors.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/** The committed floor, repo-relative. */
const BASELINE_FILE = ".baselines/internal-exports-baseline.json";

/** The inline marker that resolves a flagged symbol without dropping its `export`. */
export const INTERNAL_MARKER = "@internal";

const knipSymbolSchema = z.object({ line: z.number().int().positive(), name: z.string().min(1) });
const knipIssueSchema = z.object({
  exports: z.array(knipSymbolSchema),
  file: z.string().min(1),
  nsExports: z.array(knipSymbolSchema),
  nsTypes: z.array(knipSymbolSchema),
  types: z.array(knipSymbolSchema),
});
const knipReportSchema = z.object({ issues: z.array(knipIssueSchema) });

/** One symbol knip flagged as having no consumer outside its own file (or outside a `*.test.ts`). */
export interface FlaggedSymbol {
  readonly path: string;
  readonly name: string;
  readonly line: number;
}

/** A decoded knip `--reporter json` report, narrowed to the four issue types this gate reads. */
type KnipReport = z.infer<typeof knipReportSchema>;

/**
 * Decode knip's `--reporter json` output for the `exports`/`types`/`nsExports`/`nsTypes` issue types. Pure.
 *
 * @param text the raw stdout knip printed
 * @returns the decoded report, or an error string
 */
export function parseKnipReport({ text }: { text: string }): Result<KnipReport, DevLintInputError> {
  return decodeDebtList({
    label: "knip report",
    schema: knipReportSchema,
    shape: "{ issues: [{ file, exports, types, … }] }",
    text,
  });
}

/**
 * Flatten a decoded knip report into one flat list of flagged symbols. Pure.
 *
 * @param report the decoded knip report (see {@link parseKnipReport})
 * @returns every flagged symbol, in report order
 */
export function flaggedSymbolsOf({ report }: { report: KnipReport }): readonly FlaggedSymbol[] {
  const flagged: FlaggedSymbol[] = [];
  for (const issue of report.issues) {
    const symbols = [...issue.exports, ...issue.types, ...issue.nsExports, ...issue.nsTypes];
    appendAll({ from: symbols.map((s) => ({ line: s.line, name: s.name, path: issue.file })), into: flagged });
  }
  return flagged;
}

/**
 * The comment block directly attached above a declaration line: every contiguous non-blank line walking
 * upward, stopping at the first blank line or the block's own opening `/*`. Pure.
 *
 * @param lines the file's lines (0-indexed array; `declLine` is 1-indexed, matching knip)
 * @param declLine the 1-indexed line the declaration starts on
 * @returns the attached comment text, oldest line first (empty when nothing is attached)
 */
export function attachedCommentAbove({ lines, declLine }: { lines: readonly string[]; declLine: number }): string {
  const collected: string[] = [];
  let i = declLine - 2;
  while (i >= 0 && i < lines.length) {
    const line = lines[i]!.trim();
    if (line.length === 0) {
      break;
    }
    collected.unshift(line);
    if (line.startsWith("/*")) {
      break;
    }
    i -= 1;
  }
  return collected.join("\n");
}

/**
 * Whether a flagged declaration already carries the `@internal` marker as its OWN tag line in its attached
 * comment — never merely mentioned in prose (this file's own docstrings talk about `@internal` constantly,
 * which is exactly the false positive a plain substring search would produce). Pure.
 *
 * @param lines the file's lines
 * @param declLine the 1-indexed declaration line
 * @returns true when a line of the attached comment, stripped of its `*`/`/**` prefix, IS the tag
 */
export function isInternallyMarked({ lines, declLine }: { lines: readonly string[]; declLine: number }): boolean {
  return attachedCommentAbove({ declLine, lines })
    .split("\n")
    .some((line) => {
      const stripped = line.replace(/^\/?\*+\/?/, "").trim();
      return stripped === INTERNAL_MARKER || stripped.startsWith(`${INTERNAL_MARKER} `);
    });
}

/** The committed floor: symbols grandfathered as known, not-yet-resolved debt. */
export interface InternalBaseline {
  readonly symbols: readonly { readonly path: string; readonly name: string }[];
}

const baselineSchema = z.object({
  symbols: z.array(z.object({ name: z.string().min(1), path: z.string().min(1) })),
});

/**
 * Decode a committed baseline file. Pure.
 *
 * @param text the baseline file text
 * @returns the baseline, or an error string
 */
export function parseBaselineJson({ text }: { text: string }): Result<InternalBaseline, DevLintInputError> {
  return decodeDebtList({
    label: "internal-exports baseline",
    schema: baselineSchema,
    shape: "{ symbols: [{ path, name }] }",
    text,
  }).map((decoded) => ({ symbols: decoded.symbols }));
}

/** One flagged symbol left unresolved: no `@internal`, and — for the ordinary run — no baseline entry. */
export interface Violation {
  readonly path: string;
  readonly name: string;
  readonly line: number;
}

/**
 * Every flagged symbol that is neither `@internal`-marked nor grandfathered in the baseline. Pure — the
 * property the gate actually enforces.
 *
 * @param flagged every symbol knip flagged
 * @param marked which flagged symbols already carry `@internal` (by path+name)
 * @param baseline the committed floor
 * @returns each violation, in flagged order
 */
export function violationsOf({
  flagged,
  marked,
  baseline,
}: {
  flagged: readonly FlaggedSymbol[];
  marked: ReadonlySet<string>;
  baseline: InternalBaseline;
}): readonly Violation[] {
  const baselined = new Set(baseline.symbols.map((s) => `${s.path}\t${s.name}`));
  return flagged.filter((s) => {
    const key = `${s.path}\t${s.name}`;
    return !marked.has(key) && !baselined.has(key);
  });
}

/**
 * Run knip's own resolution pass and return its flagged-symbol list. IO edge — throws if knip cannot run.
 *
 * @param root the repository root
 * @returns every symbol knip flags as having no consumer outside its own file / a test file
 */
function runKnip({ root }: { root: string }): readonly FlaggedSymbol[] {
  const bin = join(root, "node_modules", ".bin", "knip");
  let stdout: string;
  try {
    stdout = execFileSync(bin, ["--reporter", "json", "--include", "exports,types,nsExports,nsTypes"], {
      cwd: root,
      encoding: "utf8",
      env: gitEnv(),
    });
  } catch (error) {
    // knip exits non-zero whenever it finds issues, which is the expected case here — its stdout still
    // carries the JSON report, so recover it from the caught error rather than treating this as a hard fail.
    if (!isRecord(error) || typeof error["stdout"] !== "string") {
      throw error;
    }
    stdout = error["stdout"];
  }
  const parsed = parseKnipReport({ text: stdout });
  if (parsed.isErr()) {
    throw new Error(parsed.error.message);
  }
  return flaggedSymbolsOf({ report: parsed.value });
}

/** Which of the flagged symbols already carry `@internal`, keyed by `path\tname`. IO edge — reads files. */
function markedSetOf({ root, flagged }: { root: string; flagged: readonly FlaggedSymbol[] }): ReadonlySet<string> {
  const linesByPath = new Map<string, readonly string[]>();
  const marked = new Set<string>();
  for (const symbol of flagged) {
    let lines = linesByPath.get(symbol.path);
    if (lines === undefined) {
      lines = readFileSync(join(root, symbol.path), "utf8").split("\n");
      linesByPath.set(symbol.path, lines);
    }
    if (isInternallyMarked({ declLine: symbol.line, lines })) {
      marked.add(`${symbol.path}\t${symbol.name}`);
    }
  }
  return marked;
}

/** Load the committed baseline, or say why it could not be read. */
function loadBaseline({ baselinePath }: { baselinePath: string }): Result<InternalBaseline, DevLintInputError> {
  return readCommittedInput({ kind: "floor file", path: baselinePath }).andThen((text) => parseBaselineJson({ text }));
}

/** The `--rebaseline` branch: write the current unresolved-and-unmarked set as the new baseline. */
function applyRebaseline({
  baselinePath,
  flagged,
  marked,
}: {
  baselinePath: string;
  flagged: readonly FlaggedSymbol[];
  marked: ReadonlySet<string>;
}): number {
  const unresolved = flagged.filter((s) => !marked.has(`${s.path}\t${s.name}`));
  const symbols = unresolved.map((s) => ({ name: s.name, path: s.path }));
  writeFileSync(baselinePath, `${JSON.stringify({ symbols }, null, 2)}\n`);
  process.stdout.write(`internal-exports: baseline set to ${String(symbols.length)} symbol(s)\n`);
  return 0;
}

/** The compare branch: pass, or print every unresolved symbol outside the baseline. */
function reportViolations({
  violations,
  flagged,
}: {
  violations: readonly Violation[];
  flagged: readonly FlaggedSymbol[];
}): number {
  if (violations.length === 0) {
    process.stdout.write(
      `internal-exports: clean (${String(flagged.length)} flagged symbol(s) resolved or grandfathered)\n`,
    );
    return 0;
  }
  for (const v of violations) {
    process.stderr.write(`  ${v.path}:${String(v.line)}: ${v.name}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "internal-exports" }),
      detail: `${String(violations.length)} newly-flagged symbol(s) left unresolved`,
    })}
`,
  );
  return 1;
}

/**
 * IO edge: run knip's own resolution, classify every flagged symbol against `@internal` markers and the
 * committed baseline, or (`--rebaseline`) write the current unresolved set as the new baseline.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a new unresolved symbol or a hard error)
 */
export function runInternalExports(): number {
  let root: string;
  try {
    root = repoRoot();
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("internal-exports: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const baselinePath = join(root, BASELINE_FILE);
  const baseline = loadBaseline({ baselinePath });
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`internal-exports: ${baseline.error.message}\n`);
    return 1;
  }
  let flagged: readonly FlaggedSymbol[];
  try {
    flagged = runKnip({ root });
  } catch (error) {
    // devlint: not-a-refusal -- knip could not run, so this gate has no verdict rather than a clean one
    process.stderr.write(
      `internal-exports: knip could not run: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const marked = markedSetOf({ flagged, root });
  return process.argv.includes("--rebaseline")
    ? applyRebaseline({ baselinePath, flagged, marked })
    : reportViolations({ flagged, violations: violationsOf({ baseline: baseline.value, flagged, marked }) });
}
