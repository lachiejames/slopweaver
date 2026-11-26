/**
 * Counting what a test file ASSERTS, on the TypeScript AST rather than on its text.
 *
 * Split out from the gate that consumes it so the counting is a pure function over a string, testable
 * against handwritten sources with no git, no filesystem and no repository state. The gate
 * (`testEnshittification.ts`) supplies two versions of the same path and compares two of these records.
 *
 * Why the AST and not a regular expression: `expect(` appears inside every `toThrow` message, every
 * `toContain` fragment asserting on a test's own output, and in this repository's own lint-gate fixtures,
 * which embed sample test sources as string literals. A text count of the file you are reading right now
 * would be wrong for exactly that reason. `forEachChild` sees call expressions and nothing else.
 */

import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import {
  accessNames,
  calleeOf,
  chainModifiers,
  isChainBuildingCall,
  memberAccess,
  rootIdentifier,
  unwrapWrappers,
} from "./testChainWalk.js";

/**
 * A matcher that pins an exact value, as opposed to one that passes for a whole class of them.
 *
 * `toMatchObject` is deliberately NOT here, and that is the correction rather than an omission: it asserts
 * a SUBSET, so `expect(user).toMatchObject({ id: "u1" })` passes on a record that also carries a field the
 * test was written to reject. While it counted as strong, swapping `toEqual` for it left all four counts
 * identical — a test went from exit 1 to exit 0 that way, as a plausible attempt to make a serialisation
 * test less brittle, not an attempt to evade a gate. Out of the
 * set, the same swap is a FALL in `strong` and the gate names it.
 */
const STRONG_MATCHERS: ReadonlySet<string> = new Set(["toBe", "toEqual", "toHaveLength", "toStrictEqual"]);

/**
 * The modifiers that can stop a case from running. Each scores one `skipped`, except a conditional whose
 * own argument is the literal that neutralises it — `skipWeightOf` has the exact rule.
 *
 * The criterion is what the modifier DOES, not how it is spelled: `skipIf` and `runIf` gate a case on a
 * condition that is usually not a literal and so cannot be evaluated here, and `todo` never runs one at
 * all, so each is a way to silence a test while leaving every assertion in it written. A condition this
 * gate cannot read counts, because an unreadable condition must never score as weaker than it is.
 * A genuinely failing suite turned into
 * `describe.skipIf(true)` takes vitest from exit 1 to exit 0 with all four counts unchanged;
 * both `.skipIf` and `.todo` already stand in this tree. `.fails` is deliberately NOT here — it inverts a
 * verdict rather than removing one, which is a different weakening and would need its own count.
 */
const SKIP_MODIFIERS: ReadonlySet<string> = new Set(["runIf", "skip", "skipIf", "todo"]);

/** The modifier that silences every OTHER case in its own FILE — vitest scopes focus per file, not per run. */
const FOCUS_MODIFIERS: ReadonlySet<string> = new Set(["only"]);

/** The suite and case functions those modifiers attach to. */
const SUITE_FUNCTIONS: ReadonlySet<string> = new Set(["bench", "describe", "it", "suite", "test"]);

