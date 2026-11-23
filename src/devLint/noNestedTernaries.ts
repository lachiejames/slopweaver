/**
 * The no-nested-ternaries gate — machine-enforces the rule: nested ternaries
 * are written as if statements instead, with the booleans put into constants for readability.
 *
 * ## The criterion
 *
 * A `ConditionalExpression` whose `whenTrue` or `whenFalse` branch — after stripping parentheses — is
 * itself a `ConditionalExpression` fails. That covers both the `(a ? b : (c ? d : e))` and the
 * right-associative chain shape (`a ? b : c ? d : e`), which parses the same way without needing the
 * parentheses at all. A three-deep chain reports twice, once per offending outer node, because each one
 * independently violates the rule — same shape as `hand-rolled-result` reporting a union wherever it sits.
 *
 * Pure {@link scanNoNestedTernaries} + an effectful {@link runNoNestedTernaries} edge, matching the other
 * gates in this directory.
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

/**
 * One nested-ternary violation: where the outer conditional is.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface NestedTernaryHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The node with any wrapping parentheses stripped, so `(c ? d : e)` reads the same as `c ? d : e`. */
function unwrapParens({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Every nested-ternary violation in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanNoNestedTernaries({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly NestedTernaryHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly NestedTernaryHit[] => {
      const hits: NestedTernaryHit[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isConditionalExpression(node)) {
          const whenTrue = unwrapParens({ node: node.whenTrue });
          const whenFalse = unwrapParens({ node: node.whenFalse });
          if (ts.isConditionalExpression(whenTrue) || ts.isConditionalExpression(whenFalse)) {
            hits.push({
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              message:
                "a ternary's branch is itself a ternary — `.claude/rules/typescript-patterns.md` bans nested " +
                "conditional expressions. Rewrite as if / else-if / else, and hoist the tested condition into a " +
                "named boolean constant when it is not already a bare identifier.",
              path,
            });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/** This gate's declared scan predicate: every `.ts` under the source trees, minus its own files. */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "noNestedTernaries" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runNoNestedTernaries(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("no-nested-ternaries: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<NestedTernaryHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanNoNestedTernaries({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "no-nested-ternaries",
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
    process.stdout.write(`no-nested-ternaries: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "no-nested-ternaries" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
