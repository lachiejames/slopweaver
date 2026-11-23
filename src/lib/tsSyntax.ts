/**
 * The one door to TypeScript's SYNTAX library: every parse, every tree walk and every node guard in this repository
 * reaches the `typescript` package through this file, `./tsProject.ts`, `./tsLazy.ts` or (named-object-params alone)
 * `./tsCompiler.ts`, and nowhere else — the `typescript-import-seam` gate refuses any other import of it.
 *
 * TypeScript 7.1 ships its library in two halves: a TS-shaped AST with every node guard and enum
 * (`typescript/ast`, re-exported here as `ts`), and a Go server spoken to over a pipe that does the parsing
 * (`typescript/sync`). What this file adds on top is exactly what a caller would otherwise rebuild:
 *
 * - `withSourceFile` — a parse is a LEASE on the server that must be released, or the Node heap and the server both
 *   grow with every parse. So a tree is lent to a callback and released when it returns.
 * - `forEachChild` — the free-function spelling of the node's own `forEachChild` method.
 * - `hasModifier`, `isConstDeclaration`, `isAssignmentOperator` — the questions a walker asks of modifiers, a
 *   declaration list's flags and an operator token, in one place.
 * - `bindingElementsOf` — an array-binding hole is a nameless `BindingElement`; this answers the ones that bind.
 * - `moduleSpecifiers`/`moduleSpecifiersOf` — there is no import pre-scan. `moduleSpecifiersOf` reads the tree;
 *   `moduleSpecifiers` gives the tree's answer off a TypeScript-free lexer (`./moduleSpecifierText.ts`), parsing
 *   only a file the lexer cannot settle, because a whole-tree caller cannot afford a parse per file.
 * - `isFunctionLikeDeclaration` — every signature-bearing node, signatures and function types included, which is
 *   wider than the AST's own guard of that name (implementations only).
 *
 * The server is started on the first parse, never at import, and its close is registered with `./tsLifecycle.ts`
 * at that moment, so the CLI, every gate and every test file close it on the normal path. A forced death needs
 * nothing: the server exits on its stdin's EOF when this process dies.
 */
import * as ts from "typescript/ast";
import { API } from "typescript/sync";

import { readModuleSpecifiers } from "./moduleSpecifierText.js";
import { lazyTypeScriptClient } from "./tsLifecycle.js";

export { ts };

/**
 * What {@link forEachChild} calls on each child: a truthy return stops the walk and becomes its result. Declare a
 * visitor AS this type (`const visit: NodeVisitor = (node) => …`) so its parameter list is inherited from the seam,
 * the shape `named-object-params` exempts, rather than restated as `(node: ts.Node)`.
 */
export type NodeVisitor<T = void> = (child: ts.Node) => T | undefined;

/** A declaration node that may carry a `name` of its own, a declaration's name kinds only. */
export type NamedDeclarationNode = ts.Declaration & { readonly name?: ts.DeclarationName };

/**
 * Whether an answer of type `R` reaches a `Lease`, a promise or a function: `R` itself, an element of an array or
 * tuple, a key or value of a Map or Set, a property of an object, or a neverthrow `Ok`'s value or `Err`'s error, five
 * levels deep. A FUNCTION counts as reaching the lease because a type cannot see what a closure captured: a returned
 * `() => node.getText()` would read the tree after release. A `Result` is unwrapped to its payload first, so its own
 * methods are not mistaken for a captured closure; it is matched by shape, not imported, because `site/` compiles this
 * file and has no `neverthrow`.
 */
type ReachesLease<R, Lease, Depth extends readonly unknown[]> = [R] extends [never]
  ? false
  : R extends Lease | PromiseLike<unknown>
    ? true
    : Depth["length"] extends 5
      ? false
      : R extends { readonly value: infer T; isOk: () => boolean }
        ? ReachesLease<T, Lease, [...Depth, R]>
        : R extends { readonly error: infer E; isErr: () => boolean }
          ? ReachesLease<E, Lease, [...Depth, R]>
          : R extends (...args: never[]) => unknown
            ? true
            : R extends ReadonlyMap<infer K, infer V>
              ? ReachesLease<K | V, Lease, [...Depth, R]>
              : R extends ReadonlySet<infer E>
                ? ReachesLease<E, Lease, [...Depth, R]>
                : R extends readonly (infer E)[]
                  ? ReachesLease<E, Lease, [...Depth, R]>
                  : R extends object
                    ? true extends { [K in keyof R]-?: ReachesLease<R[K], Lease, [...Depth, R]> }[keyof R]
                      ? true
                      : false
                    : false;

