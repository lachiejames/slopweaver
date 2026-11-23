/**
 * The syntax-tree reads behind the `boundary-schema` gate (`./boundarySchema.ts`): whether a file calls a fetch,
 * whether it reads a body as JSON, which `.parseJson` member access is the boundary's own licensed read, and
 * whether it really CALLS `defineBoundary`. The criterion, its narrowing and its stated residue live in that
 * gate's header; this module is only how each half is read off the parser rather than off the raw text.
 */
import { posix } from "node:path";

import {
  forEachChild,
  isAssignmentOperator,
  isClassLikeDeclaration,
  isParameterDeclaration,
  isTypeAssertion,
  type LentAnswer,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";

/**
 * One source parsed once, so every read below walks the same tree. The tree lives only for the duration of `use`,
 * which must answer plain data.
 *
 * @param use reads the file's syntax tree, parent pointers set, and answers plain data
 * @returns whatever `use` answered
 */
export function withParsedSource<R>({
  content,
  use,
}: {
  content: string;
  use: (source: ts.SourceFile) => LentAnswer<R>;
}): LentAnswer<R> {
  return withSourceFile({ fileName: "scan.ts", text: content, use });
}

/** Whether any node under `root` passes `test`, stopping at the first. */
function anyNode({ root, test }: { root: ts.Node; test: (node: ts.Node) => boolean }): boolean {
  const visit: NodeVisitor<boolean> = (node) => test(node) || forEachChild({ node, visit }) === true;
  return visit(root) === true;
}

/**
 * Whether a node only wraps the same value: parentheses, `!`, `as`, `<T>x`, `satisfies`, or an instantiation
 * `parseJson<Payload>`.
 */
function wrapsSameValue(node: ts.Expression): node is ts.Expression & { expression: ts.Expression } {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    isTypeAssertion(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isExpressionWithTypeArguments(node)
  );
}

/**
 * An expression with every same-value wrapper peeled off, so `(transport!)` and `request!` read as their names. A
 * comma expression is its right operand, which is the indirect-call idiom `(0, fetch)(url)`.
 */
function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  let bare = node;
  for (;;) {
    if (wrapsSameValue(bare)) {
      bare = bare.expression;
    } else if (ts.isBinaryExpression(bare) && bare.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      bare = bare.right;
    } else {
      return bare;
    }
  }
}

/**
 * The name a call's callee ends in and the receiver before it, wrappers peeled (`request!(`;
 * `(fetch)(`): a bare identifier has no receiver, a member access (optional-chained or not) has its object. A
 * computed member is stated residue.
 */
function calleeOf({
  call,
}: {
  call: ts.CallExpression;
}): { name: string; receiver: ts.Expression | undefined } | undefined {
  const callee = unwrapped({ node: call.expression });
  if (ts.isIdentifier(callee)) {
    return { name: callee.text, receiver: undefined };
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return { name: callee.name.text, receiver: callee.expression };
  }
  return undefined;
}

/**
 * The name a receiver ends in — `transport`, `this.transport`, `deps.transport!`, `(transport as T)`
 * — or undefined for any other shape.
 */
function receiverName({ receiver }: { receiver: ts.Expression }): string | undefined {
  const bare = unwrapped({ node: receiver });
  if (ts.isIdentifier(bare)) {
    return bare.text;
  }
  if (ts.isPropertyAccessExpression(bare)) {
    return bare.name.text;
  }
  return undefined;
}

/**
 * Whether a name is the pattern's word or ends in it after a non-word character — each pattern below is anchored
 * `(?:^|\W)…$`, so `$parseJson` counts and `myParseJson` does not. That is exactly what the lexical `\b` this tree
 * replaced matched, so no file the old gate caught slips past (a free parser whose name merely ends
 * in parseJson still fires).
 */
function namedAs({ name, word }: { name: string | undefined; word: RegExp }): boolean {
  return name !== undefined && word.test(name);
}

