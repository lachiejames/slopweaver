/**
 * Whether a test case is REGISTERED when its file loads — the half of following a moved case
 * (`./testCaseMoves.ts`) that asks whether the copy a sibling received will actually run.
 *
 * A received case earns its old file credit only if vitest registers it, and deciding that in general needs
 * dataflow. So this is a closed whitelist rather than a judgement, at three levels — what may sit ABOVE the
 * case, what statement may stand BESIDE it in every list on the way up, and what EXPRESSION may be evaluated
 * at load in one of those statements — and anything none of them names refuses, which is the safe direction.
 * Each level was added because a Codex review pass or a whole-diff read found the one before it open; the
 * three findings are named where each level is.
 */

import { isStringLiteralLikeNode, ts } from "#lib/tsSyntax.js";

import type { Bindings } from "./testAssertionCounts.js";
import { isChainBuildingCall, rootIdentifier } from "./testChainWalk.js";

/**
 * Whether a call RUNS a suite function — the outermost call of a chain whose root this file binds to `it`,
 * `describe` and friends.
 *
 * @returns true for the call that registers a case or suite
 */
export function isCaseCall({ node, bindings }: { node: ts.CallExpression; bindings: Bindings }): boolean {
  if (isChainBuildingCall({ node })) return false;
  const root = rootIdentifier({ node: node.expression });
  return root !== undefined && bindings.suites.has(root);
}

/** The only suite names a received case may sit inside: each calls its callback once, at load. */
const SUITE_HOSTS: ReadonlySet<string> = new Set(["describe", "suite"]);

/**
 * Whether a case call is REGISTERED when its file loads: every node between it and the file is a statement,
 * a block, or a callback handed straight to another case call.
 *
 * Codex review pass r1 broke the first version with `if (false) { it("c", …) }` in an added sibling: a
 * verbatim case that never runs, credited because nothing asked whether it was reachable. So an `if`, a loop,
 * a `try`, a named function or an assignment anywhere above the case means it offers nothing, however
 * plainly it would run. Each suite callback above it must be a plain one handed to a BARE suite name, and every
 * statement list above it must hold only the closed list of inert statements, so the whole rule fails closed.
 * That refuses a genuine move into such a shape, which is the safe direction.
 *
 * @param node the case call
 * @returns true when nothing but statements, blocks and suite callbacks sit above it, each list beside it inert
 */
export function registersOnLoad({ node, bindings }: { node: ts.CallExpression; bindings: Bindings }): boolean {
  let child: ts.Node = node;
  let current: ts.Node = node.parent;
  for (;;) {
    const statements = ts.isSourceFile(current) || ts.isBlock(current) ? current.statements : undefined;
    if (statements !== undefined && !onlyInertBeside({ bindings, holder: child, statements })) return false;
    if (ts.isSourceFile(current)) return true;
    const holder =
      ts.isExpressionStatement(current) || ts.isBlock(current) ? current : hostingSuite({ callback: current });
    if (holder === undefined) return false;
    child = holder;
    current = holder.parent;
  }
}

/**
 * The suite call a callback above a received case is handed to, when that call is one that runs it exactly
 * once at load.
 *
 * @param callback the node the walk up from the case reached
 * @returns the hosting `describe`/`suite` call, or undefined where the case may not register
 */
function hostingSuite({ callback }: { callback: ts.Node }): ts.CallExpression | undefined {
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  // A generator's body never runs when vitest calls it, and a parameter could rebind `it` or `expect`.
  if (callback.asteriskToken !== undefined || callback.parameters.length > 0) return undefined;
  const host: ts.Node = callback.parent;
  if (!ts.isCallExpression(host) || host.expression === callback) return undefined;
  // A bare `describe`/`suite` only: `describe.each([])(…)` or `describe.runIf(false)(…)` may never call it.
  if (!ts.isIdentifier(host.expression) || !SUITE_HOSTS.has(host.expression.text)) return undefined;
  // Titles only beside the callback: an options object can carry `fails` or `skip` by a computed name.
  const titlesOnly = host.arguments.every((argument) => argument === callback || isStringLiteralLikeNode(argument));
  if (!titlesOnly) return undefined;
  return host;
}

/*
 * What may stand beside a received case, in EVERY statement list above it, is a closed list — anything it does
 * not name refuses the case, so a shape nobody has thought of yet fails closed rather than open. Codex review
 * pass r2 found `describe("w", () => { return; it("c", …) })` after the ancestor whitelist had passed it, and
 * refusing `return` by name would only have waited for the next early exit to be found. The list:
 *
 * - an empty statement, an interface or a type alias;
 * - a function declaration, and an import that binds a name (a bare `import "./x.js"` exists only for its
 *   side effects) — neither binding `expect` or a suite name, unless the import is from `vitest`;
 * - a `const`/`let`/`var` of plain names, none of them `expect` or a suite name, each initialiser inert;
 * - another suite or case call (`describe`, `it`, `test`, `suite`, `bench`, an alias of one), its chain and
 *   every argument inert.
 *
 * So a hook (`beforeEach(({ skip }) => skip())` skips every case beside it at runtime), a `vi.*` call, a
 * local `expect`, an `if`, a loop, a `try`, a `return`, a `throw`, a label, a class and any kind TypeScript
 * adds next year all refuse it, before or after the case, because a hook registered after a case still runs
 * for it. Each suite callback above the case must also be a parameterless, non-generator function handed to
 * a bare `describe` or `suite` beside nothing but string titles.
 *
 * "Inert" is a closed list of EXPRESSION kinds too, for the same reason one level down: the whole-diff read
 * found that an earlier rule refusing only calls, `new` and tagged templates read `const v = (expect = lenient)`
 * as inert, and a property read reaches a getter, a `${x}` or an `x + 1` reaches `toString`/`valueOf`, any of
 * which runs code that can neuter what the case calls (`expect.extend`). See {@link inertOnLoad}.
 */

