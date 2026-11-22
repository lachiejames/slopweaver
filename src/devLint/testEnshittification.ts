/**
 * The test-enshittification gate (enforced prevention of test enshittification) — a
 * test file that asserts LESS than the same file asserted at the base commit.
 *
 * ## Why a diff gate and not a ratchet
 *
 * Every other quality gate here compares the tree against a committed debt list. That shape cannot express
 * this class at all: a suite can lose half its assertions while every count a baseline holds stays flat,
 * because what got worse is not a number about the repository, it is a number about ONE FILE against ITS
 * OWN PAST. So the comparison is the branch against its base commit, which is the same mechanism
 * `coverage-ratchet`'s history half already runs on, reading the same `SLOPWEAVER_COVERAGE_BASE_SHA` that
 * CI exports and fetches at job level (`gitAtCommit.ts`).
 *
 * ## The criterion — one sentence, no allowlist, and the one marker that is CHECKED rather than trusted
 *
 * A `*.test.ts` under `src/__tests__/` present at BOTH the base commit and the head, whose `expect(` count
 * fell, whose exact-value matcher count fell, whose skipped count rose, or which carries any `.only`.
 *
 * ## `deleted-with-code:` — the declared exception, given a mechanism
 *
 * This gate has always DECLARED an exception ("a case deleted with the behaviour it tested, where the
 * production code went in the same diff") and offers a way to take it: without one, a branch that
 * deleted a verb family had to restore assertions against code that no longer existed, or pad the file to
 * a number. A declaration naming an exception the gate cannot honour is worse than no declaration, because
 * it reads as a way through that is not there.
 *
 * So a test file may carry `deleted-with-code: <symbol>[, <symbol>]` inside a `//` or `*` comment. That is
 * **not an exemption marker in the sense the paragraph above refuses**, and the difference is the whole
 * design: the gate does not believe it. {@link settleDeletedWithCode} asks git whether each named symbol
 * was matched as a whole word in non-test source at the BASE and is matched in none at the HEAD, and a
 * claim that fails either half is a FINDING naming the symbol rather than a pass. An ordinary weakening
 * therefore cannot claim it — there is no symbol it could name that git would confirm.
 *
 * **A marker is SPENT the moment its own pull request lands, and the next diff that touches the file must
 * remove it.** Once the deletion is on the base branch, the symbol is gone at every base a later diff is
 * measured against, so {@link settleDeletedWithCode}'s first half can never hold again and the claim
 * becomes `in no non-test source at <base>` — a finding raised against a file whose assertions did not
 * move at all, because {@link compareAll} settles every claim a CHANGED file makes before it looks at any
 * count. MEASURED: `slack/lifecycleRun.test.ts` carried a marker settled by an earlier landed
 * branch and refused one that only widened that file's fake transport, repro
 * `SLOPWEAVER_COVERAGE_BASE_SHA=$(git merge-base origin/main HEAD) slopweaver dev lint --only
 * test-enshittification`. Deleting a spent marker makes the file stricter, never weaker.
 *
 * Two further limits keep it narrow. It answers only the two FALL clauses; a rise in skipped cases and a
 * `.only` are untouched, since deleting production code justifies neither. And a bare marker naming nobody
 * verifies nothing, so it exempts nothing. What it does NOT settle is the SIZE of the loss a settled claim
 * covers — read the residue below before quoting this section as a bound.
 *
 * State that sentence whenever you quote this class, never a count — a count here is one branch's diff.
 * Four clauses, and each is doing separate work:
 *
 * - **`expect(` count fell** is the blunt half: deleting assertions to make a red suite green.
 * - **Exact-value matchers fell** is the half a count alone misses. Turning `toBe("abc-123")` into
 *   `toBeDefined()` keeps the `expect(` count identical and destroys the claim, which is exactly what
 *   `testing.md` § Exact assertions is about. `testing-discipline` already bans the two worst
 *   (`toBeTruthy`/`toBeFalsy`) outright; this catches the drift toward every other weak matcher without
 *   having to enumerate one.
 * - **Skipped count rose** is a suite switched off rather than fixed.
 * - **Any `.only`** needs no comparison, because a focused case silences every other case in its file:
 *   one at the head refuses even when the base carried one too, so there is no version of "the base
 *   already had one" that makes landing a second acceptable. Absolute against the BASE, not against the
 *   tree — it is still only asked of a file this branch touched. Read the residue below before quoting
 *   this clause as whole-tree.
 *
 * ## Present at BOTH commits, and why renames are followed
 *
 * A file that is only at the head has nothing to have got worse than, and one that is only at the base was
 * deleted — deleting a test file is visible in the diff and is a review question, not a silent weakening.
 * `git diff --name-status -M` is what separates the two from a MOVE, which would otherwise read as a whole
 * file's assertions vanishing and the same file's assertions appearing, i.e. the loudest possible false
 * positive on the most routine possible refactor.
 *
 * ## A case split into a sibling is followed too, by the case and never by its assertions
 *
 * `file-size-ratchet` tells an oversized test file to split by describe block into siblings, and a block
 * moved into a NEW sibling is an `A` git pairs with nothing, so the file it left read as weaker by exactly
 * what moved. {@link compareAll} credits a shrunk file back with every whole test case that reappears
 * VERBATIM in a same-directory sibling — an added file, or another changed file's gain over its base — whose
 * head skips and focuses nothing and where nothing but a closed list of inert statements stands beside it,
 * all-or-none per case when two files lost the same one. The credit is
 * applied before {@link weakenings}, so a refusal's numbers are the file's counts PLUS what it was credited.
 * An identical assertion in an unrelated new case credits nothing, which is the point: the mechanism, its
 * key and its residue are `./testCaseMoves.ts`'s header.
 *
 * ## Its residue, stated rather than discovered
 *
 * - **Counting is not judging.** Splitting one `toEqual` over a whole record into three `toBe`s on its
 *   fields RAISES both counts while asserting the same thing, and merging three into one lowers them while
 *   asserting the same thing. The second shape is a legitimate refusal this gate will produce, and the
 *   declared exception says so: the answer is to say it in the pull request, not to weaken the gate.
 * - **It cannot see a matcher's argument.** `toBe(anything)` counts exactly as `toBe("abc-123")` does, so a
 *   test rewritten to assert a looser VALUE through the same matcher passes. That is `coverage-ratchet`'s
 *   and a reviewer's half; a syntax-only gate has no access to what a value means.
 * - **It counts assertions that are WRITTEN, not assertions that RUN.** Moving a case's assertions behind
 *   `if (false)`, an early `return`, or a helper nobody calls keeps all four counts identical while the
 *   file asserts nothing — review reproduced exactly that. Closing it means
 *   deciding reachability, and `if (false)` is the only spelling a syntax-only pass can settle: the moment
 *   the condition is a flag, a constant import or an environment read, the same analysis needs types and
 *   dataflow, and a gate that catches the toy spelling while missing every real one buys a false sense of
 *   coverage rather than coverage. The honest boundary is that this gate measures a file's ASSERTED force,
 *   and a test that stops executing shows up in `coverage-ratchet`'s numbers instead — which is the gate
 *   that CAN see it, because it runs the suite.
 * - **A settled `deleted-with-code:` claim is a BOOLEAN, not a budget.** `lossIsAccountedFor` in
 *   `./testAssertionCounts.ts` is `deletedWithCode.length > 0`, so ONE verified symbol silences a file's
 *   whole expect-count and exact-matcher fall, however much of that fall the symbol really accounts for:
 *   a file deleting five cases with the verb they covered can gut twenty-six unrelated assertions beside
 *   them and the gate stays silent. The claim is settled against git; its COVERAGE is not settled at all,
 *   and cannot be by this gate, because attributing a lost assertion to a lost symbol needs the case's
 *   dataflow rather than its text. What holds the shape honest instead is that the marker is a named
 *   symbol standing in the diff — a reviewer can ask the question the gate cannot, and naming the wrong
 *   symbol is a finding. Found by Claude fallback review pass r2 on this mechanism's own branch
 *   (`deleted-with-code-cannot-exempt-an-unproven-loss`, BROKEN); the measurement is in that branch's
 *   pull request, deliberately and not here — see the bullet below for why it cannot be here.
 * - **The settling read is `git grep`, so PROSE counts as production source.** A symbol mentioned in a
 *   comment, a string or a doc line anywhere under `src/` outside the test tree matches `-w` exactly as a
 *   declaration does, and the claim naming it becomes `still in non-test source at HEAD` — a false
 *   finding against a true claim. This bullet is the proof: an earlier draft of the bullet above named
 *   the deleted symbols it had measured, and the gate immediately refused the very file whose claim it
 *   was documenting. The direction is the safe one (a claim gets harder to make, never easier), and the
 *   rule that follows is a real constraint on writing, not a footnote: **evidence for a deletion names
 *   the symbol in the pull request, never in a file the gate reads.**
 * - **Within the exact set, a swap down is still invisible.** `toStrictEqual` → `toEqual` keeps the count,
 *   and `toEqual` is the looser of the two (it ignores `undefined` keys and class identity). Ranking the
 *   matchers against each other is the fix, and it is a fifth count and a comparison this gate does not
 *   have; what it has instead is the line that matters most — a matcher that asserts a SUBSET is not in
 *   the exact set at all, which is where `toMatchObject` went.
 * - **`.only` is asked only of the CHANGED set, so an untouched file keeps one forever.** A branch that
 *   edits nothing under `src/__tests__/` exits 0 on `nothing to compare` while a focused case sits in a
 *   file it did not open — Codex review pass r1 reproduced it by committing `it.only` at both commits and
 *   touching one unrelated path. This is the diff shape doing what a diff shape does, not an oversight:
 *   a `.only` standing on the base is pre-existing debt, and refusing it here would redden every branch
 *   until somebody removed it. The absolute whole-tree clause belongs in `testing-discipline`, which
 *   already scans every `.ts` under `src/__tests__/` and is where a property about the TREE is enforceable
 *   at all. Until it is added there, the tree is clean by measurement rather than by gate: every `.only`
 *   this repo contains sits inside a fixture STRING in this gate's own test file, where the parser reads a
 *   string literal and not a call.
 * - **The skipped count is a WEIGHT summed per modifier, not a flag per call — and it took four review
 *   passes to get there.** A conditional whose own literal argument says it never skips scores zero;
 *   every other modifier scores one, a non-literal condition included, since a flag or an environment
 *   read needs dataflow and an unreadable condition must never read as weaker than it is. Only the
 *   outermost hop owns a call's arguments, so in `it.skip.skipIf(false)` the `false` answers `skipIf` and
 *   says nothing about the `.skip`, which still scores. What each pass found, because the wrong designs
 *   are the reason for this one:
 *
 *       it.skipIf(false)           -> it.skip.skipIf(false)  base FAILS, head SKIPS   0 -> 1  named
 *       it.skipIf(false)           -> it.skipIf(true)        base FAILS, head SKIPS   0 -> 1  named
 *       it.runIf(true)             -> it.runIf(false)        base FAILS, head SKIPS   0 -> 1  named
 *       describe.skip.skipIf(false)-> describe.skip          base FAILS, head SKIPS   0 -> 1  named
 *       describe.skipIf(true).skipIf(false) -> .skipIf(true) base FAILS, head SKIPS   0 -> 1  named
 *       it.skipIf(false)                                     vitest RUNS it                0  not refused
 *       describe.skip.skipIf(false)                          vitest RUNS it                0  not refused
 *       it.skipIf(true).skipIf(true) vs it.skipIf(true)      both SKIP the same case  1 == 1  not refused
 *
 *   Pass r1 found the flat count refusing `skipIf(false)`, which vitest runs. A whole-chain veto fixed
 *   that and pass r2 found it erasing a real `.skip` beside the conditional. Reverting to the flat count
 *   fixed THAT and pass r3 found the deeper hole both spellings shared: one bucket per call, so
 *   `skipIf(false)` and `it.skip.skipIf(false)` scored the same, and flipping a literal moved nothing.
 *   Scoring per modifier makes those three edits a RISE; a later pass found the LAST row above, where
 *   the residue this file had written down as merely a false refusal turned out to sit on a base.
 *   Every one of those was measured by RUNNING vitest 4.1.11 at both ends, never by reading.
 * - **A suite's chain and a case's chain combine differently, and BOTH are modelled** —
 *   `LAST_WINS_FUNCTIONS` in `testAssertionCounts.ts` carries the measurement. Leaving the difference
 *   unmodelled was tried, on the argument that an over-count only ever costs a false refusal, and review
 *   disproved the argument rather than the spelling: `describe.skip.skipIf(false)` RUNS
 *   and `describe.skip` SKIPS, so DELETING the conditional silences a genuinely failing suite — with one
 *   rule for both, that pair scored flat and this gate printed clean over it. An over-count is safe only
 *   while it cannot land on the BASE side of a pair, which is not a property an over-count has.
 *   The general lesson is worth more than the case: "this errs in the safe direction" is a claim about
 *   PAIRS, and it has to be tested against a base as well as a head.
 * - **A chain a conditional CALL interrupts is still one chain**, and review found both halves of
 *   getting that wrong. `describe.skipIf(true).skipIf(false)` is three nested calls, so a walk that
 *   stopped at the first read two independent one-hop chains: the override was lost, so deleting the
 *   trailing `skipIf(false)` silenced a failing suite and scored flat, and the repeated modifier in
 *   `it.skipIf(true).skipIf(true)` counted twice, refusing a file that skipped exactly what it always
 *   had. `chainModifiers` walks THROUGH a call and carries each modifier's own argument with it, and
 *   only the call in RUN position scores — the ones under it are building the chain, not invoking it.
 * - **A value this gate cannot evaluate is where it genuinely MISSES, and both halves are stated rather
 *   than softened.** Everything above is syntax; a NAME is not. Two pairs, both run at both ends:
 *
 *       const f = false; it.skipIf(f)  -> it.skip                   base RUNS, head SKIPS   1 -> 1  MISSED
 *       it("r", fn)  -> const c = it.skip; c("r", fn)               base RUNS, head SKIPS   0 -> 0  MISSED
 *
 *   The first is the unreadable-condition rule meeting its own cost: scoring one keeps a real
 *   `skipIf(process.env.CI)` honest, and the price is that a condition named `false` scores one too, so a
 *   later edit to a plain `.skip` moves nothing. The second aliases a modified suite function into a
 *   local. Both need dataflow, which is the line this gate does not cross — and neither is a false
 *   refusal, so neither may be written down as erring safely. `coverage-ratchet` runs the suite and is
 *   where a silenced case gets caught by its coverage instead of by its syntax.
 * - **A skip is counted by EXECUTION, an inverted verdict is not.** `skip`, `skipIf`, `runIf` and `todo`
 *   all stop a case running and all raise the same count. `.fails` does not: it keeps the case running and
 *   inverts its verdict, so turning a passing test into a failing one and marking it `.fails` is a real
 *   weakening this gate does not see. Counting it in the skip bucket would be wrong — the case still runs —
 *   and giving it its own count is a shape nothing in this tree needs yet, since `.fails` appears nowhere.
 * - **It resolves assertion names by BINDING, and a namespace import still hides one.** `import { expect as
 *   check }` is followed — a file aliasing it once scored zero at both commits, so a
 *   deleted assertion in it printed `clean` — but `import * as v from "vitest"; v.expect(1).toBe(1)` is not,
 *   because `v.expect` is a property access whose root identifier is `v`. That spelling appears nowhere in
 *   this tree and following it means resolving a namespace object rather than reading an import clause; it is
 *   named here so the next reader finds it stated rather than discovers it.
 * - **No base is a failure, not a pass.** `SLOPWEAVER_COVERAGE_BASE_SHA` is exported by CI and by
 *   `github lap`; a run without it compared nothing, so the gate fails and prints the command that supplies
 *   one (`./gitAtCommit.ts`'s `resolveFloorBase`). It never resolves the base itself, because a stale
 *   `origin/main` compares clean against the wrong commit.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gitGrep, gitNulFields, gitShow, runAgainstFloorBase } from "./gitAtCommit.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { countAssertions, declaredDeletedSymbols, weakenings } from "./testAssertionCounts.js";
import { type AddedText, type ComparedText, moveCredits } from "./testCaseMoves.js";

/** The tree this gate reads, and the suffix that makes a file in it a test. */
const TEST_TREE = "src/__tests__/";
const TEST_SUFFIX = ".test.ts";

