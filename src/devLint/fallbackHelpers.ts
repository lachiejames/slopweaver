/**
 * The `fallback-helper` clause of the no-silent-fallback gate: a call to a PASS-THROUGH FALLBACK HELPER is a
 * counted site on the same debt list as `??`, because renaming the operator is not paying it. The batches that emptied the list moved most of its sites behind `absentAsNull` and its kin, and
 * helpers of the same shape stood under 22 other names outside `src/lib/absent.ts` — a gate that knew one
 * module by name would have left every copy open, and the next one too. So the criterion is structural, and
 * names nothing.
 *
 * ## The criterion — no allowlist, no exemption marker
 *
 * What a helper IS is `fallbackHelperShape.ts`'s one sentence. Every call to one is a site: a helper declared
 * in the same file, a named import of one (aliases included) from a module that exports one — by its own
 * `export`, `export default`, or a local `export { … }` list naming a module-scope one — or `ns.name` through a
 * namespace import.
 *
 * `resolveHome` (the substitute is a call), a domain function returning a fresh literal, and
 * `unsetFieldAsNull` (four statements) fall outside by construction. Its blind spots are numbered in one
 * place, and only one: `docs/doctrine-rationale/no-silent-fallback.md` § "Its blind spots".
 *
 * Pure: {@link fallbackHelperExports} is the whole-tree pre-pass, {@link fallbackHelperCallHits} the per-file
 * count; `noSilentFallback.ts`'s IO edge reads the files.
 */

import { dirname, join } from "node:path/posix";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import { isPassThroughFallback, unwrapped } from "./fallbackHelperShape.js";

/** The longest expression text a refusal line carries, so one finding stays one line. */
const MAX_TEXT_CHARS = 90;

/**
 * One node's source text, whitespace collapsed and clipped, so a refusal line stays one line.
 *
 * @param node the expression or call the finding quotes
 * @returns the collapsed text, ending `...` when clipped
 */
export function shortTextOf({ node }: { node: ts.Node }): string {
  const collapsed = node.getText().replace(/\s+/g, " ");
  if (collapsed.length <= MAX_TEXT_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_TEXT_CHARS - 3)}...`;
}

/** Each module path, repo-relative, and the pass-through fallback helpers it exports by name. */
export type HelperExports = ReadonlyMap<string, ReadonlySet<string>>;

/** One declared helper: its local name, the name its own `export` gives it (if any), and whether it is module-scope. */
interface DeclaredHelper {
  readonly name: string;
  readonly exportedAs: string | undefined;
  readonly topLevel: boolean;
}

/** The name a declaration's own `export` modifier gives it — `default` for `export default` — or `undefined`. */
function ownExportName({ node, name }: { node: ts.Declaration; name: string }): string | undefined {
  const flags = ts.getCombinedModifierFlags(node);
  if ((flags & ts.ModifierFlags.Export) === 0) {
    return undefined;
  }
  if ((flags & ts.ModifierFlags.Default) !== 0) {
    return "default";
  }
  return name;
}

/**
 * Every pass-through fallback helper a file declares, anywhere in it: the name its own `export` gives it, and
 * whether it sits in a module-scope statement — the only binding a local `export { … }` list can name.
 */
function declaredHelpers({ sf }: { sf: ts.SourceFile }): readonly DeclaredHelper[] {
  const found: DeclaredHelper[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && isPassThroughFallback({ fn: node })) {
      const name = node.name.text;
      found.push({ exportedAs: ownExportName({ name, node }), name, topLevel: node.parent === sf });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = unwrapped({ node: node.initializer });
      const isFn = ts.isArrowFunction(init) || ts.isFunctionExpression(init);
      if (isFn && isPassThroughFallback({ fn: init })) {
        const name = node.name.text;
        // declaration → declaration list → a variable STATEMENT (never a loop header) → source file
        const statement = node.parent.parent;
        const topLevel = ts.isVariableStatement(statement) && statement.parent === sf;
        found.push({ exportedAs: ownExportName({ name, node }), name, topLevel });
      }
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return found;
}

/** A value `export { … }` list naming this file's own bindings (no `from`), or `undefined` for any other statement. */
function localExportList({ statement }: { statement: ts.Statement }): ts.NamedExports | undefined {
  if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined || statement.isTypeOnly) {
    return undefined;
  }
  const clause = statement.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) {
    return undefined;
  }
  return clause;
}

/**
 * The names a file exports its helpers under: each one declared `export`, and each one a local `export { … }`
 * list names — under its exported name, since that is what an importer writes.
 */
function exportedHelperNames({ sf }: { sf: ts.SourceFile }): readonly string[] {
  const declared = declaredHelpers({ sf });
  const names: string[] = [];
  for (const one of declared) {
    if (one.exportedAs !== undefined) {
      names.push(one.exportedAs);
    }
  }
  const locals = new Set(declared.filter((one) => one.topLevel).map((one) => one.name));
  for (const statement of sf.statements) {
    const list = localExportList({ statement });
    if (list !== undefined) {
      names.push(...listedHelperNames({ list, locals }));
    }
  }
  return names;
}

/** The exported names a local `export { … }` list gives to the module-scope helpers in `locals`. */
function listedHelperNames({
  list,
  locals,
}: {
  list: ts.NamedExports;
  locals: ReadonlySet<string>;
}): readonly string[] {
  const names: string[] = [];
  for (const specifier of list.elements) {
    let local = specifier.name.text;
    if (specifier.propertyName !== undefined && ts.isIdentifier(specifier.propertyName)) {
      local = specifier.propertyName.text;
    }
    if (locals.has(local)) {
      names.push(specifier.name.text);
    }
  }
  return names;
}

/**
 * Which pass-through fallback helpers each file exports — the whole-tree pre-pass the per-file count reads, so
 * a copy exported from any module in the scan is known before a single call is counted. Pure.
 *
 * @param files every scanned file's repo-relative path and text
 * @returns each module that exports at least one helper, and those helpers' names
 */
export function fallbackHelperExports({
  files,
}: {
  files: readonly { readonly path: string; readonly content: string }[];
}): HelperExports {
  const byModule = new Map<string, ReadonlySet<string>>();
  for (const { path, content } of files) {
    const names = withSourceFile({
      fileName: path,
      text: content,
      use: (sf): readonly string[] => exportedHelperNames({ sf }),
    });
    if (names.length > 0) {
      byModule.set(path, new Set(names));
    }
  }
  return byModule;
}

/** The repo-relative module an import specifier names — relative or `#lib/…`, `.js` read as `.ts`. */
function modulePathOf({ from, specifier }: { from: string; specifier: string }): string | undefined {
  let base: string;
  if (specifier.startsWith("#lib/")) {
    base = `src/lib/${specifier.slice("#lib/".length)}`;
  } else if (specifier.startsWith(".")) {
    base = join(dirname(from), specifier);
  } else {
    return undefined;
  }
  return base.endsWith(".js") ? `${base.slice(0, -".js".length)}.ts` : base;
}

