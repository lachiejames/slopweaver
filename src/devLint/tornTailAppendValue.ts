/**
 * What an expression in one parsed source file statically IS, for the torn-tail-append criterion
 * (`./tornTailAppendShape.ts`): a member read by dot or literal key, an expression with its wrappers taken off, and a
 * value followed through same-file `const`s, spreads and members of a `const` object literal — and so whether a flags
 * argument or an options object appends. Pure, syntax only.
 *
 * It exists because the first cut read only literals written at the call, and passed the gate
 * with an fs whole-file write handed `APPEND_OPTIONS`, a `const` holding `{ flag: "a" } as const`.
 */

import { forEachChild, isStringLiteralLikeNode, isTypeAssertion, type NodeVisitor, ts } from "#lib/tsSyntax.js";

import { declaringScopeOf } from "./tornTailAppendScope.js";

/**
 * Node's append flag strings — the only ones that append; any other string starting `a` is an invalid flag Node
 * rejects before writing.
 */
const APPEND_FLAGS: ReadonlySet<string> = new Set(["a", "ax", "a+", "ax+", "as", "as+"]);

/** How deep a chain of `const` references is followed — far past any real one, and a stop for a cyclic one. */
export const MAX_CONST_HOPS = 8;

/**
 * One `const` binding: the scope it is declared into, its initializer, and — for a name an object destructure binds,
 * `const { O_APPEND: APPEND } = constants` — the member of that initializer it reads.
 */
interface ConstBinding {
  readonly scope: ts.Node;
  readonly initializer: ts.Expression;
  readonly key?: string;
}

/** Every `const` binding in a file by name — one per scope that declares it. */
export type ConstBindings = ReadonlyMap<string, readonly ConstBinding[]>;

/** The `const` lookup every value resolution reads, and how many hops it has left. */
export interface ConstScope {
  readonly consts: ConstBindings;
  readonly hops: number;
}

/**
 * A static member read — `x.name`, or `x["name"]` with a literal key — split into its receiver and its name.
 *
 * @returns the receiver and the member's name, or `undefined` when the expression is not a static member read
 */
export function memberOf({ node }: { node: ts.Expression }): { receiver: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return { name: node.name.text, receiver: node.expression };
  }
  if (ts.isElementAccessExpression(node) && isStringLiteralLikeNode(node.argumentExpression)) {
    return { name: node.argumentExpression.text, receiver: node.expression };
  }
  return undefined;
}

/**
 * An expression with its parentheses, type assertions, non-null marks and a `(0, f)` comma prefix taken off.
 *
 * @returns the innermost expression those wrappers hold
 */
export function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  const isWrapper =
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    isTypeAssertion(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node);
  if (isWrapper) {
    return unwrapped({ node: node.expression });
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return unwrapped({ node: node.right });
  }
  return node;
}

/** The scope a `const` list declares into: its block or file, a whole `switch`, or the loop that holds it. */
function scopeOfList({ list }: { list: ts.VariableDeclarationList }): ts.Node {
  const holder = list.parent;
  if (!ts.isVariableStatement(holder)) {
    return holder;
  }
  const container = holder.parent;
  if (ts.isCaseClause(container) || ts.isDefaultClause(container)) {
    return container.parent;
  }
  return container;
}

/**
 * Every `const` in the file by name, each with the scope it is declared into, so a use reads the binding its own scope
 * sees rather than whichever same-named `const` the file declares last.
 *
 * @returns the bindings of each `const` bound to a plain name, at any depth
 */
export function constInitializersOf({ sf }: { sf: ts.SourceFile }): ConstBindings {
  const found = new Map<string, ConstBinding[]>();
  const visit: NodeVisitor = (node) => {
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const) !== 0) {
      recordConstList({ found, list: node });
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return found;
}

/** Add one binding under its name. */
function addBinding({
  name,
  binding,
  found,
}: {
  name: string;
  binding: ConstBinding;
  found: Map<string, ConstBinding[]>;
}): void {
  const bindings = found.get(name);
  if (bindings === undefined) {
    found.set(name, [binding]);
  } else {
    bindings.push(binding);
  }
}

