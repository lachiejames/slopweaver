/**
 * What one source file imports, declares and exports — the facts the taint walk in `./taint.ts` runs over.
 *
 * A dependency's blast radius is a question about VALUES, not files. `@acme/shared-utils`'s index
 * re-exports `email.ts`, which imports dompurify, so a file-level walk calls every importer of that index a
 * dompurify consumer — and the reviewer who asked for "where on the app" gets "everywhere" for a sanitiser
 * that one viewer uses. So this reads each file at the granularity of its top-level declarations: which
 * names each one references, which names the file exports and from where. That is what lets a barrel pass
 * through only the names that really lead to the dependency.
 *
 * Syntax only, on purpose: a type checker over a foreign monorepo needs its whole build configuration, and
 * the answer here is an over-approximation that says so rather than a proof. `import type` carries nothing,
 * because a type does not run.
 */
import {
  bindingElementsOf,
  forEachChild,
  hasModifier,
  isPropertySignatureDeclaration,
  isStringLiteralLikeNode,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";

/** One import binding: the local name a file uses, and which export of which module it stands for. */
interface ImportBinding {
  readonly local: string;
  readonly specifier: string;
  /** The export it binds — a name, `default`, or `*` for a namespace or `require`. */
  readonly imported: string;
}

/** One `export … from` — a name passed through from another module without a local binding. */
interface ReExport {
  readonly specifier: string;
  /** The name taken from the other module, or `*` for `export *` and `export * as ns`. */
  readonly imported: string;
  /** The name it is exported as here, or `*` for a bare `export *`. */
  readonly exported: string;
}

/** One top-level statement: the names it binds (none for a bare statement) and everything it references. */
interface TopLevel {
  readonly names: readonly string[];
  readonly refs: readonly string[];
  /** Specifiers it loads at run time — `import("x")` or `require("x")` inside its body. */
  readonly dynamicSpecifiers: readonly string[];
}

/** Everything the taint walk needs to know about one file. */
export interface ModuleFacts {
  readonly imports: readonly ImportBinding[];
  /** `import "x"` — loaded for its effect, binding nothing. */
  readonly sideEffectImports: readonly string[];
  readonly reExports: readonly ReExport[];
  /** A local binding exported under a name: `export const x`, `export { a as b }`, `export default …`. */
  readonly localExports: readonly { readonly local: string; readonly exported: string }[];
  readonly topLevels: readonly TopLevel[];
  /** The path of a TanStack file route this file declares, as its `createFileRoute("…")` literal spells it. */
  readonly routePath: string | undefined;
}

/** The local name `export default <expression>` binds, which no source identifier can collide with. */
export const DEFAULT_LOCAL = "*default*";

/** The calls that declare a TanStack file route and carry its path as their one string argument. */
const ROUTE_FACTORIES: ReadonlySet<string> = new Set(["createFileRoute", "createLazyFileRoute"]);

/** The calls that declare a TanStack ROOT route — the layout every page of the app renders inside. */
const ROOT_FACTORIES: ReadonlySet<string> = new Set(["createRootRoute", "createRootRouteWithContext"]);

/** The route path recorded for a root route, which no real path can spell. */
export const ROOT_ROUTE = "*root*";

/** Every identifier a binding pattern introduces — `const { a, b: [c] } = …` binds `a` and `c`. */
function boundNames({ name }: { name: ts.BindingName }): readonly string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  return bindingElementsOf({ pattern: name }).flatMap((element) => boundNames({ name: element.name }));
}

/**
 * Whether an identifier is a NAME rather than a reference: the `b` of `a.b`, a property key, a JSX
 * attribute. Matching those against a tainted local would call `props.sanitize` a use of an import called
 * `sanitize`.
 */
function isNameNotReference({ node }: { node: ts.Identifier }): boolean {
  const parent = node.parent;
  if (ts.isQualifiedName(parent)) {
    return parent.right === node;
  }
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.name === node;
  }
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    isPropertySignatureDeclaration(parent) ||
    ts.isJsxAttribute(parent)
  ) {
    return parent.name === node;
  }
  return false;
}

/** Whether an expression is `import.meta.url`. */
function isImportMetaUrl({ node }: { node: ts.Expression | undefined }): boolean {
  return (
    node !== undefined &&
    ts.isPropertyAccessExpression(node) &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === "url"
  );
}

/**
 * The module a node loads at run time: the string argument of `import("x")` or `require("x")`, or the
 * relative path of `new URL("./x", import.meta.url)` — how a bundler loads a worker — else `undefined`.
 */
