/**
 * The unnamed-failure-assertion gate — machine-enforces `.claude/rules/error-handling.md` § Tests, which
 * already says what a which-failure check asserts: `.error.code` for a which-failure-kind check, `.error.message`
 * for a display check. It is a gate with a shrinking
 * debt list: the criterion is purely syntactic, the house rule already prescribes the fix, and a debt list
 * stops it being a 325-site rewrite before anything can land.
 *
 * The class, in one example the survey re-checked by hand:
 * `src/__tests__/unit/live/turn/judgement/parseRoutingDecision.test.ts`, a case titled _"refuses a respond
 * decision missing tier"_ whose whole body is `expect(result.isErr()).toBe(true)`. It passes when the parser refuses for the reason the title names, and
 * equally when it refuses for a rejected `schemaVersion`, an empty `needs`, or a throw on the way in. The
 * title is a claim about WHICH failure; the assertion supports only THAT one happened.
 *
 * Two independent lenses measured this class without sight of each other and agreed on its shape — 325 sites
 * in 165 files by this repo's own recount, 328 in 167 by the second lens's walk. It was the largest single
 * actionable class either found.
 *
 * ## The criterion — one sentence, no allowlist, no exemption marker
 *
 * A test CASE — an `it` or `test` call, with any modifier (`.only`, `.skip`, `.each`, `.concurrent`) — whose
 * body contains at least one `expect(...)` and where EVERY one of them is a BARE-FAILURE assertion:
 * `expect(<e>.isErr()).toBe(true)`, `expect(<e>.isOk()).toBe(false)` or `expect(<e>.ok).toBe(false)`, with
 * the subject's type-only wrappers — parentheses, `as`, `as const`, `satisfies`, `<T>` and `!` — stripped
 * first.
 *
 * State that sentence whenever you quote this class, never a count: a count is only ever this matcher's
 * output on one commit. There is no exemption marker and no allowlist, on purpose — a false positive is
 * retired by SHARPENING the sentence, the discipline `whole-file-json`, `epoch-arithmetic` and
 * `no-silent-fallback` already carry.
 *
 * ### Why all three spellings, when the survey named two
 *
 * The same survey's finding 11 is that a discipline criterion the tree can respell is a criterion the tree
 * will respell — it fed 33 fixture strings through the shipped `scanTestingDiscipline` and 26 walked
 * through. `expect(r.isOk()).toBe(false)` is `expect(r.isErr()).toBe(true)` with the negation moved, and a
 * gate that refused one and not the other would be teaching the rewrite.
 *
 * MEASURED by this gate's own matcher on the base it landed on (repro: empty the debt list to
 * `{ "sites": [] }`, then `yarn tsx src/devLint/unnamedFailureAssertion.entry.ts --rebaseline`): **385
 * cases over 196 files**, of which `isErr()`→true is 346, `isOk()`→false 35 and `.ok`→false 4. The survey's
 * published 325 was the narrower two-spelling count read by regex on an earlier base; the same instrument reads
 * 332 on this base, so the ~53 the gate adds is the third spelling plus the wrapped lines a line-at-a-time
 * matcher loses. The base is named because a live count moves under any reader.
 *
 * ### What is deliberately OUTSIDE it
 *
 * **A case with any other assertion is not this class.** A body that asserts the refusal AND something else
 * — an emitted line, a count, an unchanged file — is making a claim the other assertion carries, and the
 * survey's measured criterion is the one the owner was shown. Widening to "every case that asserts a
 * failure without naming it" is a different, much larger population and is not what B1 bought.
 *
 * **`.not`, `.resolves` and `.rejects` chains are not bare-failure assertions**, so a case holding one is
 * exempt rather than refused. The matcher chain must be exactly `.toBe(true)` / `.toBe(false)` — anything
 * between the `expect` and the matcher is a different claim this gate does not read.
 *
 * **Its stated blind spots**, both of them under-catching rather than over-catching. A failure asserted
 * through a NAME rather than a call — `expect(failed).toBe(true)` where `failed` was computed above, or a Zod
 * `expect(parsed.success).toBe(false)` — is invisible, because no syntax-only test separates it from an
 * ordinary boolean assertion; closing that needs resolved types, and `namedObjectParamsHeap.ts`'s header says
 * what a second whole-repo `ts.Program` costs. And an assertion reached through a MEMBER of `expect` —
 * `expect.soft(...)` — is not collected at all, so a case built only from those reads as having no assertion
 * and is skipped. There are zero of either spelling in this tree today (repro:
 * `grep -rn "expect\.soft\|expect\.poll" src/__tests__/`), which is why the collector stays on the bare
 * identifier; a first one appearing is the trigger to widen it, not a reason to have widened it already.
 *
 * ## The debt list is a committed baseline, and it can only tighten
 *
 * {@link BASELINE_FILE} names today's files by `{ path, count }`, the gate REFUSES a file that is new or
 * whose count grew, and `--rebaseline` tightens the committed set while refusing to raise any entry. The
 * ratchet itself is `./countRatchet.ts`, shared with `error-shape-threshold` — a list that cannot be widened
 * by hand is not an allowlist: nothing an author writes can excuse a new case.
 *
 * **Its residue, stated rather than discovered**: the unit of the ratchet is a per-file count, so a file
 * holding two refused cases can name one failure and add another bare one and stay green. Keying on the
 * case's own title instead would trip on every unrelated rewording, which is how a ratchet stops being
 * read. What was bought is that the tree's total can only fall.
 *
 * Its pure cores ({@link scanUnnamedFailureAssertions}, {@link countsOf}) are unit-tested; the ratchet's
 * are tested with the ratchet.
 */