/**
 * What a lending callback may answer — {@link withSourceFile}'s, `withTsModuleResolver`'s — and `never`, so the
 * callback fails to compile, when the answer reaches a `Lease`, a promise or a function. The lease is released when
 * the callback RETURNS, so a node handed back, read later by an async callback, or captured by a returned closure
 * would be read after release.
 *
 * A tripwire against the ordinary mistake, not a fence against a deliberate one: it reads the answer's STATIC type,
 * so an answer widened past what it holds (`(source): object => source`, `source as unknown`) passes, a node nested
 * deeper than five levels passes, and a node a `use` STORES outside itself (`holder.source = source`) is invisible to
 * it, since a type sees what a callback returns and never what it writes.
 */
export type LentAnswer<R, Lease = ts.Node> = true extends ReachesLease<R, Lease, []> ? never : R;

/** The parsing client, started on first use; a parse after `closeTypeScript()` starts a fresh one. */
const syntaxClient = lazyTypeScriptClient({ open: () => new API({ cwd: process.cwd() }) });

/**
 * Parse one file's text into a syntax tree with every `parent` set, hand it to `use`, and answer what `use` answers.
 * The script kind is inferred from the file name when absent, as the compiler does.
 *
 * SCOPED, because a parse is a LEASE on the server that must be released: MEASURED on `7.1.0-beta`, one
 * 21 KB file parsed 2,000 times with its leases kept grew the Node heap 8 → 312 MiB and the server 3 → 698 MiB;
 * released each time, both stayed flat (9 MiB, 27 MiB). Repro: `node --expose-gc leaseGrowth.mjs <repo> <ts71 dir>
 * keep|dispose 2000` (the slice-2 plan's scratch script). So answer plain data (strings, numbers, positions, records
 * of them) from `use`, never a node.
 *
 * @param fileName the name diagnostics and the kind inference read; it need not exist on disk
 * @param text the file's contents
 * @param scriptKind forces TS, TSX, JS or JSX regardless of the file name
 * @param use reads the tree and answers plain data; it must not keep or return a node
 * @returns what `use` returned
 */
export function withSourceFile<R>({
  fileName,
  text,
  scriptKind,
  use,
}: {
  fileName: string;
  text: string;
  scriptKind?: ts.ScriptKind;
  use: (sourceFile: ts.SourceFile) => LentAnswer<R>;
}): LentAnswer<R> {
  const retained = syntaxClient().createSourceFile(fileName, text, scriptKind === undefined ? {} : { scriptKind });
  try {
    return use(retained.sourceFile);
  } finally {
    retained.dispose();
  }
}

/**
 * Visit each direct child of a node, stopping at (and returning) the first truthy value `visit` returns — comments
 * and JSDoc not visited.
 *
 * @param node the parent whose children are visited
 * @param visit called once per child, in source order
 * @returns the first truthy value `visit` returned, or `undefined` when none did
 */
export function forEachChild<T>({ node, visit }: { node: ts.Node; visit: NodeVisitor<T> }): T | undefined {
  return node.forEachChild(visit);
}

/**
 * Whether a node carries one modifier keyword (`export`, `default`, `async`, `static`, …). A decorator is never one
 * of those kinds, so it never matches.
 *
 * @param node any node; one that cannot carry modifiers has none
 * @param kind the modifier keyword's syntax kind
 * @returns true when that keyword is among the node's modifiers
 */
export function hasModifier({ node, kind }: { node: ts.Node; kind: ts.ModifierSyntaxKind }): boolean {
  const modifiers = carriesModifiers(node) ? node.modifiers : undefined;
  return modifiers?.some((modifier) => modifier.kind === kind) === true;
}

/** Whether a node is of a kind that can carry modifiers — the kinds whose shape declares a `modifiers` list. */
function carriesModifiers(node: ts.Node): node is ts.ModifiersBase {
  return "modifiers" in node;
}

/**
 * Whether a token kind is an assignment operator — `=` or a compound form such as `+=`, `??=` or `>>>=` — so a
 * binary expression carrying it writes its left side.
 *
 * @param kind a binary expression's operator token kind
 * @returns true for the sixteen assignment operators, false for every other operator
 */
export function isAssignmentOperator({ kind }: { kind: ts.SyntaxKind }): boolean {
  return ts.isAssignmentOperator(kind);
}

/**
 * Whether a variable declaration's list carries the `Const` flag — read off the list, which is where the keyword
 * lives. `await using` shares that bit.
 *
 * @param declaration one binding of a `const`/`let`/`var`/`using` list
 * @returns true when the list it belongs to is `const` or `await using`
 */
