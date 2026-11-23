/**
 * The sync-child-timeout gate's lexical scope walk: the nearest declaration of a name visible from a node, so an
 * inner binding that shadows an import is not mistaken for it. Split from `./syncChildTimeoutSyntax.ts`, which
 * asks it both which launcher a call reaches and what a `timeout` name is bound to.
 *
 * Source-local on purpose: it reads one file's syntax and never a checker, so an imported binding is reported
 * as an import and never followed.
 */
import { bindingElementsOf, isCaseOrDefaultClause, isFunctionLikeDeclaration, ts } from "#lib/tsSyntax.js";

/**
 * What the nearest declaration of a name is: an import (naming its module and what it imports — `*` for a
 * namespace, `default` for a default import), a `const` with its initializer, one element of a destructuring
 * `const` (`const { timeout } = …`), or anything else.
 */
export type Declaration =
  | { readonly kind: "import"; readonly module: string; readonly imported: string }
  | { readonly kind: "const"; readonly node: ts.VariableDeclaration }
  | { readonly kind: "destructured"; readonly node: ts.VariableDeclaration; readonly element: ts.BindingElement }
  | { readonly kind: "other" };

/** The binding element of a destructuring pattern that binds `text`, at any depth, or `undefined`. */
function bindingElementOf({ name, text }: { name: ts.BindingName; text: string }): ts.BindingElement | undefined {
  if (ts.isIdentifier(name)) {
    return undefined;
  }
  for (const element of bindingElementsOf({ pattern: name })) {
    const bindsHere = ts.isIdentifier(element.name) && element.name.text === text;
    if (bindsHere) {
      return element;
    }
    const inner = bindingElementOf({ name: element.name, text });
    if (inner !== undefined) {
      return inner;
    }
  }
  return undefined;
}

/** Whether a binding name (an identifier or a destructuring pattern) binds `text`. */
function bindsName({ name, text }: { name: ts.BindingName; text: string }): boolean {
  if (ts.isIdentifier(name)) {
    return name.text === text;
  }
  return bindingElementsOf({ pattern: name }).some((element) => bindsName({ name: element.name, text }));
}

/** The declaration one `import` statement makes of `text`, or `undefined` when it binds no such name. */
function importDeclares({
  statement,
  text,
}: {
  statement: ts.ImportDeclaration;
  text: string;
}): Declaration | undefined {
  const clause = statement.importClause;
  if (clause === undefined || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return undefined;
  }
  const module = statement.moduleSpecifier.text;
  if (clause.name?.text === text) {
    return { imported: "default", kind: "import", module };
  }
  const named = clause.namedBindings;
  if (named === undefined) {
    return undefined;
  }
  if (ts.isNamespaceImport(named)) {
    return named.name.text === text ? { imported: "*", kind: "import", module } : undefined;
  }
  const element = named.elements.find((candidate) => candidate.name.text === text);
  if (element === undefined) {
    return undefined;
  }
  const imported = element.propertyName === undefined ? element.name.text : element.propertyName.text;
  return { imported, kind: "import", module };
}

/** The declaration one statement in a statement list makes of `text`, or `undefined` when it makes none. */
function statementDeclares({ statement, text }: { statement: ts.Statement; text: string }): Declaration | undefined {
  if (ts.isImportDeclaration(statement)) {
    return importDeclares({ statement, text });
  }
  if (ts.isVariableStatement(statement)) {
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const declaration = statement.declarationList.declarations.find((candidate) =>
      bindsName({ name: candidate.name, text }),
    );
    if (declaration === undefined) {
      return undefined;
    }
    if (!isConst) {
      return { kind: "other" };
    }
    if (ts.isIdentifier(declaration.name)) {
      return { kind: "const", node: declaration };
    }
    const element = bindingElementOf({ name: declaration.name, text });
    return element === undefined ? { kind: "other" } : { element, kind: "destructured", node: declaration };
  }
  const named =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement);
  return named && statement.name?.text === text ? { kind: "other" } : undefined;
}

/** The statements a scope node holds directly, for the node kinds whose statements are a scope. */
function statementsOf({ node }: { node: ts.Node }): readonly ts.Statement[] | undefined {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || isCaseOrDefaultClause(node)) {
    return node.statements;
  }
  return undefined;
}

/** Whether a non-statement scope (a function's parameters, a loop or catch binding) binds `text`. */
function headerBinds({ node, text }: { node: ts.Node; text: string }): boolean {
  if (isFunctionLikeDeclaration(node)) {
    const ownName = ts.isFunctionExpression(node) && node.name?.text === text;
    return ownName || node.parameters.some((parameter) => bindsName({ name: parameter.name, text }));
  }
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const init = node.initializer;
    return (
      init !== undefined &&
      ts.isVariableDeclarationList(init) &&
      init.declarations.some((declaration) => bindsName({ name: declaration.name, text }))
    );
  }
  if (ts.isCatchClause(node)) {
    const binding = node.variableDeclaration;
    return binding !== undefined && bindsName({ name: binding.name, text });
  }
  return false;
}

/**
 * The nearest declaration of `text` visible from `from`, walking outward scope by scope. `var` hoisting is not
 * modelled: a `var` reads as declared in its own block, and this tree's lint already refuses `var`.
 *
 * @param text the name to resolve
 * @param from the node the name is read at
 * @returns the declaration, or `undefined` when nothing in the file declares it (a global)
 */
export function declarationOf({ text, from }: { text: string; from: ts.Node }): Declaration | undefined {
  let scope = from;
  while (!ts.isSourceFile(scope)) {
    scope = scope.parent;
    if (headerBinds({ node: scope, text })) {
      return { kind: "other" };
    }
    const statements = statementsOf({ node: scope });
    const declared = statements
      ?.map((statement) => statementDeclares({ statement, text }))
      .find((found) => found !== undefined);
    if (declared !== undefined) {
      return declared;
    }
  }
  return undefined;
}