/** One file the branch changed, at both ends of the comparison. */
export interface ChangedTest {
  readonly basePath: string;
  readonly headPath: string;
}

/**
 * Read ONE record off the `-z` stream, and say where the next one starts.
 *
 * The stream is flat fields rather than one record per entry — `M`, path, `R100`, old, new — so a reader
 * that skipped only the STATUS of a record it did not care about would read the next file's path as a
 * status and desynchronise every remaining record. Advancing past a record's paths is therefore this
 * function's job whether or not the caller wants it, which is also why it is separate: the caller stays a
 * flat loop instead of carrying the cursor arithmetic and the filtering in one body.
 *
 * @param fields the `-z` stream's fields
 * @param cursor where this record starts
 * @returns the record and the next cursor, or `undefined` at a clean end or a truncated tail
 */
function readRecord({
  fields,
  cursor,
}: {
  fields: readonly string[];
  cursor: number;
}): { status: string; first: string; second: string | undefined; next: number } | undefined {
  const status = fields[cursor];
  const first = fields[cursor + 1];
  if (status === undefined || first === undefined) return undefined;
  if (!status.startsWith("R") && !status.startsWith("C")) {
    return { first, next: cursor + 2, second: undefined, status };
  }
  const second = fields[cursor + 2];
  if (second === undefined) return undefined;
  return { first, next: cursor + 3, second, status };
}

