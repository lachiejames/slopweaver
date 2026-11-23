/*
 * The console's warning glyph (`components/console/WarningMark.tsx`, which every `StaleMark` draws for a failed read
 * that is not a not-connected integration) is a `<button>`, so a keyboard reaches the words a
 * pointer's hover shows. A Queue row is one whole `<button>`, and the mark inside it was a button inside a button:
 * invalid HTML, a React nesting warning in the dev console, and a focus stop pressing does nothing in. The mark now
 * draws as a labelled image wherever `InsideControl` says it sits inside a control of its own.
 *
 * So this walks every component and route under `site/` with the TypeScript parser and refuses a control — a button,
 * a link — whose JSX, in its own file, draws a component that can reach `WarningMark` with no `InsideControl` between
 * them. Which components reach it is computed, not listed: a top-level binding whose body or value MENTIONS
 * `WarningMark`, or one that does — whatever wraps the mention, a tag or a `memo(...)` alike — is one, each name
 * resolved through its own file's top-level declarations, `const X = Y` renames and named, default and namespace
 * imports, following re-exports (named, `*` and `* as`) and index files, so two files' same-named components never
 * pool and a new wrapper is caught without editing this file. `InsideControl` is resolved the same way, so only the
 * mark's own context shields, and it is refused anywhere it is drawn turned off, so no component can undo a shield
 * credited around it. Inside a control, any reference counts, a call or a variable as much as a tag. The blind spots:
 * a mark reaching the control through a prop or as a child of another file's control; a class component; a lazy
 * import; an aliased control import; and a name declared or shadowed inside a function body, since only top-level
 * bindings are read.
 *
 * This is the scope half of the walk the sibling `*.test.ts` files in this directory exercise, one file per describe;
 * `./nestedControlsScan.ts` is the half that scans a source for marks inside a control.
 */
import { posix } from "node:path";

import { forEachChild, ts, withSourceFile } from "../../../../src/lib/tsSyntax.js";

/** The glyph every other drawer reaches — `StaleMark` draws it — as the `module#name` it is declared at. */
export const MARK = "components/console/WarningMark#WarningMark";

/** The context that turns the mark into an image inside a control, as the `module#name` it is declared at. */
export const SHIELD = "components/console/WarningMark#InsideControl";

/** One console source: its path relative to `site/`, and its text. */
export interface Source {
  readonly path: string;
  readonly source: string;
}

/**
 * What one file declares, imports and exports, which is all a tag in it can name. Every name is keyed `module#name`,
 * the module being the path with no extension and no trailing `/index`, so `./x` and `./x/index.tsx` meet.
 */
interface FileScope {
  /** The file's own module key. */
  readonly module: string;
  /** Each top-level component the file declares, with every JSX tag its body draws. */
  readonly components: ReadonlyMap<string, readonly string[]>;
  /** Each local name bound by a named or default import of another console file, as the `module#name` it names. */
  readonly imports: ReadonlyMap<string, string>;
  /** Each namespace import (`import * as ui`), as the module it names. */
  readonly namespaces: ReadonlyMap<string, string>;
  /** Each name the file exports as something else — `default`, an alias, a re-export — as the `module#name` it is. */
  readonly exports: ReadonlyMap<string, string>;
  /** Each module the file re-exports whole (`export * from`). */
  readonly starExports: readonly string[];
  /** Each module the file re-exports as one namespace (`export * as marks from`), by that name. */
  readonly namespaceExports: ReadonlyMap<string, string>;
  /** Each top-level `const` that only renames another binding (`const Reset = InsideControl`), as the name it holds. */
  readonly aliases: ReadonlyMap<string, string>;
}

