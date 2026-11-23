/*
 * Every override-variable NAME a file's code spells, found as syntax rather than as text: a string literal whose
 * whole value is shaped like an override (`./overrideVariable.ts`), and a property KEY so shaped in any key
 * position — read off any object (`process.env.X`, `(process.env).X`, an alias's `.X`), destructured from one
 * (`const { X } = …`, `({ X: y } = …)`), or written as an object-literal, type or class member (`{ X: "1" }`).
 *
 * Syntax, because a line regex lost to three ordinary spellings in one review: a block comment closed on the
 * same line, a generator method's `*`, and a property access Prettier or a hand had wrapped —
 * `process.env\n  .ACME_POLICY_OVERRIDE`. A node is the same node however it is laid out, and a comment is
 * never a node, so all three are answered at once. Each name is reported on the line its own token starts on.
 *
 * A `+` chain or a template made of nothing but literals is folded first, so `process.env["ACME_" + "OVERRIDE"]`
 * is the one name it spells. What it does NOT close: a name assembled from a VALUE. A template hole, a chain
 * operand or a key that names a constant elsewhere opens a hatch this reader never sees, because resolving one means
 * constant-folding through the type checker, and an author can always assemble it from a value only the
 * runtime holds. That input has to be CONSTRUCTED to evade, not written by accident; the
 * mechanism that would close it is a runtime one — the refusing module asking `src/hatch/` by row id rather
 * than reading the environment itself — not a wider pattern here.
 */

import {
  forEachChild,
  isClassElement,
  isParameterDeclaration,
  isTypeAssertion,
  isTypeElement,
  type NodeVisitor,
  nameOf,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";
import { isOverrideVariableName } from "./overrideVariable.js";

/** The modifiers that make a constructor parameter a class member as well as a binding. */
const PARAMETER_PROPERTY_MODIFIERS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.OverrideKeyword,
]);

/**
 * The identifier one node spells as a property KEY, in any position a key can take: the name of a property
 * access, the key of a destructuring element, and the name of ANY member — of an object literal, a class, a type
 * or an enum, so a property, a shorthand, a method and an accessor alike. The receiver and the role are
 * deliberately not consulted — `(process.env).X` read, `({ X: open } = process.env)` assignment-destructured (an OBJECT LITERAL to the parser) and `{ X: "1" }`
 * handed to a child's environment all name the same variable, and each narrower test lost to one of them under
 * review. A local binding's own name is not a key, so `const ACME_ALLOW_LOCAL = 1`, an object REST element and
 * an ARRAY pattern's element stay out — which is why a destructuring key is read off its object pattern, from the top down,
 * rather than by asking an element about its parent.
 *
 * Each node kind has its own reader below, asked in order; the first that recognises the node answers, and a
 * node none of them recognises is read as a member, or spells no key at all.
 *
 * @param node any node of the file
 * @returns the key identifiers, empty when the node spells none
 */
function keysOf({ node }: { node: ts.Node }): readonly ts.Identifier[] {
  for (const read of KEY_READERS) {
    const keys = read({ node });
    if (keys !== undefined) {
      return keys;
    }
  }
  return memberKeys({ node });
}

/** One node kind's key reader: the keys it spells, or undefined when the node is not that reader's kind. */
type KeyReader = (args: { node: ts.Node }) => readonly ts.Identifier[] | undefined;

/**
 * A destructuring pattern's keys — `const { X } = …`, `const { X: y } = …` — never a rest element's binding.
 *
 * @param node any node of the file
 * @returns the pattern's keys, or undefined when the node is not an object binding pattern
 */
function bindingPatternKeys({ node }: { node: ts.Node }): readonly ts.Identifier[] | undefined {
  if (!ts.isObjectBindingPattern(node)) {
    return undefined;
  }
  return node.elements.flatMap((element) => {
    if (element.dotDotDotToken !== undefined) {
      return [];
    }
    if (element.propertyName === undefined) {
      return element.name !== undefined && ts.isIdentifier(element.name) ? [element.name] : [];
    }
    return ts.isIdentifier(element.propertyName) ? [element.propertyName] : [];
  });
}

/**
 * A member read in a TYPE position: a qualified name's right half — `typeof env.X` — and an import type's
 * qualifier — `import("./x").X`, or `.X.Y` — whose LEFTMOST name is the one no qualified name carries as a right
 * half.
 *
 * @param node any node of the file
 * @returns the member name, or undefined when the node is neither shape
 */
