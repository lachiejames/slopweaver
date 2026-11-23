# Testing

Hard rules for **all** tests. **Run only the files you touched** (`yarn vitest run --config config/vitest/unit.ts <path>`); a whole lane is CI's, refused by `whole-tree-check-guard`. Never claim an unrun green.

**Where a test file goes, and why it matters mechanically.** `config/vitest/unit.ts` selects the unit lane by
DIRECTORY from THREE roots: `src/__tests__/unit/**`, plus `{site,desktop}/__tests__/unit/**` for modules
`src/` cannot import. A `*.test.ts` outside them is **silently never run** — no error, just not collected, the
only symptom a count that did not move. The integration lane is the same shape at
`src/__tests__/integration/**`.

## A unit test tests a PURE function

- **Zero mocks** — `vi.mock`, `vi.spyOn`, `vi.fn` are banned. If a function needs a mock to isolate it,
  it isn't a unit test: **extract the pure logic** and test that, or inject a seam (a plain fake
  function passed in), which is not a mock.
- **Zero I/O** — no network, no real clock. Filesystem only for a genuine fixture/round-trip (a `mkdtempSync`
  dir written and read back), never a shared service. The one process a test may start is the installed
  compiler's native server (`#lib/tsSyntax.js`), closed after each file by `setup-typescript-lifecycle.ts`.
- **Pure core / effectful shell**: put pure logic in testable functions; confine I/O to a thin edge.

## No conditionals — every test must be falsifiable

- **No `if` / `&&` / `?:` / `?.` in an assertion.** A test that can silently pass for any input is
  worse than no test.
- A `&&` / `?.` _inside an inline predicate_ (`.some(x => a && b)`) is fine — that's a callback.
- To access a `T | undefined` you're sure of, use a non-null assertion: `records.find(…)!`.
- For a `Result<T>`, assert `expect(result.ok).toBe(true)` then unwrap the value with the throwing
  `unwrap(result)` combinator — never `expect(result.ok && result.value)`.

## Exact assertions

```typescript
// WRONG — too permissive
expect(result).toBeDefined();
expect(result).toHaveProperty("id");
expect(typeof result.name).toBe("string");

// CORRECT — assert the actual value
expect(result.id).toBe("abc-123");
expect(result.ok).toBe(true);
```

Allowed weak assertions (intentional): `toBeDefined()` for an optional field, `toBeGreaterThan(0)` for
a count that varies, `toContain("fragment")` for an error-message fragment. A guard over a declared REGISTRY
opens with `expect(REGISTRY.length).toBeGreaterThan(0)` — `filter(bad).toEqual([])` and every loop body are
true of an EMPTY one ([why](../../docs/doctrine-rationale/three-gaps.md)).

**These are lint-enforced, not just prose.** `src/devLint/testingDiscipline.ts` bans `vi.mock`/`vi.spyOn`/
`vi.fn`, `.toBeTruthy()`/`.toBeFalsy()`, bare `toHaveProperty("k")` and `expect(typeof …)` across every
`.ts` under `src/__tests__/` — shared FAKES included, where somebody reaches for a mock — so it fails CI rather
than relying on a reviewer. `unnamed-failure-assertion` refuses a case
asserting ONLY `isErr()`/`isOk()`/`.ok`, naming no failure, on a shrinking debt list; any other exempts it
([why](../../docs/doctrine-rationale/failure-only-test.md)).

## The replay lane — a failed turn re-run over its own frozen files

`src/__tests__/subprocess/replay/**` is the lane where an incident becomes a test instead of a memory. A turn
that goes wrong leaves everything needed to re-run it, and `slopweaver turn freeze` copies that whole record
set into a committed FIXTURE under `src/__tests__/fixtures/replay/<slug>/`. A replay test materialises one
into a throwaway home (`materialiseFixture`, `src/__tests__/replayFixture.ts`) and points the REAL verbs at
it with `--home`, so what is under test is the shipped behaviour rather than a restatement of it.

