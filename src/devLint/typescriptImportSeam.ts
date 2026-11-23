/**
 * The gate that keeps the TypeScript library behind its four seam files.
 *
 * ## The criterion
 *
 * A tracked code file (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, anywhere in the repository)
 * fails when it names the `typescript` package — `typescript` or any `typescript/…` subpath — as a module specifier
 * (an import or `export … from` of any form, `import x = require(…)`, `import(…)` as a call or a type, `require(…)`),
 * in a `/// <reference types="…" />` directive, in a JavaScript file's JSDoc (`@type {import("typescript").Node}`,
 * `@import { Node } from "typescript"`, both real type dependencies there), or as the first argument of any FUNCTION
 * call or `new`, which is what catches a `createRequire` loader under another name. The four seam files are exempt:
 *
 * - `src/lib/tsSyntax.ts` — parsing, walking and node guards;
 * - `src/lib/tsLazy.ts` — the one syntax question a board read asks, with the compiler loaded on first use;
 * - `src/lib/tsProject.ts` — config files and module resolution;
 * - `src/lib/tsCompiler.ts` — the checker-backed compiler surface, which only named-object-params may import.
 *
 * A file outside named-object-params that imports `tsCompiler` fails too, so the compiler surface — the part of
 * TypeScript whose API moves most between major versions — stays as small as the one gate that needs a checker.
 *
 * So does a file outside the seam and those consumers that calls `createSourceFile` — `ts.createSourceFile(…)` through
 * the `ts` the seam re-exports, bare or wrapped. A tree is built only by `withSourceFile`, which lends it to a callback
 * and releases it after, because on TypeScript 7 a tree is a lease on the Go server that nothing else would release.
 * The builder held under another name (`const make = ts.createSourceFile; make(…)`) is not read, for the reason a
 * renamed enum is not: following a value through a binding is a checker's job.
 *
 * So does a file outside the seam that reads a `SyntaxKind` range marker (`SyntaxKind.FirstAssignment`,
 * `ts.SyntaxKind["LastToken"]`, any `First…`/`Last…` member of something named `SyntaxKind`), by member access or by
 * destructuring (`const { FirstAssignment } = ts.SyntaxKind`, `const { SyntaxKind: { LastToken } } = ts`). A numeric
 * range test is a TS6 numbering assumption that TypeScript 7 does not keep, and nothing about the walker reading it
 * would fail: the seam's named predicates (`isAssignmentOperator`) answer the question instead. The enum held under
 * another name first (`const K = ts.SyntaxKind; K.FirstAssignment`) and an assignment pattern
 * (`({ FirstAssignment } = ts.SyntaxKind)`) are not read: following a value through a binding is a checker's job.
 *
 * ## Why a gate
 *
 * TypeScript 7 ships its library as a Go server behind `typescript/sync` and a TS-shaped AST behind
 * `typescript/ast`, and renames or drops a handful of TS6 names. With every use behind the seam, moving the library
 * is a change to four files rather than to ninety; one new direct import quietly makes it ninety-one. A string,
 * comment or template that merely mentions the package is not an import, so the files are PARSED, never grepped.
 *
 * ## Blind spot, named
 *
 * A specifier assembled at run time (`import(name)`, `require(prefix + "script")`) or spread into the call
 * (`require(...["typescript"])`) is not the call's own first argument, so it is invisible here — as it is to `knip` and
 * to the bundler. So is a loader invoked INDIRECTLY (`require.call(null, "typescript")`, `module.require.apply(…)`,
 * `require.bind(null)("typescript")`, `Reflect.apply(require, …)`), where the specifier is not the loader's first
 * argument either. So is a JSDoc type in a TypeScript file, which its compiler ignores and this gate does not read,
 * and an AMD `define(["typescript"], …)` dependency, which nothing in this ESM repository loads. The gate is a tripwire against an ordinary
 * import, not a fence against a deliberate evasion. A literal under a wrapper that compiles to nothing
 * (`load("typescript" as string)`, `load(<string>"typescript")`) is read. A loader reached as a method
 * (`loader.load("typescript")`, `loader["load"]("typescript")`) is not, because a method call's first argument is
 * a value far more often than a module; only a member named `require` with a static name, `module.require(…)` or
 * `module["require"](…)`, is read, however wrapped. A computed member (`module[name](…)`) names nothing. Nor is a form TypeScript itself
 * refuses to compile, such as `import(("typescript"))` in a TYPE position (TS1141): the typecheck rejects that file
 * before this gate's verdict could matter.
 *
 * ## False positive, named
 *
 * The other side of catching a loader under any name: a plain function call whose first argument is the literal
 * `"typescript"` (`label("typescript")`) is refused although it loads nothing. Rename the value or pass it through a
 * constant; a caught renamed loader is worth more than that one-line edit. Likewise a `First…`/`Last…` member of
 * any value NAMED `SyntaxKind` is read as TypeScript's enum, since nothing else in this repository carries that name.
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import {
  bindingElementsOf,
  forEachChild,
  isParameterDeclaration,
  isStringLiteralLikeNode,
  isTypeAssertion,
  jsDocImportSpecifiersOf,
  moduleSpecifiersOf,
  type NodeVisitor,
  ts,
  typeReferenceSpecifiersOf,
  withSourceFile,
} from "../lib/tsSyntax.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/** Every extension a module of this repository is written in. */
const CODE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The JavaScript extensions, whose JSDoc types the compiler reads as real dependencies. */
const JS_EXTENSIONS: readonly string[] = [".js", ".jsx", ".mjs", ".cjs"];

