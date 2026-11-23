/**
 * The sync-child-timeout gate's object walk: which expression a name, a property chain or a destructured binding
 * reaches inside the one file being scanned, and whether its value was decided there or elsewhere. Split from
 * `./syncChildTimeoutValue.ts`, which turns what this module reaches into a number, so this half never evaluates
 * anything — it only follows nodes.
 *
 * The line it draws is the gate's trust model: a chain rooted in a literal this file spells is decided HERE,
 * however deep, and a chain rooted in an import, a parameter, a `let`, a global or a call is decided elsewhere.
 */
import { ts } from "#lib/tsSyntax.js";

import { declarationOf } from "./syncChildTimeoutScope.js";

/** The const declarations already followed on one evaluation path, so a cycle ends. */
export type Seen = ReadonlySet<ts.Node>;

/** The expression a member lookup reached, with the consts followed on the way there. */
export type Reached = { readonly node: ts.Expression; readonly seen: Seen } | "absent" | "dynamic" | "opaque";

/** What an object expression resolved to: the literal this file spells, or why there is none to read. */
type Resolved = { readonly literal: ts.Expression; readonly seen: Seen } | "dynamic" | "opaque";

/** Globals whose value the language itself fixes, so a read of one is decided here rather than elsewhere. */
const LANGUAGE_GLOBALS: ReadonlySet<string> = new Set(["undefined", "NaN", "Infinity"]);

/**
 * An expression with `as`/`satisfies`/parentheses peeled, so `{ … } as const` reads as its literal.
 *
 * @param node the expression to peel
 * @returns the innermost expression those wrappers hold
 */
export function peeled({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * A property read (`a.b`) or a string-keyed index read (`a["b"]`) as its object and key.
 *
 * @param node an expression already peeled
 * @returns the object read from and the key read, or `undefined` for any other expression, a computed index included
 */
export function accessOf({
  node,
}: {
  node: ts.Expression;
}): { readonly object: ts.Expression; readonly name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return { name: node.name.text, object: node.expression };
  }
  if (!ts.isElementAccessExpression(node)) {
    return undefined;
  }
  const key = peeled({ node: node.argumentExpression });
  const named = ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key);
  return named ? { name: key.text, object: node.expression } : undefined;
}

/**
 * The property a TOP-LEVEL, non-rest object-pattern element reads — its `propertyName`, else its own name.
 *
 * @param node the destructuring `const` declaration
 * @param element the binding element within its pattern
 * @returns the key, or `undefined` for a nested, array, rest or computed element
 */
export function topLevelKeyOf({
  node,
  element,
}: {
  node: ts.VariableDeclaration;
  element: ts.BindingElement;
}): string | undefined {
  const topLevel =
    element.parent === node.name && ts.isObjectBindingPattern(node.name) && element.dotDotDotToken === undefined;
  if (!topLevel) {
    return undefined;
  }
  const property = element.propertyName;
  if (property === undefined) {
    return element.name !== undefined && ts.isIdentifier(element.name) ? element.name.text : undefined;
  }
  return ts.isComputedPropertyName(property) ? undefined : property.text;
}

/**
 * The literal an object expression is in this file — itself, a same-file `const` followed to its initializer, a
 * property chain followed member by member, or a destructured name followed into its source — or `dynamic` when
 * it is decided elsewhere, or `opaque` on a `const` cycle or a read this walk cannot follow.
 */
function literalOf({ object, seen }: { object: ts.Expression; seen: Seen }): Resolved {
  const bare = peeled({ node: object });
  const access = accessOf({ node: bare });
  if (access !== undefined) {
    return reachedLiteral({ found: memberNodeOf({ name: access.name, object: access.object, seen }) });
  }
  if (!ts.isIdentifier(bare)) {
    return { literal: bare, seen };
  }
  const declared = declarationOf({ from: bare, text: bare.text });
  if (declared?.kind === "destructured") {
    return destructuredLiteral({ element: declared.element, node: declared.node, seen });
  }
  if (declared?.kind !== "const" || declared.node.initializer === undefined) {
    return "dynamic";
  }
  if (seen.has(declared.node)) {
    return "opaque";
  }
  return literalOf({ object: declared.node.initializer, seen: new Set([...seen, declared.node]) });
}

/** The literal a member lookup reached, an absent member being a read this walk cannot follow. */
function reachedLiteral({ found }: { found: Reached }): Resolved {
  if (found === "absent") {
    return "opaque";
  }
  return typeof found === "string" ? found : literalOf({ object: found.node, seen: found.seen });
}