/**
 * The functions whose chain resolves LAST-APPLIED-WINS rather than any-modifier-wins.
 *
 * Vitest reads a SUITE's chain differently from a CASE's, and the difference is load-bearing rather than
 * a curiosity: a later conditional OVERRIDES an earlier `.skip` on a suite and does not on a case.
 * MEASURED on vitest 4.1.11, each line its own file, `node node_modules/vitest/vitest.mjs run <f> --root
 * <dir> --config vitest.config.mjs --configLoader native --reporter verbose`, exit code as the verdict:
 *
 *     describe.skip.skipIf(false)         RUNS     it.skip.skipIf(false)         SKIPS
 *     describe.skip.runIf(true)           RUNS     it.skip.runIf(true)           SKIPS
 *     describe.skip.skipIf(true)          SKIPS    it.skipIf(false).skip         SKIPS
 *     describe.skipIf(false).skip         SKIPS    describe.skip                 SKIPS
 *     describe.skipIf(true).skipIf(false) RUNS     it.skipIf(true).skipIf(true)  SKIPS
 *     describe.skipIf(false).skipIf(true) SKIPS    it.skipIf(true).skipIf(false) SKIPS
 *
 * So a suite takes the OUTERMOST skip modifier's weight and a case takes the maximum over its chain.
 * Leaving that unmodelled was disproved by running both ends:
 * `describe.skip.skipIf(false)` RUNS and `describe.skip` SKIPS, so deleting the conditional silences a
 * genuinely failing case — and with one weight for both, `weakenings` named nothing. An over-count is
 * only ever safe while it cannot sit on the BASE side of a pair, and here it could.
 *
 * The right column's last two rows are why `chainModifiers` walks THROUGH a call: `it.skipIf(true)`
 * skips one case and so does `it.skipIf(true).skipIf(true)`, so a per-segment count reporting two would
 * refuse a file that skipped exactly what it always had (the other direction of the same
 * defect).
 *
 * `bench` is not measured and takes the case rule, which is the stickier of the two.
 */
const LAST_WINS_FUNCTIONS: ReadonlySet<string> = new Set(["describe", "suite"]);

/**
 * What one test file claims, reduced to four numbers.
 *
 * `expects` is the breadth of the file, `strong` the part of that breadth that pins an exact value,
 * `skipped` what it has stopped running, and `focused` what would silence every other case in the same file.
 */
export interface AssertionCounts {
  readonly expects: number;
  readonly focused: number;
  readonly skipped: number;
  readonly strong: number;
}

/** The local names `expect` and the suite functions are bound to in ONE file, after import aliasing. */
export interface Bindings {
  readonly expects: ReadonlySet<string>;
  readonly lastWins: ReadonlySet<string>;
  readonly suites: ReadonlySet<string>;
}

/** One import's aliases, as the local names they bind. */
function aliasesOf({ statement }: { statement: ts.ImportDeclaration }): readonly { local: string; imported: string }[] {
  const named = statement.importClause?.namedBindings;
  if (named === undefined || !ts.isNamedImports(named)) return [];
  const aliased = named.elements.filter((element) => element.propertyName !== undefined);
  return aliased.map((element) => ({ imported: element.propertyName!.text, local: element.name.text }));
}

/**
 * Resolve what `expect`, `it`, `describe` and friends are actually CALLED in one file.
 *
 * The miss reproduces end to end: with `import { expect as check } from "vitest"`,
 * a counter keyed on the literal identifier `expect` scores the file {0,0,0,0} at BOTH commits, so deleting
 * an assertion from it is invisible — the gate printed `clean` on a file that had just lost one. The
 * defaults stay, because most files here use the globals and import nothing.
 *
 * @param source the parsed test file
 * @returns the local names to treat as assertions, as suite functions, and as last-wins suite functions
 */
export function bindingsOf({ source }: { source: ts.SourceFile }): Bindings {
  const expects = new Set<string>(["expect"]);
  const suites = new Set<string>(SUITE_FUNCTIONS);
  const lastWins = new Set<string>(LAST_WINS_FUNCTIONS);
  const imports = source.statements.filter((statement) => ts.isImportDeclaration(statement));
  for (const alias of imports.flatMap((statement) => aliasesOf({ statement }))) {
    if (alias.imported === "expect") expects.add(alias.local);
    if (SUITE_FUNCTIONS.has(alias.imported)) suites.add(alias.local);
    if (LAST_WINS_FUNCTIONS.has(alias.imported)) lastWins.add(alias.local);
  }
  return { expects, lastWins, suites };
}

/**
 * Whether a call is `expect(...)`, by callee identifier.
 *
 * @returns true when the callee, wrappers stripped, is a name this file binds to `expect`
 */
