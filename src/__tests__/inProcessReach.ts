/**
 * Which of one verb module's own functions its `defineCommand(…)` call REACHES — the half of
 * `./inProcessVerbBodies.ts` that follows names inside a module, split out at the file-size ratchet. It errs IN on
 * reach, as the exit-code test does on types: every identifier named anywhere counts, and a name is followed through
 * every value that flows into it. Reaching every function of a verb module outright was measured and rejected: it
 * adds 18 paths into 18 helpers no runner reaches (repro: seed `verbBodies`' queue with
 * `...functions.keys()` and count `scanInProcessPaths` over the tree `unit/cli/inProcessRulingGate.test.ts` reads).
 */
import {
  bindingElementsOf,
  forEachChild,
  isAssignmentOperator,
  isParameterDeclaration,
  type NodeVisitor,
  ts,
} from "#lib/tsSyntax.js";

import { unwrapped } from "./inProcessOpaqueLoads.js";
import type { DeclaredFunction } from "./inProcessVerbBodies.js";

/**
 * Every identifier a node references, in source order — a call, a call nested in another call's argument
 * (`identity(runTarget(argv))`), a name handed on (`retry(runTarget)`), held (`const go = runTarget`) or placed in an
 * object. Review found each narrower reader (calls only, then calls and bare arguments) missing a
 * spelling, and a name that is not one of the module's own functions or values reaches nothing. A deps factory
 * reached this way (`productionSlackWriteDeps()`) takes no words and answers no exit code, so the verb-body test
 * drops it.
 */
function referencedNames({ node }: { node: ts.Node }): readonly string[] {
  const names: string[] = [];
  const visit: NodeVisitor = (child) => {
    if (ts.isIdentifier(child)) {
      names.push(child.text);
    }
    forEachChild({ node: child, visit });
  };
  visit(node);
  return names;
}

/** The node as a `defineCommand(…)` call, or null when it is not one. */
function defineCommandCall({ node }: { node: ts.Node }): ts.CallExpression | null {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineCommand") {
    return node;
  }
  return null;
}

/**
 * Every name the module's `defineCommand` calls reference, in any shape — `run: f`, `run: (argv) => f(argv)`, a
 * shorthand `run`, a method `run(argv) { … }`, a spread, an options object built elsewhere by name.
 */
function commandRoots({ source }: { source: ts.SourceFile }): readonly string[] {
  const roots: string[] = [];
  const visit: NodeVisitor = (node) => {
    const call = defineCommandCall({ node });
    if (call !== null) {
      roots.push(...call.arguments.flatMap((argument) => referencedNames({ node: argument })));
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return roots;
}

/** Every plain name a binding binds, however deeply destructured: `go`, `{ runTarget: go }`, `[, { a: [go] }]`. */
function boundNames({ name }: { name: ts.BindingName }): readonly string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  return bindingElementsOf({ pattern: name }).flatMap((element) => boundNames({ name: element.name }));
}

/**
 * The name an assignment target or argument is rooted at: `go`, `holder.run`, `holder["run"]` all root at their
 * identifier, with every value-preserving wrapper looked through at each step — `(options)`, `(holder as Spec).run`.
 */
function rootName({ target }: { target: ts.Expression }): string | null {
  let current = unwrapped({ node: target });
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapped({ node: current.expression });
  }
  return ts.isIdentifier(current) ? current.text : null;
}

/** The names an assignment writes: every identifier in a destructuring target, else the one its target is rooted at. */
function writtenNames({ target }: { target: ts.Expression }): readonly string[] {
  if (ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target)) {
    return referencedNames({ node: target });
  }
  const root = rootName({ target });
  return root === null ? [] : [root];
}

/** One value flowing into one name. */
interface Flow {
  readonly name: string;
  readonly node: ts.Node;
}

