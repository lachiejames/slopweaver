# The lint reference — tests, coverage and CI contracts

Part of [Toolchain](../toolchain.md).

- **untested-modules** (`src/devLint/untestedModules.ts`) — enforced test coverage.
  Refuses a `.ts` under `src/`, outside `src/__tests__/`, that EXPORTS A VALUE and is imported by no file
  under `src/__tests__/`. It measures an EDGE where `coverage-ratchet` measures execution percentages, so a
  module can sit inside a healthy directory floor and still have never been reached by a test. The mirrored-path
  rule was measured and rejected: it reports 1,904 modules against the import edge's 813, and it calls a pure
  core deliberately tested through its sibling's test file uncovered forever. A module exporting only types,
  and an entry point exporting nothing, are outside the criterion rather than exempted by it. Debt list
  `.baselines/untested-modules-baseline.json`, seeded at 735; `yarn devlint:untested-rebaseline` tightens it
  and REFUSES to add a path, one notch stricter than the other ratchets. The first cut is written by a
  rebaseline run when the file does not exist at all.
- **baseline-against-main** (`src/devLint/baselineAgainstMain.ts`, registry `baselineRegistry.ts`, records
  `baselineBump.ts`) — every committed ratchet baseline is compared with its copy at the base commit, and a row
  new or larger there is REPORTED as a landing obligation: the declaring bump record lives in the state home,
  which CI cannot see, or in a manifest the change commits, and the landing verbs check it and its Codex witness.
  It refuses a rewrite of a manifest main holds and any unregistered file under `.baselines/`; the whole mechanism is in [rebaseline and lanes](rebaseline-and-lanes.md).
