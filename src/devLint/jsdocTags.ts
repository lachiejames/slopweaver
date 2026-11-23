/**
 * The JSDoc-tag gate — the ratchet that makes `.claude/rules/typescript-patterns.md`'s documentation rule
 * mechanical instead of prose, for every EXPORTED function in the repo.
 *
 * ## Why this is bespoke rather than `eslint-plugin-jsdoc`
 *
 * Measured, not assumed. The house rule is that a function with 1+ parameters takes a single destructured
 * named-object param, and the repo documents that param's FIELDS flatly — `@param source`, `@param home` —
 * which 773 of 795 documented exports already do. `eslint-plugin-jsdoc` cannot express that:
 *
 * - with `checkDestructured` on it demands `@param root0.source`, which would rewrite all 773;
 * - with it off, name checking stops entirely, so `@param typo` on `{ left, right }` PASSES. Verified.
 *
 * Tag presence is therefore not enough. The defect the owner cares about most is **doc rot** — a tag naming
 * a parameter that a rename removed — and only a set-equality check catches it. There were FOUR such tags in
 * the tree when this gate was written: three `@param args` for a field since renamed to `fields`/`verb`, and
 * a `@param slug` for a parameter that no longer existed. Every one was invisible to a presence-only rule
 * and to every reviewer who had read past it.
 *
 * The count is four rather than seven because the first draft of this scanner compared tags against the
 * BINDING PATTERN, which wrongly condemned three functions that document a field they deliberately never
 * bind — see {@link declaredFieldNames}. That correction is why this reads the declared TYPE.
 *
 * `require-returns` is also the wrong shape: it triggers on seeing a value-producing `return` STATEMENT, so
 * it has no option matching an exact `void`/`Promise<void>` exemption. Reading the declared return TYPE is
 * exact — see {@link needsReturnsTag} for the one function here that has no annotation at all, and why the
 * body decides in that case rather than failing closed.
 *
 * ## The attachment trap, which cost a wrong measurement before this existed
 *
 * `ts.getJSDocCommentsAndTags` credits a `/** … *\/` FILE-OVERVIEW comment to the first declaration below it,
 * even across a blank line. `src/lib/parsers.ts` opens with exactly that, so a first draft of this scanner
 * scored `isRecord` as documented when the file's own header was all it had. A block separated from its
 * declaration by a blank line documents the FILE, so {@link attachedBlock} refuses it.
 *
 * Pure {@link scanJsdocTags} (unit-tested with inline fixtures, syntax-only — no program, no type checker,
 * no I/O) plus an effectful {@link runJsdocTags} edge that walks the sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forEachChild,
  hasModifier,
  isFunctionLikeDeclaration,
  isTypeAssertion,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";
import { appendAll } from "../lib/arrays.js";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { scanCommentHygiene } from "./commentHygiene.js";
import { type DefectAt, type JsdocDefect, paramDefects } from "./jsdocParamDefects.js";
import { expectedParamNames } from "./jsdocParamNames.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import { repoRoot, type ScanScope, isScannablePath as scopeIsScannablePath } from "./scanScope.js";
import { unreadJsdocTags } from "./unreadJsdocTags.js";

/** An exported function-like, paired with the node its JSDoc block hangs off. */
interface ExportedFn {
  readonly node: ts.SignatureDeclaration;
  readonly host: ts.Node;
  readonly name: string;
}

/**
 * The JSDoc block that documents `node`, or undefined when there is none ATTACHED to it.
 *
 * A block is attached only when nothing but whitespace-without-a-blank-line and other comments sit between
 * its end and the declaration. A blank line makes it a file-overview or a stray note, not this function's
 * documentation — see the module header for the measurement that forced this.
 *
 * @param node the node whose leading comments are inspected
 * @param sf the source file the node belongs to
 * @returns the attached JSDoc node, or undefined
 */
function attachedBlock({ node, sf }: { node: ts.Node; sf: ts.SourceFile }): ts.JSDoc | undefined {
  const text = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart());
  // The compiler API answers `undefined`, not an empty list, for a node with no leading comment: no last block.
  const last = ranges?.findLast((range) => text.slice(range.pos, range.pos + 3) === "/**");
  if (last === undefined) {
    return undefined;
  }
  const between = text.slice(last.end, node.getStart(sf));
  if (/\n[ \t]*\n/.test(between)) {
    return undefined;
  }
  const blocks = ts.getJSDocCommentsAndTags(node).filter((n): n is ts.JSDoc => ts.isJSDoc(n));
  return blocks.find((block) => block.end === last.end);
}

/** The text of a JSDoc comment field, flattened and trimmed (`undefined` and link-only count as blank). */
function commentText({ comment }: { comment: string | ts.NodeArray<ts.JSDocComment> | undefined }): string {
  if (comment === undefined) {
    return "";
  }
  if (typeof comment === "string") {
    return comment.trim();
  }
  const flattened = ts.getTextOfJSDocComment(comment);
  return flattened === undefined ? "" : flattened.trim();
}