/** The Datadog raw-text transport's two reads, which ARE a fetch with the HTTP machinery one file away. */
const RAW_TEXT_READ = /(?:^|\W)requestRawText(?:WithStatus)?$/;
const FETCH_NAME = /(?:^|\W)fetch$/;
const GLOBAL_THIS = /(?:^|\W)globalThis$/;
const TRANSPORT = /(?:^|\W)transport$/;
const PARSE_JSON = /(?:^|\W)parseJson$/;
const JSON_NAMESPACE = /(?:^|\W)JSON$/;

/**
 * A MEMBER name main's look-behind `(?<![.\w])` still counted, because the character before the word was neither
 * a dot nor a word character: `client.$fetch(`, `parser.$parseJson(`. A plain `.fetch(` stays out.
 */
const PREFIXED_FETCH = /\Wfetch$/;
const PREFIXED_PARSE_JSON = /\WparseJson$/;

/** Whether one call is a fetch: bare `fetch(`, `globalThis.fetch(`, a raw-text read, or a bound `transport.request(`. */
function isFetchCall({ call }: { call: ts.CallExpression }): boolean {
  const callee = calleeOf({ call });
  if (callee === undefined) {
    return false;
  }
  if (namedAs({ name: callee.name, word: RAW_TEXT_READ }) || namedAs({ name: callee.name, word: PREFIXED_FETCH })) {
    return true;
  }
  if (callee.receiver === undefined) {
    return namedAs({ name: callee.name, word: FETCH_NAME });
  }
  const receiver = receiverName({ receiver: callee.receiver });
  const globalFetch = callee.name === "fetch" && namedAs({ name: receiver, word: GLOBAL_THIS });
  return globalFetch || (callee.name === "request" && namedAs({ name: receiver, word: TRANSPORT }));
}

/** The parse helpers counted wherever they are called from, bare or as a member. */
const JSON_HELPER = /(?:^|\W)(?:parseJsonObject|safeJsonParse)$/;

/** Whether one call reads a body as JSON: `.json()`, `JSON.parse(`, a parse helper, or a FREE `parseJson(`. */
function isJsonReadCall({ call }: { call: ts.CallExpression }): boolean {
  const callee = calleeOf({ call });
  if (callee === undefined) {
    return false;
  }
  if (namedAs({ name: callee.name, word: JSON_HELPER }) || namedAs({ name: callee.name, word: PREFIXED_PARSE_JSON })) {
    return true;
  }
  if (callee.receiver === undefined) {
    return namedAs({ name: callee.name, word: PARSE_JSON });
  }
  if (callee.name === "json") {
    return call.arguments.length === 0;
  }
  return (
    callee.name === "parse" && namedAs({ name: receiverName({ receiver: callee.receiver }), word: JSON_NAMESPACE })
  );
}

/** Whether one statement imports the parse helpers' modules as a namespace, which reaches them under any name. */
function importsParseHelpersAsNamespace({ statement }: { statement: ts.Statement }): boolean {
  const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
  return (
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    /jsonParse|safeJson/.test(statement.moduleSpecifier.text) &&
    bindings !== undefined &&
    ts.isNamespaceImport(bindings)
  );
}

/**
 * Whether the file really calls a fetch. A call is a call however it is spelled around its name — broken across
 * lines, a comment inside it, optional-chained, handed type arguments — and a mention in a comment or string is
 * not one (the Vanta conversion's counterexamples).
 *
 * @returns true when any CallExpression is a bare or `globalThis` fetch, a raw-text read, or `transport.request`
 */
export function callsFetch({ source }: { source: ts.SourceFile }): boolean {
  return anyNode({ root: source, test: (node) => ts.isCallExpression(node) && isFetchCall({ call: node }) });
}

/**
 * Whether the file reads a body as JSON through a call the criterion lists, or imports the parse helpers as a
 * namespace. The licensed member `.parseJson` is NOT this read; {@link unlicensedMemberParse} judges it.
 *
 * @returns true when any call is `.json()`, `JSON.parse`, a parse helper or a free `parseJson`, typed or not
 */
