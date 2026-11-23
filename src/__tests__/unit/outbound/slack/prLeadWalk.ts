/*
 * The syntax walk behind `prLeadSeams/`: every invocation in one file, the keys its callee matches under, and
 * the named function it sits in. The grammar is declared here and pinned family by family in that test.
 *
 * - An INVOCATION is a call, a `new`, a tagged template, a decorator and a JSX element's tag. A call that runs another
 *   function it is handed — `f.call(…)`, `f.apply(…)`, `Reflect.apply(f, …)`, `Reflect.construct(f, …)` — is keyed by
 *   `f` as well as by itself.
 * - A callee is seen through every wrapper erased at run time (`./prLeadSyntax.ts`), and is keyed when it is an
 *   identifier, a member access by name or by a literal key (itself seen through those wrappers), or a conditional,
 *   logical, comma or `await` expression, each operand keyed the same way. Any other leaf is keyed `?` plus its source
 *   text, beside whatever its siblings key, so the test can refuse one that names a write rather than miss it.
 * - A VALUE USE is a reference to a watched member, by name, by literal key, or destructured by a declaration, a
 *   parameter or an assignment, that is not run where it stands: not an invocation's callee, nor the function `.call`,
 *   `.apply`, `Reflect.apply` or `Reflect.construct` runs. A watched bare entry reached as a namespace's member is
 *   the same, and so is one imported under another name or exported at all. Stored, bound, passed, put in an array,
 *   forwarded twice over, aliased by an import or re-exported, the test refuses every one.
 * - A NAMED function is a declaration (an anonymous `export default` one is `default`), method, constructor or
 *   accessor, or an arrow or function expression held by a variable, property, class field, binding element,
 *   parameter, shorthand destructuring default, assignment target or `export default`.
 *
 * Outside it, and stated in `src/outbound/slack/prLeadSeams.ts`: a member name computed from parts, a name spelled
 * with an escape sequence, an implicit invocation (an accessor, a coercion, an iterator), a bare-named entry
 * (`sendCard`) stored or passed as a value under its own name, and a function with no name of its own (an anonymous callback, a class
 * static block), whose calls count toward the named function around it.
 */
import {
  forEachChild,
  isParameterDeclaration,
  isStringLiteralLikeNode,
  type NamedDeclarationNode,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";

import { bare, holderOf, isTransparent, memberKeys, memberOf } from "./prLeadSyntax.js";

/**
 * Every extension the compiler takes a source in (`tsconfig.json` sets `allowJs` and `checkJs`), so a production
 * file in any of them is walked.
 */
export const WALKED_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Whether `operator` picks one of its two operands as its value: `||`, `&&`, `??`. */
function picksAnOperand({ operator }: { operator: ts.SyntaxKind }): boolean {
  return (
    operator === ts.SyntaxKind.BarBarToken ||
    operator === ts.SyntaxKind.AmpersandAmpersandToken ||
    operator === ts.SyntaxKind.QuestionQuestionToken
  );
}

/** The keys of a callee choosing between callees: a conditional, a logical or comma operator, or an `await`. */
function chosenKeys({ callee }: { callee: ts.Expression }): readonly string[] | undefined {
  if (ts.isConditionalExpression(callee)) {
    return [...keysOf({ callee: callee.whenTrue }), ...keysOf({ callee: callee.whenFalse })];
  }
  if (ts.isBinaryExpression(callee) && picksAnOperand({ operator: callee.operatorToken.kind })) {
    return [...keysOf({ callee: callee.left }), ...keysOf({ callee: callee.right })];
  }
  if (ts.isBinaryExpression(callee) && callee.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return keysOf({ callee: callee.right });
  }
  return ts.isAwaitExpression(callee) ? keysOf({ callee: callee.expression }) : undefined;
}

/** The keys `callee` matches under; a leaf the grammar cannot key is `?` plus its source text, beside its siblings. */
function keysOf({ callee }: { callee: ts.Expression }): readonly string[] {
  const at = bare({ expression: callee });
  if (ts.isIdentifier(at)) {
    return [at.text];
  }
  const member = memberOf({ expression: at });
  if (member !== undefined) {
    return memberKeys(member);
  }
  const chosen = chosenKeys({ callee: at });
  if (chosen !== undefined) {
    return chosen;
  }
  return [`?${at.getText()}`];
}

/** The method names that run the function they are called on: `f.call(…)`, `f.apply(…)`. */
const FORWARDING_METHODS: ReadonlySet<string> = new Set(["apply", "call"]);

/** The `Reflect` methods that run the function handed to them first: `Reflect.apply(f, …)`, `Reflect.construct(f, …)`. */
const FORWARDING_REFLECTS: ReadonlySet<string> = new Set(["Reflect.apply", "Reflect.construct"]);

/** The keys of the function a call runs on its caller's behalf, beside the call's own: none when it runs none. */
function forwardedKeys({ call }: { call: ts.CallExpression }): readonly string[] {
  const [target] = call.arguments;
  if (keysOf({ callee: call.expression }).some((key) => FORWARDING_REFLECTS.has(key))) {
    return target === undefined ? [] : keysOf({ callee: target });
  }
  const member = memberOf({ expression: call.expression });
  return member !== undefined && FORWARDING_METHODS.has(member.name) ? keysOf({ callee: member.receiver }) : [];
}

/** The expression `node` invokes, if it is an invocation: a call, `new`, tagged template, decorator or JSX tag. */
function invokedCallee({ node }: { node: ts.Node }): ts.Expression | undefined {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    return node.expression;
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return node.tag;
  }
  if (ts.isDecorator(node)) {
    return ts.isCallExpression(node.expression) ? undefined : node.expression;
  }
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    return ts.isJsxNamespacedName(node.tagName) ? undefined : node.tagName;
  }
  return undefined;
}