Four things make this a lane rather than a folder, and each is a rule:

- **A fixture is redacted by ALLOWLIST, and the freeze refuses rather than leaking.** A string survives only
  when its key is one a replay reads; every provider id becomes a stable synthetic; every absolute home path
  becomes a placeholder. `turn freeze` then runs the hygiene gate over what it just built and writes nothing
  if a single hit survives, and `--regresses` names the failure classes it holds down. Never hand-edit a
  fixture — re-freeze it; the one boundary is the register's § Bindings.
- **A fixture is a stopped world, so it carries its own clock.** Its manifest's `replayNowIso` is the last
  kept event's own instant, and a verb that judges time takes it (`turn dispatch --sweep --now <iso>`). A
  replay judged by the wall clock reports every lease in it expired the day after it was cut.
- **Freeze `--through <kind>` when the fix is in the code, not in the log.** The state at the moment BEFORE
  the defect fired is what the real verb has to behave correctly over; frozen whole, the fixture carries the
  bad event the old code wrote and replaying it proves only that the reader can read one.
- **Assert on a falsifiable witness, never on silence.** A `not.toContain` is evidence only if the input
  CARRIES what it calls absent: a redaction test feeds the secret in and asserts both halves, the input one
  against a binding that reddens if the fixture drops it. Replay's witness is a line printed only on an
  ATTEMPTED post; check it fires with `--now` past the lease.

Freezing is part of handling an incident, not a follow-up: freeze BEFORE anything cleans the record set up.

## Recording a cassette is pre-approved — never stop to ask