import { forEachChild, isTypeAssertion, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { type CountEntry, type CountFinding, runCountRatchet } from "./countRatchet.js";
import { gateSelfFiles, type ScanScope, isScannablePath as scopeIsScannablePath } from "./scanScope.js";

/** The committed debt list, repo-relative. */
const BASELINE_FILE = ".baselines/unnamed-failure-assertion-baseline.json";

/** One refused test case: where it is, and the title that claims more than its body proves. */
export interface UnnamedFailureHit {
  readonly path: string;
  readonly line: number;
  readonly title: string;
}

/**
 * The node with every wrapper that changes only its TYPE stripped — parentheses, `as`, `as const`,
 * `satisfies`, an old-style `<T>` assertion and `!`. Each leaves the runtime value exactly as written, so
 * `(r as Result<string>).ok` is the same read `r.ok` is.
 */
function unwrapTypeOnly({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    isTypeAssertion(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The identifier a call or a modifier chain is ROOTED at — `it`, `it.each(...)`, `test.only`. */
function rootIdentifierOf({ node }: { node: ts.Expression }): string | undefined {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isIdentifier(current)) {
      return current.text;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isTaggedTemplateExpression(current)) {
      current = current.tag;
      continue;
    }
    return undefined;
  }
}

/** Whether a call is a test CASE — `it`/`test`, with any modifier chain in front of its arguments. */
function isTestCase({ node }: { node: ts.CallExpression }): boolean {
  const root = rootIdentifierOf({ node: node.expression });
  return root === "it" || root === "test";
}

/** A test case's own body — the function argument vitest runs, or `undefined` when it declares none. */
function caseBodyOf({ node }: { node: ts.CallExpression }): ts.Expression | undefined {
  return node.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
}

/** The longest title a refusal line carries, so one finding stays one line. */
const MAX_TITLE_CHARS = 70;

/** A test case's title as written, whitespace collapsed and clipped. */
function titleOf({ node, sf }: { node: ts.CallExpression; sf: ts.SourceFile }): string {
  const first = node.arguments[0];
  if (first === undefined) {
    return "(untitled)";
  }
  const collapsed = first.getText(sf).replace(/\s+/g, " ");
  if (collapsed.length <= MAX_TITLE_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_TITLE_CHARS - 3)}...`;
}

/** Whether an expression reads `.isErr()`, `.isOk()` or `.ok` off something, and which of the three. */
function failureSubjectOf({ node }: { node: ts.Expression }): "isErr" | "isOk" | "ok" | undefined {
  const bare = unwrapTypeOnly({ node });
  if (ts.isCallExpression(bare) && bare.arguments.length === 0 && ts.isPropertyAccessExpression(bare.expression)) {
    const called = bare.expression.name.text;
    if (called === "isErr" || called === "isOk") {
      return called;
    }
    return undefined;
  }
  if (ts.isPropertyAccessExpression(bare) && bare.name.text === "ok") {
    return "ok";
  }
  return undefined;
}

/** The literal `true`/`false` an `expect(...)` is compared to by a bare `.toBe`, or `undefined`. */
function expectedBooleanOf({ node }: { node: ts.CallExpression }): boolean | undefined {
  const access = node.parent;
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== "toBe" || access.expression !== node) {
    return undefined;
  }
  const matcher = access.parent;
  if (!ts.isCallExpression(matcher) || matcher.arguments.length !== 1) {
    return undefined;
  }
  const expected = matcher.arguments[0];
  if (expected === undefined) {
    return undefined;
  }
  if (expected.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expected.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

/**
 * Whether one `expect(...)` call is a BARE-FAILURE assertion — it says a result failed and names nothing
 * about which failure. The three spellings are the same claim written three ways.
 */
function isBareFailureAssertion({ node }: { node: ts.CallExpression }): boolean {
  const subject = node.arguments[0];
  if (node.arguments.length !== 1 || subject === undefined) {
    return false;
  }
  const shape = failureSubjectOf({ node: subject });
  if (shape === undefined) {
    return false;
  }
  const expected = expectedBooleanOf({ node });
  if (expected === undefined) {
    return false;
  }
  return shape === "isErr" ? expected : !expected;
}

/** Every `expect(...)` call anywhere inside a node, including nested callbacks. */
function expectCallsIn({ node }: { node: ts.Node }): readonly ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit: NodeVisitor = (child) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "expect") {
      calls.push(child);
    }
    forEachChild({ node: child, visit });
  };
  visit(node);
  return calls;
}

/**
 * Every refused test case in `content`, in source order. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path, carried onto each hit for reporting
 * @param content the file's text
 * @returns each case whose only assertions say a result failed, naming no failure
 */
export function scanUnnamedFailureAssertions({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly UnnamedFailureHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly UnnamedFailureHit[] => {
      const hits: UnnamedFailureHit[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node) && isTestCase({ node })) {
          const body = caseBodyOf({ node });
          if (body !== undefined) {
            const calls = expectCallsIn({ node: body });
            if (calls.length > 0 && calls.every((call) => isBareFailureAssertion({ node: call }))) {
              hits.push({
                line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                path,
                title: titleOf({ node, sf }),
              });
            }
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * Collapse a scan into one debt entry per file, in path order. Pure.
 *
 * @param hits every refused case
 * @returns the counted files, in the debt list's own order
 */
export function countsOf({ hits }: { hits: readonly UnnamedFailureHit[] }): readonly CountEntry[] {
  const tally = new Map<string, number>();
  for (const hit of hits) {
    const standing = tally.get(hit.path);
    tally.set(hit.path, standing === undefined ? 1 : standing + 1);
  }
  return [...tally.entries()]
    .map(([path, count]) => ({ count, path }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

/** This gate's declared scan predicate: every `*.test.ts`, which is where a test case can be. */
const SCOPE: ScanScope = {
  onlyTests: true,
  selfFiles: gateSelfFiles({ stem: "unnamedFailureAssertion" }),
  trees: ["src/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/** One refused case's own finding line — every hit is its own finding, keyed by where it sits. */
function findingOf({ hit }: { hit: UnnamedFailureHit }): CountFinding {
  return { line: hit.line, path: hit.path, text: hit.title };
}

/**
 * IO edge: scan every test file, judge it against the committed debt list, or (`--rebaseline`)
 * tighten that list to what stands now.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard
 *   error)
 */
export function runUnnamedFailureAssertion(): number {
  return runCountRatchet<UnnamedFailureHit>({
    gate: {
      baselineFile: BASELINE_FILE,
      baselineKey: "sites",
      cleanLine: ({ current, hits }) =>
        `${String(hits.length)} standing case(s), ${String(current.length)} debt entr(ies)`,
      counts: countsOf,
      findingKeyOf: ({ hit }) => `${hit.path}:${String(hit.line)}`,
      findingOf,
      gate: "unnamed-failure-assertion",
      keyOf: ({ hit }) => hit.path,
      refusalDetail: ({ regressions }) => `${String(regressions.length)} new or worsened debt entr(ies)`,
      refusalId: "unnamed-failure-assertion",
      rebaselineRefusalId: "unnamed-failure-assertion-rebaseline",
      scan: scanUnnamedFailureAssertions,
      scope: SCOPE,
      unit: "case(s)",
    },
  });
}
