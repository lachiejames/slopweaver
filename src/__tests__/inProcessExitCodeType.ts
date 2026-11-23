/**
 * Whether a function's declared return type is an exit code — the half of `./inProcessVerbBodies.ts`'s verb-body
 * test that reads TYPES rather than calls, split out because it is judged against one module's own type names and
 * nothing else.
 *
 * It errs IN: a type is OUT only when its syntax positively shows it is no exit code ({@link NEVER_EXIT_CODE}, a
 * non-numeric literal, an object shape with no key that could be `exitCode`), and every other type — an imported
 * name, an intersection, no annotation at all — counts as one, because over-reporting a body only demands a gate a
 * reader then looks at, where under-reporting hides a path. Review found each narrower version missing a
 * spelling (`Promise<0 | 1>`, `outcomes.ExitCode`, a quoted `"exitCode"` key), which is why OUT is the list and IN
 * the default.
 */
import { nameOf, ts } from "#lib/tsSyntax.js";

/** What one module declares about its own type names, which is all a return type is judged against. */
export interface LocalTypes {
  /** Interfaces and object type aliases carrying an `exitCode` member. */
  readonly exitCodeShapes: ReadonlySet<string>;
  /** Interfaces and object type aliases carrying none. */
  readonly otherShapes: ReadonlySet<string>;
  /** Every other type alias, by name, to the type it names. */
  readonly aliases: ReadonlyMap<string, ts.TypeNode>;
  /** True when the module declares or imports its own `Promise`, so `Promise<T>` is no longer the built-in wrapper. */
  readonly promiseShadowed: boolean;
}

/** The names one top-level statement binds in type position: a declared type, or an imported binding. */
function typeNamesOf({ statement }: { statement: ts.Statement }): readonly string[] {
  const declaresType =
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement);
  if (declaresType) {
    return statement.name === undefined ? [] : [statement.name.text];
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    return [statement.name.text];
  }
  const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined;
  if (clause === undefined) {
    return [];
  }
  const bindings = clause.namedBindings;
  const named = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.map((e) => e.name.text) : [];
  const namespace = bindings !== undefined && ts.isNamespaceImport(bindings) ? [bindings.name.text] : [];
  const defaulted = clause.name === undefined ? [] : [clause.name.text];
  return [...defaulted, ...namespace, ...named];
}

/** The name and members of an interface or an object type alias, or null for any other statement. */
function shapeOf({
  statement,
}: {
  statement: ts.Statement;
}): { name: string; members: readonly ts.TypeElement[]; extendsAnother: boolean } | null {
  if (ts.isInterfaceDeclaration(statement)) {
    const extendsAnother = statement.heritageClauses !== undefined && statement.heritageClauses.length > 0;
    return { extendsAnother, members: statement.members, name: statement.name.text };
  }
  if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
    return { extendsAnother: false, members: statement.type.members, name: statement.name.text };
  }
  return null;
}

/**
 * Whether an object shape's members may carry `exitCode`. A member named `exitCode` in any spelling does, and so does
 * one whose key cannot be read off the syntax — a computed key, an index signature — since it errs IN, per the header.
 */
function membersMayCarryExitCode({ members }: { members: readonly ts.TypeElement[] }): boolean {
  return members.some((member) => {
    if (ts.isIndexSignatureDeclaration(member)) {
      return true;
    }
    const name = nameOf({ node: member });
    if (name === undefined) {
      return false;
    }
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isPrivateIdentifier(name)
    ) {
      return name.text === "exitCode";
    }
    return true;
  });
}

/**
 * The type names one module declares, sorted into what {@link returnsExitCode} reads.
 *
 * @returns the module's exit-code shapes, its other shapes, its remaining aliases, and whether it shadows `Promise`
 */
export function localTypes({ source }: { source: ts.SourceFile }): LocalTypes {
  const exitCodeShapes = new Set<string>();
  const otherShapes = new Set<string>();
  const aliases = new Map<string, ts.TypeNode>();
  const promiseShadowed = source.statements.some((statement) => typeNamesOf({ statement }).includes("Promise"));
  for (const statement of source.statements) {
    const shape = shapeOf({ statement });
    if (shape === null) {
      if (ts.isTypeAliasDeclaration(statement)) {
        aliases.set(statement.name.text, statement.type);
      }
      continue;
    }
    // An interface extending another may inherit `exitCode` from a shape this module cannot see: IN.
    const carriesExitCode = shape.extendsAnother || membersMayCarryExitCode({ members: shape.members });
    (carriesExitCode ? exitCodeShapes : otherShapes).add(shape.name);
  }
  return { aliases, exitCodeShapes, otherShapes, promiseShadowed };
}