/**
 * Read `git diff --name-status -M -z` output into the pairs this gate compares.
 *
 * Only `M` (modified in place) and `R` (renamed, with or without an edit) carry both ends. `A` has no base
 * and `D` has no head, so neither can be weaker than itself; `T` (type change) and `C` (copy) are not
 * shapes a test file takes. Dropping them here rather than at the git call keeps the criterion readable in
 * one function instead of encoded in a flag string.
 *
 * @param fields the `-z` stream's fields, in the order git emitted them
 * @returns one pair per test file present at both commits, in the order git reported them
 */
export function parseNameStatus({ fields }: { fields: readonly string[] }): readonly ChangedTest[] {
  const pairs: ChangedTest[] = [];
  let cursor = 0;
  for (;;) {
    const record = readRecord({ cursor, fields });
    if (record === undefined) break;
    cursor = record.next;
    if (record.status === "M") pairs.push({ basePath: record.first, headPath: record.first });
    if (record.status.startsWith("R") && record.second !== undefined) {
      pairs.push({ basePath: record.first, headPath: record.second });
    }
  }
  return pairs.filter((pair) => isTestPath({ path: pair.headPath }));
}

/**
 * Whether a path is a test file this gate reads.
 *
 * @returns true for a `*.test.ts` under the test tree
 */
