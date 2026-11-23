/**
 * Read the console sidebar's declared rows out of `site/lib/sidebarCounts.ts` without importing it.
 *
 * `site/` is its own Yarn project and the root `typecheck` deliberately does not compile it, so the gate reads
 * the `SIDEBAR_ENTRIES` literal through the TypeScript AST instead. It fails CLOSED: a missing declaration, a
 * non-literal row, or a `key`/`label`/`href` that is not a literal string (or `null`, for `href`) is an
 * extraction failure the runner reports as unseen, never a row silently skipped. A gate that read zero rows
 * and printed clean would be the defect this whole gate family exists to prevent.
 *
 * Pure: takes the file's text, returns rows or a reason.
 */
import { err, ok, type Result } from "#lib/result.js";
import { ts, withSourceFile } from "#lib/tsSyntax.js";
import type { SidebarNameDeclaration } from "./namingDoctrine.js";

/** The repo-relative file the sidebar is declared in. */
export const SIDEBAR_SOURCE = "site/lib/sidebarCounts.ts";

/** The exported constant holding the rows. */
const SIDEBAR_CONSTANT = "SIDEBAR_ENTRIES";

/** Strip the `as const` / `satisfies` wrappers a literal declaration carries. */
function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** The initializer of the named top-level `const`, or undefined when the file declares none. */
function constantInitializer({ sf, name }: { sf: ts.SourceFile; name: string }): ts.Expression | undefined {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    );
    if (declaration?.initializer !== undefined) {
      return declaration.initializer;
    }
  }
  return undefined;
}

/** One property's literal value: a string, `null`, or `undefined` when it is absent or not a literal. */
function literalProperty({
  row,
  name,
}: {
  row: ts.ObjectLiteralExpression;
  name: string;
}): { readonly found: false } | { readonly found: true; readonly value: string | null } {
  const property = row.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name,
  );
  if (property === undefined) {
    return { found: false };
  }
  const value = unwrapped({ node: property.initializer });
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return { found: true, value: value.text };
  }
  if (value.kind === ts.SyntaxKind.NullKeyword) {
    return { found: true, value: null };
  }
  return { found: false };
}

/** One array element as a declaration, or the reason it is not one. */
function rowOf({
  element,
  sf,
  path,
}: {
  element: ts.Expression;
  sf: ts.SourceFile;
  path: string;
}): Result<SidebarNameDeclaration, string> {
  const line = sf.getLineAndCharacterOfPosition(element.getStart(sf)).line + 1;
  if (!ts.isObjectLiteralExpression(element)) {
    return err(`${path}:${String(line)}: a ${SIDEBAR_CONSTANT} row is not an object literal`);
  }
  const href = literalProperty({ name: "href", row: element });
  const key = literalProperty({ name: "key", row: element });
  const label = literalProperty({ name: "label", row: element });
  if (!href.found || !key.found || !label.found || key.value === null || label.value === null) {
    return err(`${path}:${String(line)}: a ${SIDEBAR_CONSTANT} row's href, key or label is not a literal`);
  }
  return ok({ href: href.value, key: key.value, label: label.value, line, path });
}

/**
 * Every row `SIDEBAR_ENTRIES` declares, or the one reason the table could not be read.
 *
 * @param content the text of {@link SIDEBAR_SOURCE}
 * @param path the path it was read from, for reporting
 * @returns the rows in declaration order, or why extraction failed
 */
export function extractSidebarEntries({
  content,
  path,
}: {
  content: string;
  path: string;
}): Result<readonly SidebarNameDeclaration[], string> {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): Result<readonly SidebarNameDeclaration[], string> => {
      const initializer = constantInitializer({ name: SIDEBAR_CONSTANT, sf });
      if (initializer === undefined) {
        return err(`${path}: declares no \`${SIDEBAR_CONSTANT}\` constant`);
      }
      const table = unwrapped({ node: initializer });
      if (!ts.isArrayLiteralExpression(table) || table.elements.length === 0) {
        return err(`${path}: \`${SIDEBAR_CONSTANT}\` is not a non-empty array literal`);
      }
      const rows: SidebarNameDeclaration[] = [];
      for (const element of table.elements) {
        const row = rowOf({ element, path, sf });
        if (row.isErr()) {
          return err(row.error);
        }
        rows.push(row.value);
      }
      return ok(rows);
    },
  });
}
