/**
 * The `named-object-params` decision for ONE signature: which branch of the rule settles it, asked in a fixed
 * order. `./namedObjectParams.ts` walks the sources and turns these decisions into findings and, when a caller
 * asks, into the decision stream (`./namedObjectParamsOracle.ts`).
 *
 * **The branch order is a contract, twice over.** It is the gate's memory budget: the AST-only exemptions come
 * first, then compliance (one type, the sole parameter's), then the exemptions that resolve a call, and asking
 * the checker earlier contextually types whole enclosing calls (MEASURED, `HEAP_BUDGET_MIB` in
 * `./namedObjectParamsHeap.ts`). And it is what the decision stream records, so a rewrite of this rule onto
 * another compiler keeps the same order or its stream stops being comparable.
 */

import * as ts from "#lib/tsCompiler.js";

import { type ArgumentsByName, isInlineCallback, isPassedByReference } from "./namedObjectParamsCallbacks.js";

/**
 * The branch that settled one signature. `violation-*` breaks the rule; `marker-accounted-*` would have,
 * but a marker on the line above leans on it; `redundant-marker` is a marker no signature needed.
 */
export type NamedObjectParamsDecision =
  | "exempt-predicate"
  | "exempt-inherited"
  | "exempt-sole-rest"
  | "compliant-zero-parameters"
  | "compliant-declaration-arity"
  | "compliant-destructured"
  | "compliant-options-object"
  | "exempt-verb-contract"
  | "exempt-inline-callback"
  | "exempt-passed-by-reference"
  | "marker-accounted-arity"
  | "marker-accounted-not-options-object"
  | "violation-arity"
  | "violation-not-options-object"
  | "redundant-marker";

/** Type flags that are never an options bag, however many properties the checker reports. */
const PRIMITIVE_FLAGS =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.VoidLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.Never;

/** Whether a file path is outside this repository's own source — a lib declaration or a dependency. */
function isVendored({ fileName }: { fileName: string }): boolean {
  return fileName.includes("/node_modules/") || /\/lib\.[a-z0-9.]*d\.ts$/.test(fileName);
}

/**
 * Whether any of a type's properties is declared in this repo (or is synthesized, so authored here). A declaration
 * is read by its handle's file path, so judging one never fetches the file it is in.
 */
function hasOwnedProperty({ type }: { type: ts.Type }): boolean {
  return type.getProperties().some((property) => {
    const declarations = property.declarations;
    // A synthesized property has no declaration to point at — the checker answers an empty list.
    return declarations.length === 0 || declarations.some((d) => !isVendored({ fileName: d.path }));
  });
}

/**
 * Whether the type is a bag keyed by string — `Record<string, unknown>` and friends: an index signature whose key
 * is `string` itself, never a literal or a template pattern.
 */
function hasStringIndex({ checker, type }: { checker: ts.Checker; type: ts.Type }): boolean {
  return checker.getIndexInfosOfType(type).some((info) => (info.keyType.flags & ts.TypeFlags.String) !== 0);
}

/** Whether the type's symbol is a class or enum — an instance or a member, not a bag of arguments. */
function isNominal({ type }: { type: ts.Type }): boolean {
  const symbol = type.getSymbol();
  return symbol !== undefined && (symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Enum)) !== 0;
}

/**
 * Whether a parameter's type is an options object — a bag whose field names tell a caller what is available.
 *
 * Deliberately narrower than "an object": a value like `Date` names nothing, and a bare `T` could be anything.
 * A union is judged on its non-nullish members so an optional bag still qualifies; an intersection qualifies
 * if any member does, unless a primitive member makes it a branded primitive. An error type — what an
 * unresolved import becomes — is `any` by flags, so it is never an options object and a broken import can
 * only manufacture a violation, never hide one.
 *
 * @param checker the program's type checker
 * @param type the parameter's resolved type
 * @returns true when the type can carry named arguments
 */