/** The seam files, the only ones that may name the `typescript` package. */
export const TYPESCRIPT_SEAM_FILES: ReadonlySet<string> = new Set([
  "src/lib/tsCompiler.ts",
  "src/lib/tsLazy.ts",
  "src/lib/tsProject.ts",
  "src/lib/tsSyntax.ts",
]);

/** The files that may import `src/lib/tsCompiler.ts`: named-object-params and its checker-backed tests. */
export const TS_COMPILER_CONSUMERS: ReadonlySet<string> = new Set([
  "src/__tests__/namedObjectParamsFixture.ts",
  "src/__tests__/unit/devLint/namedObjectParams/heap.test.ts",
  "src/__tests__/unit/devLint/namedObjectParamsCallbacks.test.ts",
  "src/__tests__/unit/devLint/namedObjectParamsJsDoc.test.ts",
  "src/devLint/namedObjectParams.ts",
  "src/devLint/namedObjectParamsCallbacks.ts",
  "src/devLint/namedObjectParamsDecide.ts",
  "src/devLint/namedObjectParamsHeap.ts",
  "src/devLint/namedObjectParamsOracle.ts",
  "src/devLint/namedObjectParamsProgram.ts",
  "src/devLint/namedObjectParamsRun.ts",
  "src/devLint/namedObjectParamsVerdict.ts",
]);

/**
 * One file reaching past the seam.
 *
 * @internal — {@link scanTypescriptImportSeam}'s own return shape; {@link runTypescriptImportSeam} prints it.
 */
export interface TypescriptImportSeamHit {
  readonly path: string;
  readonly specifier: string;
  readonly reason: "typescript-package" | "ts-compiler" | "syntax-kind-range" | "unleased-parse";
}

/** A range marker's member name: TS6's `FirstAssignment`, `LastToken` and their kin. */
const RANGE_MARKER = /^(?:First|Last)[A-Z]/u;

/**
 * Every `SyntaxKind` range marker the file reads — `SyntaxKind.FirstAssignment`, `ts.SyntaxKind["LastToken"]` — spelled
 * as written. TypeScript 7 numbers `SyntaxKind` differently and drops some markers, so a numeric range test outside
 * the seam is a TS6 assumption the flip would silently break; the seam's named predicates (`isAssignmentOperator`)
 * carry the question instead.
 */
