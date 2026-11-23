# Gated — a class here is not a build candidate

Part of [The recurring-failure register](../recurring-failure-register.md).

Moved out of [Survivors](survivors.md) when its gate landed, per [this file's own rule at the end](bindings.md#keeping-it-current). Read this section as part
of the dedupe list: a finding that matches one of these is already refused mechanically.

- **`probe-missing-or-malformed-at-write-time`** — PARTIALLY gated, in three parts, and the middle one WARNS
  because the number made a refusal indefensible. Tests in
  `src/__tests__/unit/handover/absoluteProbeTarget.test.ts` and `openRunProbeGap.test.ts`.
  **1 · An absolute probe target is a PARSE REFUSAL** (`src/handover/probe.ts`), with no waiver, so it
  flows into `doc.problems` and therefore into `handover check`, `register-hygiene` and every lifecycle
  refusal that already reads them. Every `path:`/`present:`/`absent:` target resolves against the doc's own
  `repo:`, and `insideRepo` DECLINES an absolute one before any read — so without the refusal the board prints
  such a row as an ordinary unmet probe, indistinguishable from a file that is genuinely not there. **Blast radius, measured
  over all 1,171 docs: THREE, and all three were already silently false.** Remedy: make it
  repo-relative, or use a `command:` probe, which is not resolved against the repo at all.
  **2 · `handover start` prints WHICH key was wrong.** `start` never opens a run on an unparseable doc —
  `blockerFor` refuses it — and `docProblemsRefuse` runs first, printing the problems themselves rather than a
  bare `blocker.kind` "malformed".
  **3 · `open-run-declares-no-probe` WARNS at `start`, and does not refuse.** MEASURED by walking
  `$SLOPWEAVER_HOME/handovers/*.md` through `parseHandoverDoc` and `behaviouralProbeGap`: **158 of the
  board's 301 `ready` docs** would have been refused at `start` the instant a refusal landed — 88 declaring
  no `doneWhen:` at all, 70 declaring only structural probes, with a further 65 already waived and passing.
  That is not enforcement, it is stopping a fleet mid-flight to demand 158 waivers from authors who have not
  yet investigated the work, which is the front-loaded judgement `behaviouralProbe.ts`'s own scope note warns
  about one phase earlier. **The rule is not weakened**: `handover finish` still REFUSES, unchanged, and that
  is the transition the owner ruled on. The warning moves WHEN a session is told — to the moment the work
  opens, where a probe decides what to build, rather than when it is done, where a probe is a retrofit. That
  is the whole content of this class. The warning prints LAST, so it is the final thing a session
  reads, and a WAIVED doc prints one line too rather than passing in silence.
  **Two halves dropped rather than deferred.** The proposal's `handover register` seam would have refused its
  own output — `askRowText` writes `doneWhen: []` on every ask row by design — and `behaviouralProbeGap`
  already exempts `kind !== "doc"`, so nothing was needed there. The rest of the "malformed" cluster is
  already gated in three places and measured ZERO on the board.
  **Still open**: turning the `start` warning into a refusal, which needs the 158 worked down first. The
  number is recorded here so a later ratchet has its baseline rather than re-deriving it.
- **`re-derives-or-rebuilds-what-already-exists`** — PARTIALLY gated, and a fifth of what was proposed.
  `github stack push` REFUSES a head whose every commit is already patch-identical to the target's own
  base, before any network call. Finding name `already-landed`; the detector is `branchAbsorbed`
  (`src/worktree/pruneScan.ts`), shared with `worktree prune` rather than re-implemented, and the seam is a
  second gate beside `createBaseFreshnessRefused`, both behind `createBaseGatesRefused`. Tests in
  `src/__tests__/unit/cli/commands/github/alreadyLandedRun.test.ts` and `createAlreadyLanded.test.ts`.
  **It answers a question ancestry structurally cannot.** This repository squash-merges, so a branch whose
  every line is already on `main` has a merge base older than the squash commit and reads as perfectly
  unmerged — `git merge-base --is-ancestor` will never see it. A verbatim patch id names the change, so the
  same work under a new SHA reports absorbed. That narrow case is the whole yield, because GitHub already rejects
  a pull request with literally no commits between base and head, and it is exactly the two-competing-PRs
  instance in the owner's memory.
  **It fails OPEN, always.** A missing checkout, a mismatched remote, an unfetchable base and a patch-id read
  that could not answer are all SKIPPED with the reason printed. `gitAncestry.ts` states the rule for this
  whole family: a shallow clone makes the answer wrong rather than absent, so refusing on an unanswerable
  measurement would strand the caller. Hatch: `--acknowledge already-landed --reason "…"` — the existing
  acknowledgement parser, with ONE new asymmetry. This subject REQUIRES the reason, because the three shapes
  that are patch-identical by design (a revert of a revert, a re-land after a backed-out merge, a forward
  cherry-pick onto a release branch) are the exact thing a reviewer needs named, and a bare acknowledgement
  records only that the author saw the refusal.
  **Blast radius**: one known miss, no known false fire. `pruneScan.ts`'s own header carries the limit — a
  branch of SEVERAL commits squash-merged into ONE has no single matching patch, so it reads as unlanded.
  That barely bites here (one commit off the base is the rule) and it is the safe direction: the gate can
  miss, never fire on genuinely new work.
  **Four halves stay open, and three were DROPPED rather than deferred.** The changed-file overlap with
  another open PR was dropped because this repository has a native stacked-PR surface where exactly that
  overlap is the intended shape. The handover half was dropped because `src/handover/collide.ts`'s header
  records the opposite owner ruling — it warns and never refuses. A summary-similarity refusal was dropped as
  strictly weaker evidence than the file-token overlap the owner already declined to gate on. What genuinely stays open is the dispatch and investigation half: nothing checks prior art before a
  non-PR piece of work opens.
- **`voice-rules-run-late-and-only-on-one-lane`** — PARTIALLY gated, as a WARNING and never a refusal.
  One lane per surface — a card's `tldr` and `index`, a pull request's cells down to the first `<details>`, a
  Notion page's lead — would leave the bulk of what a reader actually reads unchecked, so
  `aboveFoldVerdictFor` takes `belowFoldCells` as a REQUIRED argument beside `cells`, and every door
  supplies them: `updateArtifactBelowFoldCells` (the whole of a card's `detail`, per paragraph, bullet, list
  line, table column label and table cell), `prBelowFoldCells` (every `<summary>` line plus the folded prose
  after it), and `notionBelowFoldCells` (the page from its first heading down). Finding name
  `voice-rule-below-fold`; tests in `src/__tests__/unit/outbound/voice/belowFold.test.ts` and the
  below-the-fold half of `src/__tests__/unit/cli/commands/github/aboveFoldGate.test.ts`.
  **It WARNS, and that is a standing rule rather than timidity** — voice has no hard blocks,
  because the old hard em-dash hook blocked legitimate work and was torn out. Below the fold the word rules
  are ordinary English at length, so `leverage the cache` in a changelog and `this smells like a race` in an
  incident note both match. The escape hatch is the existing `voice-rules` hatch (`slopweaver hatch open voice-rules --reason "<why>"`), which silences
  the warnings exactly as it lifts the refusals; no second hatch was minted.
  **Blast radius, measured rather than guessed**: over this repository's own register, the em-dash literal
  alone matches 169 separate prose regions across its pages
  (`grep -h '—' docs/recurring-failure-register.md docs/recurring-failure-register/*.md | wc -l` counts 172
  lines). That number is why a finding reports once per RULE, carrying how wide it fired and
  where to start, instead of once per region — 169 warning lines would be the wall of text rule 7 bans,
  printed by the gate that enforces rule 7.
  **Structural rules deliberately do not run below the fold.** A colon-introduced list there is a table of
  contents and a forty-word sentence is prose; the packing rules are about deciding whether to expand.
  **Three halves stay open, named so nobody re-derives them.** (1) A Linear issue's collapsible is not
  covered: it holds `aiPrompt`, a prompt for a model rather than the owner's prose, so reading it was
  declined rather than missed. (2) Owner-facing markdown written by the CLI itself — the morning reports,
  whose em dashes are authored in this repo's own TypeScript string literals — never passes a door at all
  and needs a devLint over emitted literals, a different gate. (3) The composer's benchmark is the owner's
  SENT corpus rather than the owner's approved drafts (an approved draft is not a liked one: the owner often
  edited before people saw it), and no mechanical rule here reaches that.
