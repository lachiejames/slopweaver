/**
 * Following a test CASE that moved out of one test file into a sibling, so `test-enshittification` does not
 * read a split as a deletion.
 *
 * `file-size-ratchet` tells an oversized test file to split by scenario or describe block into sibling files,
 * and `test-enshittification` compared each file only against its own past, so the two gates contradicted
 * each other: MEASURED, a `describe` block moved verbatim from `talk/chairWake.test.ts` into a new
 * `talk/chairWakeLine.test.ts` was reported as "75 expect() call(s) became 73" with every assertion still
 * standing in the sibling. Repro: move one `describe` block of any test file verbatim into a new sibling
 * file, commit, and run `SLOPWEAVER_COVERAGE_BASE_SHA=<the parent commit> slopweaver dev lint --only
 * test-enshittification` with this module's credit removed from `compareAll`.
 *
 * ## What moves is a CASE, never an assertion
 *
 * The first design credited a lost `expect(...)` chain against an identical chain gained by a sibling, and
 * Codex's plan pass refuted it with the input that matters: delete `expect(status).toBe("ready")` from one
 * file and add the same line to an unrelated new one, and the loss is credited away. An assertion's text
 * says nothing about which case it belonged to. So the unit here is the innermost suite call in run position
 * enclosing an `expect` — an `it(…)`, a `test(…)`, an `it.each(t)(…)`, or a `describe(…)` holding one
 * directly — and it is credited only when that WHOLE call, title, body and every literal, reappears in a
 * sibling. A real deletion beside an unrelated new case therefore still refuses, however alike their
 * assertions are; `testEnshittification/caseMoves.test.ts` pins exactly that pair.
 *
 * ## The key, and why it is not a whitespace collapse
 *
 * A unit's key is its two counts, its source text with each line trimmed (re-nesting a block changes its
 * indentation and nothing else), and the exact cooked text of every string and template literal inside it.
 * Collapsing every run of whitespace would also collapse it INSIDE a literal, so `toBe("a b")` and
 * `toBe("a  b")` would share a key — the plan pass's second finding. Trimming lines touches a literal only
 * where one spans lines, and the literal texts carried beside it restore exactly that.
 *
 * ## Who may receive, and who gets credited
 *
 * - A receiver sits in the SAME directory as the file that shrank, so both run in the same vitest lane.
 * - An added test file offers every unit it holds; a changed one offers only what its head gained over its
 *   base. A receiver whose head carries any skipped weight or any `.only` offers nothing, because an added
 *   file is never compared against anything and a case moved under `describe.skip` must not credit.
 * - Allocation is all-or-none per (directory, key): when two files lose the same case and only one copy
 *   arrived, NEITHER is credited. First-in-git-order would pick an owner arbitrarily; refusing both is the
 *   only answer that does not depend on an order nothing guarantees.
 *
 * ## Its residue, stated rather than discovered
 *
 * - **Verbatim is not judging.** A case reappearing in a sibling whose imports or a same-named helper bind a
 *   name the case calls to something else is credited although it may now assert about something else, and
 *   so is one beside an import of a module that registers a hook when IT loads. That is the gate's own
 *   "counting is not judging" residue widened from a file to a directory, and narrower than what the gate
 *   already allows inside one file, where any new assertion anywhere offsets a deleted one.
 * - **An `expect` no suite call encloses belongs to no unit**, so moving a module-scope helper that asserts
 *   still refuses — one pull request got round the ratchet by moving helpers and keeping the assertions where they were.
 * - **A case edited while it moved is not the same case** and refuses, as does one moved into a sibling
 *   that already carried a `.skip` anywhere, or into another directory.
 * - **A received case must be registered when its file loads**, decided by a whitelist of what may sit
 *   above it (statements, blocks, callbacks handed straight to a case call). A case under `if (false)` in
 *   a sibling never runs and was credited until review pass r1 found it; now an `if`, a loop, a `try`, a
 *   named function or an assignment above a received case refuses it, a genuine move into one included.
 *   Review pass r2 then found `describe("w", () => { return; it(…) })`, so every statement list above the
 *   case is held to a CLOSED list of inert statements (declarations, call-free `const`s, other suite calls)
 *   and anything else refuses: a hook, a `vi.*` call, a `return`, a kind not yet invented. The list sits
 *   above `callsOnLoad` below.
 * - **A split git does not report as a rename** (`D` plus two `A`s, below `-M`'s similarity threshold) has
 *   no pair at all, so the gate compares nothing for it — unchanged by this module.
 */

