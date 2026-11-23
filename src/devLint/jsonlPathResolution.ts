/**
 * Deciding, without a type checker, whether an expression IS a `.jsonl` path — the resolution half of the
 * `whole-file-json` gate. The gate indexes path-helper names across the tree to a fixpoint; this module owns
 * what a single expression must be to resolve (a literal, an indexed property's last segment, a call to an
 * indexed helper, a `join`/`resolve` over one of those, or either arm of a conditional), the per-file path
 * locals, and the unambiguity tally both passes share. The criterion and its measurements are in
 * `wholeFileJson.ts`'s header.
 */
import type { NodeVisitor } from "#lib/tsSyntax.js";
import { forEachChild, isParameterDeclaration, isStringLiteralLikeNode, ts } from "#lib/tsSyntax.js";

/**
 * The names, indexed from the whole tree, that unambiguously resolve to a `.jsonl` path.
 *
 * @internal — the gate's own two passes and its unit test are the only readers.
 */
export interface JsonlNameIndex {
  /** Function names whose returned expression resolves to a `.jsonl` path, directly or through another indexed name. */
  readonly functions: ReadonlySet<string>;
  /** Object-property names whose initializer resolves to a `.jsonl` path, the same way. */
  readonly properties: ReadonlySet<string>;
}

/** A `.jsonl` inside a string or template literal — the only place a path suffix can legitimately appear. */
const JSONL_LITERAL = /["'`][^"'`]*\.jsonl/;

/** The path builders: a call to one of these IS the path its arguments assemble. `node:path`'s two. */
const PATH_BUILDERS: ReadonlySet<string> = new Set(["join", "resolve"]);

/** A name's tally across the tree: how many declarations of it name a `.jsonl`, and how many exist at all. */
export interface NameTally {
  jsonl: number;
  total: number;
}

/**
 * Count one name's declaration into a tally map.
 *
 * @param into the tally map to mutate
 * @param name the declared name
 * @param namesJsonl whether this declaration resolves to a `.jsonl`, by whatever route the caller judged
 */
export function tally({
  into,
  name,
  namesJsonl,
}: {
  into: Map<string, NameTally>;
  name: string;
  namesJsonl: boolean;
}): void {
  // A name's first declaration starts its tally; every later one adds to it.
  const current = into.has(name) ? into.get(name)! : { jsonl: 0, total: 0 };
  current.total += 1;
  if (namesJsonl) {
    current.jsonl += 1;
  }
  into.set(name, current);
}

/**
 * The names a tally map proves UNAMBIGUOUS: every declaration of them names a `.jsonl`.
 *
 * @param tallies the tally map
 * @returns the unambiguous names
 */
export function unambiguous({ tallies }: { tallies: ReadonlyMap<string, NameTally> }): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [name, counts] of tallies) {
    if (counts.jsonl > 0 && counts.jsonl === counts.total) {
      names.add(name);
    }
  }
  return names;
}

/**
 * The called function's own name, for `f(…)` and `o.f(…)` alike.
 *
 * @param call the call expression
 * @returns the callee's name, or the empty string for any other callee
 */
export function calleeName({ call }: { call: ts.CallExpression }): string {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return "";
}

/**
 * Whether a path expression resolves to a `.jsonl`. A property access is judged on its LAST segment, so a
 * bag-of-paths helper's own name never decides for a `.json` leaf hanging off it.
 *
 * @param expression the path argument
 * @param index the unambiguous name index
 * @param locals this file's own names bound to a `.jsonl` path
 * @param source the file being scanned, for text
 * @returns true when the expression names a `.jsonl`
 */
export function pathNamesJsonl({
  expression,
  index,
  locals,
  source,
}: {
  expression: ts.Expression;
  index: JsonlNameIndex;
  locals: ReadonlySet<string>;
  source: ts.SourceFile;
}): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    return index.properties.has(expression.name.text);
  }
  return namesJsonlWithin({ index, locals, node: expression }) || JSONL_LITERAL.test(expression.getText(source));
}

/**
 * Whether any node in a subtree names a `.jsonl` through the index. A property access answers for itself and
 * its own chain rather than descending, which is what keeps a bag-of-paths helper's name off a `.json` leaf.
 *
 * @param node the subtree root
 * @param index the unambiguous name index
 * @param locals this file's own names bound to a `.jsonl` path
 * @returns true when the subtree names a `.jsonl`
 */