function isTestPath({ path }: { path: string }): boolean {
  return path.startsWith(TEST_TREE) && path.endsWith(TEST_SUFFIX);
}

/**
 * Read the same `-z` stream for the test files the branch ADDED — the only place a case split off an
 * existing file can land without a pair of its own.
 *
 * @param fields the `-z` stream's fields, in the order git emitted them
 * @returns every added test file's path, in the order git reported them
 */
export function addedTestPaths({ fields }: { fields: readonly string[] }): readonly string[] {
  const added: string[] = [];
  let cursor = 0;
  for (;;) {
    const record = readRecord({ cursor, fields });
    if (record === undefined) break;
    cursor = record.next;
    if (record.status === "A" && isTestPath({ path: record.first })) added.push(record.first);
  }
  return added;
}

/** A base blob this gate needed and git would not give it, kept separate from a file that simply passed. */
interface Comparison {
  readonly findings: readonly string[];
  readonly compared: number;
  readonly unreadable: readonly string[];
}

/** A non-test pathspec: the production tree, with this repository's whole test tree excluded. */
const PRODUCTION_PATHSPEC = ["--", "src", `:(exclude)${TEST_TREE}`] as const;

/**
 * Settle every `deleted-with-code:` claim a test file makes, against git rather than against trust.
 *
 * A claim is VERIFIED when its symbol is matched as a whole word in non-test source at the BASE commit and
 * matched in none at the HEAD — which is the only reading of "the production code went in the same diff"
 * that a gate can check. Both halves are required: a symbol that was never there proves nothing was
 * deleted, and a symbol still standing proves the tests for it were dropped while it lives.
 *
 * This is why the marker is not the blanket exemption this gate's header refuses. An ordinary weakening
 * cannot claim it — the claimant has to name a symbol that really did leave the production tree in this
 * diff, and naming one that did not is a finding rather than a pass.
 *
 * @param root the repository root
 * @param sha the base commit
 * @param symbols what the file claims, straight from {@link declaredDeletedSymbols}
 * @returns the claims git confirmed, and a finished sentence per claim it did not
 */