import { dirname } from "node:path";

import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import {
  type AssertionCounts,
  type Bindings,
  bindingsOf,
  countAssertions,
  isExpectCall,
  isStrongMatcherCall,
} from "./testAssertionCounts.js";
import { isChainBuildingCall, rootIdentifier } from "./testChainWalk.js";

/** One test case that asserts something, as the key a move is matched on and the force it carries. */
export interface CaseUnit {
  readonly expects: number;
  readonly key: string;
  /** Whether vitest registers this case when the file loads — see {@link registersOnLoad}. */
  readonly registered: boolean;
  readonly strong: number;
}

/** What a move gives back to one file's head counts. */
export interface MoveCredit {
  readonly expects: number;
  readonly strong: number;
}

/** A compared test file, by its text at both ends. */
export interface ComparedText {
  readonly path: string;
  readonly baseText: string;
  readonly headText: string;
}

/** An added test file, by its text at the head. */
export interface AddedText {
  readonly path: string;
  readonly text: string;
}

/**
 * Whether a call RUNS a suite function — the outermost call of a chain whose root this file binds to `it`,
 * `describe` and friends.
 *
 * @returns true for the call that registers a case or suite
 */
function isCaseCall({ node, bindings }: { node: ts.CallExpression; bindings: Bindings }): boolean {
  if (isChainBuildingCall({ node })) return false;
  const root = rootIdentifier({ node: node.expression });
  return root !== undefined && bindings.suites.has(root);
}

/** The only suite names a received case may sit inside: each calls its callback once, at load. */
const SUITE_HOSTS: ReadonlySet<string> = new Set(["describe", "suite"]);

/**
 * Whether a case call is REGISTERED when its file loads: every node between it and the file is a statement,
 * a block, or a callback handed straight to another case call.
 *
 * Codex review pass r1 broke the first version with `if (false) { it("c", …) }` in an added sibling: a
 * verbatim case that never runs, credited because nothing asked whether it was reachable. Deciding
 * reachability in general needs dataflow, so this is a whitelist rather than a judgement — an `if`, a loop,
 * a `try`, a named function or an assignment anywhere above the case means it offers nothing, however
 * plainly it would run. Each suite callback above it must be a plain one handed to a BARE suite name, and every
 * statement list above it must hold only the closed list of inert statements, so the whole rule fails closed.
 * That refuses a genuine move into such a shape, which is the safe direction.
 *
 * @param node the case call
 * @returns true when nothing but statements, blocks and suite callbacks sit above it, each list beside it inert
 */
function registersOnLoad({ node, bindings }: { node: ts.CallExpression; bindings: Bindings }): boolean {
  let child: ts.Node = node;
  let current: ts.Node = node.parent;
  for (;;) {
    const statements = ts.isSourceFile(current) || ts.isBlock(current) ? current.statements : undefined;
    if (statements !== undefined && !onlyInertBeside({ bindings, holder: child, statements })) return false;
    if (ts.isSourceFile(current)) return true;
    const holder =
      ts.isExpressionStatement(current) || ts.isBlock(current) ? current : hostingSuite({ callback: current });
    if (holder === undefined) return false;
    child = holder;
    current = holder.parent;
  }
}

/**
 * The suite call a callback above a received case is handed to, when that call is one that runs it exactly
 * once at load.
 *
 * @param callback the node the walk up from the case reached
 * @returns the hosting `describe`/`suite` call, or undefined where the case may not register
 */
