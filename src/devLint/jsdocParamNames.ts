/**
 * The parameter-name half of the JSDoc-tag gate: which `@param` names a function's signature obliges, read
 * syntax-only from the declared TYPE (resolving interfaces and aliases declared in the same file) and the
 * destructuring pattern. Split from `jsdocTags.ts`, which grades the tags against what this module reports.
 */

import { isPropertySignatureDeclaration, ts } from "#lib/tsSyntax.js";
import { appendAll } from "../lib/arrays.js";

/** The expected `@param` names, and whether that list is the WHOLE contract or only the part we can see. */
export interface ExpectedParams {
  readonly names: readonly string[];
  /**
   * True when every name the caller must pass is known. False when part of the parameter's type is a named
   * reference this syntax-only scanner cannot resolve, so extra fields may exist: the missing-tag direction
   * still holds, but a tag naming something unknown to us cannot be called stale.
   */
  readonly complete: boolean;
}

/** The property names of an inline type literal, or undefined when a member is not a plain named property. */
function literalFieldNames({
  members,
  sf,
}: {
  members: readonly ts.TypeElement[];
  sf: ts.SourceFile;
}): readonly string[] | undefined {
  const names: string[] = [];
  for (const member of members) {
    if (!isPropertySignatureDeclaration(member)) {
      return undefined;
    }
    names.push(member.name.getText(sf));
  }
  return names;
}

/** What a local declaration gives us: enumerable members, or a type node to keep resolving. */
type LocalShape =
  | { readonly kind: "members"; readonly members: readonly ts.TypeElement[] }
  | { readonly kind: "type"; readonly type: ts.TypeNode };

/**
 * The shape of an interface or type alias declared IN THIS FILE, or undefined when it cannot be resolved.
 *
 * Syntax-only, so it resolves a local declaration and nothing more: an imported type, or an interface with an
 * `extends` clause whose members live elsewhere, is deliberately unresolvable rather than guessed at.
 *
 * This exists because a required field can otherwise HIDE behind a named type. Codex found the hole twice:
 * first for a bare interface, then — after the first fix — for a type alias whose right-hand side is an
 * INTERSECTION, which an earlier version refused to look inside. A type alias now returns its type node so
 * the caller keeps resolving it.
 *
 * @param name the referenced type's name
 * @param sf the source file to look in
 * @returns the shape to continue from, or undefined when the name is not a resolvable local declaration
 */
function localTypeShape({ name, sf }: { name: string; sf: ts.SourceFile }): LocalShape | undefined {
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
      // `extends` puts members in another declaration, which a syntax-only scan cannot follow.
      return stmt.heritageClauses === undefined ? { kind: "members", members: stmt.members } : undefined;
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      return { kind: "type", type: stmt.type };
    }
  }
  return undefined;
}

/** The names an intersection contributes: every part merged, staying incomplete if any part is opaque. */
function namesOfIntersection({
  type,
  sf,
  seen,
}: {
  type: ts.IntersectionTypeNode;
  sf: ts.SourceFile;
  seen: ReadonlySet<string>;
}): ExpectedParams | undefined {
  const names: string[] = [];
  let complete = true;
  for (const part of type.types) {
    const partNames = namesOfTypeNode({ seen, sf, type: part });
    if (partNames === undefined) {
      return undefined;
    }
    appendAll({ from: partNames.names, into: names });
    complete = complete && partNames.complete;
  }
  return { complete, names };
}

/** The names a named type reference contributes, resolving it locally or admitting it is opaque. */
function namesOfTypeReference({
  type,
  sf,
  seen,
}: {
  type: ts.TypeReferenceNode;
  sf: ts.SourceFile;
  seen: ReadonlySet<string>;
}): ExpectedParams | undefined {
  const opaque: ExpectedParams = { complete: false, names: [] };
  if (!ts.isIdentifier(type.typeName)) {
    return opaque;
  }
  const name = type.typeName.text;
  // A self-referential alias would otherwise recurse forever.
  if (seen.has(name)) {
    return opaque;
  }
  const shape = localTypeShape({ name, sf });
  if (shape === undefined) {
    return opaque;
  }
  if (shape.kind === "members") {
    const names = literalFieldNames({ members: shape.members, sf });
    return names === undefined ? undefined : { complete: true, names };
  }
  return namesOfTypeNode({ seen: new Set([...seen, name]), sf, type: shape.type });
}

/**
 * The field names one type node contributes, and whether that is its whole contract.
 *
 * @param type the type node to read
 * @param sf the source file, for member-name text and local type resolution
 * @param seen alias names already expanded on this path, so a self-referential alias terminates
 * @returns the names plus completeness, or undefined for a shape whose members cannot be enumerated at all
 */
