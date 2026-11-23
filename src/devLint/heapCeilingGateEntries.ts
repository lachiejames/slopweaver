/**
 * Reading `gateGroups.ts` as DATA: every object literal shaped like a lint-gate entry (a plain-string
 * `name` plus an `args` in some spelling), with its argv when that argv is one array of plain string
 * literals. Syntax-only and fail-closed — an entry whose name or argv this reader cannot follow comes back
 * with `words: undefined`, which `heapCeilingSubjects.ts` turns into an `unread` verdict.
 */
import { forEachChild, isConstDeclaration, type NodeVisitor, nameOf, ts } from "#lib/tsSyntax.js";

/**
 * One object literal shaped like a gate entry: a plain-string `name`, plus an `args` in any spelling or an
 * object spread. `words` is the argv when `args` is one array of plain string literals, else `undefined`.
 */
export interface GateArgs {
  readonly name: string;
  readonly elements: readonly ts.Expression[];
  readonly words: readonly string[] | undefined;
}

/**
 * The string a literal node carries, when it is a plain string with no substitution.
 *
 * @param node any expression
 * @returns its text, or `undefined` for anything computed
 */
function literalText({ node }: { node: ts.Node }): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

/**
 * The property of an object literal with a given name, when it is a plain `name: value` assignment.
 *
 * @param literal the object literal
 * @param name the property's name
 * @returns its initializer, or `undefined`
 */
function propertyNamed({
  literal,
  name,
}: {
  literal: ts.ObjectLiteralExpression;
  name: string;
}): ts.Expression | undefined {
  const found = literal.properties.find(
    (property) => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  return found !== undefined && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}

/**
 * Whether an object literal could hand a child an argv, or a NAME, this reader cannot see: a spread that
 * could carry either in, a key that is not a plain identifier (`["na" + "me"]` evaluates to `name` — Codex
 * r3, rerun), an `args` spelled any way but `args: …`, or a `name` or `args` given twice, where the later
 * one wins at run time and this reader would have read the first.
 *
 * @param literal the object literal
 * @returns true when any of those holds
 */
function hasOpaqueArgs({ literal }: { literal: ts.ObjectLiteralExpression }): boolean {
  const keyed = ({ key }: { key: string }): readonly ts.ObjectLiteralElementLike[] =>
    literal.properties.filter((property) => {
      const name = nameOf({ node: property });
      return name !== undefined && ts.isIdentifier(name) && name.text === key;
    });
  const unreadableKey = literal.properties.some(
    (property) => ts.isSpreadAssignment(property) || !ts.isIdentifier(property.name),
  );
  const args = keyed({ key: "args" });
  return (
    unreadableKey ||
    args.length > 1 ||
    keyed({ key: "name" }).length > 1 ||
    args.some((property) => !ts.isPropertyAssignment(property))
  );
}

/**
 * Read one object literal as a gate entry, if it is shaped like one.
 *
 * @param literal the object literal
 * @param source the parsed file, for resolving a named `args`
 * @returns the entry, or `undefined` when the literal is not gate-shaped
 */
function gateEntryOf({
  literal,
  source,
}: {
  literal: ts.ObjectLiteralExpression;
  source: ts.SourceFile;
}): GateArgs | undefined {
  const nameNode = propertyNamed({ literal, name: "name" });
  const argsNode = propertyNamed({ literal, name: "args" });
  const name = nameNode === undefined ? undefined : literalText({ node: nameNode });
  const opaque = hasOpaqueArgs({ literal });
  if (name === undefined || (argsNode === undefined && !opaque)) {
    return undefined;
  }
  const resolved = argsNode === undefined || opaque ? undefined : argsElements({ argsNode, source });
  if (resolved === undefined) {
    return { elements: [], name, words: undefined };
  }
  const read = resolved.map((element) => literalText({ node: element }));
  const plain = read.filter((word): word is string => word !== undefined);
  return { elements: resolved, name, words: plain.length === read.length ? plain : undefined };
}

/**
 * Every gate-shaped object literal in a file, in source order.
 *
 * @param source the parsed file
 * @returns each literal's name, its `args` elements, and its argv when every element is a plain literal
 */
export function gatesIn({ source }: { source: ts.SourceFile }): readonly GateArgs[] {
  const gates: GateArgs[] = [];
  const visit: NodeVisitor = (node) => {
    const gate = ts.isObjectLiteralExpression(node) ? gateEntryOf({ literal: node, source }) : undefined;
    if (gate !== undefined) {
      gates.push(gate);
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return gates;
}

/**
 * Strip the wrappers a constant's initializer may carry without changing its value.
 *
 * @param node an initializer
 * @returns the expression under any `as`, `satisfies` or parentheses
 */
function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrapped({ node: node.expression });
  }
  return node;
}

/**
 * The elements a gate's `args` holds: the array literal itself, or — ONE hop — a same-file `const` array
 * literal named by an identifier that nothing else in the file touches. `prettier`'s `PRETTIER_CHECK_ARGS`
 * is the shape. A name declared twice, a `let`, or a name used anywhere but as an `args:` value (where a
 * `push` could add a word) is `undefined`, so the gate is unread.
 *
 * @param argsNode the `args` property's initializer
 * @param source the parsed file
 * @returns the elements, or `undefined` when they cannot be read without evaluating code
 */
function argsElements({
  argsNode,
  source,
}: {
  argsNode: ts.Expression;
  source: ts.SourceFile;
}): readonly ts.Expression[] | undefined {
  if (ts.isArrayLiteralExpression(argsNode)) {
    return argsNode.elements;
  }
  if (!ts.isIdentifier(argsNode)) {
    return undefined;
  }
  const declarations: ts.VariableDeclaration[] = [];
  const otherUses: ts.Identifier[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === argsNode.text) {
      declarations.push(node);
    } else if (ts.isIdentifier(node) && node.text === argsNode.text) {
      const asArgsValue =
        ts.isPropertyAssignment(node.parent) &&
        node.parent.initializer === node &&
        node.parent.name.getText() === "args";
      const isDeclaredName = ts.isVariableDeclaration(node.parent) && node.parent.name === node;
      if (!asArgsValue && !isDeclaredName) {
        otherUses.push(node);
      }
    }
    forEachChild({ node, visit });
  };
  visit(source);
  const [only] = declarations;
  const isConst = only !== undefined && isConstDeclaration({ declaration: only });
  const initializer = only?.initializer;
  const value = initializer === undefined ? undefined : unwrapped({ node: initializer });
  const unreadable = otherUses.length > 0 || declarations.length !== 1 || !isConst;
  if (unreadable || value === undefined || !ts.isArrayLiteralExpression(value)) {
    return undefined;
  }
  return value.elements;
}