/** The local names under which a file can call a helper: its own, its named imports, its namespaces. */
function callableHelpers({
  path,
  sf,
  helperExports,
}: {
  path: string;
  sf: ts.SourceFile;
  helperExports: HelperExports;
}): {
  direct: Set<string>;
  namespaces: Map<string, ReadonlySet<string>>;
} {
  const direct = new Set(declaredHelpers({ sf }).map((one) => one.name));
  const namespaces = new Map<string, ReadonlySet<string>>();
  for (const statement of sf.statements) {
    const imported = helperImport({ helperExports, path, statement });
    if (imported === undefined) {
      continue;
    }
    const { bindings, exported } = imported;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.set(bindings.name.text, exported);
      continue;
    }
    for (const local of namedHelperLocals({ bindings, exported })) {
      direct.add(local);
    }
  }
  return { direct, namespaces };
}

/** The local names a named import binds to helpers `exported` names — aliases included, type-only ones not. */
function namedHelperLocals({
  bindings,
  exported,
}: {
  bindings: ts.NamedImports;
  exported: ReadonlySet<string>;
}): readonly string[] {
  const locals: string[] = [];
  for (const element of bindings.elements) {
    const name = element.propertyName === undefined ? element.name.text : element.propertyName.text;
    if (!element.isTypeOnly && exported.has(name)) {
      locals.push(element.name.text);
    }
  }
  return locals;
}

/**
 * A value import from a module that exports helpers: its bindings and those helpers' names, or `undefined` for
 * any other statement — a type-only import, a bare or default-only import, or a module exporting none.
 */
function helperImport({
  helperExports,
  path,
  statement,
}: {
  helperExports: HelperExports;
  path: string;
  statement: ts.Statement;
}): { bindings: ts.NamedImportBindings; exported: ReadonlySet<string> } | undefined {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return undefined;
  }
  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  if (bindings === undefined || clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    return undefined;
  }
  const target = modulePathOf({ from: path, specifier: statement.moduleSpecifier.text });
  if (target === undefined) {
    return undefined;
  }
  const exported = helperExports.get(target);
  if (exported === undefined) {
    return undefined;
  }
  return { bindings, exported };
}

/**
 * Every call in one file to a pass-through fallback helper, in source order — the `fallback-helper` sites.
 * Pure.
 *
 * @param path the file's repo-relative path, which resolves its relative imports and labels each hit
 * @param sf the file, already parsed by the caller's scan
 * @param helperExports what {@link fallbackHelperExports} found across the tree
 * @returns one hit per call, shaped as a no-silent-fallback finding
 */
export function fallbackHelperCallHits({
  path,
  sf,
  helperExports,
}: {
  path: string;
  sf: ts.SourceFile;
  helperExports: HelperExports;
}): readonly { path: string; line: number; operator: "fallback-helper"; text: string }[] {
  const { direct, namespaces } = callableHelpers({ helperExports, path, sf });
  const hits: { path: string; line: number; operator: "fallback-helper"; text: string }[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapped({ node: node.expression });
      const viaNamespace =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        namespaces.get(callee.expression.text)?.has(callee.name.text) === true;
      if ((ts.isIdentifier(callee) && direct.has(callee.text)) || viaNamespace) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        hits.push({ line, operator: "fallback-helper", path, text: shortTextOf({ node }) });
      }
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return hits;
}