/**
 * Record each plain name one level of an object destructure binds, keyed by the member it reads. A nested pattern is
 * not followed, nor a rest element, which holds the initializer minus the names bound before it (recording it whole flagged `const { flag, ...options } = { flag: "a" }`).
 */
function recordPattern({
  pattern,
  initializer,
  scope,
  found,
}: {
  pattern: ts.ObjectBindingPattern;
  initializer: ts.Expression;
  scope: ts.Node;
  found: Map<string, ConstBinding[]>;
}): void {
  for (const element of pattern.elements) {
    if (element.name === undefined || !ts.isIdentifier(element.name) || element.dotDotDotToken !== undefined) {
      continue;
    }
    const name = element.name.text;
    const key = element.propertyName === undefined ? name : propertyKeyOf({ name: element.propertyName });
    if (key !== undefined) {
      addBinding({ binding: { initializer, key, scope }, found, name });
    }
  }
}

/** Record each initialised declaration of one `const` list — a plain name, or one level of an object destructure. */
function recordConstList({
  list,
  found,
}: {
  list: ts.VariableDeclarationList;
  found: Map<string, ConstBinding[]>;
}): void {
  const scope = scopeOfList({ list });
  for (const declaration of list.declarations) {
    const initializer = declaration.initializer;
    if (initializer === undefined) {
      continue;
    }
    if (ts.isIdentifier(declaration.name)) {
      addBinding({ binding: { initializer, scope }, found, name: declaration.name.text });
    }
    if (ts.isObjectBindingPattern(declaration.name)) {
      recordPattern({ found, initializer, pattern: declaration.name, scope });
    }
  }
}

/**
 * The `const` binding a use of a name means: the one declared in the nearest scope that declares the name at all. A
 * `let`, `var`, parameter or other declaration there resolves to nothing.
 *
 * @param identifier the use being resolved
 * @param consts the file's bindings from {@link constInitializersOf}
 * @returns that `const`'s binding, or `undefined` when the name does not mean a same-file `const` there
 */
function constBindingFor({
  identifier,
  consts,
}: {
  identifier: ts.Identifier;
  consts: ConstBindings;
}): ConstBinding | undefined {
  const bindings = consts.get(identifier.text);
  if (bindings === undefined) {
    return undefined;
  }
  const scope = declaringScopeOf({ identifier });
  return bindings.find((binding) => binding.scope === scope);
}

/** The value member `name` of `receiver` statically holds, when the receiver resolves to an object literal. */
function memberValue({
  receiver,
  name,
  scope,
}: {
  receiver: ts.Expression;
  name: string;
  scope: ConstScope;
}): ts.Expression | undefined {
  const owner = resolvedValue({ node: receiver, scope });
  return ts.isObjectLiteralExpression(owner) ? propertyValue({ key: name, object: owner, scope }) : undefined;
}

/** What a binding gives its name: its initializer, or the member of it a destructure reads when that resolves. */
function boundValue({ binding, scope }: { binding: ConstBinding; scope: ConstScope }): ts.Expression | undefined {
  if (binding.key === undefined) {
    return binding.initializer;
  }
  return memberValue({ name: binding.key, receiver: binding.initializer, scope });
}

