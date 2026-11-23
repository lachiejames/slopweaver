/**
 * Walking a call's CALLEE chain on the TypeScript AST, without knowing what any of it means.
 *
 * Split out of `testAssertionCounts.ts` along the seam the review history had already drawn: every
 * function here answers a question about SHAPE — which identifier a chain hangs off, which property names
 * it passes through, which argument each of them was applied to — and none of them knows a matcher from a
 * modifier. The vitest vocabulary, and every judgement made with it, stays in the counter.
 *
 * The invariant the whole file keeps, and the reason it is one file: no walk ever steps onto a node it has
 * not unwrapped first. The same root cause recurred four times, each time in
 * whichever walker still took a raw `.expression` — `(it).only`, then `(it.only)(…)`, then
 * `(it.only).each(…)`, then the element-access key in `it[("skip")]`. Together in one module they share
 * one `unwrapWrappers` and the family cannot regrow a member.
 */

import { isTypeAssertion, ts } from "#lib/tsSyntax.js";

/*
 * The wrapper family, in one place, read in two directions. `unwrapWrappers` walks DOWN through it to the
 * value a call names; `isChainBuildingCall` walks UP through it to the call that finally runs. Holding the
 * list once is the point: four review passes found the same evasion in whichever walker still spelled its
 * own copy.
 */

function wrapsValue(
  node: ts.Node,
): node is
  ts.ParenthesizedExpression | ts.NonNullExpression | ts.AsExpression | ts.SatisfiesExpression | ts.TypeAssertion {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    isTypeAssertion(node)
  );
}

/**
 * Strip the wrappers that change nothing about WHICH function a call names.
 *
 * `(it).only("a", …)` breaks a walk that skips this: the parenthesis stopped the
 * callee walk one node short of the identifier, so `.only` was never seen and a head that silenced every
 * other case in the file compared as unchanged. `it!`, `it as never` and `it satisfies T` are the same
 * evasion spelled differently, and `<typeof it.only>it.only` is a fifth. Every walk below shares this one
 * definition and applies it at EVERY hop, because fixing one walker leaves the same root cause alive in the
 * next: it appeared in `rootIdentifier`, then both shape guards, then `accessNames`.
 *
 * @returns the same expression with every value-preserving wrapper stripped off the outside
 */
export function unwrapWrappers({ node }: { node: ts.Expression }): ts.Expression {
  let current: ts.Expression = node;
  while (wrapsValue(current)) current = current.expression;
  return current;
}

/**
 * One hop of a member access, whichever way it is spelled.
 *
 * `it.skip` and `it["skip"]` name the same property and vitest treats them identically, so a walk that
 * only knows the dotted spelling can be stepped around with brackets — a
 * genuinely failing case disabled with `it["skip"](…)` makes the gate print `clean`. A computed key that is
 * not a literal is deliberately NOT resolved: deciding what `it[modifier]` names needs dataflow, and a
 * checker that guessed would be worse than one that says it cannot see.
 *
 * @param node the expression to read one hop of
 * @returns the property name and the object it sits on, or undefined when this is not a member access
 */
export function memberAccess({ node }: { node: ts.Expression }): { name: string; object: ts.Expression } | undefined {
  if (ts.isPropertyAccessExpression(node)) return { name: node.name.text, object: node.expression };
  if (!ts.isElementAccessExpression(node)) return undefined;
  // Unwrap the KEY as well as the object. `it[("only")]` is the same property as `it["only"]`, and the
  // raw-key spelling read a ParenthesizedExpression and gave up — so a parenthesis around the string
  // silenced a whole file through the focus count, and `it[("skip")]` disabled a failing case. The
  // element-access half is a separate hole from the bracket half; the
  // invariant this tree keeps repeating is that no walk steps onto a node without unwrapping it first.
  const key = unwrapWrappers({ node: node.argumentExpression });
  if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
    return { name: key.text, object: node.expression };
  }
  return undefined;
}

/**
 * The identifier a (possibly chained) call or property access ultimately hangs off.
 *
 * It unwraps CALLS as well as property accesses, and that is the whole point: the shape it has to see
 * through is `expect(value).not.toBe(other)`, where the matcher sits on a property access whose own
 * expression is the `expect(value)` call rather than an identifier. Stopping at the call would report
 * every exact-value matcher in the repository as absent.
 *
 * @returns the identifier the chain hangs off, or undefined when it bottoms out on something else
 */
