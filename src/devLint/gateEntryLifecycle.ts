/**
 * The entry-lifecycle half of `gate-registration`: every `src/devLint/*.entry.ts` runs through `runGateEntry`
 * (`./gateEntry.ts`) and nothing else exits the process, so no gate can skip the TypeScript client close it owes
 * (`../lib/tsLifecycle.ts`). An entry that calls `process.exit` itself would leave that close unreached on every run,
 * and at the TypeScript 7.1 flip that is a Go server per gate left to notice its closed pipe.
 *
 * Judged on the syntax tree, never on text, so the words `process.exit` in a comment or a string are not a finding.
 */
import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "../lib/tsSyntax.js";

/** The module every entry imports the wrapper from, exactly as an entry beside it spells it. */
const GATE_ENTRY_MODULE = "./gateEntry.js";

/** The wrapper's exported name. */
const WRAPPER = "runGateEntry";

/** Whether a call is `runGateEntry(…)`. */
function callsWrapper({ call }: { call: ts.CallExpression }): boolean {
  return ts.isIdentifier(call.expression) && call.expression.text === WRAPPER;
}

/**
 * The `process` members an entry may read: what the live entries read, and nothing that ends the process or hands
 * `process` back. An allowlist, because a member list of exits never closes — `process.valueOf()` returns `process`
 * itself. Measured with `grep -ohE "process\.[A-Za-z_]+" src/devLint/*.entry.ts | sort -u`; widen it with a reason.
 */
const SAFE_MEMBERS: ReadonlySet<string> = new Set(["argv", "cwd", "env", "stderr", "stdout"]);

/** The names Node binds to the global object, each of which reaches `process` as a member. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["global", "globalThis"]);

/** The modules that export `process`, by default or by name. */
const PROCESS_MODULES: ReadonlySet<string> = new Set(["node:process", "process"]);

/**
 * Whether an identifier sits in a NAME slot — a member name, a property key, an import or export specifier —
 * rather than referring to a binding. `foo.process` and `{ process: 1 }` name nothing called `process`.
 */
function isNameSlot({ id }: { id: ts.Identifier }): boolean {
  const parent = id.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === id) ||
    (ts.isPropertyAssignment(parent) && parent.name === id) ||
    (ts.isBindingElement(parent) && parent.propertyName === id) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    (ts.isQualifiedName(parent) && parent.right === id)
  );
}

/**
 * Whether a string literal names the `process` module anywhere but a property key. A literal, not an import shape,
 * because every loader takes one: a static or dynamic `import`, `require`, a `createRequire` result,
 * `process.getBuiltinModule`. Listing loaders would never close, so the module's NAME is the site.
 */
function namesProcessModule({ node }: { node: ts.Node }): boolean {
  if (!isStringLiteralLikeNode(node) || !PROCESS_MODULES.has(node.text)) {
    return false;
  }
  const parent = node.parent;
  return !(ts.isPropertyAssignment(parent) && parent.name === node);
}

/**
 * Whether one node is a site that could end the process outside the wrapper.
 *
 * An ALLOWLIST rather than a list of exits, because an alias defeats any list: `const p = process` and
 * `import proc from "node:process"` each reach `exit` under another name. So an entry may touch `process` only as
 * `process.<member>` for a member in `SAFE_MEMBERS`, and every other reference is a site: any other member,
 * `process[…]`, `process` passed or bound as a value, `globalThis` or Node's `global` in any form, and any string
 * literal naming the `process` module, whatever loads it. Code built at run time (`eval`, `new Function`, a module name assembled from
 * pieces) is outside any syntax check, and this one does not claim it.
 */
function endsProcessDirectly({ node }: { node: ts.Node }): boolean {
  if (ts.isIdentifier(node) && !isNameSlot({ id: node })) {
    if (GLOBAL_OBJECTS.has(node.text)) {
      return true;
    }
    if (node.text === "process") {
      const parent = node.parent;
      const readsSafeMember =
        ts.isPropertyAccessExpression(parent) && parent.expression === node && SAFE_MEMBERS.has(parent.name.text);
      return !readsSafeMember;
    }
    return false;
  }
  return namesProcessModule({ node });
}

/**
 * Whether a wrapper call's sole argument is `{ run }` and nothing else, with `run` a name or a function. The argument
 * is evaluated BEFORE the wrapper runs, so a call in it (`{ run: build() }`) or a second property would be code
 * outside the wrapper.
 */
