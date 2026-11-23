/**
 * One verb module read off its AST: which of its functions are verb BODIES, and the ruling gate each opens with.
 *
 * The half of `./inProcessVerbPaths.ts` that looks inside a single module, split from the half that follows
 * imports between modules. The criterion both halves implement is stated once, in that file's header.
 */
import {
  bindingElementsOf,
  forEachChild,
  isFunctionLikeDeclaration,
  isPropertySignatureDeclaration,
  type NodeVisitor,
  ts,
} from "#lib/tsSyntax.js";

import { localTypes, returnsExitCode } from "./inProcessExitCodeType.js";

/** The helper every in-process-reachable verb body opens with. */
const GATE_CALL = "refuseRunnerOnStandingRuling";

/** The parameter names that carry a verb's unparsed command-line words through this tree. */
const ARGUMENT_NAMES: ReadonlySet<string> = new Set(["argv", "rest"]);

/** The gate a verb body opens with: its noun literal, and its verb literal when the verb is one. */
export interface OpeningGate {
  readonly noun: string;
  readonly verb: string | null;
}

/** A function declared at a module's top level: a `function` declaration or a `const` holding an arrow/function. */
export interface DeclaredFunction {
  readonly body: ts.Node;
  /**
   * Whether it RUNS a verb: it takes the verb's own command-line words (a parameter, or a destructured field, named
   * `argv`/`rest`) and answers an exit code. A helper taking parsed values, or a parse shell, does neither.
   */
  readonly runsVerb: boolean;
}

/** A top-level function-like node and the name it is declared under. */
interface TopLevelFunction {
  readonly name: string;
  readonly node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}

/**
 * Whether a binding names the verb's command-line words at any depth: an identifier so named, or a destructured
 * field keyed so however deeply it is nested (`{ options: { argv } }`). A renamed field (`{ argv: words
 * }`, `{ "argv": words }`) is read off its key, an unrenamed one off its own name. A computed key could name either,
 * so it errs IN, as the exit-code test does.
 */
function bindsArguments({ name }: { name: ts.BindingName }): boolean {
  if (ts.isIdentifier(name)) {
    return ARGUMENT_NAMES.has(name.text);
  }
  return bindingElementsOf({ pattern: name }).some((element) => {
    const key = element.propertyName;
    if (key !== undefined && ts.isComputedPropertyName(key)) {
      return true;
    }
    const keyNamed =
      key !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key)) && ARGUMENT_NAMES.has(key.text);
    return keyNamed || bindsArguments({ name: element.name });
  });
}

/** Whether an inline parameter type carries a member named for the verb's words at any depth: `{ o: { argv } }`. */
function typedWithArguments({ type }: { type: ts.TypeNode | undefined }): boolean {
  let found = false;
  const visit: NodeVisitor = (node) => {
    const named = isPropertySignatureDeclaration(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name));
    if (named && ARGUMENT_NAMES.has(node.name.text)) {
      found = true;
    }
    // Every type argument included (`Box<{ argv: … }>`): an inline member is inline wherever it sits.
    forEachChild({ node, visit });
  };
  if (type !== undefined) {
    visit(type);
  }
  return found;
}

/** Whether any parameter, any field one destructures at any depth, or its inline type is named for the verb's words. */
function takesArguments({ parameters }: { parameters: ts.NodeArray<ts.ParameterDeclaration> }): boolean {
  return parameters.some(
    (parameter) => bindsArguments({ name: parameter.name }) || typedWithArguments({ type: parameter.type }),
  );
}

/** The functions one top-level statement declares: a named `function`, or each `const` holding one. */
function functionsIn({ statement }: { statement: ts.Statement }): readonly TopLevelFunction[] {
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    return [{ name: statement.name.text, node: statement }];
  }
  if (!ts.isVariableStatement(statement)) {
    return [];
  }
  const found: TopLevelFunction[] = [];
  for (const declaration of statement.declarationList.declarations) {
    const init = declaration.initializer;
    if (init === undefined || !ts.isIdentifier(declaration.name)) {
      continue;
    }
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      found.push({ name: declaration.name.text, node: init });
    }
  }
  return found;
}

/**
 * Every top-level function a module declares, by name.
 *
 * @returns each function's body, and whether it runs a verb; what it is exported as is `./inProcessExports.ts`'s
 */
export function declaredFunctions({ source }: { source: ts.SourceFile }): ReadonlyMap<string, DeclaredFunction> {
  const found = new Map<string, DeclaredFunction>();
  const locals = localTypes({ source });
  for (const statement of source.statements) {
    for (const { name, node } of functionsIn({ statement })) {
      if (node.body === undefined) {
        continue;
      }
      found.set(name, {
        body: node.body,
        runsVerb: takesArguments({ parameters: node.parameters }) && returnsExitCode({ locals, type: node.type }),
      });
    }
  }
  return found;
}

/** The string literal of one property of an object literal, or null when it is absent or not a literal. */
function literalProperty({ options, key }: { options: ts.ObjectLiteralExpression; key: string }): string | null {
  const property = options.properties.find(
    (each) => ts.isPropertyAssignment(each) && ts.isIdentifier(each.name) && each.name.text === key,
  );
  if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) {
    return null;
  }
  return property.initializer.text;
}