export function isConstDeclaration({ declaration }: { declaration: ts.VariableDeclaration }): boolean {
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

/** A binding element that binds something: every one but an array pattern's hole. */
export type NamedBindingElement = ts.BindingElement & { readonly name: ts.BindingName };

/**
 * Whether a binding element binds something, rather than being an array pattern's hole.
 *
 * @returns true when the element carries a name
 */
function isNamedBindingElement(element: ts.BindingElement): element is NamedBindingElement {
  return element.name !== undefined;
}

/**
 * The elements of a binding pattern that bind something — every element of `{ a, b }`, and of `[, a]` all but the
 * hole, which is a `BindingElement` with no name.
 *
 * @param pattern an object or array binding pattern
 * @returns the binding elements, in source order, holes left out
 */
export function bindingElementsOf({ pattern }: { pattern: ts.BindingPattern }): readonly NamedBindingElement[] {
  return pattern.elements.filter(isNamedBindingElement);
}

/**
 * The literal text of a module specifier written as a string or a substitution-free template (`import(`./a.js`)`),
 * or `undefined` for anything else.
 */
function literalSpecifier({ node }: { node: ts.Node | undefined }): string | undefined {
  return node !== undefined && ts.isStringLiteralLikeNode(node) ? node.text : undefined;
}

/** The specifier a declaration names — an import, an `export … from`, or `import x = require(…)`. */
function declarationSpecifier({ node }: { node: ts.Node }): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return literalSpecifier({ node: node.moduleSpecifier });
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return literalSpecifier({ node: node.moduleReference.expression });
  }
  return undefined;
}

/**
 * The string literal a load's argument STARTS with: the argument itself, or the literal leading an expression built
 * on it (`"./a.js" as string`, `"./a.js" + suffix`), so a string token right after `import(` or `require(` is the
 * specifier whatever follows it. A parenthesis before the literal breaks the match.
 */
function leadingLiteral({ node }: { node: ts.Node | undefined }): string | undefined {
  let leftmost = node;
  while (leftmost !== undefined && !ts.isStringLiteralLikeNode(leftmost)) {
    const parent: ts.Node = leftmost;
    const first: ts.Node | undefined = parent.forEachChild((child) => child);
    leftmost = first !== undefined && first.pos === parent.pos ? first : undefined;
  }
  return literalSpecifier({ node: leftmost });
}

/** The specifier a load names — `import(…)` or `require(…)` as a call, or `import(…)` as a type. */
function loadSpecifier({ node }: { node: ts.Node }): string | undefined {
  // `module.require("x")` and `new require("x")` too: a `require(` after any token reads as a load.
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
    const isRequire = ts.isIdentifier(callee) && callee.text === "require";
    return isImport || isRequire ? leadingLiteral({ node: node.arguments?.[0] }) : undefined;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return literalSpecifier({ node: node.argument.literal });
  }
  return undefined;
}

/**
 * The module a `declare module "x" { … }` names, or `undefined` for any other node. Inside a module (a file with an
 * import or export) that augments `x`; in a script it declares an ambient module, which is not an import.
 */
function declaredModuleName({ node }: { node: ts.Node }): string | undefined {
  const declared =
    ts.isModuleDeclaration(node) &&
    ts.isStringLiteral(node.name) &&
    hasModifier({ kind: ts.SyntaxKind.DeclareKeyword, node });
  return declared ? node.name.text : undefined;
}

/**
 * Every module specifier a parsed file imports: every static import and `export … from` form (type-only, namespace,
 * `export * as ns` and `import defer` included), `import x = require(…)`, `import(…)` as a call or a type,
 * `require(…)` (as a method or a constructor too, `module.require(…)`, `new require(…)`), and the module a
 * `declare module "x"` augments inside a module (never an ambient declaration in a script), each with a
 * string-literal specifier, in source order with augmentations after every other edge, duplicates kept. A
 * triple-slash reference is not an import and is not read. Only a load in running code is read; an AMD
 * `define([…], …)` dependency array is not: this repository is ESM throughout, and MEASURED no tracked
 * code file calls `define` with an array. Repro: `git grep -nE '\bdefine\(\s*("[^"]*"\s*,\s*)?\['`.
 *
 * @param sourceFile a tree inside a {@link withSourceFile} callback
 * @returns each specifier as written
 */