/** A path relative to `site/` as a module key: no extension, no trailing `/index`. */
function moduleKey({ path }: { path: string }): string {
  return path.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

/** The module a relative or `@/` specifier names, as a module key, or nothing for a package. */
function importedModule({ from, specifier }: { from: string; specifier: string }): string | undefined {
  if (specifier.startsWith("@/")) {
    return moduleKey({ path: posix.normalize(specifier.slice(2)) });
  }
  if (specifier.startsWith(".")) {
    return moduleKey({ path: posix.join(posix.dirname(from), specifier) });
  }
  return undefined;
}

/**
 * Every name a top-level binding's body or value mentions, as written: each JSX tag (`ui.Button` stays `ui.Button`) and
 * every other identifier or member path, whole. A component counts as a drawer when ANY of them reaches the mark, so
 * whatever wraps the reference — `memo(Inner)`, `memo(forwardRef(marks.WarningMark))`, parentheses, `as`, a ternary — is
 * followed without naming each shape. Over-counting only ever adds a refusal, never hides one.
 */
function referencesUnder({ node }: { node: ts.Node }): readonly string[] {
  const names: string[] = [];
  const visit = (child: ts.Node): void => {
    // Every identifier and every member path, heads included.
    const chain = chainOf({ node: child });
    if (chain !== undefined && (ts.isIdentifier(child) || ts.isPropertyAccessExpression(child))) {
      names.push(chain);
    }
    forEachChild({ node: child, visit });
  };
  visit(node);
  return names;
}

/**
 * A name or member path as the syntax tree spells it, with `?.`, `!` and parentheses dropped — `(marks)?.draw!` reads
 * `marks.draw` — or nothing for any other expression. Read off the tree, never the source text, so no spelling of an
 * access can hide its head.
 *
 * @returns the dotted chain, or nothing for any other expression
 */
export function chainOf({ node }: { node: ts.Node }): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return chainOf({ node: node.expression });
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const head = chainOf({ node: node.expression });
    return head === undefined ? undefined : `${head}.${node.name.text}`;
  }
  return undefined;
}

/** Whether a top-level `const`'s value only renames another binding (`const Reset = InsideControl`). */
function isRename({ value }: { value: ts.Expression }): boolean {
  return chainOf({ node: value }) !== undefined;
}

/**
 * What one source declares, imports and exports: each top-level component — a function declaration, or a `const`
 * holding a function or a wrapper call — with the tags it draws; each named, default and namespace import of another
 * console file; and each default, aliased or re-exported name.
 *
 * @param path the file, relative to `site/`, that its relative imports resolve against
 * @param source the file's text
 * @returns its scope
 */
export function fileScope({ path, source }: Source): FileScope {
  const module = moduleKey({ path });
  const components = new Map<string, readonly string[]>();
  const imports = new Map<string, string>();
  const namespaces = new Map<string, string>();
  const exports = new Map<string, string>();
  const starExports: string[] = [];
  const namespaceExports = new Map<string, string>();
  const aliases = new Map<string, string>();
  const pendingAliases: { exported: string; local: string }[] = [];
  withSourceFile({
    fileName: path,
    text: source,
    scriptKind: ts.ScriptKind.TSX,
    use: (file) => {
      for (const statement of file.statements) {
        if (ts.isFunctionDeclaration(statement)) {
          const isDefault = (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) !== 0;
          if (statement.name !== undefined && statement.body !== undefined) {
            components.set(statement.name.text, referencesUnder({ node: statement.body }));
          }
          if (isDefault && statement.name !== undefined) {
            exports.set("default", `${module}#${statement.name.text}`);
          }
          if (isDefault && statement.name === undefined && statement.body !== undefined) {
            components.set("default", referencesUnder({ node: statement.body }));
          }
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            const value = declaration.initializer;
            if (value === undefined || !ts.isIdentifier(declaration.name)) {
              continue;
            }
            if (isRename({ value })) {
              aliases.set(declaration.name.text, chainOf({ node: value })!);
            } else {
              components.set(declaration.name.text, referencesUnder({ node: value }));
            }
          }
        }
        if (ts.isExportAssignment(statement) && isRename({ value: statement.expression })) {
          pendingAliases.push({ exported: "default", local: chainOf({ node: statement.expression })! });
        }
        if (ts.isExportAssignment(statement) && !isRename({ value: statement.expression })) {
          components.set("default", referencesUnder({ node: statement.expression }));
        }
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const target = importedModule({ from: path, specifier: statement.moduleSpecifier.text });
          const clause = statement.importClause;
          if (target === undefined || clause === undefined) {
            continue;
          }
          if (clause.name !== undefined) {
            imports.set(clause.name.text, `${target}#default`);
          }
          const bindings = clause.namedBindings;
          if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.set(bindings.name.text, target);
          }
          if (bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              const declared = element.propertyName === undefined ? element.name.text : element.propertyName.getText();
              imports.set(element.name.text, `${target}#${declared}`);
            }
          }
        }
        if (ts.isExportDeclaration(statement)) {
          const specifier = statement.moduleSpecifier;
          const target =
            specifier !== undefined && ts.isStringLiteral(specifier)
              ? importedModule({ from: path, specifier: specifier.text })
              : undefined;
          const clause = statement.exportClause;
          if (clause === undefined && target !== undefined) {
            starExports.push(target);
          }
          if (clause !== undefined && ts.isNamespaceExport(clause) && target !== undefined) {
            namespaceExports.set(clause.name.getText(), target);
          }
          if (clause !== undefined && ts.isNamedExports(clause)) {
            for (const element of clause.elements) {
              const declared = element.propertyName === undefined ? element.name.text : element.propertyName.getText();
              if (target === undefined) {
                pendingAliases.push({ exported: element.name.text, local: declared });
              } else {
                exports.set(element.name.text, `${target}#${declared}`);
              }
            }
          }
        }
      }
    },
  });
  const scope = { aliases, components, exports, imports, module, namespaceExports, namespaces, starExports };
  // A rename of a namespace import (`export const R = marks`) passes the namespace on, exactly as `export * as` does.
  for (const name of aliases.keys()) {
    const namespace = namespaces.get(unalias({ scope, tag: name }));
    if (namespace !== undefined) {
      namespaceExports.set(name, namespace);
    }
  }
  // A local export (`export default X`, `export { X as Y }`) may name a binding declared below it, so it resolves last.
  for (const { exported, local } of pendingAliases) {
    const namespace = namespaces.get(unalias({ scope, tag: local }));
    if (namespace !== undefined) {
      namespaceExports.set(exported, namespace);
      continue;
    }
    const key = resolveTag({ scope, tag: local });
    if (key !== undefined && key !== `${module}#${exported}`) {
      exports.set(exported, key);
    }
  }
  return scope;
}

