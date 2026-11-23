/**
 * Which members one command module imports from another, by name — the precise reader `./inProcessVerbPaths.ts`
 * follows imports with, split out at the file-size ratchet. A load whose members it cannot name is
 * `./inProcessOpaqueLoads.ts`'s, which errs IN.
 */
import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts } from "#lib/tsSyntax.js";

import { memberRead, unwrapped } from "./inProcessOpaqueLoads.js";

/** One imported binding, with the specifier it came from. */
export interface ImportedBinding {
  readonly specifier: string;
  readonly exported: string;
  readonly local: string;
  /** True when `local` names a namespace object, so a use is `local.exported` rather than `local` alone. */
  readonly namespace: boolean;
}

/** One binding per member a module reads off a namespace object, `local.member` or `local["member"]`. */
function namespaceBindings({
  local,
  source,
  specifier,
}: {
  local: string;
  source: ts.SourceFile;
  specifier: string;
}): readonly ImportedBinding[] {
  const members = new Set<string>();
  const visit: NodeVisitor = (node) => {
    const member = memberRead({ local, node });
    if (member !== null) {
      members.add(member);
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return [...members].map((exported) => ({ exported, local, namespace: true, specifier }));
}

/** The value bindings one static `import d, { … } from "…"` or `import * as ns from "…"` names. */
function staticBindings({
  node,
  source,
}: {
  node: ts.ImportDeclaration;
  source: ts.SourceFile;
}): readonly ImportedBinding[] {
  const clause = node.importClause;
  const typeOnly = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
  if (clause === undefined || typeOnly || !ts.isStringLiteral(node.moduleSpecifier)) {
    return [];
  }
  const specifier = node.moduleSpecifier.text;
  const defaulted: ImportedBinding[] =
    clause.name === undefined ? [] : [{ exported: "default", local: clause.name.text, namespace: false, specifier }];
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return defaulted;
  }
  if (ts.isNamespaceImport(bindings)) {
    return [...defaulted, ...namespaceBindings({ local: bindings.name.text, source, specifier })];
  }
  const named = bindings.elements
    .filter((each) => !each.isTypeOnly)
    .map((element) => ({
      exported: element.propertyName === undefined ? element.name.text : element.propertyName.text,
      local: element.name.text,
      namespace: false,
      specifier,
    }));
  return [...defaulted, ...named];
}

/** The specifier of an `await import("<literal>")`, wrappers looked through, or null for any other initializer. */
function awaitedImportSpecifier({ initializer }: { initializer: ts.Expression | undefined }): string | null {
  if (initializer === undefined) {
    return null;
  }
  const awaited = unwrapped({ node: initializer });
  if (!ts.isAwaitExpression(awaited)) {
    return null;
  }
  const call = unwrapped({ node: awaited.expression });
  if (!ts.isCallExpression(call)) {
    return null;
  }
  const argument = call.arguments[0];
  if (call.expression.kind !== ts.SyntaxKind.ImportKeyword || argument === undefined) {
    return null;
  }
  return isStringLiteralLikeNode(argument) ? argument.text : null;
}

/** The bindings one `const { a, b: c } = await import("…")` or `const mod = await import("…")` names. */
function awaitedBindings({
  node,
  source,
}: {
  node: ts.VariableDeclaration;
  source: ts.SourceFile;
}): readonly ImportedBinding[] {
  const specifier = awaitedImportSpecifier({ initializer: node.initializer });
  if (specifier === null) {
    return [];
  }
  if (ts.isIdentifier(node.name)) {
    return namespaceBindings({ local: node.name.text, source, specifier });
  }
  if (!ts.isObjectBindingPattern(node.name)) {
    return [];
  }
  return node.name.elements.flatMap((element) => {
    if (element.name === undefined || !ts.isIdentifier(element.name)) {
      return [];
    }
    const key = element.propertyName;
    // A quoted key (`{ "runTarget": invoke }`) names the export by its text, never its quoted source; a computed
    // key names one no syntax can read, which `./inProcessOpaqueLoads.ts` counts as reaching every body.
    if (key !== undefined && !ts.isIdentifier(key) && !ts.isStringLiteral(key)) {
      return [];
    }
    const exported = key === undefined ? element.name.text : key.text;
    return [{ exported, local: element.name.text, namespace: false, specifier }];
  });
}

/**
 * Every binding one module imports by name: static named, default and namespace imports, and `await import()`
 * held whole or destructured.
 *
 * @param source the importing module
 * @returns each binding, with the specifier it came from
 */
export function importsOf({ source }: { source: ts.SourceFile }): readonly ImportedBinding[] {
  const found: ImportedBinding[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isImportDeclaration(node)) {
      found.push(...staticBindings({ node, source }));
    }
    if (ts.isVariableDeclaration(node)) {
      found.push(...awaitedBindings({ node, source }));
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return found;
}