export function moduleSpecifiersOf({ sourceFile }: { sourceFile: ts.SourceFile }): readonly string[] {
  const found: string[] = [];
  const augmented: string[] = [];
  const external = ts.isExternalModule(sourceFile);
  // An explicit stack, not recursion: a deep tree TypeScript parses (`a+a+…` 3,000 terms) overflowed a recursive walk.
  const pending: ts.Node[] = [sourceFile];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const specifier = declarationSpecifier({ node });
    const augments = external ? declaredModuleName({ node }) : undefined;
    if (augments !== undefined) {
      augmented.push(augments);
    } else if (specifier !== undefined) {
      found.push(specifier);
    } else {
      const loaded = loadSpecifier({ node });
      if (loaded !== undefined) {
        found.push(loaded);
      }
    }
    const children: ts.Node[] = [];
    node.forEachChild((child) => {
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]!);
    }
  }
  return [...found, ...augmented];
}

/**
 * Every package a file's `/// <reference types="x" />` directives name: a type dependency in any file, which
 * {@link moduleSpecifiersOf} does not read because it is not an import.
 *
 * @param sourceFile a tree inside a {@link withSourceFile} callback
 * @returns each name as written, in source order
 */
export function typeReferenceSpecifiersOf({ sourceFile }: { sourceFile: ts.SourceFile }): readonly string[] {
  return sourceFile.typeReferenceDirectives.map((directive) => directive.fileName);
}

/**
 * Every module a file names inside its JSDoc: an `import("x")` type and an `@import … from "x"` tag, each with a
 * string-literal specifier. In a JavaScript file both are real type dependencies; a `.ts` file's compiler ignores
 * them. Builds every node's child list, so it is for the handful of JavaScript files, never a whole-tree pass.
 * Duplicates are kept, in no promised order.
 *
 * @param sourceFile a tree inside a {@link withSourceFile} callback
 * @returns each specifier as written
 */
