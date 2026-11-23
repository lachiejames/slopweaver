/**
 * How one parsed source file binds the filesystem, for the torn-tail-append criterion (`./tornTailAppendShape.ts`):
 * its imports from `node:fs`, `fs`, `node:fs/promises` or `fs/promises` — a named import (aliased or not), a namespace
 * or default import, the `promises` member — and every same-file `const`/`let` alias or destructure of one. Pure,
 * syntax only; whether a name still means its binding where it is used is `./tornTailAppendScope.ts`'s question.
 */

import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts } from "#lib/tsSyntax.js";

import { copiedExport, holdsItsInitializer, isShadowed, reassignedNames } from "./tornTailAppendScope.js";
import { memberOf, unwrapped } from "./tornTailAppendValue.js";

/** The module specifiers whose bindings are the filesystem. */
const FS_MODULES: ReadonlySet<string> = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);

/** How one file binds the filesystem: named imports by local name, and the names that stand for the whole module. */
export interface FsBindings {
  /**
   * Local name → every fs export it is bound to, in any scope. A name bound twice keeps both, so a call is read as each
   * of them — an over-flag rather than a miss (an inner alias overwrote an imported append).
   */
  readonly named: ReadonlyMap<string, ReadonlySet<string>>;
  /** Local names bound to the module itself — a namespace, a default import, or its `promises` member. */
  readonly modules: ReadonlySet<string>;
  /** The `const`/`let` declarations recorded as fs aliases, which are the binding one scope in, never a shadow. */
  readonly aliases: ReadonlySet<ts.Node>;
}

/** The bindings while they are being built. */
interface BindingsUnderConstruction {
  readonly named: Map<string, Set<string>>;
  readonly modules: Set<string>;
  readonly aliases: Set<ts.Node>;
}

/** The export a named import element names: its `propertyName` when aliased (`a as b`), else its own name. */
function importedName({ element }: { element: ts.ImportSpecifier }): string {
  if (element.propertyName === undefined) {
    return element.name.text;
  }
  return element.propertyName.text;
}

/** The export a destructured or renamed binding element reads: its property name when given, else its own name. */
function boundName({ element }: { element: ts.BindingElement }): string | undefined {
  const key = element.propertyName;
  if (key === undefined) {
    return element.name !== undefined && ts.isIdentifier(element.name) ? element.name.text : undefined;
  }
  return ts.isIdentifier(key) || isStringLiteralLikeNode(key) ? key.text : undefined;
}

/**
 * Record one local name as the export `imported`: a module when it is `promises` or `default` (`import { default as
 * fs }` is the default import spelt as a named one), else a named fs function.
 */
function bind({ local, imported, fs }: { local: string; imported: string; fs: BindingsUnderConstruction }): void {
  const exports = fs.named.get(local);
  if (imported === "promises" || imported === "default") {
    fs.modules.add(local);
  } else if (exports === undefined) {
    fs.named.set(local, new Set([imported]));
  } else {
    exports.add(imported);
  }
}

/** Bind a destructure's rest element as the module: it holds every member the pattern did not name. */
function bindRest({ element, fs }: { element: ts.BindingElement; fs: BindingsUnderConstruction }): void {
  if (element.name !== undefined && ts.isIdentifier(element.name)) {
    fs.modules.add(element.name.text);
  }
}

/** How much the bindings hold, so the alias fold stops only once a pass adds nothing. */
function bindingCount({ fs }: { fs: FsBindings }): number {
  let count = fs.modules.size + fs.aliases.size;
  for (const exports of fs.named.values()) {
    count += exports.size;
  }
  return count;
}

/**
 * Bind every name a destructure of a module binding declares, descending into a nested pattern on a member that is
 * itself the module — `const { promises: { appendFile } } = fs` — and reading a rest element, which holds every
 * member, as the module itself — `const { ...io } = fs`.
 */
function bindPattern({ pattern, fs }: { pattern: ts.ObjectBindingPattern; fs: BindingsUnderConstruction }): void {
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined) {
      bindRest({ element, fs });
      continue;
    }
    const imported = boundName({ element });
    if (imported !== undefined && element.name !== undefined && ts.isIdentifier(element.name)) {
      bind({ fs, imported, local: element.name.text });
    }
    const isModuleMember = imported === "promises" || imported === "default";
    if (isModuleMember && element.name !== undefined && ts.isObjectBindingPattern(element.name)) {
      bindPattern({ fs, pattern: element.name });
    }
  }
}