Recording a live cassette is **ALWAYS greenlit**, and **an agent that stops to ask permission for it is a
defect**. Its traffic is self-addressed and expected — the bot's own DM, the owner's mailbox, a throwaway Linear
issue, a private Notion page — and the duty is **cleanup, not permission**. So a recorded question asking
whether one may be recorded is a doctrine violation: `handover/preApprovedStop.ts` classifies it, the board
labels the row, `register-hygiene` reports it. Bounds and cleanup:
[re-recording a cassette](../../docs/integration-coverage.md#re-recording-a-cassette).

## Never write to the ambient `$SLOPWEAVER_HOME`

Every lane's `setupFiles` loads `src/__tests__/setup-ambient-home.ts`, which points `$SLOPWEAVER_HOME` at a
per-test-FILE sandbox and **fails the individual test that wrote into it**. The contract is one sentence: a
test may write wherever it passes an explicit `home`, and nowhere else. Pass `--home <dir>` to a CLI runner
and `{ home }` to a store, built with `mkdtempSync` and removed in an `afterEach` — `github/stackAdoptRun.test.ts`
is the shape to copy.

A guard, not a convention, because prose failed: a lap wrote thousands of real external-write records into
the operator's own door ledger
([measured](../../docs/doctrine-rationale/ambient-home.md)). Reproduce it:

```bash
SLOPWEAVER_ALLOW_BASH=1 SLOPWEAVER_HOME=$(mktemp -d) yarn vitest run --config config/vitest/unit.ts && find "$SLOPWEAVER_HOME"
```

Three things follow, and each is the rule rather than a note:

- **A lane that declares its own `setupFiles` REPLACES the base array, never extends it.** So all three
  lane configs spell the guard explicitly, and `src/__tests__/unit/ambientHomeGuard.test.ts` asserts each one
  carries it — the integration lane's own `setup-polly.ts` sits beside it, not instead of it.
- **The static `home-safety` gate cannot see this class**, by its own construction: it is ONE HOP and it
  deliberately skips a declaration whose call-site contract has no `home` property. `runGithubPrRetarget({
rest, deps })` — which resolves `--home` out of `rest` — is exactly the excluded shape. Widening that gate
  was tried and abandoned: a syntax-only criterion flags an order of magnitude more files than the sandbox
  command above reports, most passing `home` through an injected dep no AST walk can follow. The two gates are
  complements: keep both.
- **The guard sees WRITES, not reads, and it is installed in a `beforeAll`.** Both limits are its
  construction rather than an oversight, and together they leave one hole: every setup file's and every test
  file's MODULE SCOPE runs before that hook, so a module-scope `process.env["SLOPWEAVER_HOME"]` read gets the
  operator's real home and anything written through it lands outside the sandbox the guard watches.
  `setup-polly.ts` read it exactly that way. The static `env-home-read` half of `home-safety` refuses
  that read anywhere under `src/__tests__/` — the test TREE, not just `*.test.ts`, because the file it was
  found in is neither a test file nor source. **The record lane still legitimately needs the real home**
  (its hygiene denylist, its known-values list, its id map), as does paid Codex acceptance (its plan
  register), each via `realAmbientHome()`
  (`src/__tests__/realAmbientHome.ts`), which captures the RESOLVED home at module load — before the sandbox
  exists — so a later caller cannot get the sandbox by accident. Replay reads nothing at all.
  `unit/realAmbientHome.test.ts` is the runtime witness: it fails if that capture is ever made lazy.

## Temp-dir fixtures live in a per-file sandbox

`$TMPDIR` is NOT the machine's shared temp directory while a test runs. Every lane's `setupFiles` loads
`src/__tests__/setup-temp-root.ts` first, which mints one throwaway root per test FILE, points `TMPDIR` at
it, and removes the whole thing in `afterAll`. `os.tmpdir()` re-reads that variable on every call and a
spawned child inherits it, so `mkdtempSync(join(tmpdir(), ...))` lands inside the root whether the caller is
the test, a helper, a `git` it shells, or the shipped `bin/slopweaver` the subprocess lane spawns — and it
lands there on the failure paths too, where a test threw before reaching its own cleanup.

**Still remove what you mint.** An `afterEach`/`afterAll` calling `rmSync(dir, { force: true, recursive: true })`,
or a `try/finally` around the block, keeps one file's own fixtures from piling up across its own tests. A
leak is then bounded by its file, never the run.

MEASURED, and why it is a mechanism: one `os.scandir` of the shared temp directory took **309.9 seconds** and
blocked `slopweaver github push`, against 19.33s on a clean `TMPDIR` — the backlog prose cleanup had left
([the whole measurement](../../docs/doctrine-rationale/temp-directories.md)).

Three consequences that are the rule rather than a note:

- **`afterAll` is not the whole cleanup**, so `src/__tests__/global-temp-root.ts` nests every root of one run
  inside a single parent named for the main process's pid and removes that parent in a `globalSetup`
  teardown. It is one `rmSync` of that parent, never a `readdir` of the shared temp directory; why it runs in
  the main process, and what the pid buys, is in that same section.
- **The sandbox stays under the OS temp directory, with short names.** darwin caps a Unix socket path at 104
  bytes and `subprocess/cmux/fakeCmuxServer.ts` binds one under `tmpdir()`; a root under the repo's own
  ignored scratch would blow that budget on a worktree checkout. `unit/tempRootSandbox.test.ts` asserts the
  budget rather than trusting it.
- **A lane declaring its own `setupFiles` REPLACES the base array**, exactly as with the ambient-home guard,
  so all three configs spell every entry in order, ending with `setup-typescript-lifecycle.ts` (`closeTypeScript()`
  after each file) — while the run-level sweep rides `globalSetup`, which no
  lane overrides, precisely so it cannot be dropped that way. `unit/ambientHomeGuard.test.ts` asserts each
  wiring; `unit/tempRootSandbox.test.ts` and `subprocess/lib/tempRootInheritance.test.ts` are the runtime
  witnesses, in this process and in a spawned child.

## Coverage

Cover happy path + boundaries (empty/zero/undefined) + error paths + relevant edge cases. Use
judgment — not every function needs all four.
