/**
 * Every module one command module loads in a shape the path scanner cannot read member by member — the half of
 * `./inProcessVerbPaths.ts` that ERRS IN. Review kept finding one more shape the precise reader missed
 * (a `satisfies` around an awaited import, a namespace read by an index), so rather than chase each one, a load whose
 * every use is not a member read by a literal name counts as reaching EVERY verb body the loaded module exports.
 *
 * Readable, and so left to the precise reader: a static named or default import; `import * as ns` or `const ns =
 * await import()` whose every reference outside a type is `ns.member` or `ns["member"]`; and `const { a, "b": c } =
 * await import()` whose every key is an identifier or a string. Every value-preserving wrapper (parentheses, `as`,
 * `satisfies`, `<T>`, `!`) is looked through. Anything else naming a literal relative specifier — a side-effect
 * `import "./x.js"`, a re-export `export … from "./x.js"`, a namespace handed on whole or destructured, a computed or
 * nested key, a rest element, `(await import()).member`, a `.then` — is opaque. An `import()` of a specifier that is
 * not a literal (a template with a substitution is not one) names no module, which the scanner's header states as
 * residue.
 */
import { forEachChild, isStringLiteralLikeNode, isTypeAssertion, type NodeVisitor, ts } from "#lib/tsSyntax.js";

/** A wrapper that leaves the value it wraps unchanged. */
type ValueWrapper =
  ts.AsExpression | ts.NonNullExpression | ts.ParenthesizedExpression | ts.SatisfiesExpression | ts.TypeAssertion;

/** Whether a node only wraps its operand's value: parentheses, `as`, `satisfies`, `<T>` or `!`. */
function isValueWrapper(node: ts.Node): node is ValueWrapper {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    isTypeAssertion(node) ||
    ts.isNonNullExpression(node)
  );
}

/**
 * An expression with every value-preserving wrapper around it removed.
 *
 * @param node the expression, possibly wrapped in parentheses, `as`, `satisfies`, `<T>` or `!`
 * @returns the expression those wrappers hold
 */
export function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (isValueWrapper(current)) {
    current = current.expression;
  }
  return current;
}

/** The outermost value-preserving wrapper around `node`, or `node` itself when nothing wraps it. */
function outermost({ node }: { node: ts.Node }): ts.Node {
  let current = node;
  while (isValueWrapper(current.parent)) {
    current = current.parent;
  }
  return current;
}

/**
 * The member one node reads off the namespace object `local` — `local.member` or `local["member"]` — or null.
 *
 * @param node the expression that may read a member
 * @param local the namespace object's local name
 * @returns the member's name, or null when the node reads none by a literal name
 */
export function memberRead({ node, local }: { node: ts.Node; local: string }): string | null {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === local) {
    return node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === local &&
    isStringLiteralLikeNode(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

/**
 * Whether an identifier REFERS to a binding, rather than naming a property, a member or a declaration. A shorthand
 * property and an export specifier refer; a member name, a destructure's key or bound name, and any declaration's own
 * name do not.
 *
 * @param node the identifier
 * @returns whether it reads the binding its text names
 */
export function isReference({ node }: { node: ts.Identifier }): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent) || ts.isExportSpecifier(parent)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.expression === node;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) {
    return false;
  }
  return !("name" in parent && parent.name === node);
}

/**
 * Whether a `typeof local` anywhere in the module, however deep in another type (`Readonly<typeof ns>`), takes the
 * namespace whole, as a value use does; `typeof ns.f` and `ns.T` name a member.
 */
function takenWholeByTypeof({ local, source }: { local: string; source: ts.SourceFile }): boolean {
  let whole = false;
  const visit: NodeVisitor = (node) => {
    if (ts.isTypeQueryNode(node) && ts.isIdentifier(node.exprName) && node.exprName.text === local) {
      whole = true;
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return whole;
}

/** Whether every reference to `local` outside a type and an import reads a member off it by a literal name. */
function onlyMembersRead({ local, source }: { local: string; source: ts.SourceFile }): boolean {
  let readable = !takenWholeByTypeof({ local, source });
  const visit: NodeVisitor = (node) => {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) {
      return;
    }
    const referenced = ts.isIdentifier(node) && node.text === local && isReference({ node });
    if (referenced && memberRead({ local, node: node.parent }) === null) {
      readable = false;
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return readable;
}

/** Whether a destructure names every member it takes by an identifier or a string key, with no rest or nesting. */
function readablePattern({ pattern }: { pattern: ts.BindingName }): boolean {
  if (!ts.isObjectBindingPattern(pattern)) {
    return false;
  }
  return pattern.elements.every((element) => {
    const key = element.propertyName;
    const keyReadable = key === undefined || ts.isIdentifier(key) || ts.isStringLiteral(key);
    return (
      element.dotDotDotToken === undefined && element.name !== undefined && ts.isIdentifier(element.name) && keyReadable
    );
  });
}

/** Whether the precise reader can name every member one literal `import()` call's module is used through. */
function dynamicReadable({ call, source }: { call: ts.CallExpression; source: ts.SourceFile }): boolean {
  const awaited = outermost({ node: call }).parent;
  if (!ts.isAwaitExpression(awaited)) {
    return false;
  }
  const held = outermost({ node: awaited });
  const holder = held.parent;
  if (!ts.isVariableDeclaration(holder) || holder.initializer !== held) {
    return false;
  }
  if (ts.isIdentifier(holder.name)) {
    return onlyMembersRead({ local: holder.name.text, source });
  }
  return readablePattern({ pattern: holder.name });
}

/** The specifier one static import loads opaquely — a namespace import used other than by member — or null. */
function staticOpaque({ node, source }: { node: ts.ImportDeclaration; source: ts.SourceFile }): string | null {
  const clause = node.importClause;
  if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword || !ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }
  // `import "./x.js"` runs the module and names nothing in it, so no member of it can be read.
  if (clause === undefined) {
    return node.moduleSpecifier.text;
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined || !ts.isNamespaceImport(bindings)) {
    return null;
  }
  return onlyMembersRead({ local: bindings.name.text, source }) ? null : node.moduleSpecifier.text;
}

/**
 * Every literal specifier one module loads in a shape whose members the precise reader cannot name.
 *
 * @param source the importing module
 * @returns each opaque load's specifier, once per load
 */
export function opaqueLoads({ source }: { source: ts.SourceFile }): readonly string[] {
  const found: string[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = staticOpaque({ node, source });
      if (specifier !== null) {
        found.push(specifier);
      }
      return;
    }
    // `export { f } from "./x.js"` and `export * from "./x.js"` hand the module's bodies to whoever imports this one.
    const reExported = ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined;
    if (reExported && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      // `import(\`./x.js\`)` with no substitution names its module exactly as a quoted string does.
      if (argument !== undefined && isStringLiteralLikeNode(argument) && !dynamicReadable({ call: node, source })) {
        found.push(argument.text);
      }
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return found;
}
