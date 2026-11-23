/**
 * The sync-child-timeout gate's value evaluator: what a `timeout` expression is, as the one file holding it
 * decides it. Split from `./syncChildTimeoutSyntax.ts`, which asks it about every `timeout` member it reads.
 *
 * Three answers, and the line between the last two is the gate's whole trust model. A NUMBER or `undefined` is
 * what the file spells, judged positive or not. OPAQUE is a shape the file decides but this evaluator does not
 * read as a number — a string, a boolean, `null`, a template, a bit operator — and is refused, because the file
 * could have said a positive number and did not. DYNAMIC is a value decided in another module or at run time —
 * an import, a parameter, a `let`, a call — and is trusted: a gate that sees one file cannot tell it from a zero,
 * and refusing it refused 21 real bounds (measured, see `valueState` in the syntax module). Which
 * expression a name or a property chain reaches is `./syncChildTimeoutLiteral.ts`'s walk; this module only
 * evaluates what that walk reaches.
 */
import { ts } from "#lib/tsSyntax.js";

import { accessOf, decidedHere, memberNodeOf, peeled, type Seen, topLevelKeyOf } from "./syncChildTimeoutLiteral.js";
import { declarationOf } from "./syncChildTimeoutScope.js";

/** A `timeout` value as one file decides it: a number, `undefined`, `opaque` (refused) or `dynamic` (trusted). */
export type StaticValue = number | undefined | "opaque" | "dynamic";

/** What a member lookup found: a value, or `absent` when no member names the key — distinct from an explicit `undefined`. */
type Lookup = StaticValue | "absent";

/** The arithmetic operators this evaluator models, each over two known numbers. */
const ARITHMETIC = new Map<ts.SyntaxKind, (operands: { left: number; right: number }) => number>([
  [ts.SyntaxKind.AsteriskToken, ({ left, right }) => left * right],
  [ts.SyntaxKind.PlusToken, ({ left, right }) => left + right],
  [ts.SyntaxKind.MinusToken, ({ left, right }) => left - right],
  [ts.SyntaxKind.SlashToken, ({ left, right }) => left / right],
  [ts.SyntaxKind.PercentToken, ({ left, right }) => left % right],
  [ts.SyntaxKind.AsteriskAsteriskToken, ({ left, right }) => left ** right],
]);

/** One arithmetic step over two known numbers, or `opaque` for an operator this evaluator does not model. */
function arithmetic({ operator, left, right }: { operator: ts.SyntaxKind; left: number; right: number }): StaticValue {
  const step = ARITHMETIC.get(operator);
  if (step === undefined) {
    return "opaque";
  }
  return step({ left, right });
}

/**
 * The value when either of two may apply — a conditional's branches, or a short-circuit over a trusted value.
 * Bounded only when every possibility is: two positives give the smaller, a positive beside a value decided
 * elsewhere stays trusted, and anything this file lets fall to zero, `undefined` or an unmodelled shape is
 * `opaque`.
 */
function either({ a, b }: { a: StaticValue; b: StaticValue }): StaticValue {
  if (a === b) {
    return a;
  }
  const aPositive = typeof a === "number" && a > 0;
  const bPositive = typeof b === "number" && b > 0;
  if (aPositive && bPositive) {
    return Math.min(a, b);
  }
  const trusted = (aPositive && b === "dynamic") || (bPositive && a === "dynamic");
  return trusted ? "dynamic" : "opaque";
}

/** Whether an operator short-circuits, so only one side's value applies. */
function isShortCircuit({ operator }: { operator: ts.SyntaxKind }): boolean {
  return (
    operator === ts.SyntaxKind.QuestionQuestionToken ||
    operator === ts.SyntaxKind.BarBarToken ||
    operator === ts.SyntaxKind.AmpersandAmpersandToken
  );
}

/** A `??`, `||` or `&&` over two non-opaque sides: the side JavaScript would answer with. */
function shortCircuitValue({
  operator,
  left,
  right,
}: {
  operator: ts.SyntaxKind;
  left: StaticValue;
  right: StaticValue;
}): StaticValue {
  if (left === "dynamic") {
    return either({ a: left, b: right });
  }
  if (operator === ts.SyntaxKind.QuestionQuestionToken) {
    if (left === undefined) {
      return right;
    }
    return left;
  }
  const leftTruthy = typeof left === "number" && left !== 0 && !Number.isNaN(left);
  if (operator === ts.SyntaxKind.BarBarToken) {
    return leftTruthy ? left : right;
  }
  return leftTruthy ? right : left;
}

/** A binary expression's value: arithmetic, a short-circuit, a comma or a plain assignment. */
function binaryValue({ node, seen }: { node: ts.BinaryExpression; seen: Seen }): StaticValue {
  const left = staticValueOf({ node: node.left, seen });
  const right = staticValueOf({ node: node.right, seen });
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.CommaToken || operator === ts.SyntaxKind.EqualsToken) {
    return right;
  }
  if (left === "opaque" || right === "opaque") {
    return "opaque";
  }
  if (isShortCircuit({ operator })) {
    return shortCircuitValue({ left, operator, right });
  }
  if (left === "dynamic" || right === "dynamic") {
    // A product with a known zero is zero whatever the other side; any other step over a trusted value is trusted.
    const other = left === "dynamic" ? right : left;
    return operator === ts.SyntaxKind.AsteriskToken && other === 0 ? 0 : "dynamic";
  }
  return left === undefined || right === undefined ? "opaque" : arithmetic({ left, operator, right });
}