function syntaxKindRanges({ sourceFile }: { sourceFile: ts.SourceFile }): readonly string[] {
  const found: string[] = [];
  const visit: NodeVisitor = (node) => {
    const isAccess = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
    const member = isAccess ? memberName({ callee: node }) : undefined;
    if (isAccess && member !== undefined && RANGE_MARKER.test(member) && namesSyntaxKind({ node: node.expression })) {
      found.push(`SyntaxKind.${member}`);
    }
    const qualified = qualifiedRange({ node });
    if (qualified !== undefined) {
      found.push(`SyntaxKind.${qualified}`);
    }
    const pattern = syntaxKindPattern({ node });
    if (pattern !== undefined) {
      for (const element of bindingElementsOf({ pattern })) {
        const key = bindingKey({ element });
        if (key !== undefined && RANGE_MARKER.test(key)) {
          found.push(`SyntaxKind.${key}`);
        }
      }
    }
    forEachChild({ node, visit });
  };
  visit(sourceFile);
  return found;
}

/**
 * The range marker a TYPE-position name reads off `SyntaxKind` — `SyntaxKind.FirstAssignment`,
 * `ts.SyntaxKind.LastToken`, `typeof ts.SyntaxKind.FirstNode` or `import("typescript").SyntaxKind.FirstKeyword` — which
 * the parser spells as a qualified name rather than a property access.
 */
function qualifiedRange({ node }: { node: ts.Node }): string | undefined {
  if (!ts.isQualifiedName(node) || !RANGE_MARKER.test(node.right.text)) {
    return undefined;
  }
  const owner = ts.isIdentifier(node.left) ? node.left.text : node.left.right.text;
  return owner === "SyntaxKind" ? node.right.text : undefined;
}

/** Whether an expression is something named `SyntaxKind`: the bare identifier, or a member access by that name. */
function namesSyntaxKind({ node }: { node: ts.Expression }): boolean {
  const owner = unwrapped({ node });
  const ownerName = ts.isIdentifier(owner) ? owner.text : memberName({ callee: owner });
  return ownerName === "SyntaxKind";
}

/**
 * The static key a destructuring element reads — `a` in `{ a }`, `{ a: b }`, `{ "a": b }`, `{ ["a"]: b }` or
 * `{ [("a" as const)]: b }` — or none when computed from anything but a string literal, or for a rest element (`{ ...a }`), whose name is a local binding
 * and reads no member by that name.
 */
function bindingKey({ element }: { element: ts.BindingElement }): string | undefined {
  if (element.dotDotDotToken !== undefined) {
    return undefined;
  }
  const key = element.propertyName;
  if (key === undefined) {
    return element.name !== undefined && ts.isIdentifier(element.name) ? element.name.text : undefined;
  }
  if (ts.isComputedPropertyName(key)) {
    const computed = unwrapped({ node: key.expression });
    return isStringLiteralLikeNode(computed) ? computed.text : undefined;
  }
  return ts.isIdentifier(key) || isStringLiteralLikeNode(key) ? key.text : undefined;
}

/**
 * The object pattern a node destructures `SyntaxKind` with, if it is one — a declaration or parameter defaulted from it
 * (`const { FirstAssignment } = ts.SyntaxKind`), or an element nested under a `SyntaxKind` key
 * (`const { SyntaxKind: { LastToken } } = ts`). Read off the HOLDER, from the declaration down, so the walk that
 * reaches it is the whole answer.
 */
function syntaxKindPattern({ node }: { node: ts.Node }): ts.ObjectBindingPattern | undefined {
  if (ts.isBindingElement(node)) {
    const nested =
      node.name !== undefined && ts.isObjectBindingPattern(node.name) && bindingKey({ element: node }) === "SyntaxKind";
    return nested ? node.name : undefined;
  }
  if (!ts.isVariableDeclaration(node) && !isParameterDeclaration(node)) {
    return undefined;
  }
  const defaulted = node.initializer !== undefined && namesSyntaxKind({ node: node.initializer });
  return defaulted && ts.isObjectBindingPattern(node.name) ? node.name : undefined;
}

/**
 * Whether a specifier names the `typescript` package or one of its subpaths, in any case, because macOS resolves
 * `TypeScript` to the installed `typescript` as it does `tscompiler` to the seam.
 */