export function isExpectCall({ node, bindings }: { node: ts.CallExpression; bindings: Bindings }): boolean {
  const callee = unwrapWrappers({ node: node.expression });
  return ts.isIdentifier(callee) && bindings.expects.has(callee.text);
}

/**
 * Whether a call is an `expect(...)…<strong matcher>(...)` chain.
 *
 * Reading the CHAIN rather than the bare matcher name is what keeps `.not.toBe(…)` counted and a
 * same-named method on an unrelated object out — the root of the chain has to be `expect`.
 *
 * @returns true when the call is an exact-value matcher hanging off this file's `expect`
 */
export function isStrongMatcherCall({ node, bindings }: { node: ts.CallExpression; bindings: Bindings }): boolean {
  // Unwrap BEFORE the shape test, not after. The previous spelling broke on
  // `(it.only)(…)`: parenthesising the WHOLE callee makes this expression a ParenthesizedExpression, so a
  // guard that demands a property access here rejects it and never reaches the unwrap inside
  // `rootIdentifier`. `(expect(1).toBe)(1)` is the same hole on this counter.
  const callee = unwrapWrappers({ node: node.expression });
  const hop = memberAccess({ node: callee });
  if (hop === undefined) return false;
  if (!STRONG_MATCHERS.has(hop.name)) return false;
  const root = rootIdentifier({ node: callee });
  return root !== undefined && bindings.expects.has(root);
}

/**
 * Whether a callee names a suite or case carrying a focus or a skip modifier, and which bucket it lands in.
 *
 * `describe.skip`, `it.skip`, `test.only` and `it.each(…).skip` all reduce to the same shape: the chain's
 * root identifier is a suite function and one of its property names is a modifier. It takes the CALLEE
 * rather than the call because a `.each` table can be written as a tagged template, whose tag is the only
 * place the modifier appears — `it.only.each` in that spelling escapes
 * a reader that looked at call expressions alone, focusing a whole file with every count unchanged.
 *
 * @param callee the expression in the callee or tag position
 * @returns which bucket the modifier falls in, or undefined when this is not a modified suite function
 */
function focusModifierOf({
  callee,
  bindings,
}: {
  callee: ts.Expression;
  bindings: Bindings;
}): "only" | "skip" | undefined {
  const unwrapped = unwrapWrappers({ node: callee });
  const root = rootIdentifier({ node: unwrapped });
  if (root === undefined) return undefined;
  if (!bindings.suites.has(root)) return undefined;
  const names = accessNames({ node: unwrapped });
  // "Carries a modifier at all" is the test, and it has to be asked of the WHOLE chain. Asking whether
  // the callee is itself a member access was the same question only while a chain was one unbroken
  // segment: `it.skipIf(true)("r", fn)` hands this a CallExpression, and the early return scored the file
  // zero once the inner call stopped being counted separately.
  if (names.length === 0) return undefined;
  if (names.some((name) => FOCUS_MODIFIERS.has(name))) return "only";
  if (names.some((name) => SKIP_MODIFIERS.has(name))) return "skip";
  return undefined;
}

/**
 * The conditional modifiers, each against the literal argument that makes it skip NOTHING.
 *
 * A conditional carries its answer in its own argument when that argument is a literal, so reading it is
 * what lets a flip of that literal move the count at all.
 */
const NEUTRALISING_LITERAL: ReadonlyMap<string, ts.SyntaxKind> = new Map([
  ["runIf", ts.SyntaxKind.TrueKeyword],
  ["skipIf", ts.SyntaxKind.FalseKeyword],
]);