/**
 * Whether evaluating an expression at load runs no code of the file's own: a literal, a name, a function value
 * (its body is not run), an array or object literal of those with no spread and no computed key, a signed
 * number, an `as`/`satisfies`/`!`/parenthesised wrapper of any of them, or a suite chain whose arguments are
 * all inert. Every other kind refuses, an assignment, a property read and a template substitution included.
 *
 * @returns true only for a kind on the list
 */
function inertOnLoad({ node, bindings }: { node: ts.Expression; bindings: Bindings }): boolean {
  const literal =
    isStringLiteralLikeNode(node) ||
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    ts.isRegularExpressionLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword;
  if (literal || ts.isIdentifier(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  const wrapped =
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node);
  if (wrapped) return inertOnLoad({ bindings, node: node.expression });
  if (ts.isPrefixUnaryExpression(node)) {
    const signed = node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken;
    return signed && (ts.isNumericLiteral(node.operand) || ts.isBigIntLiteral(node.operand));
  }
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every(
      (element) =>
        ts.isOmittedExpression(element) || (!ts.isSpreadElement(element) && inertOnLoad({ bindings, node: element })),
    );
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every((property) => inertMember({ bindings, property }));
  if (ts.isCallExpression(node)) return inertSuiteChain({ bindings, node });
  return false;
}

/**
 * Whether one object-literal member evaluates inertly: a plain-named value that is inert, a shorthand name, or
 * a method or accessor DEFINITION (its body runs only when called or read, and a read refuses elsewhere).
 *
 * @returns true only for a member on the list
 */
function inertMember({ property, bindings }: { property: ts.ObjectLiteralElementLike; bindings: Bindings }): boolean {
  if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) return false;
  if (ts.isPropertyAssignment(property)) return inertOnLoad({ bindings, node: property.initializer });
  if (ts.isShorthandPropertyAssignment(property)) return property.objectAssignmentInitializer === undefined;
  return (
    ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)
  );
}

/**
 * Whether a call is a suite chain (`it`, `describe.each(t)`, an alias) whose every argument, at every link, is
 * inert — the only call allowed beside a received case.
 *
 * @returns true for a suite chain evaluated without running the file's own code
 */
function inertSuiteChain({ node, bindings }: { node: ts.CallExpression; bindings: Bindings }): boolean {
  const root = rootIdentifier({ node: node.expression });
  if (root === undefined || !bindings.suites.has(root)) return false;
  if (!node.arguments.every((argument) => inertOnLoad({ bindings, node: argument }))) return false;
  let link: ts.Expression = node.expression;
  for (;;) {
    if (ts.isIdentifier(link)) return true;
    if (ts.isPropertyAccessExpression(link)) {
      link = link.expression;
      continue;
    }
    if (ts.isCallExpression(link)) return inertSuiteChain({ bindings, node: link });
    return false;
  }
}

/**
 * Every value name one import binds in this file: its default, its namespace and each named element.
 *
 * @returns the local names, empty for a bare side-effect import
 */
function importedNames({ statement }: { statement: ts.ImportDeclaration }): readonly string[] {
  const clause = statement.importClause;
  if (clause === undefined) return [];
  const names = clause.name === undefined ? [] : [clause.name.text];
  const named = clause.namedBindings;
  if (named === undefined) return names;
  if (ts.isNamespaceImport(named)) return [...names, named.name.text];
  return [...names, ...named.elements.map((element) => element.name.text)];
}

/**
 * Whether one statement beside a received case is on the closed list above.
 *
 * @returns true only for a kind the list names, in the form it names
 */
function isInertStatement({ statement, bindings }: { statement: ts.Statement; bindings: Bindings }): boolean {
  // A local `expect`, `it` or `describe` would swap what the moved case calls for something that asserts nothing.
  const shadows = ({ name }: { name: string }): boolean => bindings.expects.has(name) || bindings.suites.has(name);
  const typesOnly =
    ts.isEmptyStatement(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
  if (typesOnly) return true;
  if (ts.isFunctionDeclaration(statement))
    return statement.name !== undefined && !shadows({ name: statement.name.text });
  if (ts.isImportDeclaration(statement)) {
    if (statement.importClause === undefined) return false;
    const fromVitest = ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "vitest";
    return fromVitest || !importedNames({ statement }).some((name) => shadows({ name }));
  }
  if (ts.isVariableStatement(statement)) {
    const declared = statement.declarationList.declarations.map((declaration) => declaration.name);
    const plainNames = declared.every((name) => ts.isIdentifier(name) && !shadows({ name: name.text }));
    const initialisers = statement.declarationList.declarations.map((declaration) => declaration.initializer);
    const inert = initialisers.every((node) => node === undefined || inertOnLoad({ bindings, node }));
    return plainNames && inert;
  }
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  return (
    isCaseCall({ bindings, node: statement.expression }) && inertSuiteChain({ bindings, node: statement.expression })
  );
}

/**
 * Whether every statement in a list above a received case, bar the one holding it, is inert.
 *
 * @param holder the statement holding the case, directly in `statements`
 * @param statements the block's or file's whole statement list
 * @returns true only when every other statement is on the closed list
 */
function onlyInertBeside({
  holder,
  statements,
  bindings,
}: {
  holder: ts.Node;
  statements: readonly ts.Statement[];
  bindings: Bindings;
}): boolean {
  return statements.every((statement) => statement === holder || isInertStatement({ bindings, statement }));
}