function typePositionKeys({ node }: { node: ts.Node }): readonly ts.Identifier[] | undefined {
  if (ts.isQualifiedName(node)) {
    return ts.isIdentifier(node.right) ? [node.right] : [];
  }
  if (!ts.isImportTypeNode(node) || node.qualifier === undefined) {
    return undefined;
  }
  let leftmost: ts.EntityName = node.qualifier;
  while (ts.isQualifiedName(leftmost)) {
    leftmost = leftmost.left;
  }
  return [leftmost];
}

/**
 * An export ALIAS — `export { a as X }`, `export * as X` — a new name another module sees, never a reference to
 * a local, so a same-named binding elsewhere in the file cannot mask it.
 *
 * @param node any node of the file
 * @returns the alias, or undefined when the node is no export alias position
 */
function exportAliasKeys({ node }: { node: ts.Node }): readonly ts.Identifier[] | undefined {
  if (ts.isExportSpecifier(node)) {
    return node.propertyName !== undefined && ts.isIdentifier(node.name) ? [node.name] : [];
  }
  if (ts.isNamespaceExport(node)) {
    return ts.isIdentifier(node.name) ? [node.name] : [];
  }
  return undefined;
}

/**
 * An attribute's key: an import attribute — `with { X: "1" }` — keys the attributes object, and a JSX attribute,
 * in a `.tsx` file the gate scans, keys the element's props, a namespaced one — `ns:X="1"` — by its right half.
 *
 * @param node any node of the file
 * @returns the attribute's key, or undefined when the node is no attribute
 */
function attributeKeys({ node }: { node: ts.Node }): readonly ts.Identifier[] | undefined {
  if (ts.isImportAttribute(node)) {
    return ts.isIdentifier(node.name) ? [node.name] : [];
  }
  if (!ts.isJsxAttribute(node)) {
    return undefined;
  }
  if (ts.isJsxNamespacedName(node.name)) {
    return [node.name.name];
  }
  return [node.name];
}

/**
 * A constructor PARAMETER PROPERTY — `constructor(public X: string)` — declares a class member, and a parameter
 * carries an accessibility or `readonly` modifier only in that position. Read from the CONSTRUCTOR down, the same
 * top-down walk every reader here takes.
 *
 * @param node any node of the file
 * @returns the parameter properties' names, or undefined when the node is no constructor
 */
function parameterPropertyKeys({ node }: { node: ts.Node }): readonly ts.Identifier[] | undefined {
  if (!ts.isConstructorDeclaration(node)) {
    return undefined;
  }
  return node.parameters.flatMap((parameter) => {
    const declaresMember =
      parameter.modifiers?.some((modifier) => PARAMETER_PROPERTY_MODIFIERS.has(modifier.kind)) === true;
    return declaresMember && ts.isIdentifier(parameter.name) ? [parameter.name] : [];
  });
}

/** The readers `keysOf` asks in order, before falling to `memberKeys`; a constructor is read before it is a member. */
const KEY_READERS: readonly KeyReader[] = [
  bindingPatternKeys,
  typePositionKeys,
  exportAliasKeys,
  attributeKeys,
  parameterPropertyKeys,
];

/**
 * The name of a property access, or of any member — of an object literal, a class, a type or an enum.
 *
 * @param node any node of the file
 * @returns the member's name, empty when the node is no member or its name is not an identifier
 */
function memberKeys({ node }: { node: ts.Node }): readonly ts.Identifier[] {
  const member =
    ts.isObjectLiteralElementLike(node) || isClassElement(node) || isTypeElement(node) || ts.isEnumMember(node);
  if (!ts.isPropertyAccessExpression(node) && !member) {
    return [];
  }
  const name = nameOf({ node });
  return name !== undefined && ts.isIdentifier(name) ? [name] : [];
}

/**
 * The value a `+` chain of literals evaluates to, folded from syntax alone with JavaScript's own `+`: every
 * operand a string, numeric or bigint literal, a template whose every hole folds, one wrapped only in
 * parentheses or a type-level wrapper (`as`, `satisfies`, `<T>x`, `x!`), or another such chain. Two numbers (or two bigints) ADD and anything beside a string CONCATENATES, so
 * `1 + 2 + "_X"` is `"3_X"`, as at runtime; a number beside a bigint throws there, so it folds to nothing.
 * Anything else — a name, a call, a template with a non-literal hole — is a value only the checker or the
 * runtime holds, so the chain spells nothing here.
 *
 * @param node a binary expression, a template, or any operand inside one
 * @returns the folded value, or undefined when some operand is not a literal
 */
