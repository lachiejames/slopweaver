/**
 * The per-file half of the error-shape-threshold gate (`./errorShapeThreshold.ts` carries the criterion): every
 * expression supplied to a one-argument bare `err`/`errAsync`, read into plain data, plus the module-level facts a
 * whole-tree resolver needs to follow a bare name across files — top-level `const` bindings, imports and exports.
 *
 * It is split from the resolver (`./errorShapeThresholdResolve.ts`) because a name imported from another module
 * cannot be settled by reading one file, and `withSourceFile` lends a syntax tree only inside its callback: so
 * this half settles everything ONE file can settle — a literal, a template, a `+` chain, a conditional's arms, an
 * array's items (so `const problems = [USAGE]; err(problems)` is read), a `...spread` item as the expression it
 * spreads (so `[...(ok ? [] : ["text"])]` is read), a name bound by a `const` in an inner block
 * or a `for` header — and leaves a module-level name as a `name` fact for the resolver.
 *
 * What this half stops at, so the resolver never sees it: a name whose nearest binding is a parameter, a `let` or
 * `var`, a destructuring, a function, class or catch binding (`./tornTailAppendScope.ts`'s `declaringScopeOf`
 * decides which scope that is), a property read (`...parsed.error` included), and every expression with no literal
 * text of its own. A
 * name INSIDE a template hole or a `+` operand stays a hole. One expression is read by
 * `./errorShapeThresholdExpression.ts`; this half reads the FILE around it. A call is read only through a
 * value import of `err`/`errAsync` from the result module (`#lib/result.js`, a relative `…/lib/result.js`, or
 * `neverthrow`), renames included, and only where no inner scope rebinds that name: anything else called `err` is
 * not the `Result` constructor.
 *
 * Both arms of every conditional are charged, because a syntax-only reader cannot evaluate a condition: an arm a
 * CONSTANT condition makes dead (`true ? "a" : "b"`) is over-counted, and that is the stated residue of the
 * over-approximation. The repo's oxlint run refuses such a condition (`no-constant-condition`, `--deny-warnings`)
 * before it can reach this gate. A `namespace`-local `import err = Local.err` is not read as a rebinding either:
 * the compiler refuses it (`erasableSyntaxOnly`, TS1294) and so does oxlint (`typescript/no-namespace`).
 */

