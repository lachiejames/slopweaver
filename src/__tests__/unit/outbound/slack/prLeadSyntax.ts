/*
 * The syntax primitives `./prLeadWalk.ts` keys a callee and a value use with: every wrapper erased at run time, and a
 * member access by name or by a literal key.
 */
import { isStringLiteralLikeNode, isTypeAssertion, ts } from "#lib/tsSyntax.js";

/** A wrapper that changes nothing at run time: parentheses, `!`, `as`, `satisfies`, `<T>x`, and `x<T>`. */
type Transparent =
  | ts.ParenthesizedExpression
  | ts.NonNullExpression
  | ts.AsExpression
  | ts.SatisfiesExpression
  | ts.TypeAssertion
  | ts.ExpressionWithTypeArguments;

/**
 * Whether `node` is a {@link Transparent} wrapper.
 *
 * @returns true for parentheses, `!`, `as`, `satisfies`, `<T>x` and `x<T>`
 */
export function isTransparent(node: ts.Node): node is Transparent {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    isTypeAssertion(node) ||
    ts.isExpressionWithTypeArguments(node)
  );
}

/**
 * `expression` with every {@link Transparent} wrapper taken off.
 *
 * @returns the innermost expression the wrappers enclose
 */
export function bare({ expression }: { expression: ts.Expression }): ts.Expression {
  let at = expression;
  while (isTransparent(at)) {
    at = at.expression;
  }
  return at;
}

/**
 * The first node above `node` that is not a {@link Transparent} wrapper.
 *
 * @returns the node that holds `node`'s value
 */
export function holderOf({ node }: { node: ts.Node }): ts.Node {
  let at = node.parent;
  while (isTransparent(at)) {
    at = at.parent;
  }
  return at;
}

/**
 * A member access's name and receiver, by name (`a.b`) or by a literal key under any erased wrapper (`a["b"]`).
 *
 * @returns the member's name and receiver, or undefined when `expression` is no such access
 */
export function memberOf({
  expression,
}: {
  expression: ts.Expression;
}): { name: string; receiver: ts.Expression } | undefined {
  const at = bare({ expression });
  if (ts.isPropertyAccessExpression(at)) {
    return { name: at.name.text, receiver: at.expression };
  }
  const key = ts.isElementAccessExpression(at) ? bare({ expression: at.argumentExpression }) : undefined;
  if (ts.isElementAccessExpression(at) && key !== undefined && isStringLiteralLikeNode(key)) {
    return { name: key.text, receiver: at.expression };
  }
  return undefined;
}

/**
 * The keys a member matches under.
 *
 * @returns `.name`, and `receiver.name` when the receiver is a plain identifier
 */
export function memberKeys({ name, receiver }: { name: string; receiver: ts.Expression }): readonly string[] {
  const owner = bare({ expression: receiver });
  return ts.isIdentifier(owner) ? [`.${name}`, `${owner.text}.${name}`] : [`.${name}`];
}