/** A property name's static text — `flag`, `"flag"` or `["flag"]` — or `undefined` for a computed one. */
function propertyKeyOf({ name }: { name: ts.PropertyName }): string | undefined {
  if (ts.isIdentifier(name) || isStringLiteralLikeNode(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && isStringLiteralLikeNode(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

/**
 * The value an object literal gives `key`, the last writer winning, a spread of a resolvable object included.
 *
 * @param object the object literal to read
 * @param key the property's static name
 * @param scope the `const`s a spread is resolved through
 * @returns the expression `key` is given last, or `undefined` when nothing static gives it one
 */
function propertyValue({
  object,
  key,
  scope,
}: {
  object: ts.ObjectLiteralExpression;
  key: string;
  scope: ConstScope;
}): ts.Expression | undefined {
  let value: ts.Expression | undefined;
  for (const property of object.properties) {
    const given = valueGivenBy({ key, property, scope });
    if (given !== undefined) {
      value = given;
    }
  }
  return value;
}

/** The value one member of an object literal gives `key` — an assignment, a shorthand or a resolvable spread. */
function valueGivenBy({
  property,
  key,
  scope,
}: {
  property: ts.ObjectLiteralElementLike;
  key: string;
  scope: ConstScope;
}): ts.Expression | undefined {
  if (ts.isPropertyAssignment(property) && propertyKeyOf({ name: property.name }) === key) {
    return property.initializer;
  }
  if (ts.isShorthandPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === key) {
    return property.name;
  }
  if (!ts.isSpreadAssignment(property)) {
    return undefined;
  }
  const spread = resolvedValue({ node: property.expression, scope });
  return ts.isObjectLiteralExpression(spread) ? propertyValue({ key, object: spread, scope }) : undefined;
}

/**
 * What an expression statically is: itself unwrapped, or — when it names a same-file `const`, or reads a member of
 * one holding an object literal — the value that `const` gives it, followed up to {@link MAX_CONST_HOPS} times.
 *
 * @param scope the file's `const`s and the hops left
 * @returns the resolved expression, or the unwrapped one when nothing static resolves it further
 */
export function resolvedValue({ node, scope }: { node: ts.Expression; scope: ConstScope }): ts.Expression {
  const bare = unwrapped({ node });
  if (scope.hops <= 0) {
    return bare;
  }
  const next = { consts: scope.consts, hops: scope.hops - 1 };
  const binding = ts.isIdentifier(bare) ? constBindingFor({ consts: scope.consts, identifier: bare }) : undefined;
  const member = memberOf({ node: bare });
  let value: ts.Expression | undefined;
  if (binding !== undefined) {
    value = boundValue({ binding, scope: next });
  } else if (member !== undefined) {
    value = memberValue({ name: member.name, receiver: member.receiver, scope: next });
  }
  return value === undefined ? bare : resolvedValue({ node: value, scope: next });
}

/** Whether an expression is a string literal that is one of Node's append flags. */
function isAppendString({ node }: { node: ts.Expression }): boolean {
  return (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && APPEND_FLAGS.has(node.text);
}

/** Whether an expression names `O_APPEND` anywhere inside it, a `const` it names followed into its initializer. */
function namesAppendConstant({ node, scope }: { node: ts.Node; scope: ConstScope }): boolean {
  if ((ts.isIdentifier(node) || isStringLiteralLikeNode(node)) && node.text === "O_APPEND") {
    return true;
  }
  const binding = ts.isIdentifier(node) ? constBindingFor({ consts: scope.consts, identifier: node }) : undefined;
  if (binding !== undefined && scope.hops > 0) {
    const next = { consts: scope.consts, hops: scope.hops - 1 };
    const value = boundValue({ binding, scope: next });
    return binding.key === "O_APPEND" || (value !== undefined && namesAppendConstant({ node: value, scope: next }));
  }
  return (
    forEachChild({ node, visit: (child) => (namesAppendConstant({ node: child, scope }) ? true : undefined) }) === true
  );
}

/**
 * Whether a flags argument opens for append — one of Node's append flag strings, or an expression naming `O_APPEND`,
 * directly or through `const`s in the same file.
 *
 * @param node the flags argument as written
 * @returns true when the flags open for append
 */
export function isAppendFlags({ node, scope }: { node: ts.Expression; scope: ConstScope }): boolean {
  const subject = resolvedValue({ node, scope });
  return isAppendString({ node: subject }) || namesAppendConstant({ node: subject, scope });
}

/**
 * Whether arguments include an options object — inline or a same-file `const` — whose `flag`/`flags` appends.
 *
 * @param args the arguments the fs writer receives
 * @returns true when one of them is an options object carrying an append flag
 */
export function hasAppendFlagOption({ args, scope }: { args: readonly ts.Expression[]; scope: ConstScope }): boolean {
  return args.some((argument) => {
    const options = resolvedValue({ node: argument, scope });
    if (!ts.isObjectLiteralExpression(options)) {
      return false;
    }
    return ["flag", "flags"].some((key) => {
      const value = propertyValue({ key, object: options, scope });
      return value !== undefined && isAppendString({ node: resolvedValue({ node: value, scope }) });
    });
  });
}
