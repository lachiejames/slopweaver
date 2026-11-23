/**
 * The house-rules gate — ports the `no-restricted-syntax` AST selectors that used to live only in
 * `eslint.config.js` (deleted along with ESLint itself) into a direct TypeScript-compiler-API walk, so
 * dropping ESLint does not silently drop the rules it happened to carry. Same two groups as before:
 *
 *   - {@link ALWAYS_RULES}: fail-loud + entry-point conventions, enforced EVERYWHERE (production and tests).
 *   - {@link CAST_BAN_RULES}: the escape-hatch bans (`as any`, double casts, untyped `metadata`, `z.any()`,
 *     `z.coerce.boolean()`), enforced only OUTSIDE tests — casts are common, acceptable test ergonomics.
 *   - {@link ATOMIC_WRITE_RULES}: the hand-rolled crash-durable-write ban, enforced everywhere except the
 *     one module that IS the durable write.
 *
 * Pure {@link scanHouseRules} (unit-tested with inline fixtures) + an effectful {@link runHouseRules} edge.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forEachChild,
  isFunctionLikeDeclaration,
  isStringLiteralLikeNode,
  isTypeAssertion,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";
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

/** One house-rule violation: where it is, which rule, and the message to show. */
export interface HouseRuleHit {
  readonly path: string;
  readonly line: number;
  readonly id: string;
  readonly message: string;
}

/** One rule: an id, a display message, and a predicate over a single AST node. */
interface HouseRule {
  readonly id: string;
  readonly message: string;
  readonly matches: (args: { node: ts.Node }) => boolean;
}

const EMPTY_COALESCE_MESSAGE =
  'Do not coalesce to an empty string (`?? ""`). Fail loud — throw, or use an honest `x!` assertion.';

/** Fail-loud + entry-point house rules — enforced in production code AND tests. */
const ALWAYS_RULES: readonly HouseRule[] = [
  { id: "no-empty-string-coalesce", matches: isEmptyStringCoalesce, message: EMPTY_COALESCE_MESSAGE },
  {
    id: "no-empty-template-coalesce",
    matches: isEmptyTemplateCoalesce,
    message:
      "Do not coalesce to an empty template literal (`?? ``). Fail loud — throw, or use an honest `x!` assertion.",
  },
  {
    id: "no-in-place-sort",
    matches: isInPlaceSortCall,
    message:
      "Do not mutate an array in place with `.sort()`/`['sort']()` — use `.toSorted()`. A shared array sorted " +
      "in place changes under whoever else holds it. (Convention gate: an aliased `sort` reference escapes it.)",
  },
  {
    id: "no-is-direct-invocation",
    matches: isIsDirectInvocationIdentifier,
    message:
      "Use the entry-point-file pattern (a tiny *.entry.ts that runs importable logic), not an " +
      "isDirectInvocation guard.",
  },
  {
    id: "no-process-argv-1",
    matches: isProcessArgv1,
    message: "Do not read process.argv[1]. Use the entry-point-file pattern instead of self-invocation guards.",
  },
];

/** Escape-hatch bans — production code only; tests may cast freely. */
const CAST_BAN_RULES: readonly HouseRule[] = [
  {
    id: "no-metadata-cast",
    matches: isMetadataCast,
    message: "Do not assert types for `metadata`/`*.metadata`. Decode with a runtime schema (Zod) instead.",
  },
  {
    id: "no-as-any",
    matches: isAnyCast,
    message: "Do not use `as any`/`<any>` in production code. Narrow with a type guard or decode with a schema.",
  },
  {
    id: "no-double-cast",
    matches: isDoubleAsCast,
    message: "Do not use double casts (`as unknown as`). Narrow with a type guard or decode with a schema.",
  },
  {
    id: "no-z-any",
    matches: isZodAnyCall,
    message: "Do not use z.any(). Define a concrete schema instead.",
  },
  {
    id: "no-z-coerce-boolean",
    matches: isZodCoerceBooleanCall,
    message: "Do not use z.coerce.boolean(). Boolean('false') === true. Use z.string().transform() instead.",
  },
];

/**
 * The one module allowed to spell the temp-file-plus-rename sequence out: it IS that sequence, and every
 * other site calls it.
 */
const ATOMIC_WRITE_MODULE = "src/lib/writeAtomic.ts";

