/**
 * What one manifest member LOADS: the `<verb>: lazy({ load })` shape, read off the parsed source down to the
 * `../commands/<dir>/<File>.js` module its loader imports. `./manifestVerbs.ts` decides WHICH member a verb
 * finally reaches — through the barrel, spreads and overrides — and asks this module what that member loads.
 */

import { forEachChild, ts } from "#lib/tsSyntax.js";

/** One live manifest entry: the verb key, and the command directory and file its loader imports. */
export interface ManifestEntry {
  readonly verb: string;
  readonly dir: string;
  readonly file: string;
}

/** How many `import(…)` calls sit anywhere under a node, the node itself included. */
function importCount({ node }: { node: ts.Node }): number {
  const own = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? 1 : 0;
  let below = 0;
  forEachChild({
    node,
    visit: (child) => {
      below += importCount({ node: child });
    },
  });
  return own + below;
}

/**
 * An expression with its `as`, `satisfies` and parentheses peeled off.
 *
 * @returns the innermost expression those wrappers enclose
 */
export function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrapped({ node: node.expression });
  }
  return node;
}

/**
 * A property's key as written, bare or quoted.
 *
 * @returns the key's text, or `undefined` for a computed or numeric one
 */
export function keyText({ name }: { name: ts.PropertyName }): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** One member of an object literal, in source order: its key and value, each `undefined` when it cannot be read. */
interface ObjectMember {
  readonly key: string | undefined;
  readonly value: ts.Expression | undefined;
}

/** An object's members with every inline `...{ … }` spread inlined where it sits; any other spread is unreadable. */
function objectMembers({ object }: { object: ts.ObjectLiteralExpression }): readonly ObjectMember[] {
  return object.properties.flatMap((property): readonly ObjectMember[] => {
    if (ts.isSpreadAssignment(property)) {
      const spread = unwrapped({ node: property.expression });
      return ts.isObjectLiteralExpression(spread)
        ? objectMembers({ object: spread })
        : [{ key: undefined, value: undefined }];
    }
    if (ts.isPropertyAssignment(property)) {
      const key = keyText({ name: property.name });
      return [{ key, value: key === undefined ? undefined : property.initializer }];
    }
    if (ts.isShorthandPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      return [{ key: property.name.text, value: property.name }];
    }
    // A method or accessor: its key may be readable, but its value is no expression this module reads.
    return [{ key: keyText({ name: property.name }), value: undefined }];
  });
}

/**
 * The value an object literal finally gives `key`: its LAST member that could set it, as JavaScript reads
 * `{ verbs: a, ...{ verbs: b } }` — a barrel row or a `lazy` call's options.
 *
 * @returns the value, `as`/`satisfies`/parentheses peeled, or `undefined` when no member sets `key` or the last one that could is unreadable — a named
 *   spread, a computed key, or a method or accessor
 */
export function finalField({
  key,
  object,
}: {
  key: string;
  object: ts.ObjectLiteralExpression;
}): ts.Expression | undefined {
  const last = objectMembers({ object }).findLast((member) => member.key === undefined || member.key === key);
  const value = last?.value;
  return value === undefined ? undefined : unwrapped({ node: value });
}

/**
 * Every top-level `const <name> = <initializer>` in a source file, by name — where a named loader lives. A `let`
 * or `var` is skipped, because a reassignment could load something else.
 *
 * @returns each top-level `const` initializer keyed by its name
 */
export function topLevelConsts({ source }: { source: ts.SourceFile }): ReadonlyMap<string, ts.Expression> {
  const consts = new Map<string, ts.Expression>();
  const constStatements = source.statements
    .filter(ts.isVariableStatement)
    .filter((statement) => (statement.declarationList.flags & ts.NodeFlags.Const) !== 0);
  for (const statement of constStatements) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
        consts.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return consts;
}

/**
 * The module a loader returns, read only off the one shape the manifests write: an arrow function whose
 * expression body is `import("<literal>")`, optionally followed by `.then(…)` calls, with no other `import()`
 * anywhere in it. A block body, a second import, or anything else resolves to nothing — searching the loader for
 * an import read one it merely mentioned.
 */
function loaderSpecifier({ loader }: { loader: ts.Expression }): string | undefined {
  const fn = unwrapped({ node: loader });
  if (!ts.isArrowFunction(fn) || ts.isBlock(fn.body) || importCount({ node: fn }) !== 1) {
    return undefined;
  }
  let head = unwrapped({ node: fn.body });
  while (ts.isCallExpression(head) && ts.isPropertyAccessExpression(head.expression)) {
    if (head.expression.name.text !== "then") {
      return undefined;
    }
    head = unwrapped({ node: head.expression.expression });
  }
  if (!ts.isCallExpression(head) || head.expression.kind !== ts.SyntaxKind.ImportKeyword) {
    return undefined;
  }
  const [specifier] = head.arguments;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) {
    return undefined;
  }
  return specifier.text;
}

/**
 * What a `lazy({ load })` call loads: its `load:` loader written inline, or the same-file `const` its `load:`
 * NAMES — `load: loadDistilStatus` beside `const loadDistilStatus = () => import(…)` is how dozens of live
 * entries are written. The `load` read is the options' LAST one ({@link finalField}). A
 * name declared in another module resolves to nothing, and the verb is dropped.
 */
function loadedSpecifier({
  call,
  loaders,
}: {
  call: ts.CallExpression;
  loaders: ReadonlyMap<string, ts.Expression>;
}): string | undefined {
  const [argument] = call.arguments;
  // Every shape test here reads through `as`, `satisfies` and parentheses, which the runtime does.
  const options = argument === undefined ? undefined : unwrapped({ node: argument });
  if (call.arguments.length !== 1 || options === undefined || !ts.isObjectLiteralExpression(options)) {
    return undefined;
  }
  const load = finalField({ key: "load", object: options });
  if (load === undefined) {
    return undefined;
  }
  if (!ts.isIdentifier(load)) {
    return loaderSpecifier({ loader: load });
  }
  const declared = loaders.get(load.text);
  if (declared === undefined) {
    return undefined;
  }
  return loaderSpecifier({ loader: declared });
}

/**
 * The entry a node declares, when it is `<verb>: lazy(…)` loading `../commands/<dir>/<File>.js`.
 *
 * @param loaders the file's top-level `const`s, where a `load:` that names its loader finds it
 * @param lazyNames the local names the file imports the CLI's own `lazy` as; a call to any other function is no entry
 * @returns the entry, or `undefined` for any other member or loader shape
 */
export function lazyEntry({
  node,
  loaders,
  lazyNames,
}: {
  node: ts.Node;
  loaders: ReadonlyMap<string, ts.Expression>;
  lazyNames: ReadonlySet<string>;
}): ManifestEntry | undefined {
  if (!ts.isPropertyAssignment(node)) {
    return undefined;
  }
  const verb = keyText({ name: node.name });
  const call = unwrapped({ node: node.initializer });
  const isLazy = ts.isCallExpression(call) && ts.isIdentifier(call.expression) && lazyNames.has(call.expression.text);
  if (verb === undefined || !isLazy) {
    return undefined;
  }
  const specifier = loadedSpecifier({ call, loaders });
  if (specifier === undefined) {
    return undefined;
  }
  const match = /^\.\.\/commands\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_]+)\.js$/u.exec(specifier);
  if (match === null) {
    return undefined;
  }
  return { dir: match[1]!, file: match[2]!, verb };
}