- **`module-anchored-repo-lookup-in-a-runtime-verb`** — FULLY gated, by `running-checkout-root` in
  `yarn lint` (`src/devLint/runningCheckoutRoot.ts`), with no allowlist and no exemption marker.
  `src/lib/gitRepo.ts`'s `repoRootOf`/`currentBranchOf` resolve from the CALLER'S OWN FILE, with git. That
  is correct for a gate and throws in a runtime verb, because a marketplace install copies source into
  `~/.claude/plugins/data/<plugin>/mirror/…` with no `.git` above it. The gate confines that pair to
  `src/devLint/`, `src/hygiene/` and `gitRepo.ts` itself.
  **A verb picks between two replacements, and that choice is the part the gate cannot make.**
  `runningCheckoutRoot`/`runningCheckoutBranch` (cwd-anchored) answer where the process is STANDING — a
  spawn plan, a branch report. `installedTreeRoot` (`src/lib/pluginRoot.ts`, walking up to the plugin
  manifest, no git at all) answers which tree THIS BUILD lives in — the skills catalogue and this very
  register. Getting that second one wrong the other way is equally real: a cwd anchor there reads an
  unrelated repository's `skills/` whenever the CLI is run from one, which the replay lane caught.
  **Two measured instances, days apart, and the gap between them is the whole argument.** First,
  `cmux spawn` died mid-provisioning on the same lookup, and was fixed — in that one file, with a detailed
  header explaining the hazard. Then the ANSWER path did the identical thing.
  `src/live/turn/posterAnswer.ts` built the admit door's gate list with `repoRootOf`, so a composed,
  reviewed, verdict-clean reply to the owner's own work order was destroyed at send time and its ask row
  read `Command failed: git -C …/mirror/a/src/live/turn rev-parse --show-toplevel, fatal: not a git
repository`. Nine more call sites in the same family were standing at the moment the second one fired.
  **The lesson is not about git.** A prose warning in the file that was bitten protects that file; it does
  nothing for the nine that were never opened. This is the class where the correct fix is measured in call
  sites, and the only thing that finds all of them is a gate. Tests:
  `src/__tests__/unit/devLint/runningCheckoutRoot.test.ts`, and
  `src/__tests__/subprocess/lib/pluginMirrorRoot.test.ts`, which reproduces the mirror shape against the real
  module and asserts both families at once.
