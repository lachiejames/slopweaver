/**
 * The callback exemptions of the named-object-params gate (`./namedObjectParams.ts`): a signature whose
 * parameter list a CONSUMER chose — an inline literal handed to a call, or a named function handed to one by
 * reference — is not the author's to reshape.
 *
 * Both exemptions ask the checker something expensive (`getResolvedSignature` on the call), so both are asked
 * last, and only about a signature that already broke the rule. The checker is cache-populating rather than
 * operationally pure: every question here can enlarge the live set, which is the cost
 * `HEAP_BUDGET_MIB` (`./namedObjectParamsHeap.ts`) measures.
 */

import * as ts from "#lib/tsCompiler.js";

/**
 * Whether a type can be CALLED — directly, through a union/intersection member, or as an array element.
 *
 * `seen` is what makes this terminate on a SELF-REFERENTIAL type, and its absence was a crash rather than a
 * verdict. A union that contains an array of itself — drizzle's own `SQLChunk` is declared exactly so, as
 * `StringChunk | SQLChunk[] | …` — sends the walk through union members and array elements back to the same
 * type forever. MEASURED on the retrieval bake-off branch: the whole gate died with `RangeError: Maximum call
 * stack size exceeded` inside this function once that branch's new store modules were added, and completed
 * with this guard in place. Reproduce by removing the four guard lines and running
 * `yarn tsx src/cli/index.ts dev lint --only named-object-params` on that branch. No unit fixture is offered: two
 * small fixtures built to force the cycle both passed WITHOUT the guard, because the scanner never consulted
 * their parameter type, and a test that cannot fail is worse than none. A type already on the path contributes no
 * call signature it has not already been checked for, so returning false on a revisit changes no verdict for any
 * finite type. A type is known by its `id`, the server's identity for it.
 *
 * @param checker the program's type checker
 * @param type the type to test
 * @param seen the ids of the types already on this walk
 * @returns whether any reachable member of the type has a call signature
 */
function typeIsCallable({
  checker,
  type,
  seen = new Set<number>(),
}: {
  checker: ts.Checker;
  type: ts.Type;
  seen?: Set<number>;
}): boolean {
  if (seen.has(type.id)) {
    return false;
  }
  seen.add(type.id);
  if (type.isUnionType() || type.isIntersectionType()) {
    return type.getTypes().some((t) => typeIsCallable({ checker, seen, type: t }));
  }
  if (type.getCallSignatures().length > 0) {
    return true;
  }
  if (checker.isArrayType(type)) {
    // `as`: this is the TS compiler API's own idiom — `isArrayType` narrows at runtime but its public
    // signature doesn't say so, so every consumer (including the compiler's own source) casts here.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const element = checker.getTypeArguments(type as ts.TypeReference)[0];
    return element !== undefined && typeIsCallable({ checker, seen, type: element });
  }
  return false;
}

/**
 * Whether the callee's DECLARED parameter at this argument position is a function type — i.e. the consumer
 * really does dictate the literal's shape, rather than merely accepting it as an opaque value.
 *
 * This is what separates `throttle(task => …)`, where the parameter is declared as a function type, from
 * `Promise.resolve((value: string) => value)`, where the parameter is declared as a bare `T | PromiseLike<T>`
 * and the author chose `(value: string)` freely. Without the distinction, "is a call argument" exempted every
 * authored signature that happened to be handed to anything.
 *
 * Every unresolvable case answers TRUE — fail OPEN. This exemption exists to avoid false positives over the
 * thousands of legitimate callbacks in the repo, and a false positive here is far worse than the narrow false
 * negative of exempting one opaque-value pass.
 */
function consumerDeclaresCallback({
  argument,
  call,
  checker,
  path = [],
}: {
  argument: ts.Node;
  call: ts.CallExpression | ts.NewExpression;
  checker: ts.Checker;
  /** Property names from the argument down to the function literal — empty when it IS the argument. */
  path?: readonly string[];
}): boolean {
  const args: readonly ts.Node[] = call.arguments === undefined ? [] : Array.from(call.arguments);
  const index = args.indexOf(argument);
  if (index < 0) {
    return true;
  }
  // Always a signature: a call the checker cannot resolve answers its unknown signature, with no parameters.
  const signature = checker.getResolvedSignature(call);
  // A rest parameter covers every position from its own index onward, so an argument past the declared list
  // reads the last declared one.
  const parameters = signature.getParameters();
  const parameter = index < parameters.length ? parameters[index] : parameters.at(-1);
  const declaration = parameter?.valueDeclaration?.resolve();
  if (declaration === undefined || !ts.isParameterDeclaration(declaration) || declaration.type === undefined) {
    return true;
  }
  // Walk the declared type down the property path. `defineCommand({ run: argv => … })` resolves to `run`'s
  // declared function type and is exempt; `Promise.resolve({ run: … })` has no `run` on `T | PromiseLike<T>`,
  // so nothing dictated that shape. A property the declared type does not have is EVIDENCE, not an unknown.
  let declared = checker.getTypeFromTypeNode(declaration.type);
  for (const property of path) {
    const symbol = declared.getProperty(property);
    if (symbol === undefined) {
      return false;
    }
    declared = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  }
  return typeIsCallable({ checker, type: declared });
}