/**
 * How much skipping ONE modifier in a chain contributes.
 *
 * A conditional whose own literal argument says it never skips contributes nothing; everything else
 * contributes one, a non-literal condition included, because deciding a flag or an environment read needs
 * dataflow and the unreadable case must not read as weaker than it is.
 *
 * @param name the modifier's property name
 * @param ownsArguments whether this modifier is the hop the visited call's arguments belong to
 * @param argument the visited call's sole argument, when it has exactly one
 * @returns 1 when this modifier can stop a case running, 0 when its own literal says it cannot
 */
function skipWeightOf({ argument, name }: { argument: ts.Expression | undefined; name: string }): number {
  if (!SKIP_MODIFIERS.has(name)) return 0;
  const neutral = NEUTRALISING_LITERAL.get(name);
  if (neutral === undefined || argument === undefined) return 1;
  return unwrapWrappers({ node: argument }).kind === neutral ? 0 : 1;
}

/**
 * Whether one call's callee chain stops its subject running, scored modifier by modifier.
 *
 * Scoring each modifier separately rather than collapsing the call into one bucket is what makes a flipped
 * literal observable at all, and running both ends shows why: with a per-CALL
 * bucket, `it.skipIf(false)` and `it.skip.skipIf(false)` both scored one, so adding a real `.skip` to a
 * failing case silenced it with the count unmoved, and flipping `skipIf(false)` to `skipIf(true)` did the
 * same. Only the OUTERMOST hop owns this call's arguments: in `it.skip.skipIf(false)` the `false` answers
 * `skipIf` and says nothing about the `.skip` beside it.
 *
 * How the per-modifier weights then COMBINE is vitest's own rule and differs by callee — a suite takes
 * the outermost modifier alone, a case takes the maximum. `LAST_WINS_FUNCTIONS` carries the measurement
 * and the counterexample that forced it; guessing one rule for both let a real weakening score flat.
 *
 * @param callee the expression in the callee or tag position
 * @param node the call itself, whose arguments the outermost modifier owns
 * @returns 1 when this chain stops its subject running, 0 when it does not, undefined when it carries no
 *   skip modifier at all
 */
function skipWeightOfChain({ bindings, callee }: { bindings: Bindings; callee: ts.Expression }): number | undefined {
  const unwrapped = unwrapWrappers({ node: callee });
  const skips = chainModifiers({ node: unwrapped }).filter((hop) => SKIP_MODIFIERS.has(hop.name));
  if (skips.length === 0) return undefined;
  // `chainModifiers` reads outermost-first, so `weights[0]` is the LAST modifier applied — the one a suite
  // resolves by. `skips` is non-empty above, which is what the assertion rests on.
  const weights = skips.map((hop) => skipWeightOf({ argument: hop.argument, name: hop.name }));
  const root = rootIdentifier({ node: unwrapped });
  const lastWins = root !== undefined && bindings.lastWins.has(root);
  if (lastWins) return weights[0]!;
  return Math.max(...weights);
}

/**
 * One option name a suite call sets to anything other than a literal `false`.
 *
 * @param property the object-literal member to read
 * @returns the option's name, or undefined when it sets nothing this gate reads
 */
