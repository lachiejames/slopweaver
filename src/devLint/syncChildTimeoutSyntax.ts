/**
 * The sync-child-timeout gate's syntactic resolver: which launcher a call reaches, and whether its options
 * visibly bound it. Split from `./syncChildTimeout.ts` because resolving a name LEXICALLY — the nearest
 * declaration in scope (`./syncChildTimeoutScope.ts`), so an inner binding that shadows an import is not mistaken
 * for it — and evaluating a `timeout` value (`./syncChildTimeoutValue.ts`) are walkers of their own, and the
 * gate's scan, debt judgement and IO edge read better without them inline.
 *
 * Source-local on purpose: an imported constant, a function's return, a `let`, an assignment or a parameter is
 * never followed, which keeps this a syntax gate rather than a second checker-backed `ts.Program` (the
 * `named-object-params` gate owns the one Program this tree budgets for). An options object the resolver cannot
 * see is `unknown`, and an unknown bound is a refused one.
 */
import { ts } from "#lib/tsSyntax.js";

import { peeled } from "./syncChildTimeoutLiteral.js";
import { declarationOf } from "./syncChildTimeoutScope.js";
import { staticValueOf } from "./syncChildTimeoutValue.js";

/** The three synchronous launchers: each blocks the event loop until its child exits. */
const SYNC_APIS: ReadonlySet<string> = new Set(["execSync", "execFileSync", "spawnSync"]);

/** The module specifiers those launchers are imported from. */
const CHILD_PROCESS_MODULES: ReadonlySet<string> = new Set(["node:child_process", "child_process"]);

/** A Node launcher API this gate governs. */
export type SyncApi = "execSync" | "execFileSync" | "spawnSync";

/**
 * Whether a source file imports anything from `child_process` at all — the cheap pre-filter.
 *
 * @returns true when one top-level import names `node:child_process` or `child_process`
 */
export function importsChildProcess({ sf }: { sf: ts.SourceFile }): boolean {
  return sf.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      CHILD_PROCESS_MODULES.has(statement.moduleSpecifier.text),
  );
}

/** Narrow a name to a governed launcher. */
function isSyncApi(name: string): name is SyncApi {
  return SYNC_APIS.has(name);
}

/**
 * The synchronous launcher a call reaches, resolved lexically to its import, or `undefined` when its callee
 * is not one — a local function that shares the name, or an inner binding shadowing the import.
 *
 * @param call the call expression to classify
 * @returns the launcher's API name, or undefined
 */
export function launcherOf({ call }: { call: ts.CallExpression }): SyncApi | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    const declared = declarationOf({ from: call, text: callee.text });
    const isLauncher =
      declared?.kind === "import" && CHILD_PROCESS_MODULES.has(declared.module) && isSyncApi(declared.imported);
    return isLauncher ? declared.imported : undefined;
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && isSyncApi(callee.name.text)) {
    const declared = declarationOf({ from: call, text: callee.expression.text });
    const isNamespace =
      declared?.kind === "import" &&
      CHILD_PROCESS_MODULES.has(declared.module) &&
      (declared.imported === "*" || declared.imported === "default");
    return isNamespace ? callee.name.text : undefined;
  }
  return undefined;
}

/**
 * What an options expression says about `timeout`: `bounded` (a usable value is the last word), `unbounded`
 * (the last word is `0` or `undefined`, both "no timeout" to Node), `absent` (nothing in it touches
 * `timeout`), or `unknown` (something the resolver cannot see could set it).
 */
type TimeoutState = "bounded" | "unbounded" | "absent" | "unknown";

/**
 * The state a `timeout` value sets. A value this file decides is bounded only when it evaluates positive, so
 * `const t = 0; { timeout: t }` and `timeout: 1 % 1` are refused, and a same-file shape the evaluator does not
 * model is `unknown`, refused too. A value decided elsewhere — an imported constant, a typed seam's parameter —
 * is TRUSTED as a bound: a gate that saw one file could not tell it from a zero, and refusing it refused 21 real
 * bounds (measured with `yarn tsx src/devLint/syncChildTimeout.entry.ts` and this branch reading
 * `unknown`). That trust is the named blind spot in `./syncChildTimeout.ts`.
 */
function valueState({ value, seen }: { value: ts.Expression; seen: ReadonlySet<ts.Node> }): TimeoutState {
  const evaluated = staticValueOf({ node: value, seen });
  if (evaluated === "dynamic") {
    return "bounded";
  }
  if (evaluated === "opaque") {
    return "unknown";
  }
  return evaluated !== undefined && evaluated > 0 ? "bounded" : "unbounded";
}

/** The state one object-literal member sets, read as the LAST word on `timeout` when it says anything. */
function memberState({
  member,
  seen,
}: {
  member: ts.ObjectLiteralElementLike;
  seen: ReadonlySet<ts.Node>;
}): TimeoutState {
  if (ts.isSpreadAssignment(member)) {
    return timeoutStateOf({ node: member.expression, seen });
  }
  if (ts.isComputedPropertyName(member.name)) {
    return "unknown";
  }
  if (ts.isShorthandPropertyAssignment(member)) {
    return member.name.text === "timeout" ? valueState({ seen, value: member.name }) : "absent";
  }
  const name = member.name;
  const named = (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === "timeout";
  if (!named) {
    return "absent";
  }
  if (!ts.isPropertyAssignment(member)) {
    return "unknown";
  }
  return valueState({ seen, value: member.initializer });
}

/**
 * What an options expression says about `timeout`, respecting property order: members are read last to
 * first, so `{ ...bounded, timeout: 0 }` is unbounded and `{ timeout: 1, ...unseen }` is unknown. A conditional
 * is known only when both branches agree, and a name is followed only to a same-file `const` initialised with
 * an object literal; `seen` stops a cycle.
 *
 * @param node the options expression
 * @param seen the const declarations already followed on this path
 * @returns the expression's timeout state
 */
function timeoutStateOf({ node, seen }: { node: ts.Expression; seen: ReadonlySet<ts.Node> }): TimeoutState {
  const bare = peeled({ node });
  if (ts.isObjectLiteralExpression(bare)) {
    for (const member of bare.properties.toReversed()) {
      const state = memberState({ member, seen });
      if (state !== "absent") {
        return state;
      }
    }
    return "absent";
  }
  if (ts.isConditionalExpression(bare)) {
    // `...(stdin === undefined ? {} : { input: stdin })`: either branch may run, so it is known only when both agree.
    const whenTrue = timeoutStateOf({ node: bare.whenTrue, seen });
    return whenTrue === timeoutStateOf({ node: bare.whenFalse, seen }) ? whenTrue : "unknown";
  }
  if (!ts.isIdentifier(bare)) {
    return "unknown";
  }
  const declared = declarationOf({ from: bare, text: bare.text });
  if (declared?.kind !== "const" || seen.has(declared.node) || declared.node.initializer === undefined) {
    return "unknown";
  }
  const initializer = peeled({ node: declared.node.initializer });
  if (!ts.isObjectLiteralExpression(initializer)) {
    return "unknown";
  }
  return timeoutStateOf({ node: initializer, seen: new Set([...seen, declared.node]) });
}

/**
 * Whether any argument of a launcher call visibly bounds it — its options resolve to a usable `timeout`.
 *
 * @param call the launcher call
 * @returns true when one argument's timeout state is `bounded`
 */
export function callIsBounded({ call }: { call: ts.CallExpression }): boolean {
  return call.arguments.some((argument) => timeoutStateOf({ node: argument, seen: new Set() }) === "bounded");
}