/**
 * Walk outwards from a function literal to the call argument that contains it, collecting the property names
 * crossed on the way. Returns nothing when the literal is not inside a call argument at all.
 *
 * Separated from the callability decision so each half stays inside the cognitive-complexity cap this repo
 * enforces on itself.
 *
 * @param node the function literal to walk out from
 * @returns the containing call, the argument node, and the property path (outermost first)
 */
function enclosingArgument({ node }: { node: ts.Node }):
  | {
      readonly call: ts.CallExpression | ts.NewExpression;
      readonly argument: ts.Node;
      readonly path: readonly string[];
    }
  | undefined {
  let current: ts.Node = node;
  const path: string[] = [];
  for (let hops = 0; hops < 8; hops += 1) {
    // Safe to read unguarded: the only node with no parent is a SourceFile, and a SourceFile is neither a
    // call nor a pass-through kind, so the loop returns before it can become `current`.
    const parent = current.parent;
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      const args: readonly ts.Node[] = parent.arguments === undefined ? [] : Array.from(parent.arguments);
      return args.includes(current) ? { argument: current, call: parent, path: path.toReversed() } : undefined;
    }
    if (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) {
      path.push(parent.name.getText(parent.getSourceFile()));
    } else if (!ts.isObjectLiteralExpression(parent)) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

/**
 * Whether a function literal is an inline callback: it is a call argument whose parameter list the callee
 * declares, or it sits in an object literal property the callee declares as a function.
 *
 * @param checker the program's type checker
 * @param node the function literal under judgement
 * @returns true when a consumer chose the literal's parameter list
 */
export function isInlineCallback({ checker, node }: { checker: ts.Checker; node: ts.Node }): boolean {
  const enclosing = enclosingArgument({ node });
  return (
    enclosing !== undefined &&
    consumerDeclaresCallback({
      argument: enclosing.argument,
      call: enclosing.call,
      checker,
      path: enclosing.path,
    })
  );
}

/** One bare-identifier argument, and the call it is handed to. */
interface CallbackArgument {
  readonly argument: ts.Identifier;
  readonly call: ts.CallExpression;
}

/**
 * Every call argument in a file that is a bare identifier, keyed by its TEXT — collected from the AST alone, so
 * building it resolves nothing.
 *
 * It is the candidate list for the by-reference exemption, never the verdict. For the local declaration forms
 * {@link boundName} recognises, a direct bare-identifier reference to the same local symbol has the same
 * normalised identifier text; text only selects candidates, and exact symbol equality decides the exemption.
 */
export type ArgumentsByName = ReadonlyMap<string, readonly CallbackArgument[]>;

/**
 * Collect {@link ArgumentsByName} for one file, without touching the checker.
 *
 * @param sf the file to walk
 * @returns every bare-identifier call argument in the file, grouped by its text
 */
export function identifierArguments({ sf }: { sf: ts.SourceFile }): ArgumentsByName {
  const byName = new Map<string, CallbackArgument[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const argument of node.arguments) {
        if (ts.isIdentifier(argument)) {
          const existing = byName.get(argument.text);
          if (existing === undefined) {
            byName.set(argument.text, [{ argument, call: node }]);
          } else {
            existing.push({ argument, call: node });
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return byName;
}

/**
 * The name a signature is bound to, and the node that name sits on — a named declaration, or an arrow assigned
 * to a `const`. Anonymous literals have none, and are judged by {@link isInlineCallback} instead.
 */
function boundName({ node }: { node: ts.Node }): ts.Identifier | undefined {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    return node.name;
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name;
  }
  return undefined;
}

/**
 * Whether this signature's function is handed to a call in the same file BY REFERENCE, into a position the
 * callee declares as a function — `stdin.on("data", onData)`, `ts.forEachChild(node, visit)`.
 *
 * Two conditions, both load-bearing. The callee check is the same one the inline-callback path uses: being
 * handed to something is not evidence that the something chose your shape — `Promise.resolve(authored)` takes
 * `authored` as an opaque generic value. And the match is by checker SYMBOL rather than identifier text,
 * because text let a single genuine callback reference exempt every same-named function in the file: two
 * `transform`s in separate blocks share a spelling and nothing else. Text only NARROWS which arguments are
 * asked about, which is what keeps this off every call in the file. Two symbols are the same when their `id`s
 * are: the server's identity, where two lookups need not answer the same client object.
 *
 * @param argumentsByName the file's bare-identifier arguments, from {@link identifierArguments}
 * @param checker the program's type checker
 * @param node the signature's declaration
 * @returns true when a consumer chose this function's parameter list
 */
export function isPassedByReference({
  argumentsByName,
  checker,
  node,
}: {
  argumentsByName: ArgumentsByName;
  checker: ts.Checker;
  node: ts.Node;
}): boolean {
  const name = boundName({ node });
  if (name === undefined) {
    return false;
  }
  const candidates = argumentsByName.get(name.text);
  if (candidates === undefined) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(name);
  return (
    symbol !== undefined &&
    candidates.some(
      ({ argument, call }) =>
        checker.getSymbolAtLocation(argument)?.id === symbol.id &&
        consumerDeclaresCallback({ argument, call, checker }),
    )
  );
}