function namesTypescript({ specifier }: { specifier: string }): boolean {
  const lowered = specifier.toLowerCase();
  return lowered === "typescript" || lowered.startsWith("typescript/");
}

/** The compiler seam's repo-relative path with no extension, which every spelling of it resolves to. */
const TS_COMPILER_STEM = "src/lib/tsCompiler";

/** A module extension a specifier may carry or omit (`.js` for the `.ts` file). */
const SPECIFIER_EXTENSION = /\.(?:[cm]?[jt]s)$/u;

/**
 * Whether a specifier written in `path` loads the compiler seam: its `#lib` alias, or a relative path that RESOLVES to
 * it from `path`'s directory — `./tsCompiler.js` inside `src/lib` as much as `../lib/tsCompiler.js` from
 * `src/devLint` — with or without an extension. Resolved rather than matched by name, so a same-named file elsewhere
 * is not it.
 */
function namesTsCompiler({ path, specifier }: { path: string; specifier: string }): boolean {
  let target: string;
  if (specifier.startsWith("#lib/")) {
    target = `src/lib/${specifier.slice("#lib/".length)}`;
  } else if (specifier.startsWith(".")) {
    target = posix.join(posix.dirname(path), specifier);
  } else {
    return false;
  }
  // Case-insensitive, because macOS resolves `../lib/tscompiler.js` to the seam.
  return target.toLowerCase().replace(SPECIFIER_EXTENSION, "") === TS_COMPILER_STEM.toLowerCase();
}

/**
 * An expression with every wrapper that compiles to nothing removed — parentheses, `as`, `satisfies`, a non-null `!`
 * and a `<T>` assertion: `(("typescript" as string))` is the literal and `(text.includes)!` the property access, each
 * running exactly as it would bare.
 */
function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    isTypeAssertion(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

/**
 * The member a callee names when that name is static: `a.b` and `a["b"]` (or a substitution-free template) both name
 * `b`, unwrapped as the callee is. A computed key names nothing.
 */
function memberName({ callee }: { callee: ts.Expression }): string | undefined {
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  if (!ts.isElementAccessExpression(callee)) {
    return undefined;
  }
  const key = unwrapped({ node: callee.argumentExpression });
  return ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) ? key.text : undefined;
}

/**
 * The string literal every function call in the file passes first — a loader under any name included. A METHOD call
 * (`text.includes("typescript")`, `set.has(…)`) is left out: its callee is a property of a value, never a loader.
 */
function firstCallArguments({ sourceFile }: { sourceFile: ts.SourceFile }): readonly string[] {
  const found: string[] = [];
  const visit: NodeVisitor = (node) => {
    // `new load("typescript")` runs the loader too, so a construction is read as a call.
    const isCall = ts.isCallExpression(node) || ts.isNewExpression(node);
    const callee = isCall ? unwrapped({ node: node.expression }) : undefined;
    // A dotted `require` is a loader however it is wrapped: `(module.require)("typescript")` runs it as bare does,
    // and so is one reached by a static element access, `module["require"]("typescript")`.
    const isDottedRequire = callee !== undefined && memberName({ callee }) === "require";
    const isMethodCall =
      callee !== undefined &&
      !isDottedRequire &&
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee));
    const firstArgument = isCall ? node.arguments?.[0] : undefined;
    if (!isMethodCall && firstArgument !== undefined) {
      const first = unwrapped({ node: firstArgument });
      if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
        found.push(first.text);
      }
    }
    forEachChild({ node, visit });
  };
  visit(sourceFile);
  return found;
}

/** The compiler's own tree builder, which {@link unleasedParses} counts the calls to. */
const UNLEASED_PARSE = "createSourceFile";

/**
 * How many calls the file makes to `createSourceFile`, bare or as a member (`ts.createSourceFile(…)`), however its
 * callee is wrapped. The seam re-exports `ts`, so the compiler's builder is one dot away from every file — and a tree
 * built there is held by nothing: on TypeScript 7 it is a lease on the Go server that only `withSourceFile` releases.
 */
