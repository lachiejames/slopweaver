/**
 * How the `home-safety` gate reads one test file's call sites: the named imports it declares, the repo-relative
 * `.ts` path each in-repo specifier resolves to, and whether a call's arguments provably omit `home`.
 *
 * A pure leaf of `homeSafety.ts`, which composes these into `unsafeHomeCalls` and owns the gate's criterion,
 * scopes and runner. This module imports nothing from it, type-only included, so the dependency runs one way.
 */

import { posix } from "node:path";
import { isInternalSpecifier, resolveSubpathImport } from "#lib/subpathImports.js";
import { ts, withSourceFile } from "#lib/tsSyntax.js";

/** One named import binding: the local name a file uses, and the exported name it came from. */
interface NamedImport {
  readonly local: string;
  readonly imported: string;
  readonly specifier: string;
}

/**
 * Every named (non-type-only) import binding a file declares, in source order. Top-level only.
 *
 * @returns each binding's local name, exported name and specifier
 */
export function namedImports({ content }: { content: string }): readonly NamedImport[] {
  return withSourceFile({
    fileName: "scan.ts",
    text: content,
    use: (sourceFile): readonly NamedImport[] => {
      const imports: NamedImport[] = [];
      sourceFile.forEachChild((node) => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
          return;
        }
        const specifier = node.moduleSpecifier.text;
        if (!isInternalSpecifier({ specifier })) {
          return;
        }
        const bindings = node.importClause?.namedBindings;
        if (bindings === undefined || !ts.isNamedImports(bindings)) {
          return;
        }
        for (const { isTypeOnly, propertyName, name } of bindings.elements) {
          if (isTypeOnly) {
            continue;
          }
          // A specifier carries a `propertyName` only when it renames (`import { a as b }`); otherwise the local
          // name IS the exported one.
          const imported = propertyName === undefined ? name.text : propertyName.text;
          imports.push({ imported, local: name.text, specifier });
        }
      });
      return imports;
    },
  });
}

/**
 * Resolve one in-repo import specifier to the repo-relative `.ts` path it names, or `undefined` when it
 * cannot be resolved this cheaply (not a `.js`-suffixed specifier, or one that escapes the repository).
 *
 * A subpath import (`#lib/result.js`) resolves through {@link resolveSubpathImport} rather than through the
 * importer's own directory — its whole point is that it does not encode where the importer sits.
 *
 * @param importerPath the repo-relative path of the file doing the importing
 * @param specifier the import specifier, as written (`../../foo.js` or `#lib/foo.js`)
 * @returns the repo-relative `.ts` path the specifier resolves to, or `undefined`
 */
export function resolvedImportPath({
  importerPath,
  specifier,
}: {
  importerPath: string;
  specifier: string;
}): string | undefined {
  if (!specifier.endsWith(".js")) {
    return undefined;
  }
  const subpath = resolveSubpathImport({ specifier });
  if (subpath !== undefined) {
    return `${subpath.slice(0, -".js".length)}.ts`;
  }
  const resolved = posix.normalize(posix.join(posix.dirname(importerPath), specifier));
  if (resolved.startsWith("..")) {
    return undefined;
  }
  return `${resolved.slice(0, -".js".length)}.ts`;
}

/** Whether an object-literal argument declares a `home` property, shorthand or full — a spread makes it unknowable. */
function objectLiteralOmitsHome({ node }: { node: ts.ObjectLiteralExpression }): boolean {
  let hasSpread = false;
  let hasHome = false;
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      hasSpread = true;
      continue;
    }
    if (
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "home"
    ) {
      hasHome = true;
    }
  }
  return !hasSpread && !hasHome;
}

/**
 * Whether a call's arguments provably omit `home` — zero arguments, or one object literal missing it.
 *
 * @returns true when the call passes no `home` and no spread or variable could carry one
 */
export function callOmitsHome({ node }: { node: ts.CallExpression }): boolean {
  if (node.arguments.length === 0) {
    return true;
  }
  const [first] = node.arguments;
  return node.arguments.length === 1 && first !== undefined && ts.isObjectLiteralExpression(first)
    ? objectLiteralOmitsHome({ node: first })
    : false;
}
