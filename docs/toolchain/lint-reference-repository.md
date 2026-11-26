# The lint reference — formatting, static analysis and repository shape

Part of [Toolchain](../toolchain.md).

A narrow run is never the push bar — `yarn validate` runs the lot. There is no ESLint: oxlint's
`--type-aware` mode is the type-aware lane, and Prettier formats code as well as docs:

- **Biome** (`biome.jsonc`, gate `biome-imports`) — imports only: sorts, merges, drops an unused one, before Prettier
  rewraps (`yarn format`). It does not count a `{@link}` as a use, so such an import carries a `biome-ignore`.
- **Prettier** (`.prettierrc`) — formats everything, code and docs (double quotes, semicolons, 2-space, LF, width 120).
- **oxlint** (`.oxlintrc.jsonc`) — syntactic AST/bug rules AND, via `--type-aware` (backed by
  `oxlint-tsgolint`), the type-aware lane: `no-floating-promises`, `no-misused-promises`,
  switch-exhaustiveness, `only-throw-error`, `no-explicit-any`, `explicit-module-boundary-types`, and every
  other rule in `typescript-eslint`'s `recommendedTypeChecked` preset — `.oxlintrc.jsonc`'s own comment lists
  them rule by rule. Zero warnings tolerated (`--deny-warnings`); runs over
  `config/typescript/tsconfig.lint.json` (the `src`/`eval`/`hooks` tree).