function namesOfTypeNode({
  type,
  sf,
  seen,
}: {
  type: ts.TypeNode;
  sf: ts.SourceFile;
  seen: ReadonlySet<string>;
}): ExpectedParams | undefined {
  // `type T = ({ a } & { b })` — the parens are a node of their own, and not unwrapping them made the whole
  // alias opaque, which hid an unbound required field. Codex's third counterexample in this family.
  if (ts.isParenthesizedTypeNode(type)) {
    return namesOfTypeNode({ seen, sf, type: type.type });
  }
  if (ts.isTypeLiteralNode(type)) {
    const names = literalFieldNames({ members: type.members, sf });
    return names === undefined ? undefined : { complete: true, names };
  }
  if (ts.isTypeReferenceNode(type)) {
    return namesOfTypeReference({ seen, sf, type });
  }
  if (ts.isIntersectionTypeNode(type)) {
    return namesOfIntersection({ seen, sf, type });
  }
  return undefined;
}

/**
 * The field names a destructured parameter's TYPE declares — the caller's actual contract, which is not the
 * same as what the body destructures.
 *
 * Measured, and the reason this reads the type rather than the binding pattern: three exported functions here
 * declare a field they deliberately never bind. `postProgress` requires `state: { kind: "not-started" }` so
 * the edge is only reachable from that state, and ignores its contents; `collapseProgressPhase` keeps `verb`
 * for a stable signature. A caller MUST pass those, so documenting them is correct — and reading the binding
 * pattern alone reported all three as stale tags, which was the scanner being wrong, not the code.
 *
 * @param param the parameter whose type is read
 * @param sf the source file, for member-name text and local type resolution
 * @returns the declared names plus whether they are the complete contract, or undefined when unreadable
 */
function declaredFieldNames({
  param,
  sf,
}: {
  param: ts.ParameterDeclaration;
  sf: ts.SourceFile;
}): ExpectedParams | undefined {
  return param.type === undefined ? undefined : namesOfTypeNode({ seen: new Set(), sf, type: param.type });
}

/** The field names a destructuring pattern binds, or undefined for a shape this scanner cannot name. */
function boundFieldNames({ pattern }: { pattern: ts.ObjectBindingPattern }): readonly string[] | undefined {
  const names: string[] = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined || element.name === undefined || !ts.isIdentifier(element.name)) {
      return undefined;
    }
    names.push(element.propertyName === undefined ? element.name.text : element.propertyName.getText());
  }
  return names;
}

/** The declared names then the bound ones, deduplicated; an absent half contributes nothing. */
function unionNames({
  declared,
  bound,
}: {
  declared: ExpectedParams | undefined;
  bound: readonly string[] | undefined;
}): readonly string[] {
  const union = new Set<string>();
  if (declared !== undefined) {
    declared.names.forEach((name) => union.add(name));
  }
  if (bound !== undefined) {
    bound.forEach((name) => union.add(name));
  }
  return Array.from(union);
}

/**
 * The parameter names a function's `@param` tags must name.
 *
 * For the house named-object shape (one destructured param) that is the FIELD names of its TYPE — the
 * caller's contract — falling back to the names the pattern binds when the type is a bare named reference.
 * For positional params it is the parameter identifiers. A parameter this scanner cannot name at all — a
 * nested pattern, an array pattern, a rest element — yields `undefined`, which the caller turns into an
 * `unnameable-param` DEFECT rather than a skip.
 *
 * @param node the function-like declaration
 * @param sf the source file the declaration belongs to
 * @returns the expected names and whether they are the complete contract, or undefined when undeterminable
 */
export function expectedParamNames({
  node,
  sf,
}: {
  node: ts.SignatureDeclaration;
  sf: ts.SourceFile;
}): ExpectedParams | undefined {
  const names: string[] = [];
  let complete = true;
  for (const param of node.parameters) {
    if (ts.isIdentifier(param.name)) {
      names.push(param.name.text);
      continue;
    }
    if (!ts.isObjectBindingPattern(param.name)) {
      return undefined;
    }
    const declared = declaredFieldNames({ param, sf });
    const bound = boundFieldNames({ pattern: param.name });
    if (declared === undefined && bound === undefined) {
      return undefined;
    }
    // An ANNOTATION this scanner cannot fully resolve is a hole, not a degradation — fail closed. Codex found
    // three separate instances of the same family (a bare interface, an alias to an intersection, then a
    // PARENTHESISED intersection), each hiding a required-but-unbound field behind a type the resolver did
    // not recognise. Rather than keep adding node kinds one counterexample at a time, an unresolvable
    // annotation now reports. Measured at ZERO occurrences across 996 destructured exported params, so the
    // strictness costs nothing today; the only unresolvable params here carry NO annotation at all, whose
    // contract legitimately lives on the variable's function type and cannot be reached syntactically.
    if (param.type !== undefined && declared?.complete !== true) {
      return undefined;
    }
    // UNION, not a fallback. An earlier version wrote `declared?.names ?? bound`, and because an opaque type
    // resolves to an EMPTY array rather than undefined, the `??` never fired — the bound fields went
    // unchecked and the function was effectively ungated while the gate reported clean. Codex found it.
    // A bound field is always part of the contract; the declared type only ever ADDS unbound ones.
    appendAll({ from: unionNames({ bound, declared }), into: names });
    complete = complete && declared?.complete === true;
  }
  return { complete, names };
}