/** Whether `parent` may take `child`'s value as its own: a conditional's branch, a logical operand, a comma's right, an `await`. */
function passesThrough({ child, parent }: { child: ts.Node; parent: ts.Node }): boolean {
  if (ts.isConditionalExpression(parent)) {
    return child === parent.whenTrue || child === parent.whenFalse;
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return child === parent.right;
  }
  const picks = ts.isBinaryExpression(parent) && picksAnOperand({ operator: parent.operatorToken.kind });
  return picks || ts.isAwaitExpression(parent);
}

/** The outermost expression whose value is `node`'s own, up through every erased wrapper and pass-through operand. */
function valueOf({ node }: { node: ts.Node }): ts.Node {
  let at = node;
  while (isTransparent(at.parent) || passesThrough({ child: at, parent: at.parent })) {
    at = at.parent;
  }
  return at;
}

/** Whether `node` is run where it stands: an invocation's callee, or the function a forwarding call runs. */
function isInvoked({ node }: { node: ts.Node }): boolean {
  const value = valueOf({ node });
  const { parent } = value;
  if (invokedCallee({ node: parent }) === value) {
    return true;
  }
  const member =
    ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)
      ? memberOf({ expression: parent })
      : undefined;
  if (member?.receiver === value) {
    return FORWARDING_METHODS.has(member.name) && isInvoked({ node: parent });
  }
  const reflected = ts.isCallExpression(parent) && parent.arguments[0] === value;
  return reflected && keysOf({ callee: parent.expression }).some((key) => FORWARDING_REFLECTS.has(key));
}

/** A property name's text: an identifier, a quoted key, or a computed key that is a literal under erased wrappers. */
function propertyText({ name }: { name: ts.Node | undefined }): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const key = ts.isComputedPropertyName(name) ? bare({ expression: name.expression }) : name;
  return ts.isIdentifier(key) || isStringLiteralLikeNode(key) ? key.text : undefined;
}

/** `.name`, and `source.name` when the destructured source is a plain identifier. */
function takenKeys({ name, source }: { name: string; source: ts.Expression | undefined }): readonly string[] {
  return source === undefined ? [`.${name}`] : memberKeys({ name, receiver: source });
}

/** The name a destructuring element or an import/export specifier reads from its source: the renamed one, if any. */
function sourceName({
  node,
}: {
  node: ts.BindingElement | ts.ImportSpecifier | ts.ExportSpecifier;
}): ts.BindingName | ts.PropertyName | ts.ModuleExportName | undefined {
  // An array pattern's hole has no name, and reads no key.
  if (node.propertyName === undefined) {
    return node.name;
  }
  return node.propertyName;
}