function passesRunObject({ call }: { call: ts.CallExpression }): boolean {
  const [argument, ...rest] = call.arguments;
  if (argument === undefined || rest.length > 0 || !ts.isObjectLiteralExpression(argument)) {
    return false;
  }
  const [property, ...others] = argument.properties;
  if (property === undefined || others.length > 0) {
    return false;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return ts.isIdentifier(property.name) && property.name.text === "run";
  }
  if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || property.name.text !== "run") {
    return false;
  }
  const value = property.initializer;
  return ts.isIdentifier(value) || ts.isArrowFunction(value) || ts.isFunctionExpression(value);
}

/**
 * How many times one entry imports `runGateEntry` by name from the wrapper module, as a VALUE and under its own name:
 * a type-only import is erased at run time, and `import { other as runGateEntry }` binds something else.
 */
function wrapperImportCount({ sourceFile }: { sourceFile: ts.SourceFile }): number {
  let count = 0;
  for (const statement of sourceFile.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    const fromWrapper =
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === GATE_ENTRY_MODULE;
    const typeOnlyClause =
      ts.isImportDeclaration(statement) && statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    if (fromWrapper && !typeOnlyClause && bindings !== undefined && ts.isNamedImports(bindings)) {
      count += bindings.elements.filter(
        (element) => element.name.text === WRAPPER && element.propertyName === undefined && !element.isTypeOnly,
      ).length;
    }
  }
  return count;
}

/** Whether one top-level statement is exactly `await runGateEntry({ run … })`. */
function isWrapperStatement({ statement }: { statement: ts.Statement }): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) {
    return false;
  }
  const awaited = statement.expression.expression;
  return ts.isCallExpression(awaited) && callsWrapper({ call: awaited }) && passesRunObject({ call: awaited });
}

/** How many top-level statements are exactly `await runGateEntry({ run … })`. */
function topLevelWrapperCount({ sourceFile }: { sourceFile: ts.SourceFile }): number {
  return sourceFile.statements.filter((statement) => isWrapperStatement({ statement })).length;
}

/**
 * How many top-level statements are neither an import nor the wrapper call. Code an entry runs at its own top level
 * runs outside the wrapper, so a `throw` there ends the process before any close; an entry's work belongs in `run`.
 */
function strayTopLevelCount({ sourceFile }: { sourceFile: ts.SourceFile }): number {
  return sourceFile.statements.filter(
    (statement) => !ts.isImportDeclaration(statement) && !isWrapperStatement({ statement }),
  ).length;
}

/**
 * Every lifecycle clause one gate entry breaks, each a line naming the entry and the clause.
 *
 * The clauses: it imports `runGateEntry` by name from `./gateEntry.js` exactly once; it calls `runGateEntry` exactly
 * once in the whole file, and that call is a top-level `await runGateEntry({ run })` whose sole argument is an object
 * literal naming `run`; its top level holds nothing but imports and that call (`strayTopLevelCount`); and it has no
 * site that could end the process outside the wrapper (`endsProcessDirectly`).
 *
 * @param path the entry's repo-relative path, carried into each finding
 * @param text the entry's source
 * @returns one line per broken clause, empty when the entry conforms
 */
export function entryLifecycleViolations({ path, text }: { path: string; text: string }): readonly string[] {
  return withSourceFile({
    fileName: path,
    text,
    use: (sourceFile) => {
      let wrapperCalls = 0;
      let endingSites = 0;
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node) && callsWrapper({ call: node })) {
          wrapperCalls += 1;
        }
        if (endsProcessDirectly({ node })) {
          endingSites += 1;
        }
        forEachChild({ node, visit });
        return undefined;
      };
      visit(sourceFile);
      const findings: string[] = [];
      if (wrapperImportCount({ sourceFile }) !== 1) {
        findings.push(`${path}: does not import ${WRAPPER} from ${GATE_ENTRY_MODULE} exactly once`);
      }
      if (wrapperCalls !== 1 || topLevelWrapperCount({ sourceFile }) !== 1) {
        findings.push(`${path}: is not exactly one top-level \`await ${WRAPPER}({ run })\``);
      }
      const stray = strayTopLevelCount({ sourceFile });
      if (stray > 0) {
        findings.push(`${path}: runs code at its top level outside the wrapper (${String(stray)} statement(s))`);
      }
      if (endingSites > 0) {
        findings.push(`${path}: could end the process outside the wrapper (${String(endingSites)} site(s))`);
      }
      return findings;
    },
  });
}