import { posix } from "node:path";
import { forEachChild, hasModifier, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import {
  expressionFactOf,
  isConstList,
  type ShapeExpressionFact,
  unwrapTypeOnly,
} from "./errorShapeThresholdExpression.js";
import { declaringScopeOf } from "./tornTailAppendScope.js";

export type { ShapeExpressionFact } from "./errorShapeThresholdExpression.js";

/** The two call names the criterion reads — the repo's `Result` constructors, re-exported from neverthrow. */
const ERR_CALL_NAMES: ReadonlySet<string> = new Set(["err", "errAsync"]);

/**
 * One expression supplied to an `err` call, and the line it was written on.
 *
 * @internal
 */
export interface ShapeUseFact {
  readonly line: number;
  readonly expression: ShapeExpressionFact;
}

/**
 * A top-level `const` bound to a plain identifier, and what its initializer reads as.
 *
 * @internal
 */
export interface ModuleConstFact {
  readonly name: string;
  readonly expression: ShapeExpressionFact;
}

/**
 * One value import: the local name, the name the target exports it as (`default` included), and from where.
 *
 * @internal
 */
export interface ImportBindingFact {
  readonly local: string;
  readonly imported: string;
  readonly specifier: string;
}

/**
 * One value export: a local binding under a public name, or a named re-export of another module's.
 *
 * @internal
 */
export type ExportBindingFact =
  | { readonly kind: "local"; readonly exported: string; readonly local: string }
  | { readonly kind: "reexport"; readonly exported: string; readonly imported: string; readonly specifier: string };

/** Everything one file contributes: its `err` uses and the module-level bindings a resolver follows names through. */
export interface ErrorShapeFileFacts {
  readonly path: string;
  readonly uses: readonly ShapeUseFact[];
  readonly consts: readonly ModuleConstFact[];
  readonly imports: readonly ImportBindingFact[];
  readonly exports: readonly ExportBindingFact[];
}

/** The local an expression `export default` is held under — a space keeps any written identifier from matching it. */
const ANONYMOUS_DEFAULT = "export default";

/** The repo-relative module the `Result` constructors are re-exported from. */
const RESULT_MODULE = "src/lib/result.js";

/**
 * Whether a specifier, read from `importer`, names the module the `Result` constructors come from: this repo's own
 * (by `#lib/…` or by a relative path that lands on it), or neverthrow's.
 */
function isResultModule({ importer, specifier }: { importer: string; specifier: string }): boolean {
  if (specifier === "neverthrow" || specifier === "#lib/result.js") {
    return true;
  }
  return specifier.startsWith(".") && posix.normalize(posix.join(posix.dirname(importer), specifier)) === RESULT_MODULE;
}

/**
 * The local names this file binds the `Result` constructors to — a value import of `err` or `errAsync` from the
 * result module, renamed or not. Anything else called `err` (a top-level `const err = …`, an unrelated import) is
 * not the constructor, so its argument is not an error shape.
 */
function errNamesOf({ path, imports }: { path: string; imports: readonly ImportBindingFact[] }): ReadonlySet<string> {
  return new Set(
    imports
      .filter((one) => ERR_CALL_NAMES.has(one.imported) && isResultModule({ importer: path, specifier: one.specifier }))
      .map((one) => one.local),
  );
}

/**
 * Whether a call is a `Result` constructor with exactly one argument — the only shape the criterion reads — through
 * the file's own import of it, so neither a local `const err = …` inside a function nor a top-level one is read.
 */
function isErrCall({ node, errNames }: { node: ts.CallExpression; errNames: ReadonlySet<string> }): boolean {
  const callee = node.expression;
  return (
    ts.isIdentifier(callee) &&
    errNames.has(callee.text) &&
    node.arguments.length === 1 &&
    ts.isSourceFile(declaringScopeOf({ identifier: callee }))
  );
}

/** Every expression the criterion reads out of an `err` call's one argument — each array element, or the argument. */
function suppliedNodesOf({ argument }: { argument: ts.Expression }): readonly ts.Expression[] {
  const bare = unwrapTypeOnly({ node: argument });
  if (ts.isArrayLiteralExpression(bare)) {
    return bare.elements;
  }
  return [bare];
}

/** Every `err` use in the file, in source order, dropping one that can never resolve to a shape. */
function usesOf({ sf, errNames }: { sf: ts.SourceFile; errNames: ReadonlySet<string> }): readonly ShapeUseFact[] {
  const uses: ShapeUseFact[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isCallExpression(node) && isErrCall({ errNames, node })) {
      for (const supplied of suppliedNodesOf({ argument: node.arguments[0]! })) {
        const expression = expressionFactOf({ node: supplied, seen: new Set() });
        if (expression.kind !== "unresolved") {
          uses.push({ expression, line: sf.getLineAndCharacterOfPosition(supplied.getStart(sf)).line + 1 });
        }
      }
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return uses;
}

/** The value bindings one `import` declaration makes — named (renamed included) and default; never a type or namespace. */
function importsOf({ statement }: { statement: ts.ImportDeclaration }): readonly ImportBindingFact[] {
  const clause = statement.importClause;
  const typeOnly = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
  if (clause === undefined || typeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return [];
  }
  const specifier = statement.moduleSpecifier.text;
  const defaults: readonly ImportBindingFact[] =
    clause.name === undefined ? [] : [{ imported: "default", local: clause.name.text, specifier }];
  return [...defaults, ...namedImportsOf({ bindings: clause.namedBindings, specifier })];
}

/** The value bindings of an import's `{ … }` list, renamed included; a namespace or a type-only element is none. */
function namedImportsOf({
  bindings,
  specifier,
}: {
  bindings: ts.NamedImportBindings | undefined;
  specifier: string;
}): readonly ImportBindingFact[] {
  if (bindings === undefined || !ts.isNamedImports(bindings)) {
    return [];
  }
  return bindings.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => ({
      imported: element.propertyName === undefined ? element.name.text : element.propertyName.text,
      local: element.name.text,
      specifier,
    }));
}

/** The value exports one `export { … }` / `export { … } from` declaration makes; `export *` is not followed. */
function exportsOf({ statement }: { statement: ts.ExportDeclaration }): readonly ExportBindingFact[] {
  const clause = statement.exportClause;
  if (statement.isTypeOnly || clause === undefined || !ts.isNamedExports(clause)) {
    return [];
  }
  const from =
    statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  const bindings: ExportBindingFact[] = [];
  for (const element of clause.elements) {
    if (element.isTypeOnly) {
      continue;
    }
    const inner = element.propertyName === undefined ? element.name.text : element.propertyName.text;
    if (from === undefined) {
      bindings.push({ exported: element.name.text, kind: "local", local: inner });
    } else {
      bindings.push({ exported: element.name.text, imported: inner, kind: "reexport", specifier: from });
    }
  }
  return bindings;
}

/** The module-level bindings one top-level statement contributes. */
interface ModuleFacts {
  readonly consts: readonly ModuleConstFact[];
  readonly imports: readonly ImportBindingFact[];
  readonly exports: readonly ExportBindingFact[];
}

const NO_MODULE_FACTS: ModuleFacts = { consts: [], exports: [], imports: [] };

/**
 * `export default <expr>`: an identifier is a local export; any other expression binds no name, so it is held
 * under one no identifier can spell and followed like a `const`.
 */
function defaultExportFactsOf({ statement }: { statement: ts.ExportAssignment }): ModuleFacts {
  if (ts.isIdentifier(statement.expression)) {
    return { ...NO_MODULE_FACTS, exports: [{ exported: "default", kind: "local", local: statement.expression.text }] };
  }
  return {
    consts: [
      { expression: expressionFactOf({ node: statement.expression, seen: new Set() }), name: ANONYMOUS_DEFAULT },
    ],
    exports: [{ exported: "default", kind: "local", local: ANONYMOUS_DEFAULT }],
    imports: [],
  };
}

/** A top-level `const` statement's plain-identifier bindings, and their exports when it is exported. */
function constStatementFactsOf({ statement }: { statement: ts.VariableStatement }): ModuleFacts {
  const exported = hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: statement });
  const consts = statement.declarationList.declarations.flatMap((declaration): readonly ModuleConstFact[] =>
    ts.isIdentifier(declaration.name) && declaration.initializer !== undefined
      ? [
          {
            expression: expressionFactOf({ node: declaration.initializer, seen: new Set() }),
            name: declaration.name.text,
          },
        ]
      : [],
  );
  const exports: readonly ExportBindingFact[] = exported
    ? consts.map((one): ExportBindingFact => ({ exported: one.name, kind: "local", local: one.name }))
    : [];
  return { consts, exports, imports: [] };
}