/** The keys a declaration's destructuring element takes a member out under. */
function bindingKeys({ element }: { element: ts.BindingElement }): readonly string[] {
  const name = propertyText({ name: sourceName({ node: element }) });
  if (name === undefined || !ts.isObjectBindingPattern(element.parent)) {
    return [];
  }
  const declaration = element.parent.parent;
  return takenKeys({ name, source: ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined });
}

/** `holder` when it is an `=` assignment whose target is `pattern`, else `undefined`. */
function assignmentTo({ holder, pattern }: { holder: ts.Node; pattern: ts.Node }): ts.BinaryExpression | undefined {
  const assigns = ts.isBinaryExpression(holder) && holder.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  return assigns && bare({ expression: holder.left }) === pattern ? holder : undefined;
}

/** Whether an object or array literal is a destructuring assignment's target, directly or nested inside one. */
function isAssignedPattern({ pattern }: { pattern: ts.Node }): boolean {
  const holder = holderOf({ node: pattern });
  if (assignmentTo({ holder, pattern }) !== undefined) {
    return true;
  }
  if (ts.isForOfStatement(holder) || ts.isForInStatement(holder)) {
    const initializer = holder.initializer;
    const isExpression = !ts.isVariableDeclarationList(initializer) && !ts.isMissingDeclaration(initializer);
    return isExpression && bare({ expression: initializer }) === pattern;
  }
  if (ts.isPropertyAssignment(holder) || ts.isSpreadElement(holder)) {
    return isAssignedPattern({ pattern: holder.parent });
  }
  return ts.isArrayLiteralExpression(holder) && isAssignedPattern({ pattern: holder });
}

/** The keys a destructuring ASSIGNMENT's property takes a member out under: `({ postCard: post } = api)`. */
function assignedKeys({ property }: { property: ts.ObjectLiteralElementLike }): readonly string[] {
  const named = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property);
  const literal = property.parent;
  if (!named || !isAssignedPattern({ pattern: literal })) {
    return [];
  }
  const name = propertyText({ name: property.name });
  const source = assignmentTo({ holder: holderOf({ node: literal }), pattern: literal })?.right;
  return name === undefined ? [] : takenKeys({ name, source });
}

/** An import that renames a binding, and every export of one, by its original name: `import { sendCard as deliver }`. */
function renamedKeys({ node }: { node: ts.ImportSpecifier | ts.ExportSpecifier }): readonly string[] {
  if (ts.isImportSpecifier(node) && node.propertyName === undefined) {
    return [];
  }
  const name = propertyText({ name: sourceName({ node }) });
  return name === undefined ? [] : [name];
}

/**
 * The keys a member reference, destructuring element or destructured property names when it is not run where it
 * stands, and the name an import or export renames: a value use.
 */
function usedKeys({ node }: { node: ts.Node }): readonly string[] {
  if (ts.isBindingElement(node)) {
    return bindingKeys({ element: node });
  }
  if (ts.isObjectLiteralElementLike(node)) {
    return assignedKeys({ property: node });
  }
  if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
    return renamedKeys({ node });
  }
  const member =
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? memberOf({ expression: node })
      : undefined;
  return member === undefined || isInvoked({ node }) ? [] : memberKeys(member);
}

/** The watched name `key` reaches: itself, or a bare entry reached as a member (`.sendCard` of a namespace). */
function watchedAs({ key, watch }: { key: string; watch: ReadonlySet<string> }): string | undefined {
  if (watch.has(key)) {
    return key;
  }
  const entry = key.slice(1);
  return key.startsWith(".") && watch.has(entry) ? entry : undefined;
}

/** The name an assignment target gives the value assigned to it. */
function targetName({ target }: { target: ts.Expression }): string {
  const member = memberOf({ expression: target });
  return member === undefined ? bare({ expression: target }).getText() : member.name;
}

/** Whether `holder` names the function it holds by its own `name`. */
function namesByName(holder: ts.Node): holder is NamedDeclarationNode & { readonly name: ts.Node } {
  return (
    ts.isVariableDeclaration(holder) ||
    ts.isPropertyAssignment(holder) ||
    ts.isPropertyDeclaration(holder) ||
    ts.isBindingElement(holder) ||
    isParameterDeclaration(holder) ||
    ts.isShorthandPropertyAssignment(holder)
  );
}