function loadedSpecifier({ node }: { node: ts.Node }): string | undefined {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) {
    return undefined;
  }
  const first = node.arguments?.[0];
  if (first === undefined || !isStringLiteralLikeNode(first)) {
    return undefined;
  }
  if (ts.isNewExpression(node)) {
    const isUrl = ts.isIdentifier(node.expression) && node.expression.text === "URL";
    return isUrl && first.text.startsWith(".") && isImportMetaUrl({ node: node.arguments?.[1] })
      ? first.text
      : undefined;
  }
  const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  return isImport || isRequire ? first.text : undefined;
}

/** The route path a `createFileRoute("…")` call carries, or `undefined` when this call is not one. */
function routePathOf({ node }: { node: ts.CallExpression }): string | undefined {
  const callee = node.expression;
  const first = node.arguments[0];
  if (!ts.isIdentifier(callee)) {
    return undefined;
  }
  if (ROOT_FACTORIES.has(callee.text)) {
    return ROOT_ROUTE;
  }
  if (!ROUTE_FACTORIES.has(callee.text)) {
    return undefined;
  }
  return first !== undefined && isStringLiteralLikeNode(first) ? first.text : undefined;
}

/** What a subtree references and loads, skipping type positions, which carry no value. */
function scan({ root }: { root: ts.Node }): { refs: string[]; dynamicSpecifiers: string[]; routePath?: string } {
  const refs = new Set<string>();
  const dynamicSpecifiers: string[] = [];
  let routePath: string | undefined;
  const visit: NodeVisitor = (node) => {
    if (ts.isTypeNode(node)) {
      return;
    }
    if (ts.isIdentifier(node) && !isNameNotReference({ node })) {
      refs.add(node.text);
    }
    const loaded = loadedSpecifier({ node });
    if (loaded !== undefined) {
      dynamicSpecifiers.push(loaded);
    }
    const path = ts.isCallExpression(node) ? routePathOf({ node }) : undefined;
    if (path !== undefined) {
      routePath = path;
    }
    forEachChild({ node, visit });
  };
  visit(root);
  return { dynamicSpecifiers, refs: [...refs], ...(routePath === undefined ? {} : { routePath }) };
}

/** The name an import or export specifier takes from its module: `b` in `{ b as c }`, else its own name. */
function nameOf({ element }: { element: ts.ImportSpecifier | ts.ExportSpecifier }): string {
  return element.propertyName === undefined ? element.name.text : element.propertyName.text;
}

/** The bindings one import declaration introduces, value bindings only. */
function importBindings({ statement }: { statement: ts.ImportDeclaration }): readonly ImportBinding[] {
  const clause = statement.importClause;
  if (
    clause === undefined ||
    clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    !isStringLiteralLikeNode(statement.moduleSpecifier)
  ) {
    return [];
  }
  const specifier = statement.moduleSpecifier.text;
  const bindings: ImportBinding[] = [];
  if (clause.name !== undefined) {
    bindings.push({ imported: "default", local: clause.name.text, specifier });
  }
  const named = clause.namedBindings;
  if (named !== undefined && ts.isNamespaceImport(named)) {
    bindings.push({ imported: "*", local: named.name.text, specifier });
  }
  if (named !== undefined && ts.isNamedImports(named)) {
    for (const element of named.elements) {
      if (!element.isTypeOnly) {
        bindings.push({ imported: nameOf({ element }), local: element.name.text, specifier });
      }
    }
  }
  return bindings;
}

/** An `export { … }` or `export * … from` declaration, as re-exports or local exports. */
function exportDeclarationFacts({ statement }: { statement: ts.ExportDeclaration }): {
  reExports: readonly ReExport[];
  localExports: readonly { local: string; exported: string }[];
} {
  if (statement.isTypeOnly) {
    return { localExports: [], reExports: [] };
  }
  const from = statement.moduleSpecifier;
  const specifier = from !== undefined && isStringLiteralLikeNode(from) ? from.text : undefined;
  const clause = statement.exportClause;
  if (specifier !== undefined && clause === undefined) {
    return { localExports: [], reExports: [{ exported: "*", imported: "*", specifier }] };
  }
  if (specifier !== undefined && clause !== undefined && ts.isNamespaceExport(clause)) {
    return { localExports: [], reExports: [{ exported: clause.name.text, imported: "*", specifier }] };
  }
  if (clause === undefined || !ts.isNamedExports(clause)) {
    return { localExports: [], reExports: [] };
  }
  const elements = clause.elements.filter((element) => !element.isTypeOnly);
  const pairs = elements.map((element) => ({
    exported: element.name.text,
    local: nameOf({ element }),
  }));
  if (specifier === undefined) {
    return { localExports: pairs, reExports: [] };
  }
  return {
    localExports: [],
    reExports: pairs.map((pair) => ({ exported: pair.exported, imported: pair.local, specifier })),
  };
}