function settleDeletedWithCode({ root, sha, symbols }: { root: string; sha: string; symbols: readonly string[] }): {
  readonly verified: readonly string[];
  readonly unproven: readonly string[];
} {
  const verified: string[] = [];
  const unproven: string[] = [];
  for (const symbol of symbols) {
    const atBase = gitGrep({ args: ["grep", "-q", "-w", "-e", symbol, sha, ...PRODUCTION_PATHSPEC], root });
    const atHead = gitGrep({ args: ["grep", "-q", "-w", "-e", symbol, ...PRODUCTION_PATHSPEC], root });
    // Fail closed: a grep that FAILED at HEAD once read as "the symbol is gone" and verified the claim.
    if (atBase === "error" || atHead === "error") {
      unproven.push(`deleted-with-code names ${symbol}, but git grep failed, so the claim could not be checked`);
      continue;
    }
    if (atBase === "match" && atHead === "none") {
      verified.push(symbol);
      continue;
    }
    if (atBase === "none") {
      unproven.push(`deleted-with-code names ${symbol}, which is in no non-test source at ${sha.slice(0, 9)}`);
      continue;
    }
    unproven.push(`deleted-with-code names ${symbol}, which is still in non-test source at HEAD`);
  }
  return { unproven, verified };
}

/**
 * Read one file from the working tree.
 *
 * @param root the repository root
 * @param path the repository-relative path
 * @returns its text, or `undefined` when it would not read
 */
