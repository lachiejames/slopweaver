/**
 * The logical-operator half of the cognitive-complexity gate: flattening a `&&`/`||`/`??` expression tree into
 * its operator sequence and leaves, and charging that sequence. Pure — no scorer, no walk — so the scoring
 * walk in `cognitiveComplexity.ts` can lend it a node and take back plain numbers.
 */

import { ts } from "#lib/tsSyntax.js";

/** `&&`, `||` or `??`, as the real rule's own vocabulary — only `&&` runs are ever charged. */
type LogicalOperator = "&&" | "||" | "??";

/**
 * Whether a token kind is one of the logical operators `&&`, `||`, `??`.
 *
 * @param kind the operator token's syntax kind
 * @returns true for a logical operator
 */
export function isLogicalOperator({ kind }: { kind: ts.SyntaxKind }): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

function logicalOperatorOf({ kind }: { kind: ts.SyntaxKind }): LogicalOperator {
  if (kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return "&&";
  }
  return kind === ts.SyntaxKind.BarBarToken ? "||" : "??";
}

/**
 * The flattened left-to-right operator sequence of a logical-expression tree, plus its non-logical leaves.
 *
 * @returns the operators in source order and the leaf expressions between them
 */
export function flattenLogical({ node }: { node: ts.Expression }): {
  chain: readonly LogicalOperator[];
  leaves: readonly ts.Expression[];
} {
  if (!ts.isBinaryExpression(node) || !isLogicalOperator({ kind: node.operatorToken.kind })) {
    return { chain: [], leaves: [node] };
  }
  const left = flattenLogical({ node: node.left });
  const right = flattenLogical({ node: node.right });
  return {
    chain: [...left.chain, logicalOperatorOf({ kind: node.operatorToken.kind }), ...right.chain],
    leaves: [...left.leaves, ...right.leaves],
  };
}

/**
 * A run of `&&` costs `1`, charged once when entering it (including at the very start); `||` and `??` never
 * charge, matching this repo's pinned `eslint-plugin-sonarjs` (its own asymmetry, not the abstract spec).
 *
 * @returns the number of `&&` runs in the sequence
 */
export function countAndRuns({ chain }: { chain: readonly LogicalOperator[] }): number {
  let runs = 0;
  let previous: LogicalOperator | undefined;
  for (const operator of chain) {
    if (operator === "&&" && previous !== operator) {
      runs += 1;
    }
    previous = operator;
  }
  return runs;
}
