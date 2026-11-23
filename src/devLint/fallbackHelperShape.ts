/**
 * The SHAPE of a pass-through fallback helper — the criterion `no-silent-fallback`'s helper clause counts calls to.
 *
 * A function whose body is exactly two statements — an `if` with no `else` whose condition compares one
 * identifier `v` with `null` or `undefined` (`===`/`==`, or an `||` of two such) and whose branch only
 * returns, then `return v` — and which is GENERIC and returns a fixed value in that `if` (`null`, `undefined`, a
 * literal, an empty list or record), or returns there one of its own parameters or a call to one (a
 * caller-supplied substitute or factory). A generic one whose `if` returns any other call is not one: that call
 * may throw, which is failing loudly.
 *
 * Pure and syntax-only; `fallbackHelpers.ts` resolves which of these a file exports and which calls reach one.
 */

import { bindingElementsOf, isTypeAssertion, ts } from "#lib/tsSyntax.js";

/**
 * The expression inside any number of wrappers that change no value: parentheses, `as`, `satisfies`, `<T>x`
 * and a non-null `!`.
 *
 * @param node the expression, possibly wrapped
 * @returns the innermost expression
 */
export function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    isTypeAssertion(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Whether an expression is `null`, the `undefined` identifier, or a `void` expression (`void 0`). */
function isAbsentLiteral({ node }: { node: ts.Expression }): boolean {
  const bare = unwrapped({ node });
  if (bare.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(bare)) {
    return true;
  }
  return ts.isIdentifier(bare) && bare.text === "undefined";
}

/** The identifier one `v === null` / `undefined == v` comparison tests, or `undefined` for any other shape. */
function comparedName({ node }: { node: ts.Expression }): string | undefined {
  const bare = unwrapped({ node });
  if (!ts.isBinaryExpression(bare)) {
    return undefined;
  }
  const kind = bare.operatorToken.kind;
  if (kind === ts.SyntaxKind.BarBarToken) {
    const left = comparedName({ node: bare.left });
    return left !== undefined && left === comparedName({ node: bare.right }) ? left : undefined;
  }
  if (kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && kind !== ts.SyntaxKind.EqualsEqualsToken) {
    return undefined;
  }
  const left = unwrapped({ node: bare.left });
  const right = unwrapped({ node: bare.right });
  if (ts.isIdentifier(left) && isAbsentLiteral({ node: right })) {
    return left.text;
  }
  if (ts.isIdentifier(right) && isAbsentLiteral({ node: left })) {
    return right.text;
  }
  return undefined;
}

/** What a branch returns when all it does is return, or `undefined` when it does anything else. */
function returnedBy({ statement }: { statement: ts.Statement }): ts.Expression | undefined {
  if (ts.isReturnStatement(statement)) {
    return statement.expression;
  }
  if (ts.isBlock(statement) && statement.statements.length === 1) {
    // Index 0 of a one-statement block is that statement.
    return returnedBy({ statement: statement.statements[0]! });
  }
  return undefined;
}

/** Every name a parameter list binds, destructured ones included. */
function boundNames({ names, node }: { names: Set<string>; node: ts.BindingName }): Set<string> {
  if (ts.isIdentifier(node)) {
    names.add(node.text);
    return names;
  }
  for (const element of bindingElementsOf({ pattern: node })) {
    boundNames({ names, node: element.name });
  }
  return names;
}

/**
 * Whether one function-like declaration is a pass-through fallback helper — the criterion this file's header states.
 *
 * @param fn the function declaration, arrow or function expression
 * @returns true when its body is the two-statement pass-through shape
 */
export function isPassThroughFallback({
  fn,
}: {
  fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}): boolean {
  const body = fn.body;
  // A generator returns an iterator, never the value or its substitute.
  if (fn.asteriskToken !== undefined || body === undefined || !ts.isBlock(body) || body.statements.length !== 2) {
    return false;
  }
  // Both indices sit inside the length just checked, so neither statement can be absent.
  const first = body.statements[0]!;
  const second = body.statements[1]!;
  if (!ts.isIfStatement(first) || first.elseStatement !== undefined || !ts.isReturnStatement(second)) {
    return false;
  }
  const tested = comparedName({ node: first.expression });
  const substitute = returnedBy({ statement: first.thenStatement });
  const passed = second.expression === undefined ? undefined : unwrapped({ node: second.expression });
  if (tested === undefined || substitute === undefined || passed === undefined) {
    return false;
  }
  if (!ts.isIdentifier(passed) || passed.text !== tested) {
    return false;
  }
  const bareSubstitute = unwrapped({ node: substitute });
  const isGeneric = fn.typeParameters !== undefined && fn.typeParameters.length > 0;
  if (isGeneric && isFixedSubstitute({ node: bareSubstitute })) {
    return true;
  }
  const params = new Set<string>();
  for (const param of fn.parameters) {
    boundNames({ names: params, node: param.name });
  }
  if (ts.isIdentifier(bareSubstitute)) {
    return params.has(bareSubstitute.text);
  }
  // A call to a parameter is a caller-supplied factory (`empty()`): still a substitute the caller chose.
  return ts.isCallExpression(bareSubstitute) && isParameterName({ node: bareSubstitute.expression, params });
}

/** Whether an expression is a bare identifier naming one of the function's own parameters. */
function isParameterName({ node, params }: { node: ts.Expression; params: ReadonlySet<string> }): boolean {
  return ts.isIdentifier(node) && params.has(node.text);
}

/**
 * Whether a generic helper's substitute is a fixed value — `null`, `undefined`, a literal, or an empty list or
 * record — rather than a call, which may throw and so fail loudly instead of substituting.
 */
function isFixedSubstitute({ node }: { node: ts.Expression }): boolean {
  if (isAbsentLiteral({ node }) || isScalarLiteral({ node })) {
    return true;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.length === 0;
  }
  return ts.isObjectLiteralExpression(node) && node.properties.length === 0;
}

/** Whether an expression is a boolean, string, number or bigint literal — a negated number included. */
function isScalarLiteral({ node }: { node: ts.Expression }): boolean {
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isScalarLiteral({ node: node.operand });
  }
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  );
}
