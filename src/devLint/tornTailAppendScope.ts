/**
 * Whether a name at one point of a parsed source file still means the file's own `node:fs` binding, or an inner
 * declaration of the same name has shadowed it — for the torn-tail-append criterion (`./tornTailAppendShape.ts`).
 * Syntax only, so it reads lexical scope by walking up from the use: a parameter, a `const`/`let`/`var` (a `var`
 * hoisted to its whole function, from whatever block it is written in), a function,
 * class or enum declaration, a catch binding, a loop's own declaration, or a named function expression's own name.
 *
 * It exists because a block-local `appendFileSync` arrow that logs and never writes was flagged
 * when the first cut keyed every binding by its text alone. A declaration that is itself an fs alias the criterion
 * recorded is not a shadow: it is the binding, one scope in. The same question asked of an alias — does this name
 * still hold the fs function where it is called — is {@link holdsItsInitializer} and {@link copiedExport}.
 */

import {
  bindingElementsOf,
  forEachChild,
  isAssignmentOperator,
  isFunctionLikeDeclaration,
  type NodeVisitor,
  ts,
} from "#lib/tsSyntax.js";

/** Every plain name a binding declares — `a`, or each name inside `{ a, b: [c] }`. */
function namesBoundBy({ name }: { name: ts.BindingName }): readonly string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  const names: string[] = [];
  for (const element of bindingElementsOf({ pattern: name })) {
    names.push(...namesBoundBy({ name: element.name }));
  }
  return names;
}

/** The names a declaration list binds, leaving out a declaration the criterion recorded as an fs alias. */
function namesInList({
  list,
  aliases,
}: {
  list: ts.VariableDeclarationList;
  aliases: ReadonlySet<ts.Node>;
}): readonly string[] {
  return list.declarations
    .filter((declaration) => !aliases.has(declaration))
    .flatMap((declaration) => namesBoundBy({ name: declaration.name }));
}

/** The names one statement declares into the block it stands in. */
function namesDeclaredBy({
  statement,
  aliases,
}: {
  statement: ts.Statement;
  aliases: ReadonlySet<ts.Node>;
}): readonly string[] {
  if (ts.isVariableStatement(statement)) {
    return namesInList({ aliases, list: statement.declarationList });
  }
  const isNamedDeclaration =
    ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement);
  if (isNamedDeclaration && statement.name !== undefined) {
    return [statement.name.text];
  }
  return [];
}

/**
 * The statements a scope-opening node holds directly, or none when it holds no statement list. A `switch` is ONE scope
 * across every clause, so a declaration in one case shadows a use in another.
 */
function statementsOf({ scope }: { scope: ts.Node }): readonly ts.Statement[] {
  if (ts.isBlock(scope) || ts.isModuleBlock(scope)) {
    return scope.statements;
  }
  if (ts.isCaseBlock(scope)) {
    return scope.clauses.flatMap((clause) => [...clause.statements]);
  }
  return [];
}

/**
 * Every name a `var` binds anywhere inside `body` short of a nested function or static block — hoisted to the function
 * that holds it, so it shadows a use outside the block it is written in.
 */
function hoistedVarNames({ body, aliases }: { body: ts.Node; aliases: ReadonlySet<ts.Node> }): readonly string[] {
  const names: string[] = [];
  const visit: NodeVisitor = (node) => {
    if (isFunctionLikeDeclaration(node) || ts.isClassStaticBlockDeclaration(node)) {
      return;
    }
    const isVar = ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0;
    if (isVar) {
      names.push(...namesInList({ aliases, list: node }));
    }
    forEachChild({ node, visit });
  };
  forEachChild({ node: body, visit });
  return names;
}

/** Every name one node declares into the scope it opens — never the file's own top level, which is not walked. */
function namesDeclaredIn({ scope, aliases }: { scope: ts.Node; aliases: ReadonlySet<ts.Node> }): readonly string[] {
  const names: string[] = [];
  if (isFunctionLikeDeclaration(scope)) {
    for (const parameter of scope.parameters) {
      names.push(...namesBoundBy({ name: parameter.name }));
    }
  }
  const hoistsVars = isFunctionLikeDeclaration(scope) || ts.isClassStaticBlockDeclaration(scope);
  if (hoistsVars) {
    names.push(...hoistedVarNames({ aliases, body: scope }));
  }
  if ((ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name !== undefined) {
    names.push(scope.name.text);
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    names.push(...namesBoundBy({ name: scope.variableDeclaration.name }));
  }
  const isLoop = ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope);
  if (isLoop && scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer)) {
    names.push(...namesInList({ aliases, list: scope.initializer }));
  }
  for (const statement of statementsOf({ scope })) {
    names.push(...namesDeclaredBy({ aliases, statement }));
  }
  return names;
}

