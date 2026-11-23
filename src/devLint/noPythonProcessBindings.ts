/**
 * The process-binding half of the no-python gate: which local names in a TypeScript file are `child_process`
 * or `execa` launchers, and how a call to one reads its first argument. Syntax only — direct import aliases
 * are followed, reassignment and local wrappers deliberately are not. `noPythonTypeScript.ts` walks a file's calls
 * against what this module reports.
 */

import { forEachChild, isParameterDeclaration, type NodeVisitor, ts } from "#lib/tsSyntax.js";

/** `child_process` functions whose first argument is the PROGRAM. */
const PROGRAM_FUNCTIONS: ReadonlySet<string> = new Set(["execFile", "execFileSync", "fork", "spawn", "spawnSync"]);

/** `child_process` functions whose first argument is a SHELL command. */
const SHELL_FUNCTIONS: ReadonlySet<string> = new Set(["exec", "execSync"]);

/** `execa` exports whose first argument is the program, and those taking a whole command string. */
const EXECA_PROGRAM_FUNCTIONS: ReadonlySet<string> = new Set(["execa", "execaSync", "execaNode"]);
const EXECA_COMMAND_FUNCTIONS: ReadonlySet<string> = new Set(["execaCommand", "execaCommandSync"]);

/** How a call's first argument is read: as a program word or as a shell command line. */
export type ArgumentReading = "program" | "shell";

/** A file's process bindings: a local name that is a process function, and a local namespace for a module. */
export interface ProcessBindings {
  readonly functions: ReadonlyMap<string, ArgumentReading>;
  readonly namespaces: ReadonlyMap<string, "child_process" | "execa">;
}

/**
 * How a named export of a process module reads its first argument, or `undefined` when it is not a launcher.
 *
 * @param module which module the name came from
 * @param name the exported name
 * @returns the reading, or `undefined`
 */
function readingOf({ module, name }: { module: "child_process" | "execa"; name: string }): ArgumentReading | undefined {
  if (module === "child_process") {
    if (PROGRAM_FUNCTIONS.has(name)) {
      return "program";
    }
    return SHELL_FUNCTIONS.has(name) ? "shell" : undefined;
  }
  if (EXECA_PROGRAM_FUNCTIONS.has(name)) {
    return "program";
  }
  return EXECA_COMMAND_FUNCTIONS.has(name) ? "shell" : undefined;
}

/**
 * Which module an import specifier names, when it is one this gate reads.
 *
 * @param specifier the import's module text
 * @returns the module, or `undefined`
 */
function processModuleOf({ specifier }: { specifier: string }): "child_process" | "execa" | undefined {
  if (specifier === "node:child_process" || specifier === "child_process") {
    return "child_process";
  }
  return specifier === "execa" ? "execa" : undefined;
}

/**
 * Collect a file's process bindings from its import declarations — syntax only, direct aliases followed,
 * reassignment and local wrappers deliberately not.
 *
 * @param sourceFile the parsed file
 * @returns its launcher functions and module namespaces
 */
export function processBindingsOf({ sourceFile }: { sourceFile: ts.SourceFile }): ProcessBindings {
  const functions = new Map<string, ArgumentReading>();
  const namespaces = new Map<string, "child_process" | "execa">();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      bindImport({ functions, namespaces, statement });
    }
  }
  // A name redeclared anywhere in the file (a parameter, a local) may SHADOW the import at the call the walk
  // reaches, and a syntax-only scan cannot tell which. Dropping the binding trades a false refusal of valid
  // code for a rare miss — the safe direction for a gate, and the shape a Codex review broke this on.
  for (const name of redeclaredNames({ sourceFile })) {
    functions.delete(name);
    namespaces.delete(name);
  }
  return { functions, namespaces };
}

/**
 * Every name the file binds again outside its imports — a parameter, variable, function or class.
 *
 * @param sourceFile the parsed file
 * @returns each redeclared identifier name
 */
function redeclaredNames({ sourceFile }: { sourceFile: ts.SourceFile }): ReadonlySet<string> {
  const names = new Set<string>();
  const visit: NodeVisitor = (node) => {
    const declares =
      isParameterDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      // A named function EXPRESSION binds its own name inside itself, and shadows an import the same way.
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      // A destructured parameter or local (`function f({ run })`) shadows exactly as a named one does.
      ts.isBindingElement(node);
    if (declares && node.name !== undefined && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
    forEachChild({ node, visit });
  };
  forEachChild({ node: sourceFile, visit });
  return names;
}

/**
 * Record what one import declaration binds, when it imports a process module.
 *
 * @param statement the import declaration
 * @param functions the launcher functions found so far, added to in place
 * @param namespaces the module namespaces found so far, added to in place
 */
function bindImport({
  statement,
  functions,
  namespaces,
}: {
  statement: ts.ImportDeclaration;
  functions: Map<string, ArgumentReading>;
  namespaces: Map<string, "child_process" | "execa">;
}): void {
  const specifier = statement.moduleSpecifier;
  const module = ts.isStringLiteral(specifier) ? processModuleOf({ specifier: specifier.text }) : undefined;
  const clause = statement.importClause;
  if (module === undefined || clause === undefined) {
    return;
  }
  if (clause.name !== undefined && module === "execa") {
    functions.set(clause.name.text, "program");
  }
  if (clause.name !== undefined && module === "child_process") {
    namespaces.set(clause.name.text, module);
  }
  const bindings = clause.namedBindings;
  if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
    namespaces.set(bindings.name.text, module);
    return;
  }
  // A default-only import carries no named bindings at all, so there is nothing to walk; a specifier carries a
  // `propertyName` only when it renames (`import { spawn as run }`), and otherwise its name IS the export's.
  bindings?.elements.forEach(({ propertyName, name }) => {
    const reading = readingOf({ module, name: propertyName === undefined ? name.text : propertyName.text });
    if (reading !== undefined) {
      functions.set(name.text, reading);
    }
  });
}

/**
 * How a call reads its first argument, when its callee is a process binding.
 *
 * @param call the call expression
 * @param bindings the file's process bindings
 * @returns the reading, or `undefined` when the callee launches nothing this gate knows
 */
export function callReading({
  call,
  bindings,
}: {
  call: ts.CallExpression;
  bindings: ProcessBindings;
}): ArgumentReading | undefined {
  // A parenthesised callee reaches the same binding as a bare one, so the parentheses come off first.
  let callee: ts.Expression = call.expression;
  while (ts.isParenthesizedExpression(callee)) {
    callee = callee.expression;
  }
  if (ts.isIdentifier(callee)) {
    return bindings.functions.get(callee.text);
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const module = bindings.namespaces.get(callee.expression.text);
    return module === undefined ? undefined : readingOf({ module, name: callee.name.text });
  }
  return undefined;
}