/**
 * The `@param` names declared on a block, VERBATIM.
 *
 * Deliberately not reduced to a leaf. An earlier draft stripped a `root0.` prefix, carried over from when this
 * was going to be `eslint-plugin-jsdoc` — whose autofix writes that form. The plugin is gone, and the strip
 * was left behind as pure leniency: `.claude/rules/typescript-patterns.md` requires the FLAT field name, so
 * accepting `@param root0.source` for a field called `source` made the gate permit the one spelling the prose
 * forbids. That rules file says a gate disagreeing with its prose is a defect in one of them, and it was this.
 * Codex found it. Keeping the name whole means a dotted tag matches no field and is reported twice — once for
 * the undocumented field, once for the tag naming nothing — both with accurate messages.
 */
function paramTagNames({ block }: { block: ts.JSDoc }): readonly { name: string; description: string }[] {
  return Array.from(block.tags ?? [])
    .filter((tag): tag is ts.JSDocParameterTag => tag.tagName.text === "param")
    .map((tag) => ({
      description: commentText({ comment: tag.comment }),
      name: ts.isIdentifier(tag.name) ? tag.name.text : tag.name.getText(),
    }));
}

/** The `@returns` (or `@return`) tags on a block. */
function returnTags({ block }: { block: ts.JSDoc }): readonly ts.JSDocTag[] {
  return Array.from(block.tags ?? []).filter((tag) => tag.tagName.text === "returns" || tag.tagName.text === "return");
}

/** Whether a type node is `void` or `never` — the two that promise no value to document. */
function isValuelessType({ type }: { type: ts.TypeNode }): boolean {
  return type.kind === ts.SyntaxKind.VoidKeyword || type.kind === ts.SyntaxKind.NeverKeyword;
}

/**
 * Whether a body yields a value, not descending into nested functions.
 *
 * A CONCISE arrow body is itself the returned value, so there is no `ReturnStatement` to find — an earlier
 * version looked only for statements and therefore accepted `export const answer: () => number = () => 42`
 * with no `@returns`. Codex found it. `void expr` is the one concise body whose value is undefined by
 * definition, so it is excluded.
 */
function returnsAValue({ body }: { body: ts.Node }): boolean {
  if (!ts.isBlock(body)) {
    return !ts.isVoidExpression(body);
  }
  // A truthy visit stops `forEachChild`, so the first value-bearing `return` ends the whole walk.
  const walk: NodeVisitor<boolean> = (node) => {
    if (isFunctionLikeDeclaration(node)) {
      return undefined;
    }
    return (ts.isReturnStatement(node) && node.expression !== undefined) || forEachChild({ node, visit: walk });
  };
  return forEachChild({ node: body, visit: walk }) === true;
}

/**
 * Whether a function needs a `@returns` tag.
 *
 * The DECLARED return type decides it, because that is exact: `void`, `never`, `Promise<void>` and
 * `Promise<never>` do not need one — there is no value to describe, and demanding "@returns nothing" is the
 * ceremony the rule never intended.
 *
 * With no annotation the BODY decides instead. Measured: exactly one exported function here has none —
 * `unrefIntervalStallTimer`, whose type comes from the `StallTimer` alias on its variable rather than from
 * the arrow — and it returns nothing. Failing closed there would have demanded `@returns` on a void
 * function, which is the exact noise the void exemption exists to prevent.
 *
 * @param type the declared return type annotation, or undefined when there is none
 * @param body the function body, consulted only when there is no annotation
 * @returns true when the function must carry a `@returns` tag
 */
function needsReturnsTag({ type, body }: { type: ts.TypeNode | undefined; body: ts.Node | undefined }): boolean {
  if (type === undefined) {
    return body !== undefined && returnsAValue({ body });
  }
  if (isValuelessType({ type })) {
    return false;
  }
  if (!ts.isTypeReferenceNode(type)) {
    return true;
  }
  const name = ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.getText();
  const arg = type.typeArguments?.length === 1 ? type.typeArguments[0] : undefined;
  if (name !== "Promise" || arg === undefined) {
    return true;
  }
  return !isValuelessType({ type: arg });
}

/** The `@returns` defects: a missing tag on a value-returning function, or a tag with no description. */
function returnsDefects({
  block,
  node,
  at,
}: {
  block: ts.JSDoc;
  node: ts.SignatureDeclaration;
  at: DefectAt;
}): readonly JsdocDefect[] {
  const defects: JsdocDefect[] = [];
  const returns = returnTags({ block });
  // `SignatureDeclaration` unions several node kinds (method signatures, function types, …) that never
  // declare a `body` property at all — the `in` check narrows to only the ones that do, so this needs no cast.
  const body = "body" in node ? node.body : undefined;
  if (needsReturnsTag({ body, type: node.type }) && returns.length === 0) {
    defects.push(at({ detail: "no @returns, and the return type carries a value", kind: "missing-returns" }));
  }
  for (const blank of returns.filter((tag) => commentText({ comment: tag.comment }) === "")) {
    defects.push(at({ detail: `@${blank.tagName.text} has no description`, kind: "blank-description" }));
  }
  return defects;
}