/**
 * The literal a name bound by destructuring is: a plain top-level key (`const { a } = C`) is followed into `C`'s
 * own `a`; any other element — nested, defaulted, array, rest — is `opaque` over a source spelled here and
 * `dynamic` over one decided elsewhere.
 */
function destructuredLiteral({
  node,
  element,
  seen,
}: {
  node: ts.VariableDeclaration;
  element: ts.BindingElement;
  seen: Seen;
}): Resolved {
  if (node.initializer === undefined || seen.has(node)) {
    return node.initializer === undefined ? "dynamic" : "opaque";
  }
  const inner = new Set([...seen, node]);
  const key = topLevelKeyOf({ element, node });
  if (key === undefined || element.initializer !== undefined) {
    return decidedHere({ object: node.initializer, seen: inner }) ? "opaque" : "dynamic";
  }
  return reachedLiteral({ found: memberNodeOf({ name: key, object: node.initializer, seen: inner }) });
}

/** The expression one object-literal member gives `name`, or `absent` when it does not name it. */
function memberNodeIn({
  member,
  name,
  seen,
}: {
  member: ts.ObjectLiteralElementLike;
  name: string;
  seen: Seen;
}): Reached {
  if (ts.isSpreadAssignment(member)) {
    return memberNodeOf({ name, object: member.expression, seen });
  }
  if (ts.isComputedPropertyName(member.name)) {
    return "opaque";
  }
  if (member.name.text !== name) {
    return "absent";
  }
  if (ts.isShorthandPropertyAssignment(member)) {
    return { node: member.name, seen };
  }
  return ts.isPropertyAssignment(member) ? { node: member.initializer, seen } : "opaque";
}

/**
 * The expression an object this file declares gives `name`, read LAST member first, since the last word on a key
 * is the one JavaScript keeps. The object may itself be a chain of reads (`C.limits`) or a destructured name.
 *
 * @param object the expression read from
 * @param name the key read
 * @param seen the const declarations already followed on this path
 * @returns the member's expression with the consts followed to reach it, `absent` when no member names the key,
 *   `dynamic` when the object is decided elsewhere, or `opaque` when it is spelled here but cannot be read
 */
export function memberNodeOf({ object, name, seen }: { object: ts.Expression; name: string; seen: Seen }): Reached {
  const resolved = literalOf({ object, seen });
  if (resolved === "dynamic" || resolved === "opaque") {
    return resolved;
  }
  const { literal } = resolved;
  if (!ts.isObjectLiteralExpression(literal)) {
    return rootIsExternal({ node: literal, seen: resolved.seen }) ? "dynamic" : "opaque";
  }
  for (const member of literal.properties.toReversed()) {
    const found = memberNodeIn({ member, name, seen: resolved.seen });
    if (found !== "absent") {
      return found;
    }
  }
  return "absent";
}

/**
 * Whether an expression's value is decided outside this file: its ROOT — the base under any chain of property
 * and index reads — is a call, a construction or an await, or a name bound by an import, a parameter, a `let` or
 * a global, followed through same-file `const`s. A chain rooted in a literal this file spells is decided HERE,
 * however deep, which is what keeps the trusted set from growing with every shape the evaluator does not model.
 */
function rootIsExternal({ node, seen }: { node: ts.Expression; seen: Seen }): boolean {
  let base = peeled({ node });
  while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
    base = peeled({ node: base.expression });
  }
  if (ts.isCallExpression(base) || ts.isNewExpression(base) || ts.isAwaitExpression(base)) {
    return true;
  }
  if (!ts.isIdentifier(base)) {
    return false;
  }
  const declared = declarationOf({ from: base, text: base.text });
  if (declared === undefined) {
    return !LANGUAGE_GLOBALS.has(base.text);
  }
  if (declared.kind === "import" || declared.kind === "other") {
    return true;
  }
  const initializer = declared.node.initializer;
  if (initializer === undefined || seen.has(declared.node)) {
    return initializer === undefined;
  }
  return rootIsExternal({ node: initializer, seen: new Set([...seen, declared.node]) });
}

/**
 * Whether an object or array expression is spelled in this file — a literal, or a chain rooted in one — so a
 * read off it that the evaluator cannot follow is refused rather than trusted.
 *
 * @param object the expression read from
 * @param seen the const declarations already followed on this path
 * @returns `true` when this file decides it, `false` when it is decided elsewhere
 */
export function decidedHere({ object, seen }: { object: ts.Expression; seen: Seen }): boolean {
  const resolved = literalOf({ object, seen });
  if (resolved === "dynamic" || resolved === "opaque") {
    return resolved === "opaque";
  }
  return !rootIsExternal({ node: resolved.literal, seen: resolved.seen });
}