export function jsDocImportSpecifiersOf({ sourceFile }: { sourceFile: ts.SourceFile }): readonly string[] {
  const found: string[] = [];
  const inComment = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push(node.argument.literal.text);
    } else if (ts.isJSDocImportTag(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    }
    node.forEachChild(inComment);
  };
  // `getChildren` lists every JSDoc block a node carries, so an `@import` one block above a `@param` one is read too:
  // a function preceded by `/** @import … *\/\n/** @param … *\/` owns two blocks.
  const visit = (node: ts.Node): void => {
    for (const child of node.getChildren(sourceFile)) {
      if (ts.isJSDoc(child)) {
        inComment(child);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Every module specifier a file's text imports, for a caller that has no tree of its own and may be reading the whole
 * repository (the app-surface index, `untested-modules`, the test-only and PR-lead test helpers). The answer is
 * {@link moduleSpecifiersOf}'s, the tree's, on every input; the cost is a lexer's. `./moduleSpecifierText.ts` reads
 * the specifiers off a token stream with no TypeScript loaded, and where tokens cannot settle what the tree reads (a
 * file that may hold JSX, a `declare module "x"`, a `require` that may be a declaration) it says so and this parses
 * that one file instead. MEASURED over all 16,999 tracked code files: 94,125 specifiers, zero files where
 * this differs from the tree, 292 of them parsed (291 for JSX). Repro: over every `git ls-files` code file read once
 * into memory, compare and time this function against `moduleSpecifiersOf` over a `withSourceFile`.
 *
 * Against TypeScript 6's import pre-scan, a token scan, it gains `export * as ns from`, `import defer`, a `require?.(…)`
 * and an escaped `require`, and a load in a template nested in a substitution; it loses a load spelled where none
 * runs (in a regular expression, in JSX text, a method or function declaration spelled `require("…")`) and an AMD
 * `define([…])` dependency; and `declare module "x"` augments `x` only in a file TypeScript calls a module. The
 * `DIVERGENT` table in `src/__tests__/unit/lib/tsSyntax/moduleSpecifiers.test.ts` holds one input per difference.
 *
 * @param fileName decides whether the file parses JSX (`.tsx`, `.jsx`, `.js`, `.mjs`, `.cjs`), as TypeScript does
 * @param text the file's contents
 * @returns each specifier as written, in source order with augmentations last, duplicates kept
 */
export function moduleSpecifiers({ fileName, text }: { fileName: string; text: string }): readonly string[] {
  const reading = readModuleSpecifiers({ fileName, text });
  if (reading.kind === "read") {
    return reading.specifiers;
  }
  return withSourceFile({ fileName, text, use: (sourceFile) => moduleSpecifiersOf({ sourceFile }) });
}

/**
 * Whether a node is a `case` or `default` clause of a `switch`.
 *
 * @returns true for either clause
 */
export function isCaseOrDefaultClause(node: ts.Node): node is ts.CaseOrDefaultClause {
  return ts.isCaseClause(node) || ts.isDefaultClause(node);
}

/**
 * Whether a node is a member of a class body: a property, method, accessor, constructor, index signature, static
 * block or a stray `;`.
 *
 * @returns true for every class member kind
 */
export function isClassElement(node: ts.Node): node is ts.ClassElement {
  return (
    ts.isPropertyDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isIndexSignatureDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node) ||
    ts.isSemicolonClassElement(node)
  );
}

/**
 * Whether a node is a member of an interface or type literal: a property, method, call, construct or index
 * signature, or an accessor.
 *
 * @returns true for every type member kind
 */
export function isTypeElement(node: ts.Node): node is ts.TypeElement {
  return (
    ts.isPropertySignatureDeclaration(node) ||
    ts.isMethodSignatureDeclaration(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node) ||
    ts.isIndexSignatureDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/**
 * The `name` a node carries as its own field — a declaration's, a member's, a property access's — read without
 * narrowing the node to one kind first. An array-pattern hole carries none.
 *
 * @returns its name node, or undefined when it has no `name` field or the field is unset
 */
export function nameOf({ node }: { node: ts.Node }): ts.Node | undefined {
  return carriesName(node) ? node.name : undefined;
}

/**
 * A field TypeScript 7.1's declarations type as always set, read as what the server really answers: `undefined` when
 * the source wrote nothing there — a property signature with no type annotation, `interface X { ok }`, has a `type`
 * the declaration calls a `TypeNode`. The value passes through unchanged; only its type widens, so a caller's absence
 * check is a check the type-aware linter can see is needed rather than one it calls always false.
 *
 * @param value the field as read off a node or a server answer
 * @returns the same value, typed as possibly absent
 */
export function possiblyAbsent<T>({ value }: { value: T }): T | undefined {
  return value;
}

/**
 * Whether a node has a `name` field, set or not.
 *
 * @returns true when the field exists on the node
 */
function carriesName(node: ts.Node): node is ts.Node & { readonly name?: ts.Node } {
  return "name" in node;
}

/**
 * Whether a node is a class declaration or class expression.
 *
 * @returns true for either form
 */
export function isClassLikeDeclaration(node: ts.Node): node is ts.ClassLikeDeclaration {
  return ts.isClassLikeDeclaration(node);
}

/**
 * Whether a node is any signature-bearing declaration — a function, method, accessor, constructor, arrow, a call,
 * construct, method or index signature, or a function or constructor type. Wider than the AST's own
 * `isFunctionLikeDeclaration`, which answers implementations only.
 *
 * @returns true for every signature-bearing declaration
 */
export function isFunctionLikeDeclaration(node: ts.Node): node is ts.SignatureDeclaration {
  return (
    ts.isFunctionLikeDeclaration(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node) ||
    ts.isMethodSignatureDeclaration(node) ||
    ts.isIndexSignatureDeclaration(node) ||
    ts.isFunctionTypeNode(node) ||
    ts.isConstructorTypeNode(node)
  );
}

/**
 * Whether a node is a method signature in an interface or type literal.
 *
 * @returns true for a method signature
 */
export function isMethodSignatureDeclaration(node: ts.Node): node is ts.MethodSignatureDeclaration {
  return ts.isMethodSignatureDeclaration(node);
}

/**
 * Whether a node is a parameter declaration.
 *
 * @returns true for a parameter
 */
export function isParameterDeclaration(node: ts.Node): node is ts.ParameterDeclaration {
  return ts.isParameterDeclaration(node);
}

/**
 * Whether a node is a property signature in an interface or type literal.
 *
 * @returns true for a property signature
 */
export function isPropertySignatureDeclaration(node: ts.Node): node is ts.PropertySignatureDeclaration {
  return ts.isPropertySignatureDeclaration(node);
}

/**
 * Whether a node is a string literal or a template literal with no substitution.
 *
 * @returns true for either literal
 */
export function isStringLiteralLikeNode(node: ts.Node): node is ts.StringLiteralLikeNode {
  return ts.isStringLiteralLikeNode(node);
}

/**
 * Whether a node is an angle-bracket type assertion, `<T>value`.
 *
 * @returns true for an angle-bracket assertion
 */
export function isTypeAssertion(node: ts.Node): node is ts.TypeAssertion {
  return ts.isTypeAssertion(node);
}