function hostingSuite({ callback }: { callback: ts.Node }): ts.CallExpression | undefined {
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  // A generator's body never runs when vitest calls it, and a parameter could rebind `it` or `expect`.
  if (callback.asteriskToken !== undefined || callback.parameters.length > 0) return undefined;
  const host: ts.Node = callback.parent;
  if (!ts.isCallExpression(host) || host.expression === callback) return undefined;
  // A bare `describe`/`suite` only: `describe.each([])(…)` or `describe.runIf(false)(…)` may never call it.
  if (!ts.isIdentifier(host.expression) || !SUITE_HOSTS.has(host.expression.text)) return undefined;
  // Titles only beside the callback: an options object can carry `fails` or `skip` by a computed name.
  const titlesOnly = host.arguments.every((argument) => argument === callback || isStringLiteralLikeNode(argument));
  if (!titlesOnly) return undefined;
  return host;
}

/*
 * What may stand beside a received case, in EVERY statement list above it, is a closed list — anything it does
 * not name refuses the case, so a shape nobody has thought of yet fails closed rather than open. Codex review
 * pass r2 found `describe("w", () => { return; it("c", …) })` after the ancestor whitelist had passed it, and
 * refusing `return` by name would only have waited for the next early exit to be found. The list:
 *
 * - an empty statement, an interface or a type alias;
 * - a function declaration, and an import that binds a name (a bare `import "./x.js"` exists only for its
 *   side effects) — neither binding `expect` or a suite name, unless the import is from `vitest`;
 * - a `const`/`let`/`var` of plain names, none of them `expect` or a suite name, whose initialisers call
 *   nothing at load (a function value's own body is not run);
 * - another suite or case call (`describe`, `it`, `test`, `suite`, `bench`, an alias of one), which calls
 *   nothing at load outside its own chain and callbacks.
 *
 * So a hook (`beforeEach(({ skip }) => skip())` skips every case beside it at runtime), a `vi.*` call, a
 * local `expect`, an `if`, a loop, a `try`, a `return`, a `throw`, a label, a class and any kind TypeScript
 * adds next year all refuse it, before or after the case, because a hook registered after a case still runs
 * for it. Each suite callback above the case must also be a parameterless, non-generator function handed to
 * a bare `describe` or `suite` beside nothing but string titles.
 */

/**
 * Whether anything under `node` calls, constructs or tags a template when it is evaluated, a nested
 * function's body excepted, and a suite or case call's own chain excepted.
 *
 * @returns true when evaluating `node` would run code
 */
function callsOnLoad({ node, bindings }: { node: ts.Node; bindings: Bindings }): boolean {
  const visit: NodeVisitor<true> = (child) => {
    const isFunction = ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isClassExpression(child);
    if (isFunction) return undefined;
    const root = ts.isCallExpression(child) ? rootIdentifier({ node: child.expression }) : undefined;
    const isSuiteCall = root !== undefined && bindings.suites.has(root);
    const runsCode = ts.isCallExpression(child) || ts.isNewExpression(child) || ts.isTaggedTemplateExpression(child);
    if (runsCode && !isSuiteCall) return true;
    return forEachChild({ node: child, visit });
  };
  return visit(node) === true;
}

/**
 * Every value name one import binds in this file: its default, its namespace and each named element.
 *
 * @returns the local names, empty for a bare side-effect import
 */
function importedNames({ statement }: { statement: ts.ImportDeclaration }): readonly string[] {
  const clause = statement.importClause;
  if (clause === undefined) return [];
  const names = clause.name === undefined ? [] : [clause.name.text];
  const named = clause.namedBindings;
  if (named === undefined) return names;
  if (ts.isNamespaceImport(named)) return [...names, named.name.text];
  return [...names, ...named.elements.map((element) => element.name.text)];
}

/**
 * Whether one statement beside a received case is on the closed list above.
 *
 * @returns true only for a kind the list names, in the form it names
 */