/**
 * A tag with every local rename of its head followed, so `const R = marks` turns `R.WarningMark` into `marks.WarningMark`.
 * Bounded by the number of renames, so a cycle stops rather than spins.
 */
function unalias({ scope, tag: written }: { scope: FileScope; tag: string }): string {
  let tag = written;
  for (let hops = 0; hops <= scope.aliases.size; hops += 1) {
    const dot = tag.indexOf(".");
    const head = dot === -1 ? tag : tag.slice(0, dot);
    const held = scope.aliases.get(head);
    if (held === undefined) {
      break;
    }
    tag = `${held}${tag.slice(head.length)}`;
  }
  return tag;
}

/**
 * The `module#name` a tag drawn in one file names, once any local rename is followed: a member path (`ui.Mark`,
 * `ui.marks.Mark`) through its namespace import or through a named import of a namespace re-export, else the file's own
 * component of that name, else the one it imports. A member path is keyed by everything after the head, so
 * `all.marks.Mark` meets the `marks.Mark` a namespace re-export records.
 *
 * @returns the `module#name` the tag names, or nothing when it names no console binding
 */
export function resolveTag({ scope, tag: written }: { scope: FileScope; tag: string }): string | undefined {
  const tag = unalias({ scope, tag: written });
  const dot = tag.indexOf(".");
  if (dot !== -1) {
    const head = tag.slice(0, dot);
    const member = tag.slice(dot + 1);
    const namespace = scope.namespaces.get(head);
    if (namespace !== undefined) {
      return `${namespace}#${member}`;
    }
    if (scope.components.has(head)) {
      return `${scope.module}#${tag}`;
    }
    const imported = scope.imports.get(head);
    return imported === undefined ? undefined : `${imported}.${member}`;
  }
  if (scope.components.has(tag)) {
    return `${scope.module}#${tag}`;
  }
  return scope.imports.get(tag);
}

/**
 * Whether a resolved `module#path` reaches the mark: it is in the set, or a binding it is a member of is — so
 * `marks.draw()` reaches the mark when the `marks` object does, whether it is declared here or imported.
 *
 * @returns whether the key, or a binding it is a member of, is a drawer
 */
