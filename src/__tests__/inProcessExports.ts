/**
 * Which top-level function each name a verb module EXPORTS refers to — the half of `./inProcessVerbPaths.ts` that
 * reads a module's export surface, split out because an import names an export, never a declaration. Review
 * found a namespace read of `target.default` missing the body `export default function runTarget` declares.
 */
import { hasModifier, ts } from "#lib/tsSyntax.js";

import type { DeclaredFunction } from "./inProcessVerbBodies.js";

/** The pairs a local `export { f, f as g }` list adds; a re-export from another module adds none. */
function listedExports({ statement }: { statement: ts.ExportDeclaration }): readonly (readonly [string, string])[] {
  const clause = statement.exportClause;
  const local = statement.moduleSpecifier === undefined && !statement.isTypeOnly;
  if (!local || clause === undefined || !ts.isNamedExports(clause)) {
    return [];
  }
  return clause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => {
      if (element.propertyName === undefined) {
        return [element.name.text, element.name.text] as const;
      }
      return [element.name.text, element.propertyName.text] as const;
    });
}

/** The export name to declared name pairs one top-level statement adds. */
function exportsOf({ statement }: { statement: ts.Statement }): readonly (readonly [string, string])[] {
  if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
    return [["default", statement.expression.text]];
  }
  if (ts.isExportDeclaration(statement)) {
    return listedExports({ statement });
  }
  if (!hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: statement })) {
    return [];
  }
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    const isDefault = hasModifier({ kind: ts.SyntaxKind.DefaultKeyword, node: statement });
    return [[isDefault ? "default" : statement.name.text, statement.name.text]];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [[declaration.name.text, declaration.name.text] as const] : [],
    );
  }
  return [];
}

/**
 * Every name a module exports one of its own top-level functions under, mapped to that function's declared name:
 * `export function f`, `export const f = …`, `export default function f` (as `default`), `export { f, f as g }` and
 * `export default f`. A re-export from another module is not its own function, and stays the stated residue.
 *
 * @param source the verb module
 * @param functions its own top-level functions, by declared name
 * @returns export name to declared name, for exported names that are its own functions
 */
export function exportedFunctions({
  source,
  functions,
}: {
  source: ts.SourceFile;
  functions: ReadonlyMap<string, DeclaredFunction>;
}): ReadonlyMap<string, string> {
  const exports = new Map<string, string>();
  for (const statement of source.statements) {
    for (const [exported, declared] of exportsOf({ statement })) {
      if (functions.has(declared)) {
        exports.set(exported, declared);
      }
    }
  }
  return exports;
}