- **test-enshittification** (`src/devLint/testEnshittification.ts`, counting core in `testAssertionCounts.ts`, chain walk in `testChainWalk.ts`)
  — enforced prevention of test degradation. A `*.test.ts` under `src/__tests__/`
  that this branch MODIFIED and that now asserts LESS than the same file asserted at the base commit: fewer
  `expect(` calls, fewer exact-value matchers (`toBe`, `toEqual`, `toStrictEqual`, `toHaveLength` —
  `toMatchObject` is NOT one, it asserts a subset, and a passing test can be swapped in through it), more
  skipped suites or cases, or ANY `.only`. Counted on the TypeScript AST, never on the
  text — `expect(` appears inside this repository's own gate fixtures, which embed sample test sources as
  string literals, so a text count would be wrong on exactly the files that matter. Renames are followed
  (`git diff --name-status -M`), so moving a test file is not read as deleting one.
  **The one marker it takes is CHECKED, not trusted.** A file whose cases went out with the production code
  they covered carries `deleted-with-code: <symbol>` in a comment, and the gate asks git whether that symbol
  was in non-test source at the base and is in none at the head — a claim failing either half is a finding
  naming the symbol. It answers the two FALL clauses only: a rise in skipped cases and a `.only` stand
  regardless, and a bare marker naming nobody exempts nothing. One verified symbol does silence a file's WHOLE
  fall, though, however little of it that symbol accounts for — the claim is checked, its coverage is not, and
  the module header's residue names why no gate can check it. The settling read is `git grep`, so a symbol
  named in PROSE under `src/` counts as production source and falsifies a true claim — write the evidence for
  a deletion in the pull request, never in a file the gate reads. It is the one honest route past for a
  verb-family deletion. **There is no baseline and no `--rebaseline`**: the comparison is a file against its OWN past, which no debt
  list can express, and what it compares against is `SLOPWEAVER_COVERAGE_BASE_SHA` — `coverage-ratchet`'s
  variable, shared through `gitAtCommit.ts`, exported and `--depth=1` fetched at job level by `lint` and
  `unit`, and exported by `github lap`. Run without one it FAILS and prints the command that supplies it,
  because a comparison against no base read nothing; only a brand-new ref's all-zeroes base passes unjudged
  (`resolveFloorBase`). The diff is **two-dot**
  (`git diff <base> HEAD`) and must stay that way: a `--depth=1` fetch grafts a PARENTLESS base, so a
  three-dot `base...HEAD` has no merge-base to compute and exits non-zero — which is precisely how this
  gate went red in CI while passing every full-history lap. `unit/devLint/gitAtCommit.test.ts` asserts
  both arms over a real shallow clone. The diff is also **`-z`**, and that is a correctness flag, not a
  formatting one: `core.quotePath` defaults ON, so without it a modified `café.test.ts` arrives quoted as
  `"src/__tests__/unit/caf\303\251.test.ts"`, fails the tree-prefix test, and a real weakening is dropped
  while the gate reports "nothing to compare". A reproduced counterexample showed it. No allowlist, no
  exemption marker.
  Assertion names are resolved by BINDING, so `import { expect as check } from "vitest"` is counted — an
  aliased file once scored zero at BOTH commits, which made a deleted assertion in it
  read as `clean`. A namespace import (`import * as v`) is the named residue, in the gate's own header.
  `.only` and `.skip` are read in the TAG position as well as the callee one, so a `.each` table written as
  a tagged template (`` it.only.each`a | b` ``) is caught — it focused a whole file with all
  four counts unchanged.
  A skip is counted by EXECUTION rather than by the word: `skip`, `skipIf`, `runIf` and `todo` all raise the
  same count, since each silences a case while leaving its assertions written — `describe.skipIf(true)` took a
  genuinely failing suite from exit 1 to exit 0 with all four counts unchanged. `.fails`
  is deliberately outside it and named in the gate's own residue.
  A member hop is read in both spellings, so `it["skip"]` and `expect(1)["toBe"](1)` count exactly as their
  dotted forms do — a failing case disabled through brackets once left the gate printing clean. A key that
  is not a literal is deliberately left unresolved rather than guessed.
  A modifier is read in BOTH of vitest's spellings: chained (`it.skip`, `describe.skipIf`) and as an option
  on the call itself (`it("regression", { skip: true }, fn)`), the latter silencing a failing
  case with every count unmoved. One vocabulary serves both, so the two can never disagree; an option set to
  a literal `false`, an options object that is not the suite call's own argument, and a call whose root is
  not a suite function are all outside it.
  Both option spellings count: `{ skip: true }` and the shorthand `{ only }`, the latter carrying no
  initialiser to test and so counted on sight. A spread is not followed — that needs the declaration it came
  from, which is the dataflow this gate does not do, and it is named in the gate's own residue.
  A genuine merge of several matchers into one IS refused: say which stronger claim replaced them in the
  pull request rather than re-adding a weaker assertion to clear the count.
- **host-wording** (`src/devLint/hostWording.ts`) — a line ADDED against the same base commit, outside every
  `__tests__` tree, that names the host by its make: the words "this" and "mac" as whole words, any case,
  unless a matching pair of quotes or backticks wraps the phrase exactly (the phrase named as itself). Write
  "this machine"; macOS and its product names stay. A diff gate, so no debt list: a line already on the base
  is ordinary rewording, never a precondition. With no base it fails and names the fix, as every gate on that
  base does. The publication scan (`src/outbound/publicationScan.ts`) refuses the same phrase in
  every text a pull request publishes, commit messages included; this gate keeps new code and docs from
  carrying it back in. Reproduce with `SLOPWEAVER_COVERAGE_BASE_SHA=$(git merge-base origin/main HEAD) yarn lint --only host-wording`.
- **coverage-ratchet** (`src/devLint/coverageRatchet.ts`, cores in `coverageFloor.ts`) — the unit lane's coverage
  floor, `coverage-baseline.json` at the repo root: four repo-wide minimums plus one STATEMENT floor per
  `src/<dir>` bucket of 200 statements or more, so a weak directory cannot hide behind a healthy average.
  It RATCHETS: `yarn coverage:rebaseline` (after `yarn test:unit`) writes every floor to measured-minus-one,
  never lower. The measured half refuses a drop below a floor, answered by covering the code, and a large
  directory with no floor, answered by the rebaseline. A floor more than two points behind the measurement is
  REPORTED on stdout with the rebaseline to run and never fails, by the owner's ruling. CI alone compares HEAD's floor against the base commit's (a floor once stood at 70
  against 74.95 measured). Both numbers and the size cut are measured
  in `coverageFloor.ts`.