/** The values one node makes flow into a name, or none: a declaration, a defaulted binding, a class, a write. */
function flowsAt({ node }: { node: ts.Node }): readonly Flow[] {
  if (ts.isVariableDeclaration(node) || isParameterDeclaration(node) || ts.isBindingElement(node)) {
    const { initializer, name: bound } = node;
    // An array-pattern hole is a nameless binding element, and binds nothing.
    return initializer === undefined || bound === undefined
      ? []
      : boundNames({ name: bound }).map((name) => ({ name, node: initializer }));
  }
  if (ts.isClassDeclaration(node) && node.name !== undefined) {
    return [{ name: node.name.text, node }];
  }
  // Every assignment operator writes its left side: `=` and each compound one, `??=`, `||=`, `&&=`.
  if (ts.isBinaryExpression(node) && isAssignmentOperator({ kind: node.operatorToken.kind })) {
    return writtenNames({ target: node.left }).map((name) => ({ name, node: node.right }));
  }
  return ts.isCallExpression(node) ? callFlows({ call: node }) : [];
}

/**
 * The values one call may write into a name: every argument, into each name an argument or the callee's receiver is
 * rooted at — `Object.assign(options, { run })`, `registry.set("run", runTarget)`, `register(spec, runTarget)`.
 */
function callFlows({ call }: { call: ts.CallExpression }): readonly Flow[] {
  const callee = call.expression;
  const receiver =
    ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
      ? rootName({ target: callee.expression })
      : null;
  const argumentRoots = call.arguments.map((argument) => rootName({ target: argument }));
  const names = [receiver, ...argumentRoots].filter((name): name is string => name !== null);
  return names.flatMap((name) => call.arguments.map((node) => ({ name, node })));
}

/**
 * What flows into each name the module binds, anywhere in it (review found a destructured alias, then a
 * compound assignment, a narrower reader missed): a variable's initializer, a parameter's or a destructured field's
 * default, each under every name its binding destructures it into; a class, under its name; and the right side of
 * every write — `=` or any compound assignment — under each name a destructuring target binds or the one a target is
 * rooted at (`go = runTarget`, `holder.run = runTarget`, `options ??= { run }`, `({ run: go } = holder)`); and every
 * argument of a call, under each name an argument or the callee's receiver is rooted at, since a call may write
 * into either (`callFlows`). Widening this from top-level declarations and `=` alone moved no count on the real tree:
 * 47 paths, 23 bodies (repro: `scanInProcessPaths` over the tree `unit/cli/inProcessRulingGate.test.ts` reads).
 */
function valueFlows({ source }: { source: ts.SourceFile }): ReadonlyMap<string, readonly ts.Node[]> {
  const values = new Map<string, ts.Node[]>();
  const visit: NodeVisitor = (node) => {
    for (const { name, node: value } of flowsAt({ node })) {
      const existing = values.get(name);
      if (existing === undefined) {
        values.set(name, [value]);
      } else {
        existing.push(value);
      }
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return values;
}

/**
 * The functions a module's `defineCommand(…)` calls reach inside that module, transitively, through every name they
 * reference and every value those names flow from.
 *
 * @param functions the module's own top-level functions, from `declaredFunctions`
 * @returns the names of every function the command reaches
 */
export function verbBodies({
  functions,
  source,
}: {
  functions: ReadonlyMap<string, DeclaredFunction>;
  source: ts.SourceFile;
}): ReadonlySet<string> {
  const values = valueFlows({ source });
  const queue = [...commandRoots({ source })];
  const reached = new Set<string>();
  const followed = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (followed.has(name)) {
      continue;
    }
    followed.add(name);
    const declared = functions.get(name);
    if (declared !== undefined) {
      reached.add(name);
      // The whole function, not only its body: a parameter's default runs too.
      queue.push(...referencedNames({ node: declared.body.parent }));
      continue;
    }
    // A value the command names (`const spec = { run }`, `defineCommand(spec)`) is followed through all that flows in.
    const flows = values.get(name);
    if (flows !== undefined) {
      queue.push(...flows.flatMap((node) => referencedNames({ node })));
    }
  }
  return reached;
}
