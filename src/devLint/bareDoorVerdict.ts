/**
 * Where a door decision's bare verdict is turned into text — `refused by door: ${through.decision.status}` —
 * found on the TypeScript AST rather than on a line of text.
 *
 * Measured: a `github thread resolve` printed only `warn`, and 23 sites had the shape on the tree this gate was
 * added to
 * (`git grep -nE 'decision\.status\s*\}' "$(git log --format=%P -1 --diff-filter=A -- src/devLint/bareDoorVerdict.ts)" -- src ':!src/admit' ':!src/__tests__'`).
 * The verdict
 * alone drops every finding, its correction and its override token, and the renderer's own first line
 * already names the status, so no caller has a reason to print it again.
 *
 * The AST is the criterion because every line regex tried here was beaten by a shape Prettier leaves alone:
 * a comment between `decision` and `.status`, comment-shaped text inside the template, a non-null assertion.
 * Parsed, a comment is trivia, parentheses, `!`, `as` and `satisfies` unwrap, and a split interpolation is
 * still one node. One file is parsed at a time, with no `ts.Program`, so it costs nothing a resolved type
 * would.
 *
 * **The criterion**: a read of `status`, by name or by a quoted key, off an expression that is `decision` or
 * ends in `.decision`, anywhere inside a template interpolation or an operand of a `+`. **The blind spots**,
 * stated rather than discovered: a verdict handed on through a NAME (`const s = decision.status`, or a
 * destructured `{ status }`, then `${s}` elsewhere) — one stood behind an error factory until a Codex review
 * found it — and a decision held under another name (`d.status`).
 */

import { forEachChild, isStringLiteralLikeNode, isTypeAssertion, ts, withSourceFile } from "#lib/tsSyntax.js";

/**
 * The expression with every wrapper that changes neither the value nor which property is read removed.
 *
 * @param node an expression that may be parenthesised, asserted or cast
 * @returns the innermost expression
 */
function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    isTypeAssertion(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Whether an expression is a door decision by its name: `decision`, or any `….decision`.
 *
 * @param node the receiver a property is read off
 * @returns true when the receiver is named `decision`
 */
function namesDecision({ node }: { node: ts.Expression }): boolean {
  const inner = unwrapped({ node });
  if (ts.isIdentifier(inner)) {
    return inner.text === "decision";
  }
  return ts.isPropertyAccessExpression(inner) && inner.name.text === "decision";
}

/**
 * Whether a node reads `status` off a decision, through a dot, an optional chain or a quoted bracket.
 *
 * @param node any node in the file
 * @returns true when the node is the verdict read
 */
function readsVerdict({ node }: { node: ts.Node }): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "status" && namesDecision({ node: node.expression });
  }
  if (ts.isElementAccessExpression(node)) {
    const key = unwrapped({ node: node.argumentExpression });
    return isStringLiteralLikeNode(key) && key.text === "status" && namesDecision({ node: node.expression });
  }
  return false;
}

/**
 * Whether a node's children are being turned into text: a template interpolation, or a `+` expression.
 *
 * @param node the parent node
 * @returns true when its subtree is string-building
 */
function buildsText({ node }: { node: ts.Node }): boolean {
  return (
    ts.isTemplateSpan(node) || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
  );
}

/**
 * Every line on which a door decision's bare verdict is read into text.
 *
 * @param content the file's source
 * @param path the repo-relative path, which tells the parser the file's dialect
 * @returns the 1-indexed lines, each once, in order
 */
export function bareVerdictLines({ content, path }: { content: string; path: string }): readonly number[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sourceFile): readonly number[] => {
      const lines = new Set<number>();
      const visit = ({ node, inText }: { node: ts.Node; inText: boolean }): void => {
        if (inText && readsVerdict({ node })) {
          lines.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
        }
        const childInText = inText || buildsText({ node });
        forEachChild({
          node,
          visit: (child) => {
            visit({ inText: childInText, node: child });
          },
        });
      };
      visit({ inText: false, node: sourceFile });
      return [...lines].toSorted((a, b) => a - b);
    },
  });
}