/** A property read off an object this file declares: the value it reaches, or `absent` when none names it. */
function memberLookup({ object, name, seen }: { object: ts.Expression; name: string; seen: Seen }): Lookup {
  const found = memberNodeOf({ name, object, seen });
  return typeof found === "string" ? found : staticValueOf({ node: found.node, seen: found.seen });
}

/** A property read: what {@link memberLookup} found, an absent key reading as `undefined` exactly as JavaScript does. */
function memberValue({ object, name, seen }: { object: ts.Expression; name: string; seen: Seen }): StaticValue {
  const found = memberLookup({ name, object, seen });
  return found === "absent" ? undefined : found;
}

/** A name's value: the global `undefined`, a same-file `const` followed to its initializer, else decided elsewhere. */
function identifierValue({ node, seen }: { node: ts.Identifier; seen: Seen }): StaticValue {
  const declared = declarationOf({ from: node, text: node.text });
  if (declared === undefined) {
    if (node.text === "undefined") {
      return undefined;
    }
    return node.text === "NaN" || node.text === "Infinity" ? "opaque" : "dynamic";
  }
  if (declared.kind === "destructured") {
    return destructuredValue({ element: declared.element, node: declared.node, seen });
  }
  if (declared.kind !== "const" || declared.node.initializer === undefined) {
    return "dynamic";
  }
  if (seen.has(declared.node)) {
    return "opaque";
  }
  return staticValueOf({ node: declared.node.initializer, seen: new Set([...seen, declared.node]) });
}

/**
 * A name bound by destructuring a `const`: `const { timeout } = { timeout: 0 }` reads the initializer's own
 * `timeout`, a default applying when that is `undefined`. A nested, array or rest element over a literal this
 * file spells is `opaque`; over a value decided elsewhere it is `dynamic`.
 */
function destructuredValue({
  node,
  element,
  seen,
}: {
  node: ts.VariableDeclaration;
  element: ts.BindingElement;
  seen: Seen;
}): StaticValue {
  if (node.initializer === undefined) {
    return "dynamic";
  }
  if (seen.has(node)) {
    return "opaque";
  }
  const inner = new Set([...seen, node]);
  const key = topLevelKeyOf({ element, node });
  if (key === undefined) {
    return decidedHere({ object: node.initializer, seen: inner }) ? "opaque" : "dynamic";
  }
  const found = memberLookup({ name: key, object: node.initializer, seen: inner });
  const fellBack = (found === "absent" || found === undefined) && element.initializer !== undefined;
  if (fellBack) {
    return staticValueOf({ node: element.initializer, seen: inner });
  }
  return found === "absent" ? undefined : found;
}

/** A prefix `-`/`+` over a known number; any other prefix operator this file spells is opaque. */
function prefixValue({ node, seen }: { node: ts.PrefixUnaryExpression; seen: Seen }): StaticValue {
  const operand = staticValueOf({ node: node.operand, seen });
  if (operand === "dynamic" || operand === "opaque") {
    return operand;
  }
  if (operand === undefined) {
    return "opaque";
  }
  if (node.operator === ts.SyntaxKind.MinusToken) {
    return -operand;
  }
  return node.operator === ts.SyntaxKind.PlusToken ? operand : "opaque";
}

/**
 * Evaluate a `timeout` value from its own file alone.
 *
 * @param node the value expression
 * @param seen the const declarations already followed on this path
 * @returns the number or `undefined` it evaluates to, `opaque` for a same-file shape that is not read as a
 *   number, or `dynamic` for a value decided in another module or at run time
 */
export function staticValueOf({ node, seen }: { node: ts.Expression; seen: Seen }): StaticValue {
  const bare = peeled({ node });
  if (ts.isNumericLiteral(bare)) {
    return Number(bare.text);
  }
  if (ts.isVoidExpression(bare)) {
    return undefined;
  }
  if (ts.isPrefixUnaryExpression(bare)) {
    return prefixValue({ node: bare, seen });
  }
  if (ts.isBinaryExpression(bare)) {
    return binaryValue({ node: bare, seen });
  }
  if (ts.isConditionalExpression(bare)) {
    return either({
      a: staticValueOf({ node: bare.whenTrue, seen }),
      b: staticValueOf({ node: bare.whenFalse, seen }),
    });
  }
  if (ts.isIdentifier(bare)) {
    return identifierValue({ node: bare, seen });
  }
  const access = accessOf({ node: bare });
  if (access !== undefined) {
    return memberValue({ name: access.name, object: access.object, seen });
  }
  if (ts.isElementAccessExpression(bare)) {
    // A computed index: unreadable over a literal this file spells, trusted over one decided elsewhere.
    return decidedHere({ object: bare.expression, seen }) ? "opaque" : "dynamic";
  }
  const runTime = ts.isCallExpression(bare) || ts.isPostfixUnaryExpression(bare) || ts.isAwaitExpression(bare);
  return runTime || ts.isNewExpression(bare) ? "dynamic" : "opaque";
}
