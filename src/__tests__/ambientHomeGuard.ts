/**
 * Pure core of the ambient-home guard — the refusal a test earns by writing into `$SLOPWEAVER_HOME`.
 *
 * ## The failure this closes
 *
 * `slopweaverHome()` (`src/homeDir.ts`) answers `$SLOPWEAVER_HOME` if set and `~/.slopweaver` otherwise, and
 * every verb that takes an optional `home` falls back to it. A test that omits `home` therefore does not
 * fail — it silently writes to the DEVELOPER'S OWN world model, and the only symptom is a file getting
 * bigger. MEASURED on one machine:`~/.slopweaver/ledgers/door.jsonl` held 2,238 `verb:github.pr
 * retarget` external-write records in millisecond pairs, one pair per `yarn test:unit` lap, plus 63
 * `verb:slack.post`/`slack.reply` records per lap — so door-ledger verb counts were not a usable measure of
 * what this install had actually DONE. Reproduce the class on any branch with:
 *
 *   SLOPWEAVER_HOME=$(mktemp -d) yarn vitest run --config config/vitest/unit.ts && find "$SLOPWEAVER_HOME"
 *
 * That command is also this guard's whole mechanism, run continuously: `setup-ambient-home.ts` points every
 * lane at a per-file sandbox home and fails the individual test that wrote into it.
 *
 * ## Why a runtime guard rather than an AST gate
 *
 * The neighbouring `home-safety` gate (`src/devLint/homeSafety.ts`) is static, and by construction it cannot
 * see this: its own header states it is ONE HOP and it deliberately skips a declaration whose call-site
 * contract has no `home` property. `runGithubPrRetarget({ rest, deps })` is exactly that shape — it resolves
 * `--home` out of `rest` — so the leak sat inside the excluded case. Widening it was tried and abandoned: a
 * syntax-only criterion flags every test calling such a runner without a literal `"--home"` in its argv,
 * an order of magnitude more files than the sandbox command above reports, because most pass `home` through
 * an injected dep no AST walk can follow. A runtime witness has no false positives at all, because the write
 * either happened or it did not.
 *
 * It also caught what the static shape never could: two `throughDoor` calls in `src/cli/commands/slack/run.ts`
 * omitted `home` outright, so `slopweaver slack post --home <dir>` recorded its door decision in the AMBIENT
 * home while gating against the one it was given. That was a production defect, found by a test lane.
 */

/** The sandbox-relative paths written during one test, and the message a reader needs when there are any. */
const REMEDY =
  "Pass an explicit home to the verb under test — `--home <dir>` for a CLI runner, `{ home }` for a store — " +
  "built with `mkdtempSync(join(tmpdir(), ...))` and removed in an `afterEach`, the way " +
  "`github/stackAdoptRun.test.ts` does it.";

/**
 * The refusal for a test that wrote into the ambient `$SLOPWEAVER_HOME`.
 *
 * @param writes every path written under the sandbox home, relative to it
 * @returns the refusal message naming each path, or `undefined` when nothing was written
 */
export function ambientHomeRefusal({ writes }: { writes: readonly string[] }): string | undefined {
  if (writes.length === 0) {
    return undefined;
  }
  const listed = writes.toSorted().map((path) => `  ${path}`);
  return [
    `this test wrote ${String(writes.length)} path(s) under the ambient $SLOPWEAVER_HOME:`,
    ...listed,
    "On a developer's machine that variable is unset, so these went to the REAL ~/.slopweaver and corrupted",
    "its ledgers. " + REMEDY,
  ].join("\n");
}