function namesJsonlWithin({
  node,
  index,
  locals,
}: {
  node: ts.Node;
  index: JsonlNameIndex;
  locals: ReadonlySet<string>;
}): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return index.properties.has(node.name.text);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && index.functions.has(node.expression.text)) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    return locals.has(node.text);
  }
  // A truthy visit stops `forEachChild`, so this answers as `some` over the children did.
  return forEachChild({ node, visit: (child) => namesJsonlWithin({ index, locals, node: child }) }) === true;
}

/**
 * Whether an expression IS a `.jsonl` path — the criterion a DECLARATION must meet to be indexed, and a
 * deliberately narrower one than {@link pathNamesJsonl} applies at a read or write site. A site is judged on
 * whether its argument MENTIONS a `.jsonl` anywhere, because at the site of harm a wide net is the point; a
 * declaration is indexed only when the value it binds resolves to a path, because the index feeds itself —
 * every name it admits makes more names reachable in the next round — and "mentions" would admit every
 * reader that touches a ledger as though it were a path to one. MEASURED on this tree: the
 * "mentions" criterion applied to declarations indexed 190 functions, `readAskLifecycleText` and
 * `productionBriefingRenderDeps` among them; this one indexes 51, every one a helper that returns a path.
 *
 * The shapes that resolve: a literal naming a `.jsonl`; a property access whose last segment is indexed; a
 * name this file binds unambiguously; a call to an indexed helper; a `join`/`resolve` call any of whose
 * arguments resolves; parentheses, a conditional or a `??`/`||` whose either arm resolves; and an arrow
 * function whose expression body resolves, so a property holding `({ dir }) => join(dir, "asks.jsonl")`
 * is a path helper by another spelling. Anything else — an object literal, a `readFileSync(…)`, a parser
 * call, a block-bodied function — is a value, not a path.
 *
 * @param expression the bound value
 * @param index the unambiguous name index
 * @param locals this file's own names bound to a `.jsonl` path
 * @param source the file being scanned, for literal text
 * @returns true when the expression resolves to a `.jsonl` path
 */
export function resolvesToJsonl({
  expression,
  index,
  locals,
  source,
}: {
  expression: ts.Expression;
  index: JsonlNameIndex;
  locals: ReadonlySet<string>;
  source: ts.SourceFile;
}): boolean {
  if (leafResolvesToJsonl({ expression, index, locals, source })) {
    return true;
  }
  return builtResolvesToJsonl({ expression, index, locals, source });
}

/**
 * The LEAF half of {@link resolvesToJsonl}: an expression that IS the path, with nothing to recurse into —
 * a literal naming a `.jsonl`, a property access whose last segment the index proved, or a name this file
 * binds unambiguously. Anything else is false here and is offered to {@link builtResolvesToJsonl} next.
 *
 * @param expression the bound value
 * @param index the unambiguous name index
 * @param locals this file's own names bound to a `.jsonl` path
 * @param source the file being scanned, for literal text
 * @returns true when the expression is itself a `.jsonl` path
 */
function leafResolvesToJsonl({
  expression,
  index,
  locals,
  source,
}: {
  expression: ts.Expression;
  index: JsonlNameIndex;
  locals: ReadonlySet<string>;
  source: ts.SourceFile;
}): boolean {
  if (isStringLiteralLikeNode(expression) || ts.isTemplateExpression(expression)) {
    return JSONL_LITERAL.test(expression.getText(source));
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return index.properties.has(expression.name.text);
  }
  if (ts.isIdentifier(expression)) {
    return locals.has(expression.text);
  }
  return false;
}

/**
 * The BUILT half of {@link resolvesToJsonl}: a wrapper or a builder whose arms decide — parentheses, an
 * arrow function's expression body, either arm of a conditional or a `??`/`||`, and (through
 * {@link callResolvesToJsonl}) a call. A `&&` is deliberately not here: its value is the RIGHT arm or a
 * falsy left one, so neither arm alone proves a path.
 *
 * @param expression the bound value
 * @param index the unambiguous name index
 * @param locals this file's own names bound to a `.jsonl` path
 * @param source the file being scanned, for literal text
 * @returns true when the expression builds a `.jsonl` path out of parts that resolve
 */