function foldedValue({ node }: { node: ts.Node }): string | number | bigint | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (ts.isBigIntLiteral(node)) {
    return BigInt(node.text.slice(0, -1));
  }
  // A wrapper that changes no runtime value — parentheses, `as`, `satisfies`, `<T>x`, `x!` — folds through.
  const isTransparent =
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    isTypeAssertion(node) ||
    ts.isNonNullExpression(node);
  if (isTransparent) {
    return foldedValue({ node: node.expression });
  }
  if (ts.isTemplateExpression(node)) {
    return foldedTemplate({ node });
  }
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) {
    return undefined;
  }
  const left = foldedValue({ node: node.left });
  const right = foldedValue({ node: node.right });
  if (left === undefined || right === undefined) {
    return undefined;
  }
  if (typeof left === "string" || typeof right === "string") {
    return `${left}${right}`;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left + right;
  }
  if (typeof left === "bigint" && typeof right === "bigint") {
    return left + right;
  }
  return undefined;
}

/**
 * The text a template spells when every hole folds to a literal — `` `ACME_${"ALLOW"}_X` ``.
 *
 * @param node a template with at least one hole
 * @returns the folded text, or undefined when some hole is not a literal
 */
function foldedTemplate({ node }: { node: ts.TemplateExpression }): string | undefined {
  let text = node.head.text;
  for (const span of node.templateSpans) {
    const hole = foldedValue({ node: span.expression });
    if (hole === undefined) {
      return undefined;
    }
    text += `${hole}${span.literal.text}`;
  }
  return text;
}

/**
 * The string a `+` chain of literals spells — `foldedValue`, when what it folds to is a string.
 *
 * @param node a binary expression
 * @returns the folded text, or undefined when the chain is not all literals or folds to a number
 */
function foldedLiteral({ node }: { node: ts.Node }): string | undefined {
  const value = foldedValue({ node });
  return typeof value === "string" ? value : undefined;
}

/**
 * The override names one node spells, each with the node whose start is its line.
 *
 * @param node any node of the file
 * @returns the names and the nodes that carry them, empty when the node spells none
 */
function overrideNamesOf({ node }: { node: ts.Node }): readonly { name: string; at: ts.Node }[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return isOverrideVariableName({ name: node.text }) ? [{ at: node, name: node.text }] : [];
  }
  if (ts.isBinaryExpression(node) || ts.isTemplateExpression(node)) {
    const folded = foldedLiteral({ node });
    return folded !== undefined && isOverrideVariableName({ name: folded }) ? [{ at: node, name: folded }] : [];
  }
  return keysOf({ node })
    .filter((key) => isOverrideVariableName({ name: key.text }))
    .map((key) => ({ at: key, name: key.text }));
}

/**
 * The identifier a declaration binds as a LOCAL name — a variable, a parameter (a parameter property
 * included: it is a key AND a local), a binding element, a function, class, type, enum or namespace, an import alias, or a type
 * parameter. A tuple label, a statement label, an export specifier and `export * as` bind nothing a reference
 * resolves to — an export's name is what ANOTHER module sees — so none counts: one shaped like an override is
 * reported rather than allowed to mask a real reference.
 *
 * @param node any node of the file
 * @returns the bound identifier, or undefined when the node binds no local name
 */