/** The hand-rolled-durable-write ban — enforced everywhere but {@link ATOMIC_WRITE_MODULE}. */
const ATOMIC_WRITE_RULES: readonly HouseRule[] = [
  {
    id: "no-hand-rolled-atomic-write",
    matches: isTempFileRename,
    message:
      "Do not hand-roll a temp-file-plus-rename write. Call `writeFileAtomic` from `src/lib/writeAtomic.ts` " +
      "instead: `renameSync` is atomic for VISIBILITY but not for DURABILITY, so without an fsync of the " +
      "file AND of its directory a crash can leave the renamed path truncated or empty.",
  },
];

/** A name that reads as a staging file — the first argument of every hand-rolled atomic write. */
const STAGING_NAME = /tmp|temp|staged|staging|partial/i;

/**
 * A sync-or-async rename whose FIRST argument reads as a staging file — the shape every hand-rolled atomic
 * write has, and the shape a legitimate rename (archiving a directory, moving a finished file aside) does
 * not. Spelled without the call syntax on purpose: `door-coverage` scans this file as TEXT, so an example
 * written out here would register as a real fs seam.
 */
function isTempFileRename({ node }: { node: ts.Node }): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  if (!isCalled({ names: RENAME_NAMES, node })) {
    return false;
  }
  const source = node.arguments[0];
  if (source === undefined || !STAGING_NAME.test(source.getText())) {
    return false;
  }
  return !publishesAHardlink({ node });
}

/** The two spellings of a rename, and the two of a hardlink. */
const RENAME_NAMES: ReadonlySet<string> = new Set(["rename", "renameSync"]);
const LINK_NAMES: ReadonlySet<string> = new Set(["link", "linkSync"]);

/** Whether a call expression invokes one of `names`, however the function was reached. */
function isCalled({ node, names }: { node: ts.CallExpression; names: ReadonlySet<string> }): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    return names.has(callee.text);
  }
  return ts.isPropertyAccessExpression(callee) && names.has(callee.name.text);
}

/**
 * Whether the staging file this rename publishes was made by a HARDLINK rather than by a write.
 *
 * The rule exists because a rename is atomic for visibility and not for durability, so bytes this process
 * just wrote must be fsynced before they are published. A hardlink publishes an inode some other writer
 * already made durable — there are no bytes of ours to fsync, and `writeFileAtomic` cannot express the
 * operation at all. `worktree/execInodesApply.ts` is the case: it renames a second link to an exec-store
 * entry over a checkout's own binary, so the file is never absent and never partial.
 *
 * Scoped to the enclosing function so the evidence is local rather than file-wide: a module that both writes
 * a temp file and links one still has its write checked.
 */
function publishesAHardlink({ node }: { node: ts.CallExpression }): boolean {
  let scope: ts.Node = node.parent;
  while (!isFunctionLikeDeclaration(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent;
  }
  if (ts.isSourceFile(scope)) {
    return false;
  }
  let found = false;
  const visit: NodeVisitor = (child) => {
    if (ts.isCallExpression(child) && isCalled({ names: LINK_NAMES, node: child })) {
      found = true;
    }
    forEachChild({ node: child, visit });
  };
  forEachChild({ node: scope, visit });
  return found;
}

/** `x ?? ""` — a nullish-coalesce whose right side is the empty STRING literal (not a template). */
function isEmptyStringCoalesce({ node }: { node: ts.Node }): boolean {
  return isNullishCoalesce(node) && ts.isStringLiteral(node.right) && node.right.text === "";
}

/** `x ?? \`\`` — a nullish-coalesce whose right side is an empty no-substitution template. */
function isEmptyTemplateCoalesce({ node }: { node: ts.Node }): boolean {
  return isNullishCoalesce(node) && ts.isNoSubstitutionTemplateLiteral(node.right) && node.right.text === "";
}

/** A `??` binary expression, narrowed so callers can read `.right` without re-checking. */
function isNullishCoalesce(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
}

/** `x.sort()` or `x['sort']()` — an in-place-mutating call, however the property was reached. */
function isInPlaceSortCall({ node }: { node: ts.Node }): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text === "sort";
  }
  if (ts.isElementAccessExpression(callee) && isStringLiteralLikeNode(callee.argumentExpression)) {
    return callee.argumentExpression.text === "sort";
  }
  return false;
}