- **`code-under-proof-is-not-the-code-you-edited`** — PARTIALLY gated, and the split matters. The
  **foreign-CLI half is gated**: `bin/slopweaver` REFUSES a `dev` verb when the caller stands in a
  checkout carrying its own launcher and the code about to run is a different tree, with finding name
  `foreign-cli` and escape hatch `SLOPWEAVER_ALLOW_FOREIGN_CLI=1`. Tested in
  `src/__tests__/subprocess/scripts/binSlopweaverForeignCli.test.ts`. The measured instance it closes:
  invoking the `~/.local/bin` symlink from inside a worktree ran the plugin mirror, which printed
  `hygiene: not a git checkout` and named a file in a tree the caller had never edited — a success that
  described nothing. The pre-existing worktree warning could not see it, because it compares two git roots
  and the mirror has no `.git` at all, so it failed open by design. **The stale-checkout half is NOT gated**:
  proving through a checkout that is merely behind `origin/main` is the same class and still open.
- **`decision-ask-arrives-unanswerable`** — PARTIALLY gated, and the gate is much narrower than its own
  verified sketch. `src/outbound/briefing/schema.ts` refuses a decision card offering **neither** a
  `detail` fold **nor** a `subject.url`, because four capped cells are not enough to answer from. Satisfied
  by EITHER: a card whose subject links the pull request has already answered "where would I go", and
  demanding a fold on top of that is the ceremony rule 7 exists to remove. **The affordance is the `url`, not
  the subject** : a card with no page of its own cannot satisfy this with the
  briefing page's own `#react-now`, so the form refuses a `subject.url` whose fragment names an anchor this
  page renders, and a page-less subject drops the url, begins its text `no page`, and owes a fold.
  `src/briefing/cardSubject.ts` carries the criterion — a briefing page's own FIXED section ids, never a
  composer's, so a legitimate link to another page's `#the-queue-saga` passes — and the 78 subjects across 53
  saved forms that were doing it.
  **The sketch was wrong and the anchors are why.** It proposed a mandatory `detail` plus `options.min(2)`,
  and its own blast-radius note admitted both would fire on correct cards — "see the PR" folds on every card,
  and a refused legitimate confirm. But five of the six anchors are the owner asking WHERE THE DETAIL IS,
  not objecting to being given it: one sentence does not give the owner enough to
  answer a question, and the owner asks where to go for extra detail. So the rule became an affordance requirement rather than a fold
  mandate. **A second proposed half was deleted on contact with the code**: a truncation check, already
  refused per-field with a better message than the one being added.
  **Still open**: the jargon-with-no-artifact and mis-numbered-against-its-detail shapes in the statement.
  **Blast radius, measured twice because the first measurement was too narrow**: two test fixtures, zero real
  composers — `src/briefing/openPrCards.ts` sets both fields already. The first count said "one fixture" and
  had only run two of the directories that build one.