- **help-flag-opt-out** (`src/devLint/helpFlagOptOut.ts`) — a verb may not opt out of the help/flag ratchet
  (`src/__tests__/unit/cli/helpTruth.test.ts`) when its flag set is mechanically readable. That ratchet's
  `UNGUARDED` register carried a PROSE reason nobody read: `slack edit` claimed "no exported flag spec yet"
  while parsing from a nine-flag literal and advertising four, which hid `--as me` and `--body` — measured
  43 of the 50 entries were false the same way. A verb is readable when its manifest loader, or
  anything it reaches by relative run-time import inside `src/cli/commands/`, parses through `parseFlagTail`/
  `parseFlags`/`tokenizeFlags`; a whole-statement `import type`/`export type` edge carries no parser and is
  not followed, a mixed `import { type X, y }` is. `help-flag-optout-baseline.json` names today's offenders; a NEW one fails on
  any noun, and an entry that stops offending must be pruned. `--prune` only ever REMOVES — a mode that could
  widen the list would be the free-text opt-out again, spelled differently.
- **internal-exports** (`src/devLint/internalExports.ts`) — knip (with `ignoreExportsUsedInFile: false` and
  `*.test.ts` dropped from `entry`, in `knip.json`) already knows which exported symbol has no consumer
  outside its own file or a test file; this gate requires each one to carry an inline `@internal` JSDoc tag
  (never un-exported — a symbol a test reaches is the zero-mocks rule working as designed) or be dropped from
  `export` entirely. Its committed `.baselines/internal-exports-baseline.json` is empty, so every untagged flagged symbol fails;
  `yarn devlint:internal-rebaseline` rewrites it, and a diff that adds an entry grandfathers debt. The bare `knip` check [above](lint-reference-repository.md) excludes
  `exports`/`types`/`nsExports`/`nsTypes` — this gate owns judging those, with baseline tolerance a plain
  knip run can't express.
- **gate-registration** (`src/devLint/gateRegistration.ts`) — three wiring proofs over every `src/devLint/*.entry.ts`:
  each is in the `lintChecks` plan, each planned bespoke gate carries a refusal declaration, and each entry is
  exactly one top-level `await runGateEntry({ run })` imported from `src/devLint/gateEntry.ts`, with nothing else at its top level
  but imports, that touches `process`
  only as `process.<member>` for an allowlisted member (`argv`, `cwd`, `env`, `stderr`, `stdout`), never `process`
  as a value, never `globalThis` or `global`, never a string naming the `process` module, whatever loads it, since any alias reaches `exit`
  (`gateEntryLifecycle.ts`, judged on the syntax tree; code built at run time is outside it), so every gate closes its TypeScript clients
  (`src/lib/tsLifecycle.ts`) before it exits. It proves wiring, never that a gate's logic is correct.