/** The bare identifier `isDirectInvocation`, wherever it's read. */
function isIsDirectInvocationIdentifier({ node }: { node: ts.Node }): boolean {
  return ts.isIdentifier(node) && node.text === "isDirectInvocation";
}

/** `process.argv[1]` — the second CLI argument, read directly instead of via the entry-point pattern. */
function isProcessArgv1({ node }: { node: ts.Node }): boolean {
  if (!ts.isElementAccessExpression(node) || !ts.isNumericLiteral(node.argumentExpression)) {
    return false;
  }
  if (node.argumentExpression.text !== "1") {
    return false;
  }
  const target = node.expression;
  return (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "argv" &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === "process"
  );
}

/** `metadata as T` / `<T>metadata` / `x.metadata as T` / `<T>x.metadata` — an untrusted shape asserted, not decoded. */
function isMetadataCast({ node }: { node: ts.Node }): boolean {
  const expression = castExpressionOf({ node });
  if (expression === undefined) {
    return false;
  }
  if (ts.isIdentifier(expression)) {
    return expression.text === "metadata";
  }
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "metadata";
}

/** `x as any` / `<any>x`. */
function isAnyCast({ node }: { node: ts.Node }): boolean {
  if (ts.isAsExpression(node)) {
    return node.type.kind === ts.SyntaxKind.AnyKeyword;
  }
  if (isTypeAssertion(node)) {
    return node.type.kind === ts.SyntaxKind.AnyKeyword;
  }
  return false;
}

/** `x as unknown as T` — an `as` expression casting an already-cast expression. */
function isDoubleAsCast({ node }: { node: ts.Node }): boolean {
  return ts.isAsExpression(node) && ts.isAsExpression(node.expression);
}

/** The cast expression's operand, for `as`/`<T>` forms alike; `undefined` when `node` is neither. */
function castExpressionOf({ node }: { node: ts.Node }): ts.Expression | undefined {
  if (ts.isAsExpression(node) || isTypeAssertion(node)) {
    return node.expression;
  }
  return undefined;
}

/** `z.any()`. */
function isZodAnyCall({ node }: { node: ts.Node }): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  const callee = node.expression;
  return callee.name.text === "any" && ts.isIdentifier(callee.expression) && callee.expression.text === "z";
}

/** `z.coerce.boolean()`. */
function isZodCoerceBooleanCall({ node }: { node: ts.Node }): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  const callee = node.expression;
  if (callee.name.text !== "boolean" || !ts.isPropertyAccessExpression(callee.expression)) {
    return false;
  }
  return callee.expression.name.text === "coerce";
}

/**
 * Every house-rule violation in `content`. Pure — parses in memory with the TypeScript AST. `*.test.ts`
 * (by `path`) skips {@link CAST_BAN_RULES} and {@link ATOMIC_WRITE_MODULE} skips
 * {@link ATOMIC_WRITE_RULES}; every other rule applies everywhere.
 *
 * @param path the file's repo-relative path (decides test and self scope, and used for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanHouseRules({ path, content }: { path: string; content: string }): readonly HouseRuleHit[] {
  const rules = [
    ...ALWAYS_RULES,
    ...(path.endsWith(".test.ts") ? [] : CAST_BAN_RULES),
    ...(path === ATOMIC_WRITE_MODULE ? [] : ATOMIC_WRITE_RULES),
  ];
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly HouseRuleHit[] => {
      const hits: HouseRuleHit[] = [];
      const visit: NodeVisitor = (node) => {
        for (const rule of rules) {
          if (rule.matches({ node })) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            hits.push({ id: rule.id, line, message: rule.message, path });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * This gate's declared scan predicate: a `.ts` file under `src/`, `eval/` or `hooks/`, not this gate's own
 * source — the same tree `eslint.config.js`'s `TS_GLOBS` used to cover.
 */
const SCOPE: ScanScope = { selfFiles: gateSelfFiles({ stem: "houseRules" }), trees: ["src/", "eval/", "hooks/"] };

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
 * IO edge: scan every in-scope source, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runHouseRules(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("house-rules: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<HouseRuleHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanHouseRules({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "house-rules",
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
    process.stdout.write(`house-rules: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: [${hit.id}] ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "house-rules" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