function isInertStatement({ statement, bindings }: { statement: ts.Statement; bindings: Bindings }): boolean {
  // A local `expect`, `it` or `describe` would swap what the moved case calls for something that asserts nothing.
  const shadows = ({ name }: { name: string }): boolean => bindings.expects.has(name) || bindings.suites.has(name);
  const typesOnly =
    ts.isEmptyStatement(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
  if (typesOnly) return true;
  if (ts.isFunctionDeclaration(statement))
    return statement.name !== undefined && !shadows({ name: statement.name.text });
  if (ts.isImportDeclaration(statement)) {
    if (statement.importClause === undefined) return false;
    const fromVitest = ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "vitest";
    return fromVitest || !importedNames({ statement }).some((name) => shadows({ name }));
  }
  if (ts.isVariableStatement(statement)) {
    const declared = statement.declarationList.declarations.map((declaration) => declaration.name);
    const plainNames = declared.every((name) => ts.isIdentifier(name) && !shadows({ name: name.text }));
    return plainNames && !callsOnLoad({ bindings, node: statement });
  }
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  return isCaseCall({ bindings, node: statement.expression }) && !callsOnLoad({ bindings, node: statement });
}

/**
 * Whether every statement in a list above a received case, bar the one holding it, is inert.
 *
 * @param holder the statement holding the case, directly in `statements`
 * @param statements the block's or file's whole statement list
 * @returns true only when every other statement is on the closed list
 */
function onlyInertBeside({
  holder,
  statements,
  bindings,
}: {
  holder: ts.Node;
  statements: readonly ts.Statement[];
  bindings: Bindings;
}): boolean {
  return statements.every((statement) => statement === holder || isInertStatement({ bindings, statement }));
}

/**
 * The cooked text of every string and template literal under a node, in source order.
 *
 * @returns each literal's text
 */
function literalTexts({ node }: { node: ts.Node }): readonly string[] {
  const texts: string[] = [];
  const visit: NodeVisitor = (child) => {
    const isLiteral =
      isStringLiteralLikeNode(child) ||
      ts.isTemplateHead(child) ||
      ts.isTemplateMiddle(child) ||
      ts.isTemplateTail(child);
    if (isLiteral) texts.push(child.text);
    forEachChild({ node: child, visit });
  };
  forEachChild({ node, visit });
  return texts;
}

/**
 * The key one unit is matched on: counts, line-trimmed text and literal texts, each length-prefixed so no
 * text can forge a boundary between them.
 *
 * @returns the key
 */
function keyOf({
  content,
  node,
  source,
  counts,
}: {
  content: string;
  node: ts.Node;
  source: ts.SourceFile;
  counts: MoveCredit;
}): string {
  const text = content
    .slice(node.getStart(source), node.end)
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  const literals = literalTexts({ node }).map((literal) => `${String(literal.length)}:${literal}`);
  return `${String(counts.expects)}/${String(counts.strong)}|${String(text.length)}:${text}|${literals.join("")}`;
}

/**
 * Every test case in a source that asserts something, each with its own key and counts.
 *
 * An `expect` is owned by the innermost case call enclosing it, so a `describe` holding only `it`s owns
 * nothing and is not a unit; the `it`s are.
 *
 * @param content the test file's source text
 * @returns one unit per asserting case, in source order
 */
export function caseUnits({ content }: { content: string }): readonly CaseUnit[] {
  return withSourceFile({
    fileName: "t.test.ts",
    text: content,
    use: (source): readonly CaseUnit[] => {
      const bindings = bindingsOf({ source });
      const open: { node: ts.CallExpression; expects: number; strong: number }[] = [];
      const walk = ({ node, owner }: { node: ts.Node; owner: number | undefined }): void => {
        let current = owner;
        if (ts.isCallExpression(node)) {
          if (isCaseCall({ bindings, node })) {
            open.push({ expects: 0, node, strong: 0 });
            current = open.length - 1;
          }
          const unit = current === undefined ? undefined : open[current];
          if (unit !== undefined && isExpectCall({ bindings, node })) unit.expects += 1;
          if (unit !== undefined && isStrongMatcherCall({ bindings, node })) unit.strong += 1;
        }
        forEachChild({
          node,
          visit: (child) => {
            walk({ node: child, owner: current });
          },
        });
      };
      walk({ node: source, owner: undefined });
      return open
        .filter((unit) => unit.expects > 0)
        .map((unit) => ({
          expects: unit.expects,
          key: keyOf({ content, counts: unit, node: unit.node, source }),
          registered: registersOnLoad({ bindings, node: unit.node }),
          strong: unit.strong,
        }));
    },
  });
}

/**
 * Multiset difference: the units of `from` left over once each unit of `take` has cancelled one of its key.
 *
 * @param from the units to subtract from
 * @param take the units that cancel one occurrence each
 * @returns what `from` holds that `take` does not, multiplicity kept
 */
export function unitsMinus({
  from,
  take,
}: {
  from: readonly CaseUnit[];
  take: readonly CaseUnit[];
}): readonly CaseUnit[] {
  const cancels = new Map<string, number>();
  for (const unit of take) {
    const seen = cancels.get(unit.key);
    cancels.set(unit.key, seen === undefined ? 1 : seen + 1);
  }
  const left: CaseUnit[] = [];
  for (const unit of from) {
    const remaining = cancels.get(unit.key);
    if (remaining !== undefined && remaining > 0) {
      cancels.set(unit.key, remaining - 1);
      continue;
    }
    left.push(unit);
  }
  return left;
}

/** One file's side of the allocation: what it lost, or what it offers to receive. */
interface MoveSide {
  readonly path: string;
  readonly units: readonly CaseUnit[];
}

/**
 * Tally units by (directory, key).
 *
 * @returns how many of each key every directory holds across the sides
 */
function tally({ sides }: { sides: readonly MoveSide[] }): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const side of sides) {
    for (const unit of side.units) {
      const slot = `${dirname(side.path)}\u0000${unit.key}`;
      const seen = counts.get(slot);
      counts.set(slot, seen === undefined ? 1 : seen + 1);
    }
  }
  return counts;
}