function isOptionsObject({ checker, type }: { checker: ts.Checker; type: ts.Type }): boolean {
  if (type.isUnionType()) {
    const present = type.getTypes().filter((t) => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) === 0);
    return present.length > 0 && present.every((t) => isOptionsObject({ checker, type: t }));
  }
  if (type.isIntersectionType()) {
    const members = type.getTypes();
    if (members.some((t) => (t.flags & PRIMITIVE_FLAGS) !== 0)) {
      return false;
    }
    return members.some((t) => isOptionsObject({ checker, type: t }));
  }
  if ((type.flags & PRIMITIVE_FLAGS) !== 0) {
    return false;
  }
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint !== undefined && isOptionsObject({ checker, type: constraint });
  }
  if (checker.isArrayType(type) || checker.isTupleType(type) || type.getCallSignatures().length > 0) {
    return false;
  }
  if (isNominal({ type })) {
    return false;
  }
  return hasStringIndex({ checker, type }) || hasOwnedProperty({ type });
}

/** Whether this node declares a signature rather than implementing one (arity-only rule). */
function isDeclaration({ node }: { node: ts.Node }): boolean {
  return (
    ts.isMethodSignatureDeclaration(node) ||
    ts.isFunctionTypeNode(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node)
  );
}

/** A predicate or assertion signature — TS1230 forbids destructuring, so the compiler decides this one. */
function isPredicate({ signature }: { signature: ts.SignatureDeclaration }): boolean {
  const returnType = signature.type;
  return (
    returnType !== undefined && (ts.isTypePredicateNode(returnType) || returnType.kind === ts.SyntaxKind.AssertsKeyword)
  );
}

/**
 * Whether this signature INHERITS its parameter types from a contract rather than declaring them.
 *
 * An unannotated parameter is the signal, but only when it is also un-initialized. A default value is the
 * exception that matters: `f(value = "x")` has no annotation, yet `strict` infers `string` from the initializer
 * locally and compiles with zero diagnostics — so a consumer supplied nothing, and the parameter list is the
 * author's own. Treating "no annotation" alone as inherited let exactly that signature through.
 */
function inheritsTypes({ signature }: { signature: ts.SignatureDeclaration }): boolean {
  return signature.parameters.some(
    (p) => p.type === undefined && p.initializer === undefined && !ts.isObjectBindingPattern(p.name),
  );
}

/**
 * The CLI verb contract the router dictates, resolved semantically rather than by annotation text — so
 * `Promise<number> | number` and `number | Promise<number>` are the same contract, as they are to the compiler.
 *
 * **This match is STRUCTURAL, and that is a deliberate limit rather than an oversight.** It asks only whether a
 * signature has the verb's shape, never whether the router actually registers it — so an unrelated
 * `countValues(values: readonly string[]): number` is exempt purely by coincidence of shape. Proving
 * registration would couple this gate to the command manifests; the shape test was chosen instead, with this
 * false negative as the known price. If that price stops being acceptable, tighten it HERE rather than adding
 * a second, competing notion of what a verb is.
 */
function isVerbContract({ checker, signature }: { checker: ts.Checker; signature: ts.SignatureDeclaration }): boolean {
  const parameter = signature.parameters[0];
  if (signature.parameters.length !== 1 || parameter?.type === undefined) {
    return false;
  }
  const parameterType = checker.getTypeAtLocation(parameter);
  if (!checker.isArrayType(parameterType) || checker.typeToString(parameterType) !== "readonly string[]") {
    return false;
  }
  const returned = signature.type === undefined ? undefined : checker.getTypeFromTypeNode(signature.type);
  let members: readonly ts.Type[];
  if (returned === undefined) {
    members = [];
  } else if (returned.isUnionType()) {
    members = returned.getTypes();
  } else {
    members = [returned];
  }
  return (
    members.length > 0 &&
    members.every((m) => {
      const text = checker.typeToString(m);
      return text === "number" || text === "Promise<number>";
    })
  );
}

