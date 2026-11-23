/**
 * The operator-classification half of the no-silent-fallback gate: which binary expressions are a refused
 * spelling (`??`, `??=`, `||=`, or `||` onto a value literal). Pure syntax tests over one node, so
 * `noSilentFallback.ts` can walk a file and ask this module only "is this expression a fallback, and which".
 * The criterion sentence lives in that file's header.
 */

import { isStringLiteralLikeNode, isTypeAssertion, ts } from "#lib/tsSyntax.js";

/**
 * Which of the five refused spellings a site is. `||-literal` is the only label narrower than its own token
 * — the gate's header says why the boolean `||` sits outside the criterion — and `fallback-helper` is a call.
 */
export type FallbackOperator = "??" | "??=" | "||=" | "||-literal" | "fallback-helper";

/**
 * The node with every wrapper that changes only its TYPE stripped — parentheses, `as`, `as const`,
 * `satisfies`, an old-style `<T>` assertion and `!`. Each leaves the runtime value exactly as written, so
 * `x || ("-" as const)` substitutes the same string `x || "-"` does. MEASURED on the re-take that found it:
 * `as const` alone put an `AssertionExpression` between the operator and its literal and the site escaped.
 */
function unwrapTypeOnly({ node }: { node: ts.Expression }): ts.Expression {
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

/**
 * Whether an expression is a value LITERAL — what makes a `||` a fallback rather than a condition. A leading
 * `-` or `+` on a number is part of the literal a reader sees (`x || -1` invents a number exactly as `x || 1`
 * does), and neither sign can turn a boolean condition into this shape, so stripping it closes a false
 * negative without opening a false positive.
 */
function isValueLiteral({ node }: { node: ts.Expression }): boolean {
  const bare = isNumericSign(node) ? node.operand : node;
  return (
    isStringLiteralLikeNode(bare) ||
    ts.isTemplateExpression(bare) ||
    ts.isNumericLiteral(bare) ||
    ts.isBigIntLiteral(bare) ||
    ts.isArrayLiteralExpression(bare) ||
    ts.isObjectLiteralExpression(bare)
  );
}

/**
 * A unary `-`/`+` directly on a numeric or bigint literal — the sign of a written number, not an operation.
 * Positional because TS1230 forbids destructuring in a type predicate; see typescript-patterns.md.
 */
function isNumericSign(node: ts.Expression): node is ts.PrefixUnaryExpression {
  if (!ts.isPrefixUnaryExpression(node)) {
    return false;
  }
  const signed = node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken;
  return signed && (ts.isNumericLiteral(node.operand) || ts.isBigIntLiteral(node.operand));
}

/**
 * Which refused spelling a binary expression is, or `undefined` when it is outside the criterion.
 *
 * @param node the binary expression to classify
 * @returns the operator label, or undefined
 */
export function operatorOf({ node }: { node: ts.BinaryExpression }): FallbackOperator | undefined {
  const kind = node.operatorToken.kind;
  if (kind === ts.SyntaxKind.QuestionQuestionToken) {
    return "??";
  }
  if (kind === ts.SyntaxKind.QuestionQuestionEqualsToken) {
    return "??=";
  }
  if (kind === ts.SyntaxKind.BarBarEqualsToken) {
    return "||=";
  }
  if (kind === ts.SyntaxKind.BarBarToken && isValueLiteral({ node: unwrapTypeOnly({ node: node.right }) })) {
    return "||-literal";
  }
  return undefined;
}
