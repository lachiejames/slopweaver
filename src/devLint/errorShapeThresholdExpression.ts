/**
 * The per-expression reader of the error-shape-threshold gate (`./errorShapeThreshold.ts` carries the criterion):
 * one expression read as far as its own file can read it — a literal, a template, a `+` chain, a conditional's
 * arms, an array's items (a `...spread` item read as the expression it spreads), a name bound by a `const` in an inner block or a `for` header — and a module-level name
 * left as a `name` fact for the whole-tree resolver (`./errorShapeThresholdResolve.ts`).
 *
 * It is split from `./errorShapeThresholdFacts.ts` along the seam between reading ONE expression and reading a
 * FILE (its `err` uses, imports and exports): the file half calls this one per expression it finds.
 */

import { isStringLiteralLikeNode, isTypeAssertion, ts } from "#lib/tsSyntax.js";
import { declaringScopeOf } from "./tornTailAppendScope.js";

/** What every `${...}` hole becomes, so two sites differing only in what they interpolate are one shape. */
const HOLE = "{}";

/** One expression, read as far as its own file can read it. */
export type ShapeExpressionFact =
  | { readonly kind: "shape"; readonly shape: string }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "conditional"; readonly whenTrue: ShapeExpressionFact; readonly whenFalse: ShapeExpressionFact }
  | { readonly kind: "list"; readonly items: readonly ShapeExpressionFact[] }
  | { readonly kind: "unresolved" };

const UNRESOLVED: ShapeExpressionFact = { kind: "unresolved" };

/**
 * The node with every wrapper that changes only its TYPE stripped — parentheses, `as`, `satisfies`, an old-style
 * `<T>` assertion and `!`. Each leaves the runtime value exactly as written.
 *
 * @returns the innermost expression that carries the runtime value
 */
export function unwrapTypeOnly({ node }: { node: ts.Expression }): ts.Expression {
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

/** The authored text and the normalised text of one node — `literal` is what decides whether it is a shape at all. */
interface ShapeParts {
  readonly literal: string;
  readonly normalised: string;
}

/**
 * Both texts of a terminal node: a string literal is itself; a template contributes its quasis with each hole a
 * {@link HOLE}; a `+` chain concatenates its operands; anything else is a hole with no literal text.
 */
function shapePartsOf({ node }: { node: ts.Expression }): ShapeParts {
  const bare = unwrapTypeOnly({ node });
  if (isStringLiteralLikeNode(bare)) {
    return { literal: bare.text, normalised: bare.text };
  }
  if (ts.isTemplateExpression(bare)) {
    return {
      literal: bare.head.text + bare.templateSpans.map((span) => span.literal.text).join(""),
      normalised: bare.head.text + bare.templateSpans.map((span) => `${HOLE}${span.literal.text}`).join(""),
    };
  }
  if (ts.isBinaryExpression(bare) && bare.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = shapePartsOf({ node: bare.left });
    const right = shapePartsOf({ node: bare.right });
    return { literal: left.literal + right.literal, normalised: left.normalised + right.normalised };
  }
  return { literal: "", normalised: HOLE };
}

/**
 * Whether a declaration list binds with `const`.
 *
 * @returns true for a `const` list, false for `let` or `var`
 */
export function isConstList({ list }: { list: ts.VariableDeclarationList }): boolean {
  return (list.flags & ts.NodeFlags.Const) !== 0;
}

/** The declaration of `name` in one `const` list, when it binds that name to a plain identifier. */
function namedIn({
  list,
  name,
}: {
  list: ts.VariableDeclarationList;
  name: string;
}): ts.VariableDeclaration | undefined {
  if (!isConstList({ list })) {
    return undefined;
  }
  return list.declarations.find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);
}

/**
 * The `const` declaration of `name` that `scope` itself opens — one of its own statements, or a `for` header's
 * binding — when there is exactly that.
 */
function constDeclarationIn({ scope, name }: { scope: ts.Node; name: string }): ts.VariableDeclaration | undefined {
  const isLoop = ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope);
  if (isLoop) {
    const header = scope.initializer;
    return header !== undefined && ts.isVariableDeclarationList(header) ? namedIn({ list: header, name }) : undefined;
  }
  let statements: readonly ts.Statement[] = [];
  if (ts.isBlock(scope) || ts.isModuleBlock(scope)) {
    statements = scope.statements;
  } else if (ts.isCaseBlock(scope)) {
    statements = scope.clauses.flatMap((clause) => [...clause.statements]);
  }
  for (const statement of statements) {
    const found = ts.isVariableStatement(statement) ? namedIn({ list: statement.declarationList, name }) : undefined;
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Both arms of a conditional, unresolved only when neither arm reads as anything. */
function conditionalFactOf({
  node,
  seen,
}: {
  node: ts.ConditionalExpression;
  seen: ReadonlySet<ts.Node>;
}): ShapeExpressionFact {
  const whenTrue = expressionFactOf({ node: node.whenTrue, seen });
  const whenFalse = expressionFactOf({ node: node.whenFalse, seen });
  if (whenTrue.kind === "unresolved" && whenFalse.kind === "unresolved") {
    return UNRESOLVED;
  }
  return { kind: "conditional", whenFalse, whenTrue };
}

/**
 * A bare name: at file scope a `name` fact for the resolver; in an inner scope, the `const` that scope opens,
 * followed once per declaration on this path; anything else bound there is unresolved.
 */
function identifierFactOf({ node, seen }: { node: ts.Identifier; seen: ReadonlySet<ts.Node> }): ShapeExpressionFact {
  const scope = declaringScopeOf({ identifier: node });
  if (ts.isSourceFile(scope)) {
    return { kind: "name", name: node.text };
  }
  const declaration = constDeclarationIn({ name: node.text, scope });
  if (declaration?.initializer === undefined || seen.has(declaration)) {
    return UNRESOLVED;
  }
  return expressionFactOf({ node: declaration.initializer, seen: new Set([...seen, declaration]) });
}

/**
 * One expression read as far as its own file can read it. `seen` carries the inner-scope `const` declarations
 * already followed on this path, so `const a = b; const b = a;` ends rather than loops.
 *
 * @returns a shape, a name for the resolver, a conditional's arms, a list's items, or unresolved
 */
export function expressionFactOf({
  node,
  seen,
}: {
  node: ts.Expression;
  seen: ReadonlySet<ts.Node>;
}): ShapeExpressionFact {
  const bare = unwrapTypeOnly({ node });
  if (ts.isSpreadElement(bare)) {
    return expressionFactOf({ node: bare.expression, seen });
  }
  if (ts.isConditionalExpression(bare)) {
    return conditionalFactOf({ node: bare, seen });
  }
  if (ts.isArrayLiteralExpression(bare)) {
    const items = bare.elements.map((element) => expressionFactOf({ node: element, seen }));
    return items.every((item) => item.kind === "unresolved") ? UNRESOLVED : { items, kind: "list" };
  }
  if (ts.isIdentifier(bare)) {
    return identifierFactOf({ node: bare, seen });
  }
  const parts = shapePartsOf({ node: bare });
  if (parts.literal.trim() === "") {
    return UNRESOLVED;
  }
  return { kind: "shape", shape: parts.normalised };
}