- **ci-offload-contract** (`src/devLint/ciOffloadContract.ts`) — parses `.github/workflows/ci.yml` and proves
  one property: **`build` succeeding implies every offloaded lap succeeded on that event's tree.** Those laps
  (`yarn lint` — the FULL lane, not `lint:local`, so every gate the local lane skips — plus `typecheck`,
  `test:unit`, `test:subprocess`, `test:e2e`, `coverage:ratchet`, `yarn build`, and the desktop shell's and the console
  site's own `yarn build`) run in parallel worker jobs, so command PRESENCE is not the property: a job nothing
  requires satisfies it. The gate checks each command runs in its declared worker as a step whose
  whole `run:` is that command with nothing that could mask its failure; that `build` needs exactly those
  workers, runs under `always()` (without it a failed need SKIPS `build`, and skipped reads as passing) and
  fails unless each result is spelled `== 'success'`; that every worker's runner facts, setup step, `run` and
  `env` is pinned as [ci-install-cache.md](../ci-install-cache.md#what-ci-offload-contract-pins) says; and that
  `lint` and `unit` both carry the coverage base. It also enumerates every job in the file
  (`src/devLint/ciJobCoverage.ts`): each is `build`, listed in `build.needs`, or named in `UNAGGREGATED_JOBS` with a
  reason (`integration`, a required context of its own; `ci-timing`, a non-required report on the finished run), so a
  job added outside `build.needs` fails the gate rather than going red under a green `build`; an exclusion naming a
  job the file no longer has, or one `build.needs` also lists, fails too, as does a `jobs` key that is not a plain job id (YAML's numeric `1:` and
  string `"1":` collapse onto one parsed property, and a `<<` merge key splices in another map, either of which could
  hide a job). `gate-registration` proves a check is in the PLAN; this
  proves the machine that runs the plan still does. It cannot see GitHub's branch
  protection, so it does not prove `build` is a REQUIRED check — only that the work stands behind it.
- **ambient-heap-ceiling** (`src/devLint/ambientHeapCeiling.ts`) — fails if an AMBIENT heap ceiling is set
  anywhere: a `NODE_OPTIONS` naming `--max-old-space-size` anywhere in any `.github/workflows/*.yml` or any
  tracked `package.json` — **both parsed and then walked WHOLE**, every string in the document offered to
  the shell reader, rather than at the keys somebody remembered — set by any tracked script the TypeScript
  parser reads, or assigned in **any other tracked file at all**. **Each subject is a SHAPE, never a path list** — that is the gate's whole substance,
  and each of these is a hole wherever it is not: a quoted value with another option
  first, a nested `site/package.json`, V8's `--max_old_space_size` underscore alias, a step `run:` body, a
  `#` inside quotes truncating the line, a backslash line continuation, a continuation splitting the flag
  itself, a manifest script read as a flat string, a quote boundary inside the flag, a second assignment on the
  same line, an unquoted backslash escaping a character inside the flag, and a comment ending in a
  backslash, which a real shell ends at the newline while a reader that joins first and strips comments
  afterwards pulls the assignment below it into the comment, and a quote boundary inside the variable NAME
  (`NODE_'OPTIONS'=…`), which no pattern anchored on the literal name can see. **Each logical line is split
  into shell WORDS and each word DEQUOTED whole**, name and value together, so every one of those spellings
  becomes the same string; bash's `+=` append counts, and a name buried inside another word does not. There
  is no key list: `defaults.run.shell`, a GitHub Actions field whose value REPLACES the command every `run:`
  body executes, passes `actionlint` and would escape any list, as a tracked `.envrc` escapes any
  name-shaped filter for "is this shell". **The shell reader is its own module**
  (`src/devLint/ambientHeapCeilingShell.ts`), because the same three questions are asked of a `.sh` file, a
  manifest script and a `run:` body. **There is no shell filter: every tracked file no other parser
  claimed is read whole as shell**, whatever it is called and whatever is at the top of it. Each filter
  leaves a live hole: `.sh` misses `bin/slopweaver`, the launcher every verb
  runs through and the one standing ceiling in the tree; `.sh` plus no-dot-in-the-basename misses a dotted
  script name; matching the INTERPRETER's name — `sh`, `bash`, `zsh`, `dash` — misses `#!/bin/ksh`; and
  "`.sh` or a shebang of any kind" misses a tracked `.envrc`, which `direnv` sources into every shell in the
  checkout and which has neither. Measured, one exporting a `NODE_OPTIONS` of `--max-old-space-size=128`
  gave a real `node` child a 320 MiB ceiling against a 4,288 MiB baseline while the gate read the tree
  clean. **A markdown file is read as shell too**, which is why the sentence you just read spells the
  variable and the flag apart rather than as one assignment: canon describing the ban must not carry a live
  assignment, and the fix when this gate reddens on a doc is to reword the doc, never to exempt the kind —
  no tracked markdown in this repository trips it today.
  **So a file kind buys a PARSER, never an exemption, and the failure direction is inverted: an
  unrecognised file kind is SCANNED.** Dropping the filter with nothing parsing scripts reports seven
  tracked `.ts` files that set nothing — a `.ts` spells the assignment inside a string literal or a JSDoc
  fence, in a refusal message naming the workaround, a test asserting on that message, and a measured
  comment carrying its own repro command — so **a fourth bucket parses every extension TypeScript reads**
  (`src/devLint/ambientHeapCeilingScript.ts`) and looks for the shape a script really sets a ceiling with: a
  property or assignment whose TARGET is named `NODE_OPTIONS`, which is `{ env: { NODE_OPTIONS: … } }` on a
  spawn and `process.env.NODE_OPTIONS = …` in place. A declaration is a write, a shorthand property is a write, and **a CALL is a write with no
  function named**: the criterion is that both halves sit in the same call, some argument being exactly the
  variable's name and some argument carrying the flag, so `Object.defineProperty(process.env,
"NODE_OPTIONS", { value: … })` and `Reflect.set` both count without either being listed — a method list
  would be the interpreter list one level down. **Key and value each resolve ONE hop through a `const` in
  the same file**, so a computed key and a value held in a constant both count; a deeper chain is the stated
  blind spot, because folding an arbitrary expression needs a type checker. **A leading byte-order mark is stripped ONCE, at the walk's
  own decode step**, because a BOM is decoding rather than content and every real decoder discards it:
  `dotenv.parse` of `EF BB BF` followed by a `NODE_OPTIONS` heap assignment answers the assignment, and a
  real `node` child spawned with it reported a 320 MiB limit against a 4,288 MiB baseline while the shell
  reader saw a first word of `\uFEFFNODE_OPTIONS=…` and matched nothing. Stripping it in each of the four
  readers would be the list-shaped answer this gate exists against, and the manifest bucket gains the most —
  `JSON.parse` throws outright on a BOM, so a BOM'd `package.json` would stop the walk with a parse failure
  rather than be read. bash needs no special case in either direction: it reads
  such a line as a COMMAND, so it sets nothing at all. Reading every tracked file costs 8.9s against 8.0s
  for the shebang-filtered walk
  (`slopweaver dev lint --only ambient-heap-ceiling`).
  **That ceiling is carried as DEBT, in `STANDING_CEILING_SITES`, not hidden by the filter.** **An entry
  names a SITE, never a file**, which is why every site carries the assignment's own text. Written as a
  filename the entry exempted the whole file: a second `export NODE_OPTIONS` of
  `--max-old-space-size=128` inserted beside the real one printed "standing debt, 2 site(s)" and exited 0,
  while the launcher prefix gave a real `node` child a 320 MiB limit against a 4,288 MiB baseline. Matching
  on the assignment's text rather than on a line NUMBER means an unrelated edit to the launcher does not
  redden the gate, and changing what the clamp sets does. A row is CONSUMED by the site it matches, one for
  one, so a VERBATIM second copy of the declared assignment is fresh and refused rather than absorbed by the
  entry that already covers the original. It cannot go
  until `derive` streams bronze rather than loading it, and the list only ever shrinks: a ceiling anywhere else is refused, and the entry failing to FIRE fails the gate
  just as loudly, because the list would then be a lie about the tree.
  The owner wants the node-options workaround permanently off, with the owner and the fleet unable to bring it
  back; and the refusal's correction is the act that serves that — measure the process with `slopweaver dev profile`, and if you have measured it
  and still cannot solve it, explain the memory problem to the OWNER rather than putting the variable back.
  **A ceiling on the argv of the one process that needs it is outside the criterion by construction**, not
  excused by an allowlist: `yarn typecheck`'s `scripts/tsc-owner.sh … --rss-ceiling-mib 10240` and `devLint.ts`
  spawning its gate with the flag on the CHILD's argv both stand, because this gate never reads an argv.
  Each subject is parsed structurally (YAML, JSON, or shell read with the shell's own quoting, comment and continuation rules), so the many
  deliberate COMMENTS in `ci.yml` about the variable can never be read as the
  variable itself. No allowlist and no exemption marker — a lint gate is the one refusal with no run-time
  override, and this one's whole point is that it cannot be waved through.
- **ci-trigger-contract** (`src/devLint/ciTriggerContract.ts`) — parses every workflow that carries a
  `pull_request` trigger and fails if a job could run on an event that cannot change its verdict. Each job
  declares its actions, and a file's `pull_request.types` must equal the union of its own jobs' declarations,
  so a type nobody needs cannot sit there costing a lap and a job added later cannot silently inherit one.
  The gate above proves the work still runs; this one proves it does not run for nothing. It cannot check
  whether a declaration is TRUE — that is a judgement about what the job reads, so each entry carries its
  reasoning for a reviewer.
- **heap-ceiling-ratchet** (`src/devLint/heapCeilingRatchet.ts`) — refuses a memory ceiling (a package
  script's V8 heap flag or compiler owner's `--rss-ceiling-mib`, in any manifest that pins TypeScript; a lint
  gate's argv one; `HEAP_BUDGET_MIB`) that disagrees with `.baselines/heap-ceilings.json`, and, against
  `SLOPWEAVER_COVERAGE_BASE_SHA`, a raise or a new ceiling over 4,096 MiB with no appended, anchored raise
  record. An RSS key (`….process-tree-rss`) is judged against the V8 key it replaces, never the reverse.
  Fails closed on a ceiling spelled where its readers cannot follow, or a manifest it cannot read; blind to
  `bin/slopweaver`'s ambient clamp, which `ambient-heap-ceiling` owns.
- **tsc-heap-contract** (`src/devLint/tscHeapContract.ts`, policy in `tscOwnerContract.ts`) — on TypeScript
  6, refuses a `package.json` script that runs the
  TypeScript compiler without naming its own `--max-old-space-size` before the entrypoint, and refuses one
  that reaches a ceiling through `NODE_OPTIONS` even when the direct flag is also there. No allowlist, no
  marker, no script-name exception: renaming `build` evades nothing, and the criterion deliberately covers a
  single-file compiler call too, because classifying "whole repo" would mean resolving a tsconfig's
  `extends` chain, `include`, `files` and project references to answer a question a `-p` argument never
  asks. The two gates above prove the CI machine still runs its laps; this proves one of those laps can run
  at all — MEASURED, `yarn build` with no ceiling died at 4,085.3 MB. Its blind spot is that
  it reads script strings and nothing else, so a compiler call inside a shell or JS wrapper is invisible to
  it, and a declared ceiling being SUFFICIENT is `compile`'s property rather than this one's. On 7.1 the
  same gate asks every manifest in `TYPESCRIPT_PIN_MANIFESTS` for `bash <path>/scripts/tsc-owner.sh` with all
  three bounds and the compiler after `--` (the optional `--lock-timeout-seconds` read the way the owner reads
  it), and refuses any V8 heap flag beside it.
- **typescript-pin** (`src/devLint/typescriptPin.ts`) — the tracked manifests naming TypeScript are exactly
  `TYPESCRIPT_PIN_MANIFESTS`, each pinning `typescript` to exactly `TYPESCRIPT_PIN`; the tracked lockfiles are
  exactly `TYPESCRIPT_PIN_LOCKFILES`, and every `resolution` installing TypeScript is that version (Yarn's
  builtin compat patch of it included, both its version fields checked), as is every entry nesting a
  `typescript@` descriptor or exposing a `tsc`/`tsserver` bin, by command name or by target. A range, an alias
  under any protocol, `@typescript/typescript6` or a foreign patch is refused, a `resolutions` key read as Yarn's
  selector; a tracked manifest NAMED `typescript` (a vendored copy a `portal:` could install) and another package
  manager's lockfile are refused by their presence: one compiler, no dual toolchain. A peer range is never read —
  it installs nothing.