export function readsJsonByCall({ source }: { source: ts.SourceFile }): boolean {
  return (
    source.statements.some((statement) => importsParseHelpersAsNamespace({ statement })) ||
    anyNode({ root: source, test: (node) => ts.isCallExpression(node) && isJsonReadCall({ call: node }) })
  );
}

/**
 * The one boundary module, as a repo-relative path. An import is trusted only when its specifier RESOLVES here —
 * a module elsewhere that happens to be named `boundary.js` exports whatever it likes.
 */
const BOUNDARY_MODULE = "src/lib/boundary.js";

/**
 * Where one import specifier points, repo-relative: `#lib/…` is the subpath root `src/lib/`, a relative specifier
 * resolves against the importing file, and a package specifier resolves to nothing this gate trusts.
 */
function resolvedSpecifier({ path, specifier }: { path: string; specifier: string }): string | undefined {
  if (specifier.startsWith("#lib/")) {
    return posix.join("src/lib", specifier.slice("#lib/".length));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return posix.join(posix.dirname(path), specifier);
  }
  return undefined;
}

/** The local names one statement imports the boundary module's `Boundary` under, aliases included. */
function boundaryImportsOf({ statement, path }: { statement: ts.Statement; path: string }): readonly string[] {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return [];
  }
  const bindings = statement.importClause?.namedBindings;
  const fromBoundary = resolvedSpecifier({ path, specifier: statement.moduleSpecifier.text }) === BOUNDARY_MODULE;
  if (!fromBoundary || bindings === undefined || !ts.isNamedImports(bindings)) {
    return [];
  }
  return bindings.elements
    .filter(
      (element) => (element.propertyName === undefined ? element.name.text : element.propertyName.text) === "Boundary",
    )
    .map((element) => element.name.text);
}

/**
 * The local names this file imports the boundary module's `Boundary` type under, aliases included — and none at
 * all when the file declares a type, interface, class, enum or type parameter of one of those names anywhere,
 * because a reference could then mean the local one.
 */
function importedBoundaryNames({ source, path }: { source: ts.SourceFile; path: string }): ReadonlySet<string> {
  const names = new Set(source.statements.flatMap((statement) => boundaryImportsOf({ path, statement })));
  const redeclares: NodeVisitor<boolean> = (node) => {
    const named =
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      isClassLikeDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isTypeParameterDeclaration(node);
    if (named && node.name !== undefined && names.has(node.name.text)) {
      return true;
    }
    return forEachChild({ node, visit: redeclares }) === true;
  };
  return redeclares(source) === true ? new Set() : names;
}

/**
 * The declaration an identifier BINDS a value name through — a variable, a parameter, a destructured element, a
 * function, class, enum or namespace name, an import — or undefined when the identifier is not in a binding position.
 * A property key, an interface member and a reference are not bindings.
 */