- **cognitive-complexity, house-rules, testing-discipline, unnamed-failure-assertion, hand-rolled-result, error-shape-threshold,
  no-nested-ternaries, authored-separator, app-copy-voice, transient-references, console-loading-prose, no-private-browser-profile, claude-email-not-identity, epoch-arithmetic, cli-command-boundary, torn-tail-append, session-harness-lifecycle, store-journal-anchor, escape-hatch, hatch-release, atlas-manifest-clock, primitive-ratchet,
  linear-sdk-documents, redos-check, typescript-import-seam, runtime-dependencies**
  (`src/devLint`) — bespoke gates
  covering what oxlint has no mechanism for: `sonarjs/cognitive-complexity` (capped at **12**, reimplemented
  against the TS AST — see `cognitiveComplexity.ts`'s own doc for exactly how it matches the pinned plugin);
  the house rules (no `?? ""`, no `isDirectInvocation`, no `process.argv[1]`, no `as any`/double casts) plus
  the ban on hand-rolling a crash-durable write — a rename out of a staging file, which every store gets from
  `src/lib/writeAtomic.ts`; the **testing-discipline bans** that
  machine-enforce `testing.md` across every `.ts` under `src/__tests__/` — the shared fakes and
  fixture builders included, since a fake is where somebody reaches for a mock (no `vi.mock`/`vi.spyOn`/`vi.fn`, no
  `.toBeTruthy()`/`.toBeFalsy()`, no bare `toHaveProperty("k")`, no `expect(typeof …)`); the
  **unnamed-failure-assertion ratchet** (`unnamedFailureAssertion.ts`) that machine-enforces the other half of
  `testing.md`'s assertion discipline — a test case whose every assertion is a bare `isErr()`/`isOk()`/`.ok`
  failure check names no failure, and `.baselines/unnamed-failure-assertion-baseline.json` only ratchets down;
  the **app-copy-voice ratchet** (`appCopyVoice.ts`) that holds the app's own copy to
  the owner's voice rule on dashes — a string, template part or JSX text in non-test `site/{app,components,lib}` or
  `desktop` TypeScript carrying an em or en dash (or its HTML entity) is refused, text somebody else wrote
  arrives as data and is exempt by construction, and its baseline is empty, so every such dash is refused; the
  **transient-references ratchet** (`transientReferences.ts`), holding every reference only one installation's history
  or store gives meaning — a dated ruling, a commit, PR, turn, call or session id, a time of day, an attributed quote, a
  masculine pronoun for the owner, a knowledge row, a store pointer, a voice turn, a cited handover run — to a per-file,
  per-class debt list, test or code data reported apart, the four state-id ones reading fixtures and JSON too, bar their
  reserved synthetic forms; the **hand-rolled-`Result` ban** that machine-enforces `error-handling.md`'s categorical
  rule — a union type discriminating on a literal `ok` is a `Result` written by hand, and a plain
  `ok: boolean` success flag is not (`handRolledResult.ts` states the criterion and both deliberate exclusions); the
  **error-shape-threshold** (`errorShapeThreshold.ts`) that machine-enforces the other side of
  `error-handling.md`'s union rule — a directory authoring more than four DISTINCT plain error message shapes
  into `err`/`errAsync`, a string reached through a `const`, an import, a re-export or a `...spread` item included, fails unless `.baselines/error-shape-threshold-baseline.json` carries it at a count no
  smaller, and that debt list only ratchets down; the
  **no-nested-ternaries ban** that machine-enforces `typescript-patterns.md`'s § Other rules entry — a
  ternary whose branch is itself a ternary must become if / else-if / else (`noNestedTernaries.ts`); the
  **console-loading-prose ban** (`consoleLoadingProse.ts`) that holds the console under `site/` to the owner's
  ruling — a read or load word followed by an ellipsis in text a page shows is a loading line written
  as prose, and `site/components/ui/spinner.tsx` draws the progress indicator instead; the
  **authored-separator ban** (`authoredSeparator.ts`) that machine-enforces an owner ruling —
  a card's TL;DR may not carry a separator character somebody typed, in a `tldr:` property's own string or
  anywhere inside a function whose name mentions a TL;DR, which is the shape two of them took. Its pair is
  `src/outbound/artifact/headline.ts`, the form that makes the mistake unrepresentable where a composer owns
  every word. A separator reached through a named constant is outside the criterion on purpose: that IS the
  pattern being generalised. A companion ruling — no runtime hard block, every refusal carries a
  hatch — is what makes this a LINT gate rather than a send-time check; the
  **no-private-browser-profile ban** (`noPrivateBrowserProfile.ts`) that machine-enforces the owner's
  browser ruling ([browser-route](../browser-route.md)) — a launch or attach naming a profile directory of
  its own, or a `--user-data-dir`/`--remote-debugging-port` argument, fails. A bare Playwright import does
  NOT: the owner asked for Playwright pointed at their real Chrome, so the ban is on a private PROFILE, never on the tool;
  the **claude-email-not-identity ban** (`claudeEmailIdentity.ts`) — under `src/claude/` and
  `src/cli/commands/claude/`, a read of `accounts.json`'s `email` in an IDENTITY position fails: an equality
  against a real value, a `.get`/`.has`/`.set`/`.add`/`.includes`/`.indexOf` first argument, a computed
  member key. That address is hand-typed, a `/login` does not touch it and it drifts from the token in the
  store, so WHICH ACCOUNT is resolved from the organisation the probe named against the
  standing enrollment and rendered through `accountBinding.ts`. A comparison against `undefined` or `null` is
  a presence check and outside the criterion, as is passing, spreading or rendering the address; the
  **epoch-arithmetic ban** (`epochArithmetic.ts`) — a `new Date()` whose sole argument is a multiplication is
  an epoch scaled by hand, and fails anywhere outside `src/lib/date.ts` and `src/lib/slackTs.ts`. No
  allowlist and no exemption marker, because the legitimate shapes are already outside the criterion
  (`new Date(ms)` has no operator; a window bound's top-level operator is `-`). Four independent `tsToIso`
  copies stood in the tree at once, so there was no single function a rule could name — and the human half
  of that, a Slack `ts` read 80 minutes wrong into two deadman deadlines, is why the answer is a gate plus a
  verb (`slopweaver slack when`) rather than a note; the **cli-command-boundary ban** (`cliCommandBoundary.ts`) —
  product code statically importing `src/cli/commands/` fails (17 such imports once made verb modules a library); the
  **torn-tail-append gate** (`tornTailAppend.ts`) — an append to a file through a `node:fs` binding
  (`appendFileSync`/`appendFile`, an `openSync`/`open` for `a` or `O_APPEND`, a `{ flag: "a" }` write, or any
  `.appendFile(…)` method) fails anywhere but `appendLines` in `src/lib/appendSeparator.ts`, which starts a record
  on a fresh line when a crash left the last one cut short. 78 append call sites had no such guard and one death record was
  written twice (a fresh audit's finding); four descriptor appends that guard their own held descriptor
  sit on a debt list keyed by count, which fails when an entry stops firing; the **session-harness-lifecycle
  gate** keeps the session ledger's row to ONE writer, the seam ([session harness](../session-harness.md)); the
  **store-journal-anchor gate** (`storeJournalAnchor.ts`) — the committed migration journal is resolved
  from the tree the build lives in, never the operator cwd, in two arms: no `process.cwd()` anywhere under
  `src/store/`, and outside it a `cwd` argument to a journal-resolving function (`connectStore`,
  `applyStore`, and the seven `lifecycle.ts` entry points) must be `installedTreeRoot(...)` — or omitted where
  the function defaults to it, as the two openers do.
  No allowlist, no exemption marker, no debt list: both arms were clean on the commit that added them. Its
  three blind spots are named in the module header and asserted in its own tests — a spread, an argument
  that is not an object literal, and a family member reached through an alias — and widening the criterion
  to reach the first two would red correct code, so the runtime witness covers them instead. The class is invisible in the
  main checkout and fires only elsewhere, which is why prose could never hold it — two spawned seats an
  hour apart could neither search nor write the knowledge register from inside a worktree. The runtime
  complement is `src/__tests__/subprocess/cli/commands/store/journalFromTree.test.ts`, which spawns the
  shipped binary from an empty directory; the **escape-hatch gate** (`escapeHatch.ts`) that makes the owner's
  refusal shape structural — a `SLOPWEAVER_ALLOW_*` literal, any quoted name or property key with an
  `ALLOW`/`OVERRIDE` component (`overrideVariable.ts`), or a `*_OVERRIDE = "<token>"` constant with no row in
  `src/hatch/registry.ts` fails, and so does a `decision.findings` mapped, spread or iterated into TEXT outside
  `src/admit/doorRefusal.ts`, which is the one renderer that always prints the override token — or the bare
  `decision.status` verdict read into a template or a `+`, found on the AST (`bareDoorVerdict.ts`), which printed
  `refused by door: warn` and nothing else. Its single
  exclusion is a criterion rather than an allowlist: findings mapped into a RECORD (`=> ({ … })`) are a
  journal row or a `--json` document, not a message anyone acts on. It also refuses a
  devLint module that writes its own policy summary — every lint gate's refusal is the same four lines,
  rendered by `src/devLint/refusal/render.ts` from a declaration in that directory's register, with line
  three refusing a RUN-TIME override and naming what a fix looks like. A write that is a fact the gate
  could not get past, or a correction body, carries `devlint: not-a-refusal -- <why>` on the line above. MEASURED: 29 sites in
  `src/` rendered door findings to a caller and ZERO printed the token the finding was carrying;
  the
  **hatch-release ban** (`hatchRelease.ts`) — the other half of that shape: a refusal that NAMES an override
  must be RELEASED by it. An escape-hatch environment read (any name `overrideVariable.ts` calls an override — `SLOPWEAVER_ALLOW_*`,
  `ALLOW_FABLE_OVERRIDE`, `SLOPWEAVER_DOOR_OVERRIDE` — written as a literal or through a constant the tree binds to one) written as a
  PARAMETER DEFAULT fails, because a default initialiser is skipped whenever a caller passes that argument at
  all. MEASURED: `SLOPWEAVER_ALLOW_SPENT_PLAN=1 slopweaver cmux spawn <slug> --model fable`
  printed the identical refusal it had printed without the variable — _"run the same command again with
  SLOPWEAVER_ALLOW_SPENT_PLAN=1"_ — because `cmux spawn` always passes its own `--force` argument, `false`
  when absent, so the default never ran; with the ruling that a supervisor runs on Fable and no other model,
  that left the chain unable to seat any successor. The correction never weakens anything (read it into a
  local and OR it with the argument), so there is no exemption marker, and an ordinary ambient value such as
  `SLOPWEAVER_HOME` is outside the criterion by construction — there an explicit argument SHOULD win;
  the
  **atlas-manifest-clock ban** (`atlasManifestClock.ts`) — a function declared outside `src/atlas/kit/` whose
  body returns an object spreading one of its own PARAMETERS and assigning `kinds` is a per-atlas copy of the
  manifest-stamping the kit owns, and fails. `publishAtlas` DERIVES a generation's `updatedAt` from the kind
  files it vouches for, exactly as it derives each digest from the bytes it writes, so no caller can assert a
  clock at all; a private copy is how one got preserved instead. MEASURED: `atlas doctor` reported
  the 1Password generation "published <iso-instant>" while its own `events.jsonl` envelope said a
  later instant, days apart. FOUR copies stood at once — `onepassword/sync.ts`, `vanta/sync.ts`,
  `cloudflare/kindFold.ts` and `vanta/browserSurface.ts`, the last found by this gate and by no manual audit
  — and JumpCloud had already fixed it privately, in a file whose header described the defect its siblings
  still carried. No allowlist and no exemption marker: spreading a CALL or a LOCAL is a fresh-generation
  build and passes, and the kit is out of scope by path because the kit is where the function belongs
  (`kit/manifestClock.ts` carries the measurement and the owner's ruling);
  **primitive-ratchet** (`src/devLint/primitiveRatchet.ts`, code-quality round 2 item 7) — refuses a new
  top-level function whose body is an exact AST-structural match for a REGISTERED canonical primitive
  (today: `optStr` in `src/corpus/slack/shape.ts`), even reformatted, commented, or renamed.
  A primitive drifts into copies under many local names, and a review that recommends deleting one does
  not stop the next copy: MEASURED in that file's header, `optStr` went from 12 to 14 copies in the day
  after code-quality round 1 recommended deleting it.
  Each copy differs slightly, which is why a text match misses them and the comparison is structural.
  See that file's own header
  for the registry and why "structurally equal" deliberately ignores a node's original text and formatting;
  **linear-sdk-documents** (`src/devLint/linearSdkDocuments.ts`) — every Linear GraphQL operation comes from
  `@linear/sdk`, never from a template literal in this tree. It reads `LinearDocument` at SCAN TIME, extracts
  the root field of every generated document, and refuses a hand-written operation that lands on one of them,
  so the criterion narrows itself in both directions: the day Linear ships a document for a field we still
  write by hand, the gate starts refusing it with no edit here, and the two operations the SDK genuinely
  cannot express (the atlas's `__schema` introspection, and `oauthApplications`, for which the pinned bundle
  ships nothing) sit outside the criterion rather than on an allowlist. Scoped to Linear source paths, because
  GitHub's schema shares root field names — `organization`, `search`, `user`, `node` — with Linear's. Its ONE
  exemption marker, `linear-sdk-documents-exempt:`, needs a reason on the line directly above the literal; a
  bare marker exempts nothing. It exists because the class had regenerated to 81 hand-written operations
  across 11 files while `@linear/sdk` was installed and imported in four of them, as a transport only —
  the owner's ruling is that, where feasible, the class is made structurally impossible.
  And ReDoS (`no-super-linear-backtracking`'s job), via the exact `scslre` library + options that ESLint rule
  itself called, read from its source rather than guessed.
- **typescript-import-seam** (`src/devLint/typescriptImportSeam.ts`) — only `src/lib/tsSyntax.ts`, `tsProject.ts`,
  `tsLazy.ts` and `tsCompiler.ts` (named-object-params' checker alone) name `typescript`; a file is PARSED, and any call's
  first literal argument counts, so a renamed `createRequire` loader is caught. Outside them it refuses a range
  marker `SyntaxKind.First…`/`Last…`, read or destructured (TS7 renumbers it: ask `isAssignmentOperator`), and, bar
  named-object-params, a `createSourceFile`: `withSourceFile` lends a tree, `withTsModuleResolver` a resolver.
- **named-object-params** (`src/devLint/namedObjectParams.ts`) — the one whole-repo `ts.Program` gate; its header
  carries the criterion, coverage and heap budget. ONE branch settles each signature, in a fixed order
  (`namedObjectParamsDecide.ts`). Moving it onto another compiler is accepted by its **decision stream**: with
  `SLOPWEAVER_NAMED_OBJECT_PARAMS_SUBJECT_ROOT=<checkout>` and `SLOPWEAVER_NAMED_OBJECT_PARAMS_DECISION_STREAM=<file>`
  set, `yarn tsx --expose-gc --max-old-space-size=8192 src/devLint/namedObjectParams.entry.ts` judges that checkout
  as the gate judges this one, one JSON line per decision (`namedObjectParamsOracle.ts`). Base and head rule each
  stream over one detached base checkout with its own `yarn install --immutable`; `cmp -s` is the verdict.
- **home-safety** (`src/devLint/homeSafety.ts`) — two halves over one subject: a test reaching the
  developer's real `~/.slopweaver`. It refuses a `*.test.ts` call to a home-defaulting export (a
  `home?: string` parameter that falls back to the real `slopweaverHome()`) that omits `home`; and it refuses
  any file under `src/__tests__/` that READS `process.env["SLOPWEAVER_HOME"]` (`env-home-read`). The second
  half's pool is the test TREE rather than `*.test.ts`, which is the point of it: `setup-polly.ts` is neither
  a test file nor source, and it held that read. Writes to the variable are left alone — repointing it is the
  ambient-home sandbox's own mechanism; the record lane and the paid Codex acceptance run take the operator's real home from
  `realAmbientHome()` (`src/__tests__/realAmbientHome.ts`), captured at module load before the sandbox
  exists. A comment reading `home-safety-exempt: <reason>` above the statement is the one way to keep either
  shape, for a test that deliberately proves the default-resolution behaviour with every I/O edge injected as
  a fake, or that saves and restores the variable it is testing.
- **stdout-data-channel** (`src/devLint/stdoutDataChannel.ts`) — refuses a `process.stdout.write` in any
  non-test `.ts` under `src/cli/`, the verb surface. That write is asynchronous on a pipe and
  `runCliProcess` ends with `process.exit`, so a `--json` document larger than the pipe buffer arrives
  truncated mid-string with exit code 0 — measured at 65,536 of 300,012 bytes, which `jq`
  reports as `Unfinished string at EOF`. **How much survives is not one number**, and treating it as one
  made the test that proves this flaky: it is the kernel's buffer against whatever the READER drained in
  the meantime, so the same 300,012-byte document kept 65,536 bytes here and 146,176 on a Linux runner, and
  kept all of them on an idle one. `src/__tests__/subprocess/lib/stdoutDataChannel.test.ts` takes the reader
  away entirely rather than pinning a count; its header carries the measurements and the repro. `logger.out` already
  places every byte (`writeAllSync` loops a blocking `writeSync` and waits out `EAGAIN`), so the fix is one channel
  rather than a per-verb flush: 24 runners had grown their own `out: (line) => process.stdout.write(...)` seam. No
  allowlist and no exemption marker — the tree IS the criterion. Its one blind spot is named in the gate's own
  header: `src/lib/progress.ts` writes short lines straight to stdout under a declared non-blocking constraint the
  blocking channel would break, and sits outside the tree.
- **sync-child-timeout** (`src/devLint/syncChildTimeout.ts`) — refuses an `execFileSync`, `execSync` or
  `spawnSync` (resolved lexically to an import of `node:child_process`) whose options do not end with a
  positive `timeout`: a synchronous child blocks the event loop, so one waiting on a keychain dialog, an ssh
  passphrase on `/dev/tty` or a held lock holds the whole session for good. Last member wins, a same-file
  `const` spread is followed, `timeout: 0` is unbounded, and a shape it cannot resolve is refused, never
  passed. 74 such calls stood at measurement; the rest are per-file debt that only shrinks
  (`.baselines/sync-child-timeout-baseline.json`). `sync-child-timeout-exempt: <reason>` above the statement keeps a
  call meant to wait on a human it can see. Blind spots, named in the header: `require`, dynamic `import()`,
  a call reached through a wrapper in another module, and a `timeout` value decided outside the file (an
  imported constant, a parameter, a call), which is trusted, and an extra argument past the options Node
  reads, which TypeScript refuses but whose bound the gate still counts. A value the file decides is
  evaluated: zero, `undefined`, a negative or a shape it does not read as a number is refused.
- **knip** (`knip.json`) — dead files / unused exports / unlisted deps.
- **constraints** (`yarn.config.cjs`) — every dependency exact-pinned; `packageManager` always set.
- **renovate** (`renovate.json`) — the update mechanism the exact pin needs so the tree does not just age:
  `rangeStrategy: "pin"` is the strategy written for a repo that already pins, so Renovate proposes an exact
  version and `constraints()` above validates it rather than the two fighting each other. A major/minor bump
  waits 30 days (`minimumReleaseAge`, patch bumps do not) so a freshly published bad version is never
  proposed; `prConcurrentLimit: 2` bounds the queue; `sharp` is excluded (`enabled: false` on that `packageRules` entry)
  because it is pinned to a `portal:` stub, not a registry package (see `stubs/sharp`). No grouping and no shared
  schedule: the owner is the sole reviewer/merger (`.github/CODEOWNERS`) and every PR here — one dependency or a bundle
  — lands through the same `slopweaver github merge --admin` (rule 1), so grouping would only add blast radius (one bad
  dependency blocking every other bump behind it in the same PR) for no reviewer-load saving.
- **hygiene** + **door-coverage** — the public leak gate and the admit-door seam ratchet (see `docs/`). The
  leak gate fails on a SECRET always, and on a real workspace id wherever `IDENTIFIER_VERDICT` reads `refuse`
  (`docs/security/hygiene-gate.md`).
- **forbidden-identifiers** — the gate's committed-rule half, hashed names and provider locations
  (`src/hygiene/identifierScanRun.ts`), in CI only:
  a bounded per-kind summary and the tracked-file headline, `--list` for every location.
- **corpus-hygiene** — the SAME leak classes and the SAME private denylist, pointed at the bronze corpus
  under `$SLOPWEAVER_HOME` instead of at the tree (`src/hygiene/corpusScan.entry.ts`). The only check in the
  plan whose subject is not the repository, and the one lane the verb behind it has.
  Running it in the lane is the point: as opt-in prose in a skill, a non-zero exit on this install's corpus
  is something nobody sees, while a lane failing is something somebody reads.
  A machine with no bronze (CI, a fresh checkout, a fork) gets one line
  saying so and exit 0. MEASURED on this install: 66 s over 12 files / 2,226,826 records / 7.5 GB,
  streaming, so its heap is a read buffer rather than a corpus. Reproduce with
  `time yarn tsx src/hygiene/corpusScan.entry.ts`.
- **derived-card-voice** (`src/devLint/derivedCardVoice.ts`) — the SECOND gate whose subject is not only the
  repository, and the only one that runs the operator's own voice checker rather than a criterion written
  here. It walks `BOT_FORM_KINDS` (`src/outbound/artifact/botFormKinds.ts`), derives each kind's card from
  each of that kind's canonical fixtures — one per branch that composes prose differently, since a branch
  nothing exercises composes text nothing reads, and a fixture may IMPORT the function it covers rather than
  restate it — and runs the real above- and below-fold rules over the prose
  the DERIVATION composed: text no form schema can see, because it does not exist until after every schema
  has passed.
  Mirrors the live door's boundary rather than inventing a stricter one: above the fold refuses, below it
  warns (an owner ruling). Its STRUCTURAL half — every fixture still parses and still derives prose
  — runs anywhere and is a real refusal in CI; its VOICE half needs `$SLOPWEAVER_HOME/profile.json`, so a
  machine without one gets a line saying the voice half did not run and exit 0, exactly as **corpus-hygiene**
  does. Reproduce with `yarn lint --only derived-card-voice`.
- **duplicate-windows** (`src/devLint/duplicateWindows.ts`) — the clone ratchet: a 15-line normalised cross-file
  sliding-window hash (an all-import window excepted), ratcheted on the FILE-PAIR count against the committed
  `.baselines/clone-baseline.json` (refuse an increase, `yarn devlint:clone-rebaseline` tightens it down).
- **file-size-ratchet** (`src/devLint/fileSizeRatchet.ts`) — no module bounded a FILE's size (every function
  already has one). Counts CODE lines (comments/blanks stripped, reusing the clone ratchet's stripper) so a
  load-bearing file header is never the cheapest way under the cap; ratchets a committed
  `.baselines/file-size-baseline.json` of whatever sits over the cap — `MAX_FILE_LINES`, **300**, the figure
  the owner named (refuse a new one or a worse one, `yarn devlint:file-size-rebaseline` tightens it
  down): one cap behind a shrinking debt list. Its scope is **every file**: every tracked `.ts`, `.tsx`,
  `.mts`, `.cts`, `.js`, `.mjs` and `.cjs` in every tree, root included — the console and Electron shell were
  once outside it, and a 1,218-line `Workstreams.tsx` grew there unmeasured. **It is the ONE
  file-length rule**: oxlint's `max-lines` (1,000) was weighed and dropped — it counts
  blanks, cannot hold a debt list and exempts only by config path — and what only it covered (`tools/`,
  `config/`, `stubs/`, the root) moved in here. A **test file** (`*.test.ts`, `*.test.tsx`) is held to
  `MAX_TEST_FILE_LINES`, **500** (the owner's chosen option), and splits by scenario or `describe` block into
  sibling files, never by moving a flow's steps into helpers; no size marker works on one, and a helper under
  `__tests__/` keeps the 300. MEASURED, the numbers the owner picked from: 6,362 test files,
  median 118 code lines, 877 over 300, 295 over 500, 54 over 1,000, the largest `helpTruth.test.ts` at 10,340;
  every one over 500 the day it landed is frozen as debt at its count. The one exclusion is named: the
  upstream registry trees `site/components/ui/` and `site/components/ai-elements/`, re-pulled by their CLIs.
  **Oversized files are always split** (the owner's ruling, quoted in `src/devLint/fileSizeTradeoffs.ts`).
  Two things exempt a file from the cap: the `GENERATED — do not hand-edit` leading comment, and an inline
  `max-file-lines-exempt: <reason>` marker WITH a row in `.baselines/file-size-tradeoffs.json` naming the
  tradeoff and the anchor of the owner's yes. The register ships empty, because the owner could not name a case where
  splitting costs more than it buys. A marker with no row exempts nothing and is refused as
  `file-size-ratchet-unrecorded-tradeoff` on any file, under the cap or not; a test file's marker is refused
  whatever the register holds. The register is a ratchet baseline judged against main, so a new row needs a
  bump record and its witness exactly as a raised floor row does, and a row whose file is gone or no longer
  carries the marker is refused through `file-size-ratchet-debt`. The `max-file-lines-register:` marker that
  once let a file raise its own ceiling is RETIRED and refused by name (`file-size-ratchet-retired-marker`):
  a register splits by category like any other file. **An exemption waives the CAP, never the RATCHET**
  (the owner's ask): an exempt file is measured like any other and frozen in the baseline's own `exempt`
  array at its recorded ceiling, and `--rebaseline` refuses every recorded file's growth, exempt or not. The
  marker needs its reason on the SAME line, and it is read as a DECLARATION — opening its own line under
  nothing but comment characters — so a file merely naming it in prose declares nothing; a line that merely
  LOOKS like a comment line still does, which is named as the gate's blind spot rather than closed, since
  telling the two apart is a parser's job. A committed row that STOPS FIRING (its file gone, under the cap,
  or moved to the other half) is refused through `file-size-ratchet-debt`, so the floor only shrinks without
  anyone remembering the rebaseline; a row whose count merely dropped while staying over the cap is printed
  as slack rather than refused.
  **A REGISTRATION TABLE is split along a family the code already names, never rebaselined upward.** The
  freeze applies to a file whose length IS its data exactly as much as to one nobody reviews, so a catalogue
  that grows by one mandatory row per registration runs out of room and nothing new can be registered at all
  — measured, when `src/devLint/refusal/declarations.ts` (689) and `src/admit/sanctionedSeams.ts`
  (321) between them made adding a lint gate impossible. The remedy is the one the refusal already names:
  move a COHERENT family to its own leaf and spread it back into the same aggregate every consumer imports,
  so each row is still defined once and the parity check still reads one composed table
  (`refusal/*Declarations.ts` under `refusal/declarations.ts`, `admit/sanctionedDevTooling.ts`; witness
  `unit/devLint/registryComposition.test.ts`). The cut must be a family the tree already draws —
  `qualityRatchets` and `contractRatchets` in `gateGroups.ts`, the `dev-tooling` seam class — and never an
  arbitrary half taken to fit a number. A table that outgrows even that cut is split again into contiguous
  category leaves, never marked `max-file-lines-register:` (an oversized file is always
  split): `admit/sanctionedSeams.ts` spreads five theme leaves after the dev-tooling one, in one fixed order
  (witness `unit/admit/sanctionedSeamComposition.test.ts`), and a leaf nearing the cap splits again.