/**
 * Whether an expression is a module binding, or that binding's `promises` member, however it is spelt.
 *
 * @param node the expression as written
 * @param fs the file's bindings
 * @returns true when the expression stands for the fs module where it is written
 */
export function isModuleReference({ node, fs }: { node: ts.Expression; fs: FsBindings }): boolean {
  const target = unwrapped({ node });
  if (ts.isIdentifier(target)) {
    return fs.modules.has(target.text) && !isShadowed({ aliases: fs.aliases, identifier: target });
  }
  const member = memberOf({ node: target });
  return member?.name === "promises" && isModuleReference({ fs, node: member.receiver });
}

/** Every declaration in the file that may be read as an alias: one with an initializer that it still holds. */
function aliasCandidatesOf({ sf }: { sf: ts.SourceFile }): readonly ts.VariableDeclaration[] {
  const declarations: ts.VariableDeclaration[] = [];
  const reassigned = reassignedNames({ sf });
  const collect: NodeVisitor = (node) => {
    const holds = ts.isVariableDeclaration(node) && holdsItsInitializer({ declaration: node, reassigned });
    if (holds && node.initializer !== undefined) {
      declarations.push(node);
    }
    forEachChild({ node, visit: collect });
  };
  collect(sf);
  return declarations;
}

/** The fs exports an initializer reads — a copy of a bound name, or a member of a module binding — if any. */
function exportsReadBy({
  source,
  fs,
}: {
  source: ts.Expression;
  fs: BindingsUnderConstruction;
}): ReadonlySet<string> | undefined {
  const copied = copiedExport({ aliases: fs.aliases, named: fs.named, source });
  if (copied !== undefined) {
    return copied;
  }
  const member = memberOf({ node: source });
  if (member !== undefined && isModuleReference({ fs, node: member.receiver })) {
    return new Set([member.name]);
  }
  return undefined;
}

/** Fold one alias candidate into the bindings when its initializer is the module, an fs export, or a destructure. */
function foldDeclaration({
  declaration,
  fs,
}: {
  declaration: ts.VariableDeclaration;
  fs: BindingsUnderConstruction;
}): void {
  const source = unwrapped({ node: declaration.initializer! });
  const name = declaration.name;
  if (ts.isObjectBindingPattern(name) && isModuleReference({ fs, node: source })) {
    bindPattern({ fs, pattern: name });
    fs.aliases.add(declaration);
  }
  if (!ts.isIdentifier(name)) {
    return;
  }
  if (isModuleReference({ fs, node: source })) {
    fs.modules.add(name.text);
    fs.aliases.add(declaration);
  }
  const exports = exportsReadBy({ fs, source });
  if (exports === undefined) {
    return;
  }
  for (const imported of exports) {
    bind({ fs, imported, local: name.text });
  }
  fs.aliases.add(declaration);
}

/** Bind every name one `import` clause from an fs module introduces. */
function bindImport({ clause, fs }: { clause: ts.ImportClause; fs: BindingsUnderConstruction }): void {
  if (clause.name !== undefined) {
    fs.modules.add(clause.name.text);
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(bindings)) {
    fs.modules.add(bindings.name.text);
    return;
  }
  for (const element of bindings.elements) {
    bind({ fs, imported: importedName({ element }), local: element.name.text });
  }
}

/** The clause of an `import` from an fs module, or `undefined` for any other statement. */
function fsImportClause({ statement }: { statement: ts.Statement }): ts.ImportClause | undefined {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return undefined;
  }
  return FS_MODULES.has(statement.moduleSpecifier.text) ? statement.importClause : undefined;
}

/**
 * Every fs binding a source file's imports introduce, and every local alias of one, folded until no pass adds one.
 *
 * @param sf the parsed file, created with parent pointers
 * @returns the file's fs bindings
 */
export function fsBindingsOf({ sf }: { sf: ts.SourceFile }): FsBindings {
  const fs: BindingsUnderConstruction = { aliases: new Set(), modules: new Set(), named: new Map() };
  for (const statement of sf.statements) {
    const clause = fsImportClause({ statement });
    if (clause !== undefined) {
      bindImport({ clause, fs });
    }
  }
  const candidates = aliasCandidatesOf({ sf });
  let before = -1;
  while (before !== bindingCount({ fs })) {
    before = bindingCount({ fs });
    for (const declaration of candidates) {
      foldDeclaration({ declaration, fs });
    }
  }
  return fs;
}