function readHead({ root, path }: { root: string; path: string }): string | undefined {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Read every compared file at both ends and every added file at the head, keeping what would not read.
 *
 * An added file that will not read is UNREADABLE, never dropped: it is a receiver candidate, so the verdict
 * would otherwise depend on a file the gate never saw.
 *
 * @param pairs the file pairs to compare
 * @param added the test files only at the head
 * @param root the repository root
 * @param sha the base commit
 * @returns the texts, and every path that would not read
 */
function loadAll({
  pairs,
  added,
  root,
  sha,
}: {
  pairs: readonly ChangedTest[];
  added: readonly string[];
  root: string;
  sha: string;
}): { compared: readonly ComparedText[]; added: readonly AddedText[]; unreadable: readonly string[] } {
  const compared: ComparedText[] = [];
  const addedTexts: AddedText[] = [];
  const unreadable: string[] = [];
  for (const pair of pairs) {
    const baseText = gitShow({ root, spec: `${sha}:${pair.basePath}` });
    if (baseText === undefined) {
      unreadable.push(pair.basePath);
      continue;
    }
    const headText = readHead({ path: pair.headPath, root });
    if (headText === undefined) {
      unreadable.push(pair.headPath);
      continue;
    }
    compared.push({ baseText, headText, path: pair.headPath });
  }
  for (const path of added) {
    const text = readHead({ path, root });
    if (text === undefined) {
      unreadable.push(path);
      continue;
    }
    addedTexts.push({ path, text });
  }
  return { added: addedTexts, compared, unreadable };
}

/**
 * Compare every changed test file against its own base revision, crediting back each case it moved verbatim
 * into a sibling in the same diff (`./testCaseMoves.ts`).
 *
 * @param pairs the file pairs to compare
 * @param added the test files only at the head, which can only RECEIVE a moved case
 * @param root the repository root, for resolving the head-side read
 * @param sha the base commit
 * @returns every weakening found, how many files were actually compared, and which files would not read
 */
function compareAll({
  pairs,
  added,
  root,
  sha,
}: {
  pairs: readonly ChangedTest[];
  added: readonly string[];
  root: string;
  sha: string;
}): Comparison {
  const loaded = loadAll({ added, pairs, root, sha });
  const credits = moveCredits({ added: loaded.added, compared: loaded.compared });
  const findings: string[] = [];
  for (const file of loaded.compared) {
    const claim = settleDeletedWithCode({
      root,
      sha,
      symbols: declaredDeletedSymbols({ content: file.headText }),
    });
    for (const line of claim.unproven) {
      findings.push(`${file.path}: ${line}`);
    }
    const head = countAssertions({ content: file.headText });
    const moved = credits.get(file.path)!;
    findings.push(
      ...weakenings({
        base: countAssertions({ content: file.baseText }),
        deletedWithCode: claim.verified,
        head: { ...head, expects: head.expects + moved.expects, strong: head.strong + moved.strong },
        path: file.path,
      }),
    );
  }
  return { compared: loaded.compared.length, findings, unreadable: loaded.unreadable };
}

/**
 * Write a line the gate reports as a FACT about its input rather than as a rule catching something.
 *
 * Every caller is a state the gate could not get PAST — a diff git would not report, a file it could not read —
 * so this channel never carries a verdict about anyone's code. The base itself is resolved, and its absence
 * reported, by `./gitAtCommit.ts`'s `runAgainstFloorBase`. The refusal channel is
 * {@link lintGateRefusal}, and each call site names its own case directly above itself.
 */
function fact({ line }: { line: string }): void {
  // devlint: not-a-refusal -- this is the FACT channel itself; a rule catching something goes through lintGateRefusal
  process.stderr.write(`test-enshittification: ${line}\n`);
}

/**
 * Run the gate.
 *
 * @returns the process exit code — 0 when nothing got weaker or a brand-new ref has no previous commit; 1 on a
 *   finding, or no usable base
 */
export function runTestEnshittification(): number {
  return runAgainstFloorBase({ gate: "test-enshittification", judge });
}

/**
 * The half that has a base commit in hand.
 *
 * @param root the repository root
 * @param sha the base commit, validated as a SHA and present in this checkout
 * @returns the process exit code
 */
function judge({ root, sha }: { root: string; sha: string }): number {
  // TWO-dot, and the distinction is the whole reason this gate went red in CI while passing locally. A
  // three-dot `base...HEAD` asks git for the merge-base first, and CI never fetches one: the base arrives
  // via `git fetch --no-tags --depth=1 origin "$SLOPWEAVER_COVERAGE_BASE_SHA"`, which grafts a PARENTLESS
  // commit, so there is no common ancestor to compute and the diff exits non-zero. A full-history clone
  // hides this completely. Repro the CI shape locally:
  //   git clone --depth=1 . /tmp/shallow && git -C /tmp/shallow diff <base>...HEAD   # fatal; two-dot works
  // Two-dot compares the two TREES, which is what this gate actually wants and what `coverage-ratchet`
  // already relies on when it reads files at the same grafted base.
  const fields = gitNulFields({
    args: ["diff", "--name-status", "-M", "-z", sha, "HEAD", "--", TEST_TREE],
    root,
  });
  if (fields === undefined) {
    // devlint: not-a-refusal -- git would not report the diff, so there is no input to judge
    fact({ line: `git diff against ${sha} failed — no comparison made` });
    return 1;
  }
  const pairs = parseNameStatus({ fields });
  if (pairs.length === 0) {
    // devlint: not-a-refusal -- the gate's own filter matched nothing, so it has no subject
    fact({ line: `no test file changed against ${sha.slice(0, 9)} — nothing to compare` });
    return 0;
  }
  return report({ comparison: compareAll({ added: addedTestPaths({ fields }), pairs, root, sha }), sha });
}

/**
 * The fact line for changed test files the gate could not read at one end. Pure. Any such file fails the
 * gate: it was never compared, and an earlier revision folded it into the `clean` line and exited 0.
 *
 * @param unreadable the paths whose base blob or working-tree copy would not read
 * @param sha the base commit those reads were made against
 * @returns the line to print, or `undefined` when every file read
 */
export function unreadableFact({
  sha,
  unreadable,
}: {
  sha: string;
  unreadable: readonly string[];
}): string | undefined {
  if (unreadable.length === 0) return undefined;
  return `${String(unreadable.length)} changed test file(s) would not read at one end against ${sha.slice(0, 9)}, so they were never compared and the gate fails: ${unreadable.join(", ")}`;
}

/**
 * Print the verdict.
 *
 * @param comparison what the comparison found
 * @param sha the base commit, for the clean line
 * @returns the process exit code
 */
function report({ comparison, sha }: { comparison: Comparison; sha: string }): number {
  // Fail closed: a changed test file either end would not read was never compared, so it cannot be clean.
  const unread = unreadableFact({ sha, unreadable: comparison.unreadable });
  if (unread !== undefined) {
    // devlint: not-a-refusal -- the gate never SAW these files, which is a fact about its input
    fact({ line: unread });
  }
  if (comparison.findings.length === 0) {
    if (unread !== undefined) return 1;
    process.stdout.write(`test-enshittification: clean (${comparison.compared} test file(s) vs ${sha.slice(0, 9)})\n`);
    return 0;
  }
  for (const finding of comparison.findings) {
    // devlint: not-a-refusal -- a per-finding diagnostic; the summary below it is the rendered refusal
    process.stderr.write(`  ${finding}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "test-enshittification" }),
      detail: `${String(comparison.findings.length)} weakening(s) against ${sha.slice(0, 9)}`,
    })}\n`,
  );
  return 1;
}