/** The names a declaration statement binds — none for a bare statement such as a call at module scope. */
function declaredNames({ statement }: { statement: ts.Statement }): readonly string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name === undefined ? [DEFAULT_LOCAL] : [statement.name.text];
  }
  if (ts.isEnumDeclaration(statement)) {
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) => boundNames({ name: declaration.name }));
  }
  return [];
}

/** Whether a statement declares only types, or is ambient — neither runs. */
function isTypeOnlyStatement({ statement }: { statement: ts.Statement }): boolean {
  return (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    hasModifier({ kind: ts.SyntaxKind.DeclareKeyword, node: statement })
  );
}

/** The facts one file accumulates, statement by statement. */
interface Accumulator {
  readonly imports: ImportBinding[];
  readonly sideEffectImports: string[];
  readonly reExports: ReExport[];
  readonly localExports: { local: string; exported: string }[];
  readonly topLevels: TopLevel[];
  routePath: string | undefined;
}

/** An `import … from` or `import x = require(…)`: its bindings, or the specifier it loads for effect. */
function addImport({
  statement,
  acc,
}: {
  statement: ts.ImportDeclaration | ts.ImportEqualsDeclaration;
  acc: Accumulator;
}): void {
  if (ts.isImportDeclaration(statement)) {
    acc.imports.push(...importBindings({ statement }));
    if (statement.importClause === undefined && isStringLiteralLikeNode(statement.moduleSpecifier)) {
      acc.sideEffectImports.push(statement.moduleSpecifier.text);
    }
    return;
  }
  const reference = statement.moduleReference;
  if (statement.isTypeOnly || !ts.isExternalModuleReference(reference)) {
    return;
  }
  if (isStringLiteralLikeNode(reference.expression)) {
    acc.imports.push({ imported: "*", local: statement.name.text, specifier: reference.expression.text });
  }
}

/** A statement that runs: what it binds and references, what it exports, and any route it declares. */
function addValueStatement({ statement, acc }: { statement: ts.Statement; acc: Accumulator }): void {
  const scanned = scan({ root: statement });
  if (scanned.routePath !== undefined) {
    acc.routePath = scanned.routePath;
  }
  if (ts.isExportAssignment(statement)) {
    acc.topLevels.push({ dynamicSpecifiers: scanned.dynamicSpecifiers, names: [DEFAULT_LOCAL], refs: scanned.refs });
    acc.localExports.push({ exported: "default", local: DEFAULT_LOCAL });
    return;
  }
  const names = declaredNames({ statement });
  acc.topLevels.push({ dynamicSpecifiers: scanned.dynamicSpecifiers, names, refs: scanned.refs });
  if (!hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: statement })) {
    return;
  }
  const isDefault = hasModifier({ kind: ts.SyntaxKind.DefaultKeyword, node: statement });
  acc.localExports.push(...names.map((name) => ({ exported: isDefault ? "default" : name, local: name })));
}

/**
 * Read one file's import, export and declaration facts.
 *
 * @param path the file's path, which only picks the parser's script kind (`.tsx` reads JSX)
 * @param text the file's text
 * @returns what the file imports, declares, exports and whether it declares a file route
 */
export function moduleFactsOf({ path, text }: { path: string; text: string }): ModuleFacts {
  const kind = /\.[cm]?[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return withSourceFile({
    fileName: path,
    text,
    scriptKind: kind,
    use: (source): ModuleFacts => {
      const acc: Accumulator = {
        imports: [],
        localExports: [],
        reExports: [],
        routePath: undefined,
        sideEffectImports: [],
        topLevels: [],
      };
      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
          addImport({ acc, statement });
        } else if (ts.isExportDeclaration(statement)) {
          const facts = exportDeclarationFacts({ statement });
          acc.reExports.push(...facts.reExports);
          acc.localExports.push(...facts.localExports);
        } else if (!isTypeOnlyStatement({ statement })) {
          addValueStatement({ acc, statement });
        }
      }
      return { ...acc };
    },
  });
}