/** Every defect on one exported function, given its attached block. */
function documentedDefects({
  entry,
  block,
  path,
  line,
  sf,
}: {
  entry: ExportedFn;
  block: ts.JSDoc;
  path: string;
  line: number;
  sf: ts.SourceFile;
}): readonly JsdocDefect[] {
  const at: DefectAt = ({ kind, detail }) => ({ detail, kind, line, name: entry.name, path });
  const defects: JsdocDefect[] = [];
  if (commentText({ comment: block.comment }) === "") {
    defects.push(at({ detail: "the block has no prose description", kind: "no-description" }));
  }
  const tags = paramTagNames({ block });
  appendAll({
    from: paramDefects({ at, expected: expectedParamNames({ node: entry.node, sf }), tags }),
    into: defects,
  });
  appendAll({ from: returnsDefects({ at, block, node: entry.node }), into: defects });
  return defects;
}

/**
 * Whether a class member is gated: public methods are, constructors and private/protected members are not.
 *
 * Positional because TS1230 forbids destructuring in a type predicate — the documented exception to the
 * named-object rule, and the same reason `isRecord` in `src/lib/parsers.ts` is positional.
 *
 * @param member the class member to narrow
 * @returns true for a public method with a body; a constructor has no return contract, so it is excluded
 */
function isGatedMember(member: ts.ClassElement): member is ts.MethodDeclaration {
  if (!ts.isMethodDeclaration(member) || member.body === undefined) {
    return false;
  }
  const hidden = ts.ModifierFlags.Private | ts.ModifierFlags.Protected;
  return (ts.getCombinedModifierFlags(member) & hidden) === 0;
}

/**
 * The function hiding under any number of type-only wrappers, or undefined when there is none.
 *
 * A type-only wrapper is an expression that ERASES at runtime and does not change the value, so the function
 * underneath is still the thing being exported. The set below is the complete list of those in TypeScript —
 * parentheses, `as T`, `satisfies T`, the angle-bracket `<T>x`, and the non-null `x!` — which is why it is
 * fixed rather than growing. An earlier version listed only the three someone had thought of, and Codex found
 * the gap twice: first `satisfies`, then `<T>x`. Enumerating a CATEGORY with a stated boundary is the fix;
 * enumerating remembered examples is what produced two rounds of the same finding.
 *
 * A `CallExpression` is deliberately NOT unwrapped even though it also carries an `.expression`:
 * `export const f = makeFn()` exports the call's RESULT, so unwrapping would document the factory instead of
 * the export — and the factory is often not exported at all. The boundary is "erases at runtime", not "has a
 * child expression".
 *
 * `satisfies` matters more than its shape suggests: this repo's own style guide says to prefer it over type
 * assertions, so the gate had a hole in the construct it actively recommends.
 *
 * @param node the initializer expression to unwrap
 * @returns the function-like underneath, or undefined when the initializer is not one
 */
function unwrapFunctionInitializer({
  node,
}: {
  node: ts.Expression;
}): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return node;
  }
  const erasesAtRuntime =
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    isTypeAssertion(node) ||
    ts.isNonNullExpression(node);
  return erasesAtRuntime ? unwrapFunctionInitializer({ node: node.expression }) : undefined;
}

/** The exported arrow/function-expression constants a variable statement declares. */
function exportedFnsOfVariable({ stmt }: { stmt: ts.VariableStatement }): readonly ExportedFn[] {
  const found: ExportedFn[] = [];
  for (const decl of stmt.declarationList.declarations) {
    const outer = decl.initializer;
    const init = outer === undefined ? undefined : unwrapFunctionInitializer({ node: outer });
    if (init === undefined) {
      continue;
    }
    found.push({ host: stmt, name: ts.isIdentifier(decl.name) ? decl.name.text : "(anonymous)", node: init });
  }
  return found;
}

/** The gated public methods of an exported class — constructors and private/protected members excluded. */
function exportedFnsOfClass({ stmt, sf }: { stmt: ts.ClassDeclaration; sf: ts.SourceFile }): readonly ExportedFn[] {
  const { name } = stmt;
  // An anonymous `export default class` has no name node, and `default` IS the name it is exported under.
  const className = name === undefined ? "default" : name.text;
  return stmt.members
    .filter((candidate) => isGatedMember(candidate))
    .map((method) => ({ host: method, name: `${className}.${method.name.getText(sf)}`, node: method }));
}

