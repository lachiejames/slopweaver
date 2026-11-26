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
 * - **A changed receiver keeps nothing it supplied.** It is compared against its own base too, so every unit
 *   it holds in a credited (directory, key) is taken off its head before it is judged. Without that, a case
 *   moved into an existing sibling counted twice and hid a different case the sibling deleted (move X from
 *   A into B, delete B's Y: A credited, B unchanged in count, Y gone). An added receiver is judged against
 *   nothing, so there is nothing to take off it.
 *
 * ## Its residue, stated rather than discovered
 *
 * - **Verbatim is not judging.** A case reappearing in a sibling whose imports or a same-named helper bind a
 *   name the case calls to something else is credited although it may now assert about something else, and
 *   so is one beside an import of a module that registers a hook when IT loads, or beside another case whose
 *   own body calls `expect.extend` when it runs. That is the gate's own
 *   "counting is not judging" residue widened from a file to a directory, and narrower than what the gate
 *   already allows inside one file, where any new assertion anywhere offsets a deleted one.
 * - **An `expect` no suite call encloses belongs to no unit**, so moving a module-scope helper that asserts
 *   still refuses — one pull request got round the ratchet by moving helpers and keeping the assertions where they were.
 * - **A case edited while it moved is not the same case** and refuses, as does one moved into a sibling
 *   that already carried a `.skip` anywhere, or into another directory.
 * - **A received case must be registered when its file loads**, decided by closed whitelists of what may
 *   sit above it, stand beside it and be evaluated at load (`./testCaseRegistration.ts`, which names the
 *   review finding behind each). A genuine move into a shape none of them names refuses, the safe direction.
 * - **A split git does not report as a rename** (`D` plus two `A`s, below `-M`'s similarity threshold) has
 *   no pair at all, so the gate compares nothing for it — unchanged by this module.
 */

import { dirname } from "node:path";

import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import {
  type AssertionCounts,
  bindingsOf,
  countAssertions,
  isExpectCall,
  isStrongMatcherCall,
} from "./testAssertionCounts.js";
import { isCaseCall, registersOnLoad } from "./testCaseRegistration.js";

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
  /** A receiver that existed at the base, so it is judged too and must give back what it supplied. */
  readonly judged: boolean;
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
 * Credit each shrunk file's lost cases against what same-directory receivers gained — all-or-none per key —
 * and debit a judged receiver every unit it holds in a credited slot.
 *
 * The debit is what keeps the gate's invariant (no compared file's count falls, so the total cannot): without
 * it a case moved into an EXISTING sibling counted twice, once as the loser's credit and again in the
 * receiver's own head, where it hid a different case that sibling deleted. A judged receiver is therefore
 * weighed without anything it supplied, all of a credited slot's units at once, which can only refuse more.
 *
 * @param lost per file, the cases its head no longer holds
 * @param offered per eligible receiver, the cases it gained
 * @returns per path in `lost`, the net counts to add to its head: credit received, less every unit supplied
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
  const settled = ({ slot }: { slot: string }): boolean => {
    const wanted = demand.get(slot);
    const arrived = supply.get(slot);
    return wanted !== undefined && arrived !== undefined && arrived >= wanted;
  };
  const net = new Map<string, MoveCredit>(lost.map((side) => [side.path, { expects: 0, strong: 0 }]));
  const shift = ({ side, sign }: { side: MoveSide; sign: 1 | -1 }): void => {
    for (const unit of side.units) {
      if (!settled({ slot: `${dirname(side.path)}\u0000${unit.key}` })) continue;
      const before = net.get(side.path)!;
      net.set(side.path, {
        expects: before.expects + sign * unit.expects,
        strong: before.strong + sign * unit.strong,
      });
    }
  };
  for (const side of lost) shift({ side, sign: 1 });
  for (const side of offered.filter((receiver) => receiver.judged)) shift({ side, sign: -1 });
  return net;
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
 * @returns per compared path, the net counts to add to its head before judging it — negative for a changed
 *   receiver that supplied more than it was credited
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
    lost.push({ judged: true, path: file.path, units: unitsMinus({ from: base, take: head }) });
    if (runsEverything({ counts: countAssertions({ content: file.headText }) })) {
      const gained = unitsMinus({ from: head, take: base });
      offered.push({ judged: true, path: file.path, units: gained.filter((unit) => unit.registered) });
    }
  }
  for (const file of added) {
    if (!runsEverything({ counts: countAssertions({ content: file.text }) })) continue;
    const units = caseUnits({ content: file.text }).filter((unit) => unit.registered);
    offered.push({ judged: false, path: file.path, units });
  }
  return creditedMoves({ lost, offered });
}
