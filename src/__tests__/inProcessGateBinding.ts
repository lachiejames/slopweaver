/**
 * Whether the `refuseRunnerOnStandingRuling` a verb module calls IS the ruling gate — the half of
 * `./inProcessVerbPaths.ts` that stops a module-local fake of the same name passing for it.
 *
 * `./inProcessVerbBodies.ts` reads a body's opening statements by NAME, so the name has to mean the real helper
 * everywhere in the module: it is bound exactly once, by a value import of that same export from `src/cli/rulingGateDoor.ts`
 * (a redundant `refuseRunnerOnStandingRuling as refuseRunnerOnStandingRuling` binds the identical function),
 * and `undefined`, which the obeying check compares against, is bound nowhere. Any other binding of either name
 * anywhere in the module — a top-level or nested declaration, a hoisted function, a parameter, a catch variable, a
 * class, an enum, a second or aliased import — leaves no body of that module gated. That errs IN: a module that
 * merely declares such a name, with no fake behind it, reads as ungated, the safe direction for a guard.
 */

import { dirname, resolve } from "node:path";
import { forEachChild, isParameterDeclaration, type NodeVisitor, ts } from "#lib/tsSyntax.js";

/** The helper every in-process-reachable verb body opens with. */
const GATE = "refuseRunnerOnStandingRuling";

/** Whether an identifier is the name a value declaration, a parameter or an import binds. */
function isBinding({ node }: { node: ts.Identifier }): boolean {
  const parent = node.parent;
  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent)) {
    return parent.name === node;
  }
  const declares =
    ts.isVariableDeclaration(parent) ||
    isParameterDeclaration(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isModuleDeclaration(parent);
  return declares && parent.name === node;
}

/** Whether a binding of the gate's name is a value import of the gate's own export, from the gate's own module. */
function isGateImport({
  node,
  gateModule,
  importer,
}: {
  node: ts.Identifier;
  gateModule: string;
  importer: string;
}): boolean {
  const specifier = node.parent;
  if (!ts.isImportSpecifier(specifier) || specifier.isTypeOnly) {
    return false;
  }
  if (specifier.propertyName !== undefined && specifier.propertyName.text !== GATE) {
    return false;
  }
  // The specifier's parent is its `{ … }` list, whose parent is the clause. A JSDoc `@import` tag holds a clause
  // too, and binds only a type, so a clause outside an import declaration is not the gate.
  const clause = specifier.parent.parent;
  const declaration = clause.parent;
  if (!ts.isImportClause(clause) || !ts.isImportDeclaration(declaration)) {
    return false;
  }
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword || !ts.isStringLiteral(declaration.moduleSpecifier)) {
    return false;
  }
  return resolve(dirname(importer), declaration.moduleSpecifier.text.replace(/\.js$/u, ".ts")) === gateModule;
}

/**
 * Whether one verb module's `refuseRunnerOnStandingRuling` and `undefined` are the real gate and the real
 * `undefined` throughout it: the gate bound once, by its import, and neither name bound any other way.
 *
 * @param commandsRoot the absolute `src/cli/commands` directory, whose parent holds `rulingGateDoor.ts`
 * @param importer the verb module's absolute path, the specifier is resolved against
 * @param source the verb module
 * @returns whether a gate call the module's bodies open with can be read as the ruling gate
 */
export function gateBoundByImport({
  commandsRoot,
  importer,
  source,
}: {
  commandsRoot: string;
  importer: string;
  source: ts.SourceFile;
}): boolean {
  const gateModule = resolve(commandsRoot, "..", "rulingGateDoor.ts");
  // One entry per binding of either name: whether it is the gate's own import.
  const bindings: boolean[] = [];
  const visit: NodeVisitor = (node) => {
    const named = ts.isIdentifier(node) && (node.text === GATE || node.text === "undefined");
    if (named && isBinding({ node })) {
      bindings.push(node.text === GATE && isGateImport({ gateModule, importer, node }));
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return bindings.length === 1 && bindings[0] === true;
}