function bindingOf({ identifier }: { identifier: ts.Identifier }): ts.Node | undefined {
  const parent = identifier.parent;
  const binds =
    ts.isVariableDeclaration(parent) ||
    isParameterDeclaration(parent) ||
    ts.isBindingElement(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isModuleDeclaration(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportSpecifier(parent);
  return binds && parent.name === identifier ? parent : undefined;
}

/** Every binding declaration in the file, grouped by the name it binds, in every scope at once. */
function bindingsByName({ source }: { source: ts.SourceFile }): ReadonlyMap<string, readonly ts.Node[]> {
  const byName = new Map<string, ts.Node[]>();
  const visit: NodeVisitor = (node) => {
    const declaration = ts.isIdentifier(node) ? bindingOf({ identifier: node }) : undefined;
    const seen = ts.isIdentifier(node) ? byName.get(node.text) : undefined;
    if (declaration !== undefined && seen !== undefined) {
      seen.push(declaration);
    } else if (declaration !== undefined && ts.isIdentifier(node)) {
      byName.set(node.text, [declaration]);
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return byName;
}

/**
 * Every name that appears anywhere on the target side of an assignment after its declaration — `=`, a compound
 * assignment, a destructuring assignment at any depth, or a `for…of`/`for…in` head that is an expression rather than
 * a declaration. Over-approximate on purpose: `obj.boundary = x` withdraws `boundary`'s licence too, which fails closed.
 */
function assignedNames({ source }: { source: ts.SourceFile }): ReadonlySet<string> {
  const names = new Set<string>();
  const collect: NodeVisitor = (node) => {
    if (ts.isIdentifier(node)) {
      names.add(node.text);
    }
    forEachChild({ node, visit: collect });
  };
  const visit: NodeVisitor = (node) => {
    const assigns = ts.isBinaryExpression(node) && isAssignmentOperator({ kind: node.operatorToken.kind });
    if (assigns) {
      collect(node.left);
    }
    const loopTarget =
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer);
    if (loopTarget) {
      collect(node.initializer);
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return names;
}

/**
 * Whether any `.parseJson` member access — called, constructed or aliased — is NOT the boundary's own strict read.
 * One is licensed only when its
 * receiver is a bare identifier and EVERY declaration of that name anywhere in the file — whatever scope it sits in —
 * is a parameter or a `const`, named plainly and annotated with the imported `Boundary` type itself, and nothing in
 * the file assigns to that name. So no scoping rule has to be modelled: any other binding of the name, in any scope,
 * withdraws the licence. Anything else — an index or call receiver, an undeclared name — is unlicensed.
 *
 * @param path the file's repo-relative path, which a relative import of the boundary module resolves against
 * @returns true when at least one `.parseJson` access is not the licensed boundary read
 */
export function unlicensedMemberParse({ source, path }: { source: ts.SourceFile; path: string }): boolean {
  if (!source.text.includes("parseJson")) {
    return false;
  }
  const boundaryNames = importedBoundaryNames({ path, source });
  const reassigned = assignedNames({ source });
  const bindings = bindingsByName({ source });
  const annotatedBoundary = ({
    declaration,
  }: {
    declaration: ts.ParameterDeclaration | ts.VariableDeclaration;
  }): boolean => {
    const type = declaration.type;
    return (
      ts.isIdentifier(declaration.name) &&
      type !== undefined &&
      ts.isTypeReferenceNode(type) &&
      ts.isIdentifier(type.typeName) &&
      boundaryNames.has(type.typeName.text)
    );
  };
  const licensed = ({ receiver }: { receiver: ts.Expression }): boolean => {
    if (!ts.isIdentifier(receiver) || reassigned.has(receiver.text)) {
      return false;
    }
    const declarations = bindings.get(receiver.text);
    if (declarations === undefined) {
      return false;
    }
    return declarations.every((declaration) => {
      if (isParameterDeclaration(declaration)) {
        return annotatedBoundary({ declaration });
      }
      if (ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0) {
        return annotatedBoundary({ declaration });
      }
      return false;
    });
  };
  // Every `.parseJson` member ACCESS, not only a call: `new parser.parseJson(…)` and
  // `const read = parser.parseJson` reach the same parser without a CallExpression around it.
  const visit: NodeVisitor<boolean> = (node) => {
    const memberParse = ts.isPropertyAccessExpression(node) && node.name.text === "parseJson";
    if (memberParse && !licensed({ receiver: node.expression })) {
      return true;
    }
    return forEachChild({ node, visit }) === true;
  };
  return visit(source) === true;
}

/**
 * Whether the file really CALLS `defineBoundary` — the call that satisfies the rule — read off the syntax tree,
 * bare or as a namespace member. Never lexical: a trailing `// TODO: defineBoundary(…)` beside an unvalidated
 * read, or the spelling inside a string, is not a declaration (counterexamples from the Vanta conversion).
 *
 * @returns true when a CallExpression's callee is `defineBoundary` or a member access named so
 */
export function declaresBoundary({ source }: { source: ts.SourceFile }): boolean {
  if (!source.text.includes("defineBoundary")) {
    return false;
  }
  return anyNode({
    root: source,
    test: (node) => ts.isCallExpression(node) && calleeOf({ call: node })?.name === "defineBoundary",
  });
}