function declaredOptionName({ property }: { property: ts.ObjectLiteralElementLike }): string | undefined {
  // Shorthand FIRST, and named without a truthiness test: `{ only }` carries no initialiser to read, so
  // counting it is the only answer that cannot be wrong in the direction that matters. A file focused
  // through exactly this spelling kept all four counts put.
  if (ts.isShorthandPropertyAssignment(property))
    return ts.isIdentifier(property.name) ? property.name.text : undefined;
  if (!ts.isPropertyAssignment(property)) return undefined;
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/**
 * Whether a property assignment's value is the literal `false`.
 *
 * @param property the object-literal member to read
 * @returns true only when it is an assignment whose value is that literal
 */
function isFalseOption({ property }: { property: ts.ObjectLiteralElementLike }): boolean {
  if (!ts.isPropertyAssignment(property)) return false;
  return unwrapWrappers({ node: property.initializer }).kind === ts.SyntaxKind.FalseKeyword;
}

/**
 * The option a member SETS, with an explicit `false` reading as unset.
 *
 * @param property the object-literal member to read
 * @returns the option's name, or undefined when it names none or sets it to false
 */
function optionNameOf({ property }: { property: ts.ObjectLiteralElementLike }): string | undefined {
  if (isFalseOption({ property })) return undefined;
  return declaredOptionName({ property });
}

/**
 * Every option a call sets through an object-literal argument.
 *
 * Only a DIRECT argument is read, and only its own top-level members: `it.each([{ skip: true }])` passes an
 * array, and a `{ skip: true }` built inside a test body belongs to the body, not to the case.
 *
 * @param node the call to read the arguments of
 * @returns the option names it sets, in source order
 */
function optionNames({ node }: { node: ts.CallExpression }): readonly string[] {
  const names: string[] = [];
  for (const argument of node.arguments) {
    const unwrapped = unwrapWrappers({ node: argument });
    if (!ts.isObjectLiteralExpression(unwrapped)) continue;
    for (const property of unwrapped.properties) {
      const name = optionNameOf({ property });
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

/** The options whose declared value DECIDES whether a case runs, overriding the chain entirely. */
const DECIDING_OPTIONS: ReadonlySet<string> = new Set(["skip", "todo"]);

/**
 * What ONE member of an options object says about whether the call runs.
 *
 * @param property the object-literal member to read
 * @returns true when it declares a skip, false when it declares the absence of one, undefined when it is
 *   not a deciding option at all
 */
function decidedBy({ property }: { property: ts.ObjectLiteralElementLike }): boolean | undefined {
  const name = declaredOptionName({ property });
  if (name === undefined) return undefined;
  if (!DECIDING_OPTIONS.has(name)) return undefined;
  // Shorthand `{ skip }` carries no initialiser, so it reads as declared-skipped — the same answer
  // `optionNameOf` gives it, and for the same reason.
  return !isFalseOption({ property });
}

/**
 * What a call's options object declares about skipping, as a THREE-valued answer.
 *
 * `optionNames` cannot answer this: it drops a `false` initialiser, so "declared false" and "absent" come
 * back the same, and they mean opposite things here. MEASURED on vitest 4.1.11, the option is the LAST
 * word in both directions — it overrides whatever the chain said:
 *
 *     it.skipIf(false)("r", { skip: true }, fn)   SKIPS    it.skip("r", { skip: false }, fn)   RUNS
 *     it.skipIf(true)("r", { skip: false }, fn)   RUNS     describe.skipIf(false)("s", { skip: true }, fn)  SKIPS
 *
 * Only `skip` and `todo` are read, because those are the options vitest actually has. Reading `runIf` here
 * would invert its sense — `{ runIf: false }` would mean skip — and no such option exists to test it with.
 *
 * @param node the call whose arguments may carry an options object
 * @returns true when an option declares this case skipped, false when one declares it NOT skipped,
 *   undefined when no deciding option is present
 */
function declaredSkipOption({ node }: { node: ts.CallExpression }): boolean | undefined {
  let declared: boolean | undefined = undefined;
  for (const argument of node.arguments) {
    const unwrapped = unwrapWrappers({ node: argument });
    if (!ts.isObjectLiteralExpression(unwrapped)) continue;
    for (const property of unwrapped.properties) {
      const decided = decidedBy({ property });
      if (decided !== undefined) declared = decided;
    }
  }
  return declared;
}

/**
 * The modifier a suite call carries as an OPTION rather than as a chained property.
 *
 * `it("regression", { skip: true }, fn)` is vitest's own signature and reads as ordinary configuration, not
 * as evasion — which is exactly why it matters: a failing case taken out of the run
 * with it leaves all four counts put. The option vocabulary is the same one the chain uses, so the
 * two spellings can never disagree about what counts as a skip.
 *
 * @param node the call to read
 * @returns which bucket the option falls in, or undefined when the call sets neither
 */
function optionsModifierOf({
  node,
  bindings,
}: {
  node: ts.CallExpression;
  bindings: Bindings;
}): "only" | "skip" | undefined {
  const root = rootIdentifier({ node: node.expression });
  if (root === undefined) return undefined;
  if (!bindings.suites.has(root)) return undefined;
  const names = optionNames({ node });
  if (names.some((name) => FOCUS_MODIFIERS.has(name))) return "only";
  if (names.some((name) => SKIP_MODIFIERS.has(name))) return "skip";
  return undefined;
}

/**
 * Which bucket one node's suite modifier falls in, whichever way it is spelled.
 *
 * @param node any node in the tree
 * @returns the bucket, or undefined when this node carries no modifier
 */
function modifierOf({ node, bindings }: { node: ts.Node; bindings: Bindings }): "only" | "skip" | undefined {
  const callee = calleeOf({ node });
  if (callee === undefined) return undefined;
  const chain = focusModifierOf({ bindings, callee });
  if (chain !== undefined) return chain;
  if (!ts.isCallExpression(node)) return undefined;
  return optionsModifierOf({ bindings, node });
}

/**
 * What one node adds to the focused and skipped counts.
 *
 * `only` wins the FOCUS bucket for its call and contributes no skip, matching vitest, where focusing a
 * case is what decides whether it runs. Otherwise the skip contribution is the chain's own weight, so two
 * modifiers on one call count two — the collapse to one is the false negative this replaced.
 *
 * @param node any node in the tree
 * @returns how many focuses and skips this node carries
 */
function contributionOf({ node, bindings }: { node: ts.Node; bindings: Bindings }): {
  focused: number;
  skipped: number;
} {
  if (isChainBuildingCall({ node })) return { focused: 0, skipped: 0 };
  const modifier = modifierOf({ bindings, node });
  if (modifier === "only") return { focused: 1, skipped: 0 };
  // `modifierOf` is what proves the chain's ROOT is a suite function, so nothing below may run without it
  // having said `skip` first: weighing a chain on its own scored `queue.skip("a")` as a skipped case,
  // which is the whole reason `.skip` on an arbitrary object was excluded in the first place.
  if (modifier !== "skip") return { focused: 0, skipped: 0 };
  // A DECLARED option outranks the chain in both directions, measured — `declaredSkipOption` has the four
  // lines. Reading the chain first left `it.skipIf(false)("r", { skip: true }, fn)` scoring zero while
  // vitest skipped it, which is the miss this gate exists to catch, in vitest's own documented signature.
  const declared = ts.isCallExpression(node) ? declaredSkipOption({ node }) : undefined;
  if (declared === true) return { focused: 0, skipped: 1 };
  if (declared === false) return { focused: 0, skipped: 0 };
  const callee = calleeOf({ node });
  if (callee === undefined) return { focused: 0, skipped: 1 };
  // The chain is AUTHORITATIVE once it carries any skip modifier, zero included — falling back to the
  // per-call flag when it scored zero put `it.skipIf(false)` straight back on one and made the weight
  // unobservable. The flag survives only for the OPTION form, which has no chain to read.
  const chained = skipWeightOfChain({ bindings, callee });
  if (chained !== undefined) return { focused: 0, skipped: chained };
  return { focused: 0, skipped: 1 };
}

/**
 * Count what a test source asserts, skips and focuses.
 *
 * @param content the test file's source text
 * @returns the four counts, all zero for a source TypeScript cannot parse into any call expression
 */
export function countAssertions({ content }: { content: string }): AssertionCounts {
  return withSourceFile({
    fileName: "t.test.ts",
    text: content,
    use: (source): AssertionCounts => {
      const bindings = bindingsOf({ source });
      let expects = 0;
      let strong = 0;
      let skipped = 0;
      let focused = 0;
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node)) {
          if (isExpectCall({ bindings, node })) expects += 1;
          if (isStrongMatcherCall({ bindings, node })) strong += 1;
        }
        const contribution = contributionOf({ bindings, node });
        focused += contribution.focused;
        skipped += contribution.skipped;
        forEachChild({ node, visit });
      };
      forEachChild({ node: source, visit });
      return { expects, focused, skipped, strong };
    },
  });
}

/**
 * The ways one file's counts can have got worse, as finished sentences.
 *
 * Every clause is a FALL or a RISE against the same path at the base commit, except `.only`, which is
 * absolute: a focused case silences its whole file whether or not the base had one too, so there is no
 * version of "the base was already broken" that makes it acceptable to land.
 *
 * The two FALL clauses — and only those two — are answered by `deletedWithCode`, the symbols the CALLER has
 * already proved were in non-test source at the base and are in none at the head. That is this gate's own
 * declared exception ("a case deleted with the behaviour it tested, where the production code went in the
 * same diff") finally given a mechanism: before it existed, the declaration named an exception the gate
 * could not honour, so the only ways past a legitimate deletion were to restore assertions for code that no
 * longer exists or to pad the file. The two RISE clauses are untouched on purpose — deleting production
 * code never justifies skipping a case or landing a `.only`, so no claim can answer them.
 *
 * @param base what the file asserted at the comparison commit
 * @param deletedWithCode the symbols the caller VERIFIED this diff removed from non-test source
 * @param head what it asserts now
 * @param path the repository-relative path, for the message
 * @returns one sentence per way the file got weaker; empty when it did not
 */
export function weakenings({
  base,
  deletedWithCode,
  head,
  path,
}: {
  base: AssertionCounts;
  deletedWithCode: readonly string[];
  head: AssertionCounts;
  path: string;
}): readonly string[] {
  const found: string[] = [];
  const lossIsAccountedFor = deletedWithCode.length > 0;
  if (head.expects < base.expects && !lossIsAccountedFor) {
    found.push(`${path}: ${base.expects} expect() call(s) became ${head.expects}`);
  }
  if (head.strong < base.strong && !lossIsAccountedFor) {
    found.push(`${path}: ${base.strong} exact-value matcher(s) became ${head.strong}`);
  }
  if (head.skipped > base.skipped) {
    found.push(`${path}: ${base.skipped} skipped suite(s)/case(s) became ${head.skipped}`);
  }
  if (head.focused > 0) {
    found.push(`${path}: ${head.focused} .only — it silences every other case in this file`);
  }
  return found;
}

/** The marker prefix a test file uses to claim its lost assertions went with code the same diff deleted. */
const DELETED_WITH_CODE = "deleted-with-code:";

/**
 * The production symbols a test file CLAIMS its lost assertions went with.
 *
 * Pure and deliberately naive: it reads a claim, it does not settle one. The settling is the caller's, and
 * it is a git question — was each named symbol really in non-test source at the base and gone at the head —
 * which is what keeps this from being the blanket exemption marker this gate's header refuses. A claim the
 * caller cannot verify is a FINDING by name, not a silent pass.
 *
 * Only a line whose whole text before the marker is a comment opener counts, so the phrase appearing inside
 * a fixture string literal (this gate's own tests are full of them) claims nothing.
 *
 * @param content the test file's source text at the head
 * @returns every symbol named across every marker line, in the order they appear
 */
export function declaredDeletedSymbols({ content }: { content: string }): readonly string[] {
  const symbols: string[] = [];
  for (const line of content.split("\n")) {
    const at = line.indexOf(DELETED_WITH_CODE);
    if (at < 0) continue;
    const opener = line.slice(0, at).trim();
    if (opener !== "//" && opener !== "*") continue;
    for (const part of line.slice(at + DELETED_WITH_CODE.length).split(",")) {
      const name = part.trim();
      if (name.length > 0) symbols.push(name);
    }
  }
  return symbols;
}