/**
 * The exemption the AST alone decides — a predicate, an inherited parameter list, a sole rest parameter — or
 * `undefined` when none applies. Asked FIRST, before anything resolves a type: an unannotated callback
 * parameter, the commonest signature in the repo, is exempt here, and asking the checker for its type instead
 * would contextually type the whole enclosing call.
 */
function syntaxExemption({ signature }: { signature: ts.SignatureDeclaration }): NamedObjectParamsDecision | undefined {
  if (isPredicate({ signature })) {
    return "exempt-predicate";
  }
  if (inheritsTypes({ signature })) {
    return "exempt-inherited";
  }
  const sole = signature.parameters[0];
  if (signature.parameters.length === 1 && sole?.dotDotDotToken !== undefined) {
    return "exempt-sole-rest";
  }
  return undefined;
}

/**
 * Which compliance branch a signature satisfies, or `undefined` when it satisfies none. One type at most is
 * resolved here — the sole parameter's, and only once every syntactic answer is exhausted.
 */
function compliance({
  checker,
  declaration,
  signature,
}: {
  checker: ts.Checker;
  declaration: boolean;
  signature: ts.SignatureDeclaration;
}): NamedObjectParamsDecision | undefined {
  const parameters = signature.parameters;
  if (parameters.length === 0) {
    return "compliant-zero-parameters";
  }
  if (parameters.length > 1) {
    return undefined;
  }
  // Exactly one parameter, counted on the line above.
  const sole = parameters[0]!;
  if (declaration) {
    return "compliant-declaration-arity";
  }
  if (ts.isObjectBindingPattern(sole.name)) {
    return "compliant-destructured";
  }
  if (isOptionsObject({ checker, type: checker.getTypeAtLocation(sole) })) {
    return "compliant-options-object";
  }
  return undefined;
}

/**
 * Which exemption the code a signature is handed to, or the verb router, gives it — every exemption that needs
 * the checker — or `undefined` when none does. Inline callback before passed-by-reference, the order the gate
 * has always asked them in.
 */
function typesExemption({
  argumentsByName,
  checker,
  declaration,
  node,
  signature,
}: {
  argumentsByName: ArgumentsByName;
  checker: ts.Checker;
  declaration: boolean;
  node: ts.Node;
  signature: ts.SignatureDeclaration;
}): NamedObjectParamsDecision | undefined {
  if (isVerbContract({ checker, signature })) {
    return "exempt-verb-contract";
  }
  if (declaration) {
    return undefined;
  }
  // The consumer fixed the shape of an inline callback and of a named local handed over by reference alike,
  // and wrapping either would mean writing an adapter whose only job is to satisfy this gate.
  if (isInlineCallback({ checker, node })) {
    return "exempt-inline-callback";
  }
  if (isPassedByReference({ argumentsByName, checker, node })) {
    return "exempt-passed-by-reference";
  }
  return undefined;
}

/**
 * Decide one signature: the first branch, in the contract order above, that settles it. A `violation-*`
 * answer is the rule broken before any marker is consulted; the scan, which can see the line above, turns
 * one a marker leans on into `marker-accounted-*`.
 *
 * @param argumentsByName every identifier the file passes as an argument, for the by-reference exemption
 * @param checker the program's type checker
 * @param node the signature's own node
 * @param signature the same node, narrowed to a signature
 * @returns the deciding branch
 */
export function decideSignature({
  argumentsByName,
  checker,
  node,
  signature,
}: {
  argumentsByName: ArgumentsByName;
  checker: ts.Checker;
  node: ts.Node;
  signature: ts.SignatureDeclaration;
}): NamedObjectParamsDecision {
  const bySyntax = syntaxExemption({ signature });
  if (bySyntax !== undefined) {
    return bySyntax;
  }
  const declaration = isDeclaration({ node });
  const compliant = compliance({ checker, declaration, signature });
  if (compliant !== undefined) {
    return compliant;
  }
  const byTypes = typesExemption({ argumentsByName, checker, declaration, node, signature });
  if (byTypes !== undefined) {
    return byTypes;
  }
  if (signature.parameters.length > 1) {
    return "violation-arity";
  }
  return "violation-not-options-object";
}