- **`slack-ts-hand-converted-to-iso`** — GATED, three ways. A Slack `ts` is an epoch that looks enough like a
  date to invite a guess, and a run once read a `ts` as an instant 1:16 into a day when
  it was 23:56 on the day before — **80 minutes out**. The wrong instant propagated
  into the board row registering the ask, two cron schedules, the doc's `statusSummary` and two supervisors'
  deadman deadlines; the announcement those governed went out 53 minutes overdue. Nothing compared it to
  anything, which is why nothing caught it. So: (1) `slopweaver slack when <ts-or-permalink> [--json]`
  derives the instant with no token and no network, so there is never a reason to guess; (2) `slack
read-thread --json` carries `tsIso` beside every `ts` — on each message, on `thread.threadTs` and
  `addressedTs`, on each channel summary and its anchor — and the text renderer prints it in the message head
  line; (3) `handover register` takes `--asked-ts` and derives `askedIso` itself, derives it from a Slack
  `--anchor` when given neither, and REFUSES an `--asked-iso` that does not parse, while `handover lint`
  refuses a row whose `askedIso` sits over a minute from the instant its own Slack anchor names. The code
  half is gated by `epoch-arithmetic` in `yarn lint`: `new Date(x * 1000)` anywhere outside `src/lib/date.ts`
  and `src/lib/slackTs.ts` fails, no allowlist, no exemption marker. That gate exists because the class
  regenerates rather than persists — **four** independent `tsToIso` copies stood in the tree at once, two
  answering `""` and two `undefined`, plus four more ad-hoc conversions, every one written correctly. Tests:
  `src/__tests__/unit/lib/slackTs.test.ts`, `src/__tests__/unit/devLint/epochArithmetic.test.ts`, and the
  anchor-agreement block in `src/__tests__/unit/handover/askRow.test.ts`.
- **`dependabot-alert-cited-as-a-pull-request-url`** — GATED. `ALERT_CONTEXT` (`src/outbound/linkify/bareRefs.ts:284`)
  declines a bare number introduced by `alert`, `advisory` or `dependabot` rather than guessing which of two
  objects a small integer in the same repository meant. Tests:
  `src/__tests__/unit/outbound/linkify/bareRefsAlertNumbers.test.ts`, whose last case in each block proves
  the witness can FIRE — the same number with no alert word in front of it still resolves exactly as it
  always did, so a green there is not green-by-inertia.
  **A Survivor row can be false for as long as nobody re-reads it** — this one read unbuilt for six days
  after its gate shipped — because `src/reflect/crossRef.ts` parses only the Refuted
  table. Catching that is the `register-bindings` gate's job, and this row is one of the three it was built
  from.