function builtResolvesToJsonl({
  expression,
  index,
  locals,
  source,
}: {
  expression: ts.Expression;
  index: JsonlNameIndex;
  locals: ReadonlySet<string>;
  source: ts.SourceFile;
}): boolean {
  const resolves = ({ arm }: { arm: ts.Expression }): boolean =>
    resolvesToJsonl({ expression: arm, index, locals, source });
  if (ts.isParenthesizedExpression(expression)) {
    return resolves({ arm: expression.expression });
  }
  if (ts.isArrowFunction(expression)) {
    return ts.isBlock(expression.body) ? false : resolves({ arm: expression.body });
  }
  if (ts.isConditionalExpression(expression)) {
    return resolves({ arm: expression.whenTrue }) || resolves({ arm: expression.whenFalse });
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    const eitherArm = operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken;
    return eitherArm && (resolves({ arm: expression.left }) || resolves({ arm: expression.right }));
  }
  if (ts.isCallExpression(expression)) {
    return callResolvesToJsonl({ call: expression, index, locals, source });
  }
  return false;
}

/**
 * Whether a CALL resolves to a `.jsonl` path: a call to a helper the index already proved, or a
 * `join`/`resolve` any of whose arguments resolves. A call to anything else is a value — `readFileSync(p)`
 * returns the file's TEXT, not its path, and indexing the reader as a helper is how a self-feeding index
 * would swallow the tree.
 *
 * @param call the call expression
 * @param index the unambiguous name index
 * @param locals this file's own names bound to a `.jsonl` path
 * @param source the file being scanned, for literal text
 * @returns true when the call's value is a `.jsonl` path
 */
function callResolvesToJsonl({
  call,
  index,
  locals,
  source,
}: {
  call: ts.CallExpression;
  index: JsonlNameIndex;
  locals: ReadonlySet<string>;
  source: ts.SourceFile;
}): boolean {
  const name = calleeName({ call });
  if (ts.isIdentifier(call.expression) && index.functions.has(name)) {
    return true;
  }
  if (!PATH_BUILDERS.has(name)) {
    return false;
  }
  return call.arguments.some((argument) => resolvesToJsonl({ expression: argument, index, locals, source }));
}

/**
 * Pure pass 1b, per file: the LOCAL names that unambiguously hold a `.jsonl` path.
 *
 * This is the blind spot the gate's own header used to state and no longer has to. A path parked in a local
 * before the read — `const path = jumpcloudResumePath({ directory }); readFileSync(path, "utf8")` — was
 * invisible to a pass that only judged the argument expression, and it is not a hypothetical shape: it is
 * exactly how `src/atlas/jumpcloud/resume.ts` read a 2,024,469,872-byte journal past V8's 512 MiB string
 * wall, silently, on every sync, for two days.
 *
 * The unambiguity criterion is the tree-wide index's, applied to one file: a name qualifies only when EVERY
 * declaration of it IN THIS FILE names a `.jsonl`, so a `path` reused for a `.json` in the same module
 * proves nothing and is not indexed. One hop only, stated rather than discovered — a local initialised from
 * another local is not followed, because the initializer pass runs with no locals of its own.
 *
 * @param source the parsed file
 * @param index the tree-wide `.jsonl` name index
 * @returns the local names this file binds unambiguously to a `.jsonl` path
 * @internal — the gate's own scan pass and its unit test are the only readers.
 */
export function indexLocalJsonlPaths({
  source,
  index,
}: {
  source: ts.SourceFile;
  index: JsonlNameIndex;
}): ReadonlySet<string> {
  const none: ReadonlySet<string> = new Set<string>();
  const tallies = new Map<string, NameTally>();
  const visit: NodeVisitor = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const namesJsonl = resolvesToJsonl({ expression: node.initializer, index, locals: none, source });
      tally({ into: tallies, name: node.name.text, namesJsonl });
    } else if (
      (isParameterDeclaration(node) || ts.isBindingElement(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      // A parameter or a destructured binding is a declaration of the name too, and one that never names a
      // `.jsonl` — so a file whose `path` local holds a ledger AND whose `writePage: ({ path, html })`
      // callback writes HTML has an ambiguous `path`, not a jsonl-writing callback. That exact pair stood
      // in `src/cli/commands/briefing/renderRun.ts` when the index first learned to follow a helper.
      tally({ into: tallies, name: node.name.text, namesJsonl: false });
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return unambiguous({ tallies });
}
