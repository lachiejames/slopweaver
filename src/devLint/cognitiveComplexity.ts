/**
 * The cognitive-complexity gate — replaces `sonarjs/cognitive-complexity` (deleted along with ESLint
 * itself; oxlint has no equivalent rule). A pragmatic reimplementation of SonarSource's public Cognitive
 * Complexity metric against the TypeScript AST, not a port of sonarjs's own source: each function-like node
 * is scored independently (a nested closure resets to its own fresh score, scored separately when the outer
 * walk reaches it, rather than folding into its parent's — the common simplification most reimplementations
 * make, and the one this repo's threshold of {@link COGNITIVE_COMPLEXITY_LIMIT} was already tuned against).
 *
 * Structural increments (`if`, ternary, `switch`, loops, `catch`) cost `1 + current nesting depth`; an
 * `else`/`else if` costs a flat `1` (a sibling, not a deeper nest); a labelled `break`/`continue` costs `1`
 * (bare/unlabelled ones cost nothing). Logical-operator runs match this repo's pinned `eslint-plugin-sonarjs`
 * exactly, read straight from its source rather than the abstract public spec: a run of `&&` costs `1`,
 * charged the moment it starts; `||` and `??` never charge at all — confirmed by reading `S3776/rule.js`
 * directly, because the abstract spec's "same-operator-run" story does NOT match what that plugin enforces.
 * There is no recursion charge — that sub-rule of the public spec is simply absent from this codebase's
 * pinned plugin version, so porting it in would make this gate STRICTER than what it replaces.
 *
 * Pure {@link scanCognitiveComplexity} (unit-tested with inline fixtures) + an effectful
 * {@link runCognitiveComplexity} edge that walks the sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { countAndRuns, flattenLogical, isLogicalOperator } from "./cognitiveLogicalChain.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/** The complexity ceiling (inclusive limit — a function scoring exactly this many passes). */
export const COGNITIVE_COMPLEXITY_LIMIT = 12;

/** One over-complex function: where it is, its name, and its score. */
export interface ComplexityHit {
  readonly path: string;
  readonly name: string;
  readonly startLine: number;
  readonly complexity: number;
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

/** The best display name for a function-like node — mirrors `maxFunctionLines.ts`'s `nameOf`. */
function nameOf({ node, sf }: { node: ts.Node; sf: ts.SourceFile }): string {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined) {
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

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Mutable scoring state for one function's walk — kept as a class only so every helper shares it by reference. */
class Scorer {
  complexity = 0;

  /** Add a structural increment: the base `1`, plus `nesting` when the construct nests (B3 of the spec). */
  add({ nesting }: { nesting: number }): void {
    this.complexity += 1 + nesting;
  }

  /** Add a flat `1` — for a sibling `else`, an `&&` run, or a labelled jump. */
  addFlat(): void {
    this.complexity += 1;
  }
}

/** Walks `node`, scoring every construct into `scorer`, without descending into a NESTED function-like node. */
function walk({ node, nesting, scorer }: { node: ts.Node; nesting: number; scorer: Scorer }): void {
  if (isFunctionLike(node)) {
    return; // scored separately, as its own top-level entry — see scanCognitiveComplexity.
  }
  if (ts.isIfStatement(node)) {
    walkIf({ node, nesting, scorer });
    return;
  }
  if (isLoopOrCatch(node)) {
    walkNestingIncrement({ body: bodyOf({ node }), header: headerOf({ node }), nesting, scorer });
    return;
  }
  if (ts.isSwitchStatement(node)) {
    scorer.add({ nesting });
    walk({ node: node.expression, nesting, scorer });
    for (const statement of node.caseBlock.clauses.flatMap((clause) => clause.statements)) {
      walk({ node: statement, nesting: nesting + 1, scorer });
    }
    return;
  }
  if (ts.isConditionalExpression(node)) {
    walkNestingIncrement({ body: [node.whenTrue, node.whenFalse], header: [node.condition], nesting, scorer });
    return;
  }
  if (ts.isBinaryExpression(node) && isLogicalOperator({ kind: node.operatorToken.kind })) {
    walkLogicalChain({ node, nesting, scorer });
    return;
  }
  if (isLabelledJump({ node })) {
    scorer.addFlat();
  }
  const visit: NodeVisitor = (child) => {
    walk({ node: child, nesting, scorer });
  };
  forEachChild({ node, visit });
}

/** `if`/`else if`/`else` as one chain: the first `if` nests; every later arm is a flat sibling increment. */
function walkIf({ node, nesting, scorer }: { node: ts.IfStatement; nesting: number; scorer: Scorer }): void {
  scorer.add({ nesting });
  walk({ node: node.expression, nesting, scorer });
  walk({ node: node.thenStatement, nesting: nesting + 1, scorer });
  const elseBranch = node.elseStatement;
  if (elseBranch === undefined) {
    return;
  }
  scorer.addFlat();
  if (ts.isIfStatement(elseBranch)) {
    walk({ node: elseBranch.expression, nesting, scorer });
    walk({ node: elseBranch.thenStatement, nesting: nesting + 1, scorer });
    walkElseTail({ node: elseBranch, nesting, scorer });
    return;
  }
  walk({ node: elseBranch, nesting: nesting + 1, scorer });
}

/** The `else` arm of an `else if`, walked without re-adding the flat increment `walkIf`'s caller already added. */
function walkElseTail({ node, nesting, scorer }: { node: ts.IfStatement; nesting: number; scorer: Scorer }): void {
  const elseBranch = node.elseStatement;
  if (elseBranch === undefined) {
    return;
  }
  scorer.addFlat();
  if (ts.isIfStatement(elseBranch)) {
    walk({ node: elseBranch.expression, nesting, scorer });
    walk({ node: elseBranch.thenStatement, nesting: nesting + 1, scorer });
    walkElseTail({ node: elseBranch, nesting, scorer });
    return;
  }
  walk({ node: elseBranch, nesting: nesting + 1, scorer });
}

/** A structural construct whose header (condition/init) stays at `nesting`, and body(ies) nest one deeper. */
function walkNestingIncrement({
  header,
  body,
  nesting,
  scorer,
}: {
  header: readonly (ts.Node | undefined)[];
  body: readonly (ts.Node | undefined)[];
  nesting: number;
  scorer: Scorer;
}): void {
  scorer.add({ nesting });
  for (const node of header) {
    if (node !== undefined) {
      walk({ node, nesting, scorer });
    }
  }
  for (const node of body) {
    if (node !== undefined) {
      walk({ node, nesting: nesting + 1, scorer });
    }
  }
}

function isLoopOrCatch(
  node: ts.Node,
): node is
  ts.ForStatement | ts.ForInStatement | ts.ForOfStatement | ts.WhileStatement | ts.DoStatement | ts.CatchClause {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCatchClause(node)
  );
}

function headerOf({
  node,
}: {
  node: ts.ForStatement | ts.ForInStatement | ts.ForOfStatement | ts.WhileStatement | ts.DoStatement | ts.CatchClause;
}): readonly (ts.Node | undefined)[] {
  if (ts.isForStatement(node)) {
    return [node.initializer, node.condition, node.incrementor];
  }
  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    return [node.expression];
  }
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    return [node.expression];
  }
  return [];
}