- **`test-fixture-mints-a-temp-dir-with-no-cleanup`** — GATED by a per-file temp-root SANDBOX
  rather than by a lint gate. `src/__tests__/setup-temp-root.ts` mints one throwaway root per test FILE and points
  `TMPDIR` at it, and `src/__tests__/global-temp-root.ts` nests every root of one run under a parent named
  for the main process's pid and removes it in a `globalSetup` teardown. `os.tmpdir()` re-reads the variable
  on every call and a spawned child inherits it, so a `mkdtempSync` lands inside the root whether the caller
  is the test, a helper, a shelled `git` or the subprocess lane's own `bin/slopweaver`. Tests:
  `src/__tests__/unit/tempRootSandbox.test.ts` (this process) and
  `src/__tests__/subprocess/lib/tempRootInheritance.test.ts` (a spawned child).
  **The measurement is in `.claude/rules/testing.md`** and is not repeated here: 1,409,874 stale entries in
  the shared temp directory, one `os.scandir` over it taking 309.9 seconds, blocking `slopweaver github
push` through three unrelated 30-second timeouts.
- **`outbound-figure-asserted-with-no-measurement`** — GATED, and a POST-MINING class: it came
  off a fleet finding rather than the transcript pass, and is the narrow cousin of
  `outbound-claim-ships-without-its-evidence` that survives it. A count, a proportion, a span or a roster size
  asserted in an outbound answer with nothing naming the command that settles it. Rules 1–3 of
  `src/outbound/assistant/citedAndShown.ts` ask whether a THING is addressable, cited and photographed; a
  number is the one claim with no referent to link, so all three passed every instance. **Evidence**:
  it recurred in every one of P2's four review rounds and both
  HIGH-impact breaks were counts with a date span attached; and MEASURED over 311 verdict records across 130
  threads, 619 of 4,468 claims came back unsupported with 319 of the 619 carrying a digit — a dated snapshot
  of a growing store, whose durable half is the 52% share. Gated by
  `answerArmSchema.measurements` plus `src/outbound/assistant/measuredFigures.ts` in `parseAnswerArm`, which
  is what makes it a SCHEMA rather than a review note (`AGENTS.md` rule 7). Tests:
  `src/__tests__/unit/outbound/assistant/measuredFigures.test.ts` and the end-to-end describe in
  `parseAnswerArm/measuredFigures.test.ts` beside it. **`narrows`, not `closes`, and the residues are why**: a
  bare run of five or more digits is masked as an identifier, so a count written without its thousands comma
  ships unrefused; and a date SPAN is covered only through the figure inside it, never as a span — which is
  exactly the shape of both HIGH-impact breaks. The asymmetry it removes: a measurement in CODE has carried its
  own inline repro command since `.claude/rules/typescript-patterns.md` § Other rules.
- **`outbound-small-sample-figure-stated-without-its-n`** — GATED (the class "a small sample read as a trend"). A figure computed
  over a handful of observations is stated as if it were a trend, and the reviewer objects on sample size
  round after round. **Evidence**: thread `C0SYN000015-1788757965.613679`, where the booking-median claims
  drew sample-size objections across the rounds, and the round that checked the table put its drifting cells
  down to "small-n operations (9-41 spans)" while every figure at n=66 to n=223 reproduced. That gap is where
  `SMALL_SAMPLE_THRESHOLD` (50) comes from. Gated by `answerArmSchema.samples` plus
  `src/outbound/assistant/smallSamples.ts` in `parseAnswerArm`. A declared figure under the threshold is
  refused unless its own sentence states `n=<n>`, the INLINE placement chosen over the fold. Tests:
  `src/__tests__/unit/outbound/assistant/smallSamples.test.ts` and the end-to-end describe in
  `parseAnswerArm/smallSamples.test.ts` beside it. **`narrows`, not `closes`**: the n is not in the answer's
  bytes, so the check binds DECLARED samples only, and a composer who never declares one is unchecked.