/** What one top-level statement contributes to the module's bindings — nothing, for any statement not read. */
function moduleFactsOf({ statement }: { statement: ts.Statement }): ModuleFacts {
  if (ts.isImportDeclaration(statement)) {
    return { ...NO_MODULE_FACTS, imports: importsOf({ statement }) };
  }
  if (ts.isExportDeclaration(statement)) {
    return { ...NO_MODULE_FACTS, exports: exportsOf({ statement }) };
  }
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    return defaultExportFactsOf({ statement });
  }
  if (ts.isVariableStatement(statement) && isConstList({ list: statement.declarationList })) {
    return constStatementFactsOf({ statement });
  }
  return NO_MODULE_FACTS;
}

/**
 * Read one file into the facts the whole-tree resolver needs. Pure — parses in memory with the TypeScript AST,
 * and returns plain data only.
 *
 * @param path the file's repo-relative path, carried onto each use for reporting and onto the record for lookup
 * @param content the file's text
 * @returns exactly one record per file, an empty one included, so the resolver knows the whole scanned pool
 */
export function scanErrorShapeFacts({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly ErrorShapeFileFacts[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly ErrorShapeFileFacts[] => {
      const parts = sf.statements.map((statement) => moduleFactsOf({ statement }));
      const imports = parts.flatMap((part) => part.imports);
      return [
        {
          consts: parts.flatMap((part) => part.consts),
          exports: parts.flatMap((part) => part.exports),
          imports,
          path,
          uses: usesOf({ errNames: errNamesOf({ imports, path }), sf }),
        },
      ];
    },
  });
}