/** Whether a literal type is a number: `0`, or `-1`. */
function isNumericLiteralType({ type }: { type: ts.LiteralTypeNode }): boolean {
  const literal = type.literal;
  return (
    ts.isNumericLiteral(literal) ||
    (ts.isPrefixUnaryExpression(literal) && literal.operator === ts.SyntaxKind.MinusToken)
  );
}

/** Whether a named type is an exit code: a local shape carrying `exitCode`, a local alias of one, or a name this
 * module does not declare (counted IN, per the header). */
function isExitCodeReference({
  name,
  locals,
  seen,
}: {
  name: string;
  locals: LocalTypes;
  seen: ReadonlySet<string>;
}): boolean {
  if (locals.exitCodeShapes.has(name)) {
    return true;
  }
  if (locals.otherShapes.has(name) || seen.has(name)) {
    return false;
  }
  const alias = locals.aliases.get(name);
  return alias === undefined || isExitCodeType({ locals, seen: new Set([...seen, name]), type: alias });
}

/** The type kinds that can never be an exit code, judged off the syntax alone. */
const NEVER_EXIT_CODE = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.NeverKeyword,
  ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.ArrayType,
  ts.SyntaxKind.TupleType,
  ts.SyntaxKind.FunctionType,
  ts.SyntaxKind.ConstructorType,
  ts.SyntaxKind.TypeOperator,
  ts.SyntaxKind.TemplateLiteralType,
]);

/**
 * Whether one type, its `Promise` already unwrapped, is an exit code; a union is one only when every member is. It
 * answers OUT only for a type it can positively judge to be no exit code, and IN for every other shape — an
 * intersection, a qualified or `import()` type, `typeof`, an indexed access, a mapped or conditional type.
 */
function isExitCodeType({
  type,
  locals,
  seen,
}: {
  type: ts.TypeNode;
  locals: LocalTypes;
  seen: ReadonlySet<string>;
}): boolean {
  if (NEVER_EXIT_CODE.has(type.kind)) {
    return false;
  }
  if (ts.isLiteralTypeNode(type)) {
    return isNumericLiteralType({ type });
  }
  if (ts.isParenthesizedTypeNode(type)) {
    return isExitCodeType({ locals, seen, type: type.type });
  }
  if (ts.isUnionTypeNode(type)) {
    return type.types.every((member) => isExitCodeType({ locals, seen, type: member }));
  }
  if (ts.isTypeLiteralNode(type)) {
    return membersMayCarryExitCode({ members: type.members });
  }
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return true;
  }
  return isExitCodeReference({ locals, name: type.typeName.text, seen });
}

/**
 * Whether a declared return type is an exit code, bare or inside a `Promise`. An absent annotation counts IN. A
 * shared parse shell returning `Prepared | { code }` is not a verb body: its object-literal member is no exit code,
 * so the union is not one. `Promise` is unwrapped only as the built-in, one type argument and no local or imported
 * `Promise` in the module; any other `Promise` is judged as the name it is (`type Promise = {
 * exitCode }` read as a wrapper with nothing inside).
 *
 * @param type the function's declared return type, absent when it declares none
 * @param locals the declaring module's own type names, from {@link localTypes}
 * @returns whether the function answers an exit code
 */
export function returnsExitCode({ type, locals }: { type: ts.TypeNode | undefined; locals: LocalTypes }): boolean {
  if (type === undefined) {
    return true;
  }
  const named = ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "Promise";
  const argument = ts.isTypeReferenceNode(type) && type.typeArguments?.length === 1 ? type.typeArguments[0] : undefined;
  if (named && argument !== undefined && !locals.promiseShadowed) {
    return isExitCodeType({ locals, seen: new Set(), type: argument });
  }
  return isExitCodeType({ locals, seen: new Set(), type });
}