function bodyOf({
  node,
}: {
  node: ts.ForStatement | ts.ForInStatement | ts.ForOfStatement | ts.WhileStatement | ts.DoStatement | ts.CatchClause;
}): readonly (ts.Node | undefined)[] {
  return [ts.isCatchClause(node) ? node.block : node.statement];
}

/** Charges each `&&` run once (see `countAndRuns`), then walks the operands. */
function walkLogicalChain({
  node,
  nesting,
  scorer,
}: {
  node: ts.BinaryExpression;
  nesting: number;
  scorer: Scorer;
}): void {
  const { chain, leaves } = flattenLogical({ node });
  scorer.complexity += countAndRuns({ chain });
  for (const leaf of leaves) {
    walk({ node: leaf, nesting, scorer });
  }
}

function isLabelledJump({ node }: { node: ts.Node }): boolean {
  return (ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label !== undefined;
}

/**
 * Every over-complex function in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @param limit the complexity ceiling (defaults to {@link COGNITIVE_COMPLEXITY_LIMIT})
 * @returns each over-complex function, highest score first
 */
export function scanCognitiveComplexity({
  path,
  content,
  limit = COGNITIVE_COMPLEXITY_LIMIT,
}: {
  path: string;
  content: string;
  limit?: number;
}): readonly ComplexityHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly ComplexityHit[] => {
      const results: ComplexityHit[] = [];
      const visitTopLevel: NodeVisitor = (node) => {
        if (isFunctionLike(node) && node.body !== undefined) {
          const scorer = new Scorer();
          walk({ node: node.body, nesting: 0, scorer });
          if (scorer.complexity > limit) {
            const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            results.push({ complexity: scorer.complexity, name: nameOf({ node, sf }), path, startLine });
          }
        }
        forEachChild({ node, visit: visitTopLevel });
      };
      visitTopLevel(sf);
      return results.toSorted((a, b) => b.complexity - a.complexity);
    },
  });
}

/**
 * This gate's declared scan predicate: a `.ts` file under `src/`, `eval/` or `hooks/`, not this gate's own
 * source.
 */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "cognitiveComplexity" }),
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
 * IO edge: scan every in-scope source, print each over-complex function, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 an over-complex function found or not a git checkout)
 */
export function runCognitiveComplexity(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("cognitive-complexity: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<ComplexityHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanCognitiveComplexity({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "cognitive-complexity",
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
      `cognitive-complexity: clean (${String(readCount)} sources scanned, limit ${String(COGNITIVE_COMPLEXITY_LIMIT)})\n`,
    );
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(
      `  ${hit.path}:${String(hit.startLine)}: ${hit.name} (complexity ${String(hit.complexity)})\n`,
    );
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "cognitive-complexity" }),
      detail: `${String(hits.length)} function(s) over the ceiling of ${String(COGNITIVE_COMPLEXITY_LIMIT)}`,
    })}\n`,
  );
  return 1;
}