/**
 * Credit each shrunk file's lost cases against what same-directory receivers gained — all-or-none per key.
 *
 * @param lost per file, the cases its head no longer holds
 * @param offered per eligible receiver, the cases it gained
 * @returns per path in `lost`, the counts credited back to its head
 */
function creditedMoves({
  lost,
  offered,
}: {
  lost: readonly MoveSide[];
  offered: readonly MoveSide[];
}): ReadonlyMap<string, MoveCredit> {
  const demand = tally({ sides: lost });
  const supply = tally({ sides: offered });
  const credits = new Map<string, MoveCredit>();
  for (const side of lost) {
    let expects = 0;
    let strong = 0;
    for (const unit of side.units) {
      const slot = `${dirname(side.path)}\u0000${unit.key}`;
      const wanted = demand.get(slot)!;
      const arrived = supply.get(slot);
      if (arrived === undefined || arrived < wanted) continue;
      expects += unit.expects;
      strong += unit.strong;
    }
    credits.set(side.path, { expects, strong });
  }
  return credits;
}

/**
 * Whether a receiver's head may offer anything: nothing skipped, nothing focused.
 *
 * @returns true when the head runs every case it holds
 */
function runsEverything({ counts }: { counts: AssertionCounts }): boolean {
  return counts.skipped === 0 && counts.focused === 0;
}

/**
 * The credit every compared file earns from cases moved to a sibling in the same diff.
 *
 * @param compared every test file present at both ends
 * @param added every test file only at the head
 * @returns per compared path, the counts to add back to its head before judging it
 */
export function moveCredits({
  compared,
  added,
}: {
  compared: readonly ComparedText[];
  added: readonly AddedText[];
}): ReadonlyMap<string, MoveCredit> {
  const lost: MoveSide[] = [];
  const offered: MoveSide[] = [];
  for (const file of compared) {
    const base = caseUnits({ content: file.baseText });
    const head = caseUnits({ content: file.headText });
    lost.push({ path: file.path, units: unitsMinus({ from: base, take: head }) });
    if (runsEverything({ counts: countAssertions({ content: file.headText }) })) {
      const gained = unitsMinus({ from: head, take: base });
      offered.push({ path: file.path, units: gained.filter((unit) => unit.registered) });
    }
  }
  for (const file of added) {
    if (!runsEverything({ counts: countAssertions({ content: file.text }) })) continue;
    offered.push({ path: file.path, units: caseUnits({ content: file.text }).filter((unit) => unit.registered) });
  }
  return creditedMoves({ lost, offered });
}