/**
 * The nearest scope enclosing `identifier` that declares its name — any declaration, a parameter, `let` or `var`
 * included — or the file itself when no inner scope does. A same-file `const` is the value of a use only when it was
 * declared in exactly this scope (an inner `const OPTIONS` can mask the top-level one a call read).
 *
 * @param identifier a use of a name
 * @returns the scope-opening node the name resolves in, or the source file
 */
export function declaringScopeOf({ identifier }: { identifier: ts.Identifier }): ts.Node {
  const none: ReadonlySet<ts.Node> = new Set();
  let node: ts.Node = identifier.parent;
  while (!ts.isSourceFile(node)) {
    if (namesDeclaredIn({ aliases: none, scope: node }).includes(identifier.text)) {
      return node;
    }
    node = node.parent;
  }
  return node;
}

/**
 * Every name the file ever assigns after its declaration — `x = …`, `x += …`, `x++` — by text, scope ignored. A `let`
 * alias whose name is in it may no longer hold the fs function by the time it is called, so it is not one (`let append = fs.appendFileSync; append = () => {}` is the case).
 *
 * @param sf the parsed file
 * @returns each name the file assigns or steps anywhere
 */
export function reassignedNames({ sf }: { sf: ts.SourceFile }): ReadonlySet<string> {
  const names = new Set<string>();
  const visit: NodeVisitor = (node) => {
    const isAssignment = ts.isBinaryExpression(node) && isAssignmentOperator({ kind: node.operatorToken.kind });
    if (isAssignment && ts.isIdentifier(node.left)) {
      names.add(node.left.text);
    }
    const isStep = ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node);
    if (isStep && ts.isIdentifier(node.operand)) {
      names.add(node.operand.text);
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return names;
}

/**
 * Whether a declaration may be read as an alias: a `const`, or a `let`/`var` whose name the file never reassigns.
 *
 * @param reassigned the names {@link reassignedNames} found
 * @returns true when the declaration still holds its initializer wherever its name is used
 */
export function holdsItsInitializer({
  declaration,
  reassigned,
}: {
  declaration: ts.VariableDeclaration;
  reassigned: ReadonlySet<string>;
}): boolean {
  const list = declaration.parent;
  if (ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0) {
    return true;
  }
  // Every name the pattern binds, at any depth: `let { promises: { appendFile: add } } = fs; add = …`.
  return namesBoundBy({ name: declaration.name }).every((name) => !reassigned.has(name));
}

/**
 * The fs export an initializer copies when it is a bare, unshadowed name already bound to one — `const add =
 * appendFileSync`.
 *
 * @param source the initializer, already unwrapped
 * @param named local name to every fs export it is bound to, as bound so far
 * @param aliases the declarations recorded as fs aliases
 * @returns the exports it copies, or `undefined` when it copies none
 */
export function copiedExport({
  source,
  named,
  aliases,
}: {
  source: ts.Expression;
  named: ReadonlyMap<string, ReadonlySet<string>>;
  aliases: ReadonlySet<ts.Node>;
}): ReadonlySet<string> | undefined {
  if (!ts.isIdentifier(source) || isShadowed({ aliases, identifier: source })) {
    return undefined;
  }
  return named.get(source.text);
}

/**
 * Whether an inner scope between `identifier` and the top of its file declares the same name, so the identifier
 * no longer means the file-level binding. A declaration in `aliases` is the fs binding one scope in, never a shadow.
 *
 * @param identifier a use of a name the file binds to the filesystem
 * @param aliases the declarations the criterion recorded as fs aliases
 * @returns true when an enclosing scope below the file's top level redeclares the name
 */
export function isShadowed({
  identifier,
  aliases,
}: {
  identifier: ts.Identifier;
  aliases: ReadonlySet<ts.Node>;
}): boolean {
  let node: ts.Node = identifier.parent;
  while (!ts.isSourceFile(node)) {
    if (namesDeclaredIn({ aliases, scope: node }).includes(identifier.text)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}