/** The gate one node IS — a gate call naming its noun by literal — or null. */
function gateOfCall({ node }: { node: ts.Node }): OpeningGate | null {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== GATE_CALL) {
    return null;
  }
  const options = node.arguments[0];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return null;
  }
  const noun = literalProperty({ key: "noun", options });
  return noun === null ? null : { noun, verb: literalProperty({ key: "verb", options }) };
}

/** Whether a statement returns at once when `name` is defined: `if (name !== undefined) { return …; }`. */
function returnsWhenDefined({ statement, name }: { statement: ts.Statement | undefined; name: string }): boolean {
  if (statement === undefined || !ts.isIfStatement(statement) || statement.elseStatement !== undefined) {
    return false;
  }
  const test = statement.expression;
  const testsName =
    ts.isBinaryExpression(test) &&
    test.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    ts.isIdentifier(test.left) &&
    test.left.text === name &&
    ts.isIdentifier(test.right) &&
    test.right.text === "undefined";
  const then = statement.thenStatement;
  const first = ts.isBlock(then) ? then.statements[0] : then;
  return testsName && first !== undefined && ts.isReturnStatement(first);
}

/** Whether a declaration list is a plain `const` — not `let`, `var`, `using` or `await using`. */
function isConst({ list }: { list: ts.VariableDeclarationList }): boolean {
  // `await using` is `Const | Using`, so the whole block-scoped mask has to equal `Const` alone.
  const scoped: number = list.flags & ts.NodeFlags.BlockScoped;
  const plainConst: number = ts.NodeFlags.Const;
  return scoped === plainConst;
}

/**
 * The gate a body's OPENING statements ask and obey, or null: `const gated = refuseRunnerOnStandingRuling(…)` and
 * then `if (gated !== undefined) { return …; }`, exactly. A gate call anywhere else — inside a closure nothing
 * calls, or one whose answer is dropped — refuses nothing, so it gates nothing.
 */
function obeyedGate({ body }: { body: ts.Node }): OpeningGate | null {
  if (!ts.isBlock(body)) {
    return null;
  }
  const [first, second] = body.statements;
  // `const` only: a `let` or `var` binding can be reassigned between the gate and the check that obeys it.
  if (first === undefined || !ts.isVariableStatement(first) || !isConst({ list: first.declarationList })) {
    return null;
  }
  const declarations = first.declarationList.declarations;
  const declaration = declarations.length === 1 ? declarations[0]! : undefined;
  if (declaration?.initializer === undefined || !ts.isIdentifier(declaration.name)) {
    return null;
  }
  const gate = gateOfCall({ node: declaration.initializer });
  return gate !== null && returnsWhenDefined({ name: declaration.name.text, statement: second }) ? gate : null;
}

/** The one call a body consists of — `return f(…)`, `return await f(…)`, or an arrow's `f(…)` — or null. */
function soleDelegate({ body }: { body: ts.Node }): string | null {
  let expression: ts.Node | undefined = body;
  if (ts.isBlock(body)) {
    const only = body.statements.length === 1 ? body.statements[0] : undefined;
    expression = only !== undefined && ts.isReturnStatement(only) ? only.expression : undefined;
  }
  if (expression !== undefined && ts.isAwaitExpression(expression)) {
    expression = expression.expression;
  }
  if (expression === undefined || !ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return null;
  }
  return expression.expression.text;
}

/** Every name the parameters of the function owning `body` bind, a destructured or defaulted one included. */
function parameterNames({ body }: { body: ts.Node }): ReadonlySet<string> {
  const names = new Set<string>();
  const owner = body.parent;
  if (!isFunctionLikeDeclaration(owner)) {
    return names;
  }
  const collect = ({ name }: { name: ts.BindingName }): void => {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    for (const element of bindingElementsOf({ pattern: name })) {
      collect({ name: element.name });
    }
  };
  for (const parameter of owner.parameters) {
    collect({ name: parameter.name });
  }
  return names;
}

/**
 * The gate one verb body opens with, following a sole delegation inside its own module. A parameter rebinding the
 * delegate's name makes the call something other than the module's, so it gates nothing; a
 * binding of the gate's own name or `undefined` anywhere in the module is `./inProcessGateBinding.ts`'s to refuse.
 *
 * @param functions the module's own top-level functions
 * @param name the body to read
 * @param seen the bodies already followed, so a delegation cycle ends rather than recursing
 * @returns the gate its opening statements ask and obey, or null when it opens with none
 */
export function openingGateOf({
  functions,
  name,
  seen,
}: {
  functions: ReadonlyMap<string, DeclaredFunction>;
  name: string;
  seen: ReadonlySet<string>;
}): OpeningGate | null {
  const declared = functions.get(name);
  if (declared === undefined || seen.has(name)) {
    return null;
  }
  const opening = obeyedGate({ body: declared.body });
  if (opening !== null) {
    return opening;
  }
  const delegate = soleDelegate({ body: declared.body });
  if (delegate === null || parameterNames({ body: declared.body }).has(delegate)) {
    return null;
  }
  return openingGateOf({ functions, name: delegate, seen: new Set([...seen, name]) });
}