export function rootIdentifier({ node }: { node: ts.Expression }): string | undefined {
  let current: ts.Expression = node;
  for (;;) {
    const hop = memberAccess({ node: current });
    if (hop !== undefined) {
      current = hop.object;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    // The TAG is a hop like any other. A tagged-template `.each` table
    // invoked with a `{ skip: true }` option combines two spellings this walker already handled apart, and the
    // combination escaped, because the option reader asks THIS function what the call's root is and the
    // walk stopped at the template. Every node kind a callee can be built from belongs in this loop.
    if (ts.isTaggedTemplateExpression(current)) {
      current = current.tag;
      continue;
    }
    const unwrapped = unwrapWrappers({ node: current });
    if (unwrapped !== current) {
      current = unwrapped;
      continue;
    }
    break;
  }
  if (ts.isIdentifier(current)) return current.text;
  return undefined;
}

/**
 * One chain hop, spelled so that an absent argument is an absent FIELD.
 *
 * `exactOptionalPropertyTypes` refuses an explicit `argument: undefined`, so the two shapes are pushed
 * apart here rather than written as one object with a maybe-undefined field at every call site.
 *
 * @param argument the sole argument the hop was applied to, when it had one
 * @returns the hop record
 */
function hopOf({ argument, name }: { argument: ts.Expression | undefined; name: string }): {
  argument?: ts.Expression;
  name: string;
} {
  if (argument === undefined) return { name };
  return { argument, name };
}

/**
 * A call's one and only argument.
 *
 * A modifier that took several is not one whose literal this tree ever reads, and answering undefined is
 * what keeps an unreadable condition weighed as a real skip rather than as a neutralised one.
 *
 * @param node the call to read
 * @returns its sole argument, or undefined when it took none or more than one
 */
function soleArgument({ node }: { node: ts.CallExpression }): ts.Expression | undefined {
  if (node.arguments.length !== 1) return undefined;
  return node.arguments[0];
}

/**
 * Every modifier in a call's callee chain, with the argument it was APPLIED to, outermost first.
 *
 * Walking through a CallExpression rather than stopping at one is the whole point, and this is why: `describe.skipIf(true).skipIf(false)` is two calls, so a walk that stopped at the first
 * saw two independent one-hop chains instead of one two-hop chain — each scored on its own, the override
 * lost, and the same modifier counted twice. A modifier's own argument travels with it here, so no caller
 * has to work out which hop a call's arguments belonged to.
 *
 * @param node the expression in the callee or tag position
 * @returns the chain's modifiers, last-applied first, each with its own sole argument when it had one
 */
export function chainModifiers({
  node,
}: {
  node: ts.Expression;
}): readonly { argument?: ts.Expression; name: string }[] {
  const hops: { argument?: ts.Expression; name: string }[] = [];
  // Unwrap at EVERY hop, not at the ends. The same root cause appeared in three different helpers
  // — `(it).only`, then `(it.only)(…)`, then `(it.only).each(…)`, each landing in
  // whichever walker still took a raw `.expression`. The invariant that closes the family rather than the
  // spelling: no walk here ever steps onto a node without unwrapping it first.
  let current: ts.Expression = unwrapWrappers({ node });
  // The arguments of the call this hop is the callee of — they belong to the NEXT property name down.
  let pending: ts.Expression | undefined = undefined;
  for (;;) {
    const hop = memberAccess({ node: current });
    if (hop !== undefined) {
      hops.push(hopOf({ argument: pending, name: hop.name }));
      pending = undefined;
      current = unwrapWrappers({ node: hop.object });
      continue;
    }
    if (ts.isCallExpression(current)) {
      pending = soleArgument({ node: current });
      current = unwrapWrappers({ node: current.expression });
      continue;
    }
    if (ts.isTaggedTemplateExpression(current)) {
      pending = undefined;
      current = unwrapWrappers({ node: current.tag });
      continue;
    }
    break;
  }
  return hops;
}

/**
 * Every property name in a call's callee chain, outermost first.
 *
 * @returns the chain's property names, last-applied first
 */
export function accessNames({ node }: { node: ts.Expression }): readonly string[] {
  return chainModifiers({ node }).map((hop) => hop.name);
}

/**
 * The expression in the callee or tag position, for the two node kinds that can carry a suite modifier.
 *
 * @param node any node in the tree
 * @returns the callee, or undefined when this node invokes nothing
 */
export function calleeOf({ node }: { node: ts.Node }): ts.Expression | undefined {
  if (ts.isCallExpression(node)) return node.expression;
  if (ts.isTaggedTemplateExpression(node)) return node.tag;
  return undefined;
}

/**
 * The sub-expression a node reads its own chain from — its callee, its tag, or the object under a property.
 *
 * This is the upward counterpart of the walks above: given a PARENT, it says which of its children is the
 * one continuing a chain rather than being an argument of it.
 *
 * @param node the enclosing node
 * @returns the child that continues the chain, or undefined when this node continues none
 */
function chainHostOf({ node }: { node: ts.Node }): ts.Expression | undefined {
  if (ts.isCallExpression(node)) return node.expression;
  if (ts.isTaggedTemplateExpression(node)) return node.tag;
  if (ts.isPropertyAccessExpression(node)) return node.expression;
  if (ts.isElementAccessExpression(node)) return node.expression;
  return undefined;
}

/**
 * Whether this node is the CALLEE of an enclosing call, rather than the call that finally runs.
 *
 * `describe.skipIf(true).skipIf(false)("s", fn)` is three nested calls over one chain, and every one of
 * them resolves to the same suite root. Scoring each would retain a modifier the outermost one overrides
 * and count a repeated modifier twice — both halves of the defect. Only the
 * call in RUN position scores; the ones under it are chain-building, and `chainModifiers` reads them from
 * there. Wrappers are stepped through, because `(it.skipIf(false))("a", fn)` puts a parenthesis between.
 *
 * @param node the node being visited
 * @returns true when an enclosing call would score this same chain
 */
export function isChainBuildingCall({ node }: { node: ts.Node }): boolean {
  let current: ts.Node = node;
  for (;;) {
    // `parent` is typed non-optional, so testing it against undefined is a condition the compiler can
    // prove constant — CI's typecheck said so. The SOURCE FILE is the node that really has none, and
    // asking that question instead is both true at runtime and checkable.
    if (ts.isSourceFile(current)) return false;
    const parent: ts.Node = current.parent;
    if (wrapsValue(parent)) {
      current = parent;
      continue;
    }
    return chainHostOf({ node: parent }) === current;
  }
}