function boundNameOf({ node }: { node: ts.Node }): ts.Identifier | undefined {
  // Every parameter binds a local — a parameter PROPERTY too, whose own name `keysOf` still reports as a key.
  if (isParameterDeclaration(node)) {
    return ts.isIdentifier(node.name) ? node.name : undefined;
  }
  const binds =
    ts.isVariableDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isImportClause(node) ||
    ts.isImportSpecifier(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportEqualsDeclaration(node);
  if (!binds) {
    return undefined;
  }
  const name: ts.Node | undefined = node.name;
  return name !== undefined && ts.isIdentifier(name) ? name : undefined;
}

/**
 * The identifiers a node spells only as ANOTHER module's export, as that module spells it: the imported side of
 * `import { a as b }`, and the source side of a re-export (`export { a } from`, `export { a as b } from`'s `a`).
 * Its declaration lives in that module, where the gate reads it; an alias (`b`) is a new name and stays read.
 * Read from the declaration down, the same top-down walk every reader here takes.
 *
 * @param node any node of the file
 * @returns the identifiers that only refer to a name declared in another module
 */
function foreignExportNames({ node }: { node: ts.Node }): readonly ts.Node[] {
  if (ts.isImportSpecifier(node)) {
    return node.propertyName === undefined ? [] : [node.propertyName];
  }
  const reexports =
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined &&
    node.exportClause !== undefined &&
    ts.isNamedExports(node.exportClause);
  if (!reexports) {
    return [];
  }
  return node.exportClause.elements.map((spec) => {
    if (spec.propertyName === undefined) {
      return spec.name;
    }
    return spec.propertyName;
  });
}

/**
 * Every local name the file binds, so a later use of one is told apart from a key.
 *
 * @param sf the parsed file
 * @returns the bound names' text
 */
function localNames({ sf }: { sf: ts.SourceFile }): ReadonlySet<string> {
  const names = new Set<string>();
  const visit: NodeVisitor = (node) => {
    const bound = boundNameOf({ node });
    if (bound !== undefined) {
      names.add(bound.text);
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return names;
}

/**
 * Every override-variable name the file's code spells, keyed by the 1-indexed line its token starts on, each
 * line's names in source order and deduplicated.
 *
 * Two readers compose. The NAMED key positions (`keysOf`) report a key even when a local shares its name. The
 * CATCH-ALL then reports any override-shaped identifier that is not a name this file binds, nor another
 * module's export named as that module spells it (`foreignExportNames`, read where it is declared) — so a key position
 * nobody listed (an import attribute, a JSX attribute, whatever the grammar adds next) is caught by
 * construction rather than by a review finding it one form at a time, and a use of a local is never a key.
 * The bound set is the FILE's, by text, not a scope's: a same-named local anywhere in the file masks the
 * catch-all for that name (never a named key position). Resolving scope is the binder's job, which a
 * syntax-only parse does not run; the residue is a name that is both bound somewhere and used unbound elsewhere.
 *
 * @param content the file's text
 * @param path the repo-relative path, which picks the TS or TSX parser
 * @returns line number to the names spelled there; a line with none is absent
 */
export function overrideNamesByLine({
  content,
  path,
}: {
  content: string;
  path: string;
}): ReadonlyMap<number, readonly string[]> {
  const byLine = new Map<number, readonly string[]>();
  for (const [line, spans] of overrideNameSpansByLine({ content, path })) {
    byLine.set(line, [...new Set(spans.map((span) => span.name))]);
  }
  return byLine;
}

/** One override name the syntax tree found, with the columns its source node covers on the line it starts. */
export interface ShapedName {
  readonly name: string;
  /** The 0-indexed column the node starts at. */
  readonly start: number;
  /** The column it ends before — `Infinity` when the node runs on past its first line. */
  readonly end: number;
}

/**
 * `overrideNamesByLine` with each name's source SPAN kept, so a raw-text fragment can be tied to the very
 * literal or chain that spells the longer name, rather than to any longer name on the same line.
 *
 * @param content the file's text
 * @param path the repo-relative path, which picks the TS or TSX parser
 * @returns line number to the shaped names starting there, each with its span; a line with none is absent
 */
export function overrideNameSpansByLine({
  content,
  path,
}: {
  content: string;
  path: string;
}): ReadonlyMap<number, readonly ShapedName[]> {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): ReadonlyMap<number, readonly ShapedName[]> => {
      const byLine = new Map<number, ShapedName[]>();
      const bound = localNames({ sf });
      // Filled as the walk passes each declaration, which it always does before that declaration's own names.
      const foreign = new Set<ts.Node>();
      const record = ({ found }: { found: { at: ts.Node; name: string } }): void => {
        if (!isOverrideVariableName({ name: found.name })) {
          return;
        }
        const from = sf.getLineAndCharacterOfPosition(found.at.getStart(sf));
        const to = sf.getLineAndCharacterOfPosition(found.at.getEnd());
        let end = Number.POSITIVE_INFINITY;
        if (to.line === from.line) {
          end = to.character;
        }
        const span: ShapedName = { end, name: found.name, start: from.character };
        const spans = byLine.get(from.line + 1);
        if (spans === undefined) {
          byLine.set(from.line + 1, [span]);
        } else if (!spans.some((seen) => seen.name === span.name && seen.start === span.start)) {
          spans.push(span);
        }
      };
      const visit: NodeVisitor = (node) => {
        for (const name of foreignExportNames({ node })) {
          foreign.add(name);
        }
        // A foreign name is skipped whichever reader would report it — a bare identifier, or a quoted module
        // export name (`import { "A_ALLOW_B" as b }`), which the string-literal reader would otherwise take.
        if (foreign.has(node)) {
          forEachChild({ node, visit });
          return;
        }
        const isUnbound = ts.isIdentifier(node) && !bound.has(node.text);
        const unbound = isUnbound ? [{ at: node, name: node.text }] : [];
        for (const found of [...overrideNamesOf({ node }), ...unbound]) {
          record({ found });
        }
        // Every sub-chain and every literal inside a folded chain is read too, failing CLOSED: a refusal gate
        // that misses `("ACME_A" + "LLOW_X") + "-y"` is worse than one that also names the ACME_ALLOW inside
        // `("ACME_" + "ALLOW") + "_X"`, which a reader dismisses in one glance.
        forEachChild({ node, visit });
      };
      visit(sf);
      return byLine;
    },
  });
}
