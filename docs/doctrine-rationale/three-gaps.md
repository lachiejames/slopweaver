# The three gaps twelve mutations found

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

Round 3 of the team-readiness survey judged test CONTENT rather than distribution, and it did it by breaking
production code on purpose twelve times and asking whether the suites noticed. Ten were killed. The two
survivors and one gate-evasion probe are the three gaps this section explains, and each fix here was proved
by re-running the same mutation rather than argued. The survey itself, both lenses and their instruments:
`$SLOPWEAVER_HOME/teamready/code-quality-round-3-test-content.md`.

## `epochSecondsToIso` had no test of its own

`typescript-patterns.md` bans `new Date(x * 1000)` everywhere outside `src/lib/date.ts` and
`src/lib/slackTs.ts`, gated by `epoch-arithmetic`, so that ONE function owns the arithmetic — the rule
justified by a Slack `ts` read 80 minutes wrong reaching a board row, two cron schedules and two supervisors'
deadman deadlines. Changing `MS_PER_SECOND` from 1000 to 1001 left `unit/lib/date.test.ts` entirely green:
that file never named `epochSecondsToIso` at all.

The whole unit lane DID catch it — dozens of failures across unrelated files — but every one was a downstream
caller asserting a timestamp it happened to bake into a fixture. Not one was about epoch scaling. **A pin held
entirely by its caller set shrinks when the caller set shrinks, and nothing reports that.** The function now
carries its own cases: a known epoch, zero, a negative, a fractional second, the largest second count
ECMAScript can hold as a `Date`, one second past it, `NaN` and `Infinity`. Re-running the mutation now reddens
the function's own file.

## The discipline gate could not see the shared fakes

`testingDiscipline.ts` applied its four bans within `*.test.ts`, and the shared fakes, fixture builders and
setup files under `src/__tests__/` are not `*.test.ts`. **A fake is exactly where somebody reaches for a
mock.** Appending `export const proof = { spy: vi.fn() };` to a shared capture-transport fake under
`src/__tests__/` and running `yarn tsx src/cli/index.ts dev lint --only testing-discipline` printed `clean`
and PASS.

The tree already knew: three of those helpers carried a hand-written comment doing the gate's job, and
`cross-session-messages.md` states the principle they were standing in for — _"A convention both sides promise
to keep is not a mechanism."_ The scan predicate moved from `onlyTests` to `onlyTestsDir`, so the pool is every
tracked `.ts` under `__tests__/`. **The widening loses nothing**: every tracked `*.test.ts` already sits under
that tree (`git ls-files '*.test.ts' | grep -vc '__tests__/'`). It found no violation standing today — the
comments had held — which is the point of replacing them with something that cannot stop holding.

## A registry guard proved nothing about its own registry

Emptying `NOTION_BROWSER_PAGES` left `unit/atlas/notion/browserPages.test.ts` wholly green: every case in it
is `expect(REGISTRY.filter(badShape)).toEqual([])` or a loop body, and all of those are true of an empty
collection. What caught the mutation was two sibling files driving real behaviour off the constant.

The same mutation on `WORKOS_DASHBOARD_ROUTES` WAS caught by its own guard — because that file happens to
assert three exact routes by `.find()`; on `VANTA_BROWSER_PAGES` and `LINEAR_ROUTE_TEMPLATES` it was caught by
an unrelated case dereferencing a `.find()` result, a `TypeError` rather than an assertion. **So the protection
was real, and incidental: it came from a sibling assertion somebody happened to write, and nothing required
one.** A census over the test tree — a constant imported from production source, iterated, with every
assertion naming it either an emptiness check or a loop body, and no witness anywhere in the file — found 46
such bindings in 43 files, and each now opens with `expect(REGISTRY.length).toBeGreaterThan(0)`.

**Why prose and not a gate.** Every instrument built on the "asserts a collection is empty" class over-reports
by roughly 90× until it learns the witness shapes this tree actually uses. The survey's own detector was
recalibrated four laps, every lap downward — 3,579 → 41 — as it learned that `expect(x.scanned > 0).toBe(true)`
is a witness, and that a `toEqual([non-empty])` in the pure half of the house two-describe shape is one too.
A gate on the general class would redden thousands of sites that are correct. The narrow rule in
`testing.md` is scoped to registry guards for exactly that reason, and the calibration list is why a future
attempt to widen it should start from the survey's instruments rather than from a fresh matcher list.