export function reaches({ drawers, key }: { drawers: ReadonlySet<string>; key: string }): boolean {
  let path = key;
  while (!drawers.has(path)) {
    const dot = path.lastIndexOf(".");
    if (dot <= path.indexOf("#")) {
      return false;
    }
    path = path.slice(0, dot);
  }
  return true;
}

/**
 * Give a second name everything the first one reaches: the name itself when it reaches the mark — as itself or as a
 * member of something that does — and every member path held under it, renamed.
 */
function carry({ drawers, from, to }: { drawers: Set<string>; from: string; to: string }): void {
  if (reaches({ drawers, key: from })) {
    drawers.add(to);
  }
  for (const key of drawers) {
    if (key.startsWith(`${from}.`)) {
      drawers.add(`${to}${key.slice(from.length)}`);
    }
  }
}

/**
 * Every file's scope, by path.
 *
 * @param sources the console files to scope
 * @returns each file's scope, keyed by its path
 */
export function scopesOf({ sources }: { sources: readonly Source[] }): ReadonlyMap<string, FileScope> {
  return new Map(sources.map((one) => [one.path, fileScope(one)]));
}

/**
 * Every component that can draw the mark, as `module#name`: the mark itself, any component drawing one already in the
 * set — a tag resolved through its own file's declarations and imports — and any name a file exports one under, to a
 * fixed point.
 *
 * @param scopes every file's scope
 * @returns the components that reach the mark, under every name a file can import them by
 */
export function markDrawers({ scopes }: { scopes: ReadonlyMap<string, FileScope> }): ReadonlySet<string> {
  return closure({ draws: true, scopes, seed: MARK });
}

/**
 * Every name `InsideControl` can be imported by, as `module#name`: its own, and any a file re-exports it under. A
 * component drawing it is not it, so unlike the mark's drawers this never grows through what a body draws.
 *
 * @param scopes every file's scope
 * @returns the shield under every name a file can import it by
 */
export function shieldNames({ scopes }: { scopes: ReadonlyMap<string, FileScope> }): ReadonlySet<string> {
  return closure({ draws: false, scopes, seed: SHIELD });
}

/**
 * The names a seed is reachable by, to a fixed point: each re-export of it, by name, `*` or `* as`, and — when `draws`
 * holds — each component whose body draws one already in the set.
 */
function closure({
  scopes,
  seed,
  draws: throughBodies,
}: {
  scopes: ReadonlyMap<string, FileScope>;
  seed: string;
  draws: boolean;
}): ReadonlySet<string> {
  const drawers = new Set<string>([seed]);
  let size = 0;
  while (drawers.size !== size) {
    size = drawers.size;
    for (const scope of scopes.values()) {
      for (const [name, tags] of scope.components) {
        const draws = tags.some((tag) => {
          const resolved = resolveTag({ scope, tag });
          return resolved !== undefined && reaches({ drawers, key: resolved });
        });
        if (throughBodies && draws) {
          drawers.add(`${scope.module}#${name}`);
        }
      }
      // A local rename (`export const R = InsideControl`) declares no component, and is the binding it holds, carrying
      // every member path under it exactly as a re-export does, so a renamed namespace keeps its members.
      for (const name of scope.aliases.keys()) {
        const resolved = resolveTag({ scope, tag: name });
        if (resolved !== undefined) {
          carry({ drawers, from: resolved, to: `${scope.module}#${name}` });
        }
      }
      // A re-exported name carries every member path under it, so a `* as` namespace passed on by name keeps them.
      for (const [exported, target] of scope.exports) {
        carry({ drawers, from: target, to: `${scope.module}#${exported}` });
      }
      for (const [name, target] of scope.namespaceExports) {
        for (const key of drawers) {
          if (key.startsWith(`${target}#`)) {
            drawers.add(`${scope.module}#${name}.${key.slice(key.indexOf("#") + 1)}`);
          }
        }
      }
      for (const star of scope.starExports) {
        for (const key of drawers) {
          const name = key.slice(key.indexOf("#") + 1);
          if (key.startsWith(`${star}#`) && name !== "default") {
            drawers.add(`${scope.module}#${name}`);
          }
        }
      }
    }
  }
  return drawers;
}