function unleasedParses({ sourceFile }: { sourceFile: ts.SourceFile }): number {
  let count = 0;
  const visit: NodeVisitor = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapped({ node: node.expression });
      const name = ts.isIdentifier(callee) ? callee.text : memberName({ callee });
      if (name === UNLEASED_PARSE) {
        count += 1;
      }
    }
    forEachChild({ node, visit });
  };
  visit(sourceFile);
  return count;
}

/**
 * Whether a repo-relative path is a code module this gate reads.
 *
 * @param path the repo-relative path
 * @returns true for a tracked file in one of the code extensions, `.d.ts` included
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return CODE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * Every place one file reaches past the seam.
 *
 * @param path the repo-relative path, which decides the seam exemptions and the parse kind
 * @param content the file's text
 * @returns one hit per offending specifier, in source order
 */
export function scanTypescriptImportSeam({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly TypescriptImportSeamHit[] {
  // Every file is parsed, with no text prefilter: a string literal can spell the package through an escape or a line
  // continuation the raw text never shows, so only the decoded literal is evidence. A TypeScript file's JSDoc is not
  // read, because its compiler ignores a JSDoc type; a JavaScript file's JSDoc types are real dependencies, so its
  // JSDoc is read too.
  const readsJsDoc = JS_EXTENSIONS.some((extension) => path.endsWith(extension));
  const isSeam = TYPESCRIPT_SEAM_FILES.has(path);
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sourceFile): readonly TypescriptImportSeamHit[] => {
      const specifiers = [
        ...new Set([
          ...moduleSpecifiersOf({ sourceFile }),
          ...firstCallArguments({ sourceFile }),
          ...typeReferenceSpecifiersOf({ sourceFile }),
          ...(readsJsDoc ? jsDocImportSpecifiersOf({ sourceFile }) : []),
        ]),
      ];
      const hits: TypescriptImportSeamHit[] = [];
      for (const specifier of specifiers) {
        if (namesTypescript({ specifier }) && !isSeam) {
          hits.push({ path, reason: "typescript-package", specifier });
        } else if (namesTsCompiler({ path, specifier }) && !TS_COMPILER_CONSUMERS.has(path)) {
          hits.push({ path, reason: "ts-compiler", specifier });
        }
      }
      if (!isSeam) {
        for (const specifier of new Set(syntaxKindRanges({ sourceFile }))) {
          hits.push({ path, reason: "syntax-kind-range", specifier });
        }
      }
      if (!isSeam && !TS_COMPILER_CONSUMERS.has(path) && unleasedParses({ sourceFile }) > 0) {
        hits.push({ path, reason: "unleased-parse", specifier: UNLEASED_PARSE });
      }
      return hits;
    },
  });
}

/** How each kind of reach reads in the printed list. */
const REASON_TEXT: Readonly<Record<TypescriptImportSeamHit["reason"], string>> = {
  "syntax-kind-range": "reads a SyntaxKind range marker (use a named predicate in src/lib/tsSyntax.ts)",
  "ts-compiler": "imports the compiler seam",
  "typescript-package": "names the TypeScript package",
  "unleased-parse": "builds a syntax tree no lease holds (parse through withSourceFile in src/lib/tsSyntax.ts)",
};

/**
 * IO edge: scan every tracked code module, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or the checkout could not be read)
 */
export function runTypescriptImportSeam(): number {
  let root: string;
  let paths: readonly string[];
  try {
    root = repoRoot();
    paths = workingTreeFilesOf({ root }).filter((path) => isScannablePath({ path }));
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ, so the gate has no subject to judge
    process.stderr.write("typescript-import-seam: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const { hits, unreadable, scanned } = scanTextFiles<TypescriptImportSeamHit>({
    paths,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanTypescriptImportSeam({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "typescript-import-seam",
    scanned,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(`typescript-import-seam: clean (${String(scanned)} code module(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    const what = REASON_TEXT[hit.reason];
    process.stderr.write(`  ${hit.path}  ${what}: "${hit.specifier}"\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "typescript-import-seam" }),
      detail: `${String(hits.length)} reach(es) past the TypeScript seam`,
    })}\n`,
  );
  return 1;
}
