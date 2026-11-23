/**
 * The STATIC RUNTIME import closure of a set of source files — every `.ts` module that loading them loads eagerly, and
 * every package or builtin that closure names.
 *
 * It exists for one property: importing `src/cli/nounGroups.ts` must load no command implementation and no npm package,
 * because every CLI invocation imports it (`../__tests__/unit/cli/manifestBarrelClosure.test.ts` is the guard). That
 * makes the edge it follows narrower than `untestedModules.ts`'s on purpose, and the difference is the whole point:
 *
 * - **A dynamic `import()` is NOT an edge.** It is the lazy loader by design — a manifest's
 *   `lazy(() => import("../commands/…"))` is exactly the load this walk must not count. `importedPathsOf` counts it,
 *   which is why this module does not reuse that function.
 * - **An `import type`, and a named import whose every element is inline `type`, are NOT edges.** `tsc` erases both,
 *   and `tsconfig.json` sets no `verbatimModuleSyntax` that would keep them.
 * - **A mixed `{ type A, b }` import IS an edge**, as is a side-effect `import "x"`, an `export … from` that is not
 *   `export type`, and an `import x = require("…")` that is not `import type`.
 *
 * Its residue, stated: a named import of nothing but types written WITHOUT the `type` keyword counts as an edge,
 * although `tsc` elides it, because telling it apart needs resolved types. The error is on the safe side — the walk
 * reports more, never less — and oxlint's `consistent-type-imports` keeps that shape rare. A bare `require("…")` CALL
 * is not read: an ESM module has no `require` in scope, so it reaches one only through `createRequire`, which is a
 * `node:module` import the walk already reports as bare.
 *
 * Resolution is `resolveSpecifier`'s, so `.js` maps back to `.ts` and `#lib/` to `src/lib/` exactly as the
 * untested-modules gate reads them. Pure: the file text comes from an injected `readText`.
 */

import { ts, withSourceFile } from "#lib/tsSyntax.js";
import { resolveSpecifier } from "./untestedModules.js";

/** Whether an import clause survives `tsc`'s type-only elision. */
function importClauseIsRuntime({ clause }: { clause: ts.ImportClause | undefined }): boolean {
  if (clause === undefined) {
    return true;
  }
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    return false;
  }
  if (clause.name !== undefined) {
    return true;
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined || ts.isNamespaceImport(bindings)) {
    return true;
  }
  if (bindings.elements.length === 0) {
    return true;
  }
  return bindings.elements.some((element) => !element.isTypeOnly);
}

/** Whether an `export … from` declaration survives `tsc`'s type-only elision. */
function exportIsRuntime({ declaration }: { declaration: ts.ExportDeclaration }): boolean {
  if (declaration.isTypeOnly) {
    return false;
  }
  const clause = declaration.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause) || clause.elements.length === 0) {
    return true;
  }
  return clause.elements.some((element) => !element.isTypeOnly);
}

/**
 * Every specifier a source text loads EAGERLY at runtime: static imports, `import = require`s and value
 * re-exports, side-effect imports included, with `import type`, all-inline-`type` imports, `export type` and dynamic `import()`
 * left out.
 *
 * @param content the module's source text
 * @returns each runtime specifier exactly as written, in source order
 */
export function runtimeSpecifiersOf({ content }: { content: string }): readonly string[] {
  return withSourceFile({
    fileName: "m.ts",
    text: content,
    use: (source): readonly string[] => {
      const specifiers: string[] = [];
      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          importClauseIsRuntime({ clause: statement.importClause })
        ) {
          specifiers.push(statement.moduleSpecifier.text);
        }
        if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier !== undefined &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          exportIsRuntime({ declaration: statement })
        ) {
          specifiers.push(statement.moduleSpecifier.text);
        }
        if (
          ts.isImportEqualsDeclaration(statement) &&
          !statement.isTypeOnly &&
          ts.isExternalModuleReference(statement.moduleReference) &&
          ts.isStringLiteral(statement.moduleReference.expression)
        ) {
          specifiers.push(statement.moduleReference.expression.text);
        }
      }
      return specifiers;
    },
  });
}

/** A specifier the walk could not resolve into this repository — a package or a `node:` builtin. */
export interface BareImport {
  /** The repo-relative module that wrote it. */
  readonly from: string;
  /** The specifier exactly as written. */
  readonly specifier: string;
}

/**
 * Walk the static runtime closure from some roots. Cycles terminate, because a file is read once.
 *
 * @param roots repo-relative `.ts` paths the walk starts from
 * @param readText returns a repo-relative file's text; the edge where the real tree or a fixture is read
 * @returns every repo module reached (roots included), sorted, and every package or builtin import met
 */
export function staticClosureOf({
  readText,
  roots,
}: {
  readText: (path: string) => string;
  roots: readonly string[];
}): { readonly bare: readonly BareImport[]; readonly files: readonly string[] } {
  const seen = new Set<string>();
  const bare: BareImport[] = [];
  const pending = [...roots];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    for (const specifier of runtimeSpecifiersOf({ content: readText(path) })) {
      const resolved = resolveSpecifier({ fromPath: path, specifier });
      if (resolved === undefined) {
        bare.push({ from: path, specifier });
      } else {
        pending.push(resolved);
      }
    }
  }
  return { bare, files: [...seen].toSorted() };
}
