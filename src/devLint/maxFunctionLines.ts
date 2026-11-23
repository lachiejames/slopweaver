/**
 * The max-function-lines gate — a per-FUNCTION size ratchet that keeps the "pure core / thin shell"
 * discipline from drifting back into 100+-line mixed-concern functions (the shape PR3.5's partial-output
 * bug hid in). It parses each source with the TypeScript compiler API (pure, in-memory — no filesystem)
 * and flags any function/method/arrow whose body spans more than {@link MAX_FUNCTION_LINES} lines.
 *
 * A genuinely-cohesive effectful shell that this refactor doesn't touch (e.g. a CLI verb's
 * parse→execute→report handler) can carry an inline `max-lines-exempt: <reason>` comment on the line
 * directly above it — the archive's inline-exemption pattern, so the bar stays honest instead of hiding
 * behind a hardcoded name list. `*.test.ts` and the scanner's own files are skipped.
 *
 * Pure {@link scanFunctionLines} (unit-tested with inline fixtures) + an effectful {@link runMaxFunctionLines}
 * edge that walks the sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/** The per-function line ceiling (inclusive limit — a body of exactly this many lines passes). */
export const MAX_FUNCTION_LINES = 60;

/** The inline marker that exempts the function directly below it. */
const EXEMPT_MARKER = "max-lines-exempt";

/** One oversized function: where it is, its name, and its body's line span. */
export interface OversizedFunction {
  readonly path: string;
  readonly name: string;
  readonly startLine: number;
  readonly lines: number;
}

/** The best display name for a function-like node (declaration name, assigned const, or `(anonymous)`). */
function nameOf({ node, sf }: { node: ts.Node; sf: ts.SourceFile }): string {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    return node.name.getText(sf);
  }
  if (ts.isMethodDeclaration(node)) {
    return node.name.getText(sf);
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent)) {
    return parent.name.getText(sf);
  }
  return "(anonymous)";
}

/**
 * Every function whose body exceeds `max` lines, unless the line above it carries the exempt marker. Pure —
 * parses `content` in memory with the TypeScript AST, so a test asserts exactly which functions trip it.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @param max the per-function line ceiling (defaults to {@link MAX_FUNCTION_LINES})
 * @returns each oversized function (empty when all are within the bar)
 */
export function scanFunctionLines({
  path,
  content,
  max = MAX_FUNCTION_LINES,
}: {
  path: string;
  content: string;
  max?: number;
}): readonly OversizedFunction[] {
  const lines = content.split("\n");
  const results: OversizedFunction[] = [];
  withSourceFile({
    fileName: path,
    text: content,
    use: (sf): void => {
      const visit: NodeVisitor = (node) => {
        const isFn =
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node);
        if (isFn && node.body !== undefined) {
          const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
          const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
          const span = endLine - startLine + 1;
          const above = startLine > 0 ? lines[startLine - 1]! : "";
          if (span > max && !above.includes(EXEMPT_MARKER)) {
            results.push({ lines: span, name: nameOf({ node, sf }), path, startLine: startLine + 1 });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
    },
  });
  return results.toSorted((a, b) => b.lines - a.lines);
}

/** This gate's declared scan predicate: a non-test `.ts` file under `src/`, `eval/` or `hooks/`, not this gate's own sources. */
const SCOPE: ScanScope = {
  excludeTests: true,
  selfFiles: gateSelfFiles({ stem: "maxFunctionLines" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it; tests and this gate's own sources are excluded
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every in-scope source, print each oversized function, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 an oversized function found or not a git checkout)
 */
export function runMaxFunctionLines(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("max-function-lines: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<OversizedFunction>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanFunctionLines({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "max-function-lines",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(
      `max-function-lines: clean (${String(readCount)} sources scanned, limit ${String(MAX_FUNCTION_LINES)})\n`,
    );
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.startLine)}: ${hit.name} (${String(hit.lines)} lines)\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "max-function-lines" }),
      detail: `${String(hits.length)} function(s) over ${String(MAX_FUNCTION_LINES)} lines`,
    })}\n`,
  );
  return 1;
}
