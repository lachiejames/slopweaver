/**
 * How the CLI's manifest files bind names to each other: what a file exports, what it imports from a sibling, and
 * which manifest object the barrel's `MANIFEST_MODULES` binds to a noun. `./manifestVerbs.ts` walks those bindings
 * to the member a verb finally reaches; `./manifestLoaders.ts` reads what that member loads.
 */

import { hasModifier, type LentAnswer, ts, withSourceFile } from "#lib/tsSyntax.js";

import { finalField, topLevelConsts, unwrapped } from "./manifestLoaders.js";

/** The file and exported name one `NounManifestModule` row's `verbs:` identifier is imported as. */
export interface NounBinding {
  readonly file: string;
  readonly exported: string;
}

/**
 * A manifest source parsed as TypeScript for the length of `use`, with no type information. The tree is released
 * when `use` returns, so it answers plain data, never a node.
 *
 * @param use reads the syntax tree and answers plain data
 * @returns whatever `use` answered
 */
export function withParsedManifest<R>({
  text,
  use,
}: {
  text: string;
  use: (source: ts.SourceFile) => LentAnswer<R>;
}): LentAnswer<R> {
  return withSourceFile({ fileName: "manifest.ts", scriptKind: ts.ScriptKind.TS, text, use });
}

/**
 * The local name behind each name a source file exports — `export const x = …`, or `export { x, y as z }`,
 * keyed by `x` and `z`. A listed `export { x }` is an export too.
 *
 * @returns each exported name's local name
 */
export function exportedLocals({ source }: { source: ts.SourceFile }): ReadonlyMap<string, string> {
  const locals = new Map<string, string>();
  const declared = source.statements
    .filter(ts.isVariableStatement)
    .filter((statement) => hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: statement }))
    .flatMap((statement) => statement.declarationList.declarations.map((declaration) => declaration.name))
    .filter(ts.isIdentifier);
  for (const name of declared) {
    locals.set(name.text, name.text);
  }
  const listed = source.statements
    .filter(ts.isExportDeclaration)
    .filter((statement) => statement.moduleSpecifier === undefined && !statement.isTypeOnly);
  for (const statement of listed) {
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) {
      continue;
    }
    // `export { type m }` exports no value, so the const `m` stays unexported.
    for (const element of clause.elements.filter((each) => !each.isTypeOnly)) {
      let local = element.name;
      if (element.propertyName !== undefined) {
        local = element.propertyName;
      }
      if (ts.isIdentifier(local)) {
        locals.set(element.name.text, local.text);
      }
    }
  }
  return locals;
}

/**
 * The `./<file>.js` value imports a manifest file binds `name` from.
 *
 * @returns each as that file's `.ts` and the name it exports; empty when nothing imports `name`
 */
export function importedBinding({ name, source }: { name: string; source: ts.SourceFile }): readonly NounBinding[] {
  return source.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
    const clause = statement.importClause;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      clause === undefined ||
      clause.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      return [];
    }
    const file = /^\.\/([A-Za-z0-9_-]+)\.js$/u.exec(statement.moduleSpecifier.text);
    const bindings = clause.namedBindings;
    if (file === null || bindings === undefined || !ts.isNamedImports(bindings)) {
      return [];
    }
    return bindings.elements
      .filter((element) => !element.isTypeOnly && element.name.text === name)
      .map((element) => ({
        exported: element.propertyName === undefined ? element.name.text : element.propertyName.text,
        file: `${file[1]!}.ts`,
      }));
  });
}

/** What one row says about a noun: it names another one, or it binds this one (`undefined`: unreadably). */
type RowVerdict = { readonly binding: NounBinding | undefined } | "other";

/**
 * What one barrel row says about `noun`: `"other"` when it names another noun, else the one import its `verbs:`
 * names — `binding: undefined` when the row could bind `noun` but cannot be read: a bare name, an unreadable
 * noun, or this noun with a `verbs:` that is not exactly one imported name.
 */
function rowBinding({
  element,
  noun,
  source,
}: {
  element: ts.Expression;
  noun: string;
  source: ts.SourceFile;
}): RowVerdict {
  const row = unwrapped({ node: element });
  if (!ts.isObjectLiteralExpression(row)) {
    return { binding: undefined };
  }
  const nounField = finalField({ key: "noun", object: row });
  if (nounField === undefined || !ts.isStringLiteral(nounField)) {
    return { binding: undefined };
  }
  if (nounField.text !== noun) {
    return "other";
  }
  const verbsField = finalField({ key: "verbs", object: row });
  if (verbsField === undefined || !ts.isIdentifier(verbsField)) {
    return { binding: undefined };
  }
  const [imported, ...others] = importedBinding({ name: verbsField.text, source });
  return { binding: others.length === 0 ? imported : undefined };
}