/** The name `holder` gives an arrow or function expression it holds, if any. */
function heldName({ holder }: { holder: ts.Node }): string | undefined {
  if (namesByName(holder)) {
    return holder.name.getText();
  }
  if (ts.isBinaryExpression(holder) && holder.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return targetName({ target: holder.left });
  }
  return ts.isExportAssignment(holder) ? "default" : undefined;
}

/** The name a function-like node carries — its own, or the one its holder gives it — if any. */
function functionName({ node }: { node: ts.Node }): string | undefined {
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (ts.isFunctionDeclaration(node)) {
    return node.name === undefined ? "default" : node.name.text;
  }
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    return node.name.getText();
  }
  if (ts.isFunctionExpression(node) && node.name !== undefined) {
    return node.name.text;
  }
  const held = ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  return held ? heldName({ holder: holderOf({ node }) }) : undefined;
}

/** One walked file: every invocation, and every value use of a watched member. */
interface Walk {
  /** One entry per invocation in source order; `within` is `<module>` outside every named function. */
  readonly calls: readonly { keys: readonly string[]; within: string }[];
  /** One entry per reference to a watched member that is not run where it stands: stored, passed, bound, destructured. */
  readonly uses: readonly { key: string; within: string }[];
}

/**
 * Every invocation in `text`, with the keys its callee matches under and the named function it sits in, and every
 * reference to a member keyed in `watch` that is not run where it stands. A function is identified by the chain of
 * named functions around it (`previewOrSend/perform`), and two distinct functions whose chains are equal are told
 * apart by their order in the file (`f/perform#1`, `f/perform#2`), so no two named functions share a bucket. The
 * file's extension decides how it parses, so `.tsx` reads JSX.
 *
 * @returns the file's invocations and its watched members' value uses, each in source order
 */
export function walkFile({ path, text, watch }: { path: string; text: string; watch: ReadonlySet<string> }): Walk {
  return withSourceFile({
    fileName: path,
    text,
    use: (file): Walk => {
      const named: { chain: string; node: ts.Node }[] = [];
      const calls: { keys: readonly string[]; scope: ts.Node | undefined }[] = [];
      const uses: { key: string; scope: ts.Node | undefined }[] = [];
      const visit = ({ chain, node, scope }: { chain: string; node: ts.Node; scope: ts.Node | undefined }): void => {
        const callee = invokedCallee({ node });
        if (callee !== undefined) {
          const forwarded = ts.isCallExpression(node) ? forwardedKeys({ call: node }) : [];
          calls.push({ keys: [...keysOf({ callee }), ...forwarded], scope });
        }
        const keys = watch.size === 0 ? [] : usedKeys({ node });
        const used = keys.map((key) => watchedAs({ key, watch })).find((key) => key !== undefined);
        if (used !== undefined) {
          uses.push({ key: used, scope });
        }
        const name = functionName({ node });
        const inner =
          name === undefined ? { chain, scope } : { chain: chain === "" ? name : `${chain}/${name}`, scope: node };
        if (name !== undefined) {
          named.push({ chain: inner.chain, node });
        }
        forEachChild({
          node,
          visit: (child) => {
            visit({ ...inner, node: child });
          },
        });
      };
      visit({ chain: "", node: file, scope: undefined });
      const labels = new Map<ts.Node, string>();
      for (const [chain, group] of Map.groupBy(named, ({ chain: key }) => key)) {
        group.forEach(({ node }, index) =>
          labels.set(node, group.length === 1 ? chain : `${chain}#${String(index + 1)}`),
        );
      }
      const within = ({ scope }: { scope: ts.Node | undefined }): string =>
        scope === undefined ? "<module>" : labels.get(scope)!;
      return {
        calls: calls.map(({ keys, scope }) => ({ keys, within: within({ scope }) })),
        uses: uses.map(({ key, scope }) => ({ key, within: within({ scope }) })),
      };
    },
  });
}

/**
 * Every invocation in `text`, as {@link walkFile} reads it with nothing watched.
 *
 * @returns one entry per invocation in source order; `within` is `<module>` outside every named function
 */
export function callsIn({ path, text }: { path: string; text: string }): Walk["calls"] {
  return walkFile({ path, text, watch: new Set() }).calls;
}