/** Every exported function-like in a source file, with the node its JSDoc hangs off. */
function exportedFunctions({ sf }: { sf: ts.SourceFile }): readonly ExportedFn[] {
  const found: ExportedFn[] = [];
  for (const stmt of sf.statements) {
    // The modifiers, not a cast to `Declaration` for `getCombinedModifierFlags`: `export default` counts too.
    if (!hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: stmt })) {
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.body !== undefined) {
      found.push({ host: stmt, name: stmt.name?.text ?? "default", node: stmt });
    } else if (ts.isVariableStatement(stmt)) {
      appendAll({ from: exportedFnsOfVariable({ stmt }), into: found });
    } else if (ts.isClassDeclaration(stmt)) {
      appendAll({ from: exportedFnsOfClass({ sf, stmt }), into: found });
    }
  }
  return found;
}

/**
 * Every documentation defect on the exported functions of one source file. Pure — parses `content` in memory
 * with the TypeScript AST, so a test asserts exactly which functions trip it.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns every defect, in source order
 */
export function scanJsdocTags({ path, content }: { path: string; content: string }): readonly JsdocDefect[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly JsdocDefect[] => {
      const defects: JsdocDefect[] = [];
      for (const entry of exportedFunctions({ sf })) {
        const line = sf.getLineAndCharacterOfPosition(entry.node.getStart(sf)).line + 1;
        const block = attachedBlock({ node: entry.host, sf });
        if (block === undefined) {
          defects.push({
            detail: "no JSDoc block immediately above the declaration",
            kind: "no-block",
            line,
            name: entry.name,
            path,
          });
          continue;
        }
        for (const defect of documentedDefects({ block, entry, line, path, sf })) {
          defects.push(defect);
        }
      }
      return defects;
    },
  });
}

/**
 * This gate's declared scan predicate: every `.ts` source, repo-wide — wider than any tree-scoped
 * gate here (`trees: []`, `testing-discipline`'s shape), because JSDoc coverage isn't confined to `src/`,
 * `eval/` or `hooks/`. No `selfFiles` exclusion: unlike a pattern-matching gate, this one's own source is
 * ordinary JSDoc-bearing code, not a text blob that would trip its own rules by containing them.
 */
const SCOPE: ScanScope = { selfFiles: new Set(), trees: [] };

/**
 * Whether a path is in scope: TypeScript sources, excluding declaration files.
 *
 * @param path the repo-relative path
 * @returns true for a `.ts` source. Declaration files are excluded because they declare rather than
 *   implement; test-support modules are NOT, since they export helpers like any other module
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE }) && !path.endsWith(".d.ts");
}

/** Every code extension a compiler reads JSDoc out of — the import seam's own list. */
const CODE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Whether a path gets the unread-tag check: every code source, declaration files included, because a reader takes
 * tags out of JavaScript (`typescript-import-seam`'s `@import`) as well as TypeScript.
 *
 * @param path the repo-relative path
 * @returns true for a file with a code extension
 */
function isUnreadTagPath({ path }: { path: string }): boolean {
  return CODE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * IO edge: scan every in-scope source, print each defect, return 0 (clean) or 1 (any defect).
 *
 * @returns the process exit code (0 clean, 1 a defect was found, the tree unreadable, or not a git checkout)
 */
export function runJsdocTags(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRoot();
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("jsdoc-tags: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const { hits, scanned, unreadable } = scanTextFiles({
    paths: listing.filter((path) => isUnreadTagPath({ path })),
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ path, content }) => [
      ...(isScannablePath({ path })
        ? [
            ...scanJsdocTags({ content, path }),
            ...scanCommentHygiene({ content, path }).map((defect): JsdocDefect => ({ ...defect, name: "" })),
          ]
        : []),
      ...unreadJsdocTags({ content, path }).map((defect): JsdocDefect => ({ ...defect, name: "" })),
    ],
  });

  if (hits.length > 0) {
    for (const hit of hits) {
      const at = hit.name === "" ? "" : ` ${hit.name}`;
      process.stderr.write(`  ${hit.path}:${String(hit.line)}${at} — ${hit.detail}\n`);
    }
  }
  const complete = reportScanIntegrity({
    label: "jsdoc-tags",
    scanned,
    unreadable,
    write: (text) => process.stderr.write(text),
  });
  const outcome = gateOutcome({ refused: hits.length, unseen: complete ? 0 : 1 });
  if (outcome === "incomplete") {
    return 1;
  }
  if (outcome === "refused") {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "jsdoc-tags" }),
        detail: `${String(hits.length)} documentation defect(s)`,
      })}\n`,
    );
    return 1;
  }
  process.stdout.write(`jsdoc-tags: clean (${String(scanned)} sources scanned)\n`);
  return 0;
}