/**
 * The array literal a source file exports under `exported` — `export const x = [ … ]`, or `export { y as x }`
 * of a `const y = [ … ]`, through any `as` / `satisfies` / parentheses.
 *
 * @returns the array, or `undefined` when the name is not exported or is not bound to an array literal
 */
function exportedArray({
  exported,
  source,
}: {
  exported: string;
  source: ts.SourceFile;
}): ts.ArrayLiteralExpression | undefined {
  const local = exportedLocals({ source }).get(exported);
  const declared = local === undefined ? undefined : topLevelConsts({ source }).get(local);
  const array = declared === undefined ? undefined : unwrapped({ node: declared });
  if (array === undefined || !ts.isArrayLiteralExpression(array)) {
    return undefined;
  }
  return array;
}

/**
 * What a `...name` element says about `noun`: the verdicts of the array that `name` imports from a sibling manifest
 * file, read in place with THAT file's own imports. A spread this reader cannot follow — no sibling sources
 * supplied, a name that is not exactly one value import, a sibling that is absent, an export that is not an array
 * literal, or a cycle — is one unreadable binding, never a skipped element: the reader says it could not tell
 * rather than guess the row away.
 */
function spreadVerdicts({
  element,
  manifests,
  noun,
  seen,
  source,
}: {
  element: ts.SpreadElement;
  manifests: ReadonlyMap<string, string> | undefined;
  noun: string;
  seen: ReadonlySet<string>;
  source: ts.SourceFile;
}): readonly RowVerdict[] {
  const unreadable: readonly RowVerdict[] = [{ binding: undefined }];
  const spread = unwrapped({ node: element.expression });
  if (manifests === undefined || !ts.isIdentifier(spread)) {
    return unreadable;
  }
  const [target, ...others] = importedBinding({ name: spread.text, source });
  if (target === undefined || others.length > 0) {
    return unreadable;
  }
  const key = `${target.file}#${target.exported}`;
  const text = manifests.get(target.file);
  if (text === undefined || seen.has(key)) {
    return unreadable;
  }
  return withParsedManifest({
    text,
    use: (sibling): readonly RowVerdict[] => {
      const array = exportedArray({ exported: target.exported, source: sibling });
      if (array === undefined) {
        return unreadable;
      }
      return arrayVerdicts({ array, manifests, noun, seen: new Set([...seen, key]), source: sibling });
    },
  });
}

/** Every element of `array` as a verdict, in order, with each spread of an imported array expanded in place. */
function arrayVerdicts({
  array,
  manifests,
  noun,
  seen,
  source,
}: {
  array: ts.ArrayLiteralExpression;
  manifests: ReadonlyMap<string, string> | undefined;
  noun: string;
  seen: ReadonlySet<string>;
  source: ts.SourceFile;
}): readonly RowVerdict[] {
  return array.elements.flatMap((element): readonly RowVerdict[] => {
    if (ts.isSpreadElement(element)) {
      return spreadVerdicts({ element, manifests, noun, seen, source });
    }
    return [rowBinding({ element, noun, source })];
  });
}

/**
 * Where the barrel binds a noun: the LAST `{ noun: "<noun>", verbs: <name> }` row of its exported
 * `MANIFEST_MODULES` array — the CLI routes through `Object.fromEntries` over it (`src/cli/nounGroups.ts`), so a
 * later row for the same noun replaces an earlier one — with `<name>` followed through the
 * `import { … } from "./<file>.js"` of the file the row is written in. This is the binding the CLI routes by,
 * so a verb whose module lives under another noun's directory resolves — `notion read` loads
 * `commands/providerRead/run.js` — while `slack status` still never reads `codex status`'s entry.
 *
 * The array may spread arrays imported from sibling manifest files (`...DOOR_MANIFEST_MODULES`), which is how the
 * rows are divided into family files; given those files' sources in `manifests`, each spread is read in place, so
 * last-row-wins holds across files exactly as it does at run time. Without them a spread is unreadable.
 *
 * @param manifests the source text of each `src/cli/manifests/*.ts` file, keyed by file name, for the spreads
 * @returns the binding, `"unbound"` when no row names `noun`, or `undefined` when the array, or the last row that
 *   could bind `noun`, cannot be read
 */
export function nounBinding({
  barrel,
  manifests,
  noun,
}: {
  barrel: string;
  manifests?: ReadonlyMap<string, string>;
  noun: string;
}): NounBinding | "unbound" | undefined {
  return withParsedManifest({
    text: barrel,
    use: (source): NounBinding | "unbound" | undefined => {
      const array = exportedArray({ exported: "MANIFEST_MODULES", source });
      if (array === undefined) {
        return undefined;
      }
      const last = arrayVerdicts({ array, manifests, noun, seen: new Set(), source }).findLast(
        (row) => row !== "other",
      );
      if (last === undefined) {
        return "unbound";
      }
      return last.binding;
    },
  });
}
