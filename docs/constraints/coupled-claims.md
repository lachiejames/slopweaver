# Coupled claims

Part of [Design constraints](../constraints.md).

Acting on a [relaxation](relaxed.md) makes these false. Update them in the same PR, or the repo overclaims.

**If a native or macOS-only dependency ships:**

- `docs/security/runs-anywhere.md` — the `# Runs anywhere` section.

**Foreclosed by rule 2, not merely coupled:** the only model transports are `talk`'s, the `codex` SDK's and
`claude gauge`'s one-token probe, so there is no per-verb token-spender claim to keep in step (see [token spend](relaxed.md#token-spend-is-not-a-per-verb-question)). Re-derive:
`grep -rn "token spender" README.md docs/ skills/` returns nothing prescriptive.

**If the Codex sandbox or its network access changes** (the list is where the next change looks):

- `docs/security/codex-boundary.md` — the whole `# The Codex boundary` section, plus the numbered egress list in
  [`# Data flow`](../security/data-flow.md)
- `skills/codex/SKILL.md` — the `description:` frontmatter (rendered in the skill picker), the brain/body
  paragraph, and the "honest limits" list
- `docs/codex-orchestration.md` — the opening thesis, the Access row of the roles table, and the limits list
- `README.md` — the `codex` blurb under Build, and the Trust section's "stated at their weakest" claim
- `docs/architecture/trust-and-transports.md` — the `codex` description; `docs/architecture/packaging-and-layout.md` —
  the `src/codex/` module paragraph and the tree annotation
- `AGENTS.md` — the module list and the "one exception" egress paragraph

**If how a pass READS the tree changes** (a pass reads a frozen snapshot rather than the live repository,
and every pass records the tree it read):

- `src/codex/gitDiff.ts` — the header's frozen-copy paragraph: a later write makes a verdict STALE, not wrong
- `skills/codex/SKILL.md` — "Keep working while a pass runs", "A verdict goes STALE, not wrong", and the
  background/never-pipe rule
- `docs/codex-orchestration.md` — the loop steps and anything describing what a pass can see
- `src/codex/snapshot.ts` — the header states why it stages in the OS temp directory rather than
  `$SLOPWEAVER_HOME`; that reason is the tripwire's orchestration-pry signal, so the two move together
- `src/codex/snapshotPool.ts` and `src/codex/snapshotLease.ts` — the pooled slots live under the same OS temp
  directory for the same reason; `src/codex/snapshotCheckout.ts` must name every checkout rule a fresh worktree
  reads, or a reused slot serves stale bytes; and `src/worktree/snapshotPoolPath.ts`'s `isSnapshotPoolSlot` is
  the one predicate `src/cmux/worktreeList.ts` filters on, so moving the pool root without it puts every slot back in
  `listWorktrees`, inventory and prune (which would salvage a slot after its hold)
- `src/codex/tripwire.ts` — `ORCHESTRATION_PRY_ABORT` assumes the snapshot lives OUTSIDE the orchestration
  tree. Move the snapshot there and every pass aborts itself on reading its own working copy
- `src/admit/sanctionedSeams.ts` — `snapshot.ts` and `streamLog.ts` are sanctioned `local-state` seams
  (the catalogue `src/admit/coverage.ts` scans, split out of it so a new sanction stops moving that scan's size)

**If the orchestration-doc board changes** (`$SLOPWEAVER_HOME/handovers`, the front-matter
schema, and `codex status --check`):

- `skills/handover/SKILL.md` and `skills/orchestrate/SKILL.md` — the front-matter schema is documented in the first,
  and the loop and gate in the second; the schema appears in both places and must not drift
- `src/handover/doc.ts` — `KNOWN_STATUSES` is the authority. `blocked` is deliberately not one, because
  blocking is derived from `blockedBy`. `paused` IS one, and the difference is the test: nothing else on a
  doc carries who a row waits on, so a pause has exactly one source where `blocked` had two. Its rules,
  including the no-clock one, live in `src/handover/paused.ts`; `handover pause`/`unpause` are the only
  sanctioned writers
- `package.json` — `validate:pr` is where the LOCAL check is wired. It is deliberately NOT in `validate`,
  which is run dozens of times per build and would be red for almost all of them. `github enqueue` and
  `github merge --admin` also ask the Codex floor at the mutation (`src/codex/landingGate.ts`), because a
  package script nothing invokes enforces nothing
- `src/stateHome.ts` — `handovers` must stay a SIBLING of `orchestration`, never inside it

**If the run lifecycle or its hooks change** (`doneWhen:` probes, `$SLOPWEAVER_HOME/runs`,
and the three run hooks):

- `src/handover/probe.ts` — an unreadable file yields `not-evaluated`, NEVER `pass`. A missing file (ENOENT) is
  different: that is knowledge, so it answers `false`. Collapsing the two makes `present:` unfailable
- `src/handover/doc.ts` — the flat scalars are read by the HAND parser and only `doneWhen:`/`outputs:` by YAML.
  Handing the whole front-matter to strict YAML regressed three live docs, because a backtick opens a reserved
  plain scalar. A YAML error is reported only when `doneWhen:` depends on it
- `src/handover/doc.ts` — that hand parser reads a key's WRAPPED lines too, and must keep doing so. Reading
  only the key's own physical line returned every author-wrapped scalar as a fragment and every `>`/`|` block
  scalar as the literal indicator character, and it read a `blockedBy:` block sequence as NO dependency at
  all — twelve live docs lost a declared dependency, two of them offered as RUN NOW while genuinely
  blocked. Measure a claim like that by running the shipped verb from BOTH checkouts against ONE frozen
  copy of the board; two reads of the LIVE board attributed a third row to this change that had merely been
  registered in between. A folded value is ONE line by
  contract — every consumer prints a board row — and a continuation block whose lines all begin `- ` is a
  sequence, handed on in the flow spelling `asList` already reads
- `src/handover/frontmatter.ts` — `editFrontMatterFields` must drop a replaced or removed key's continuation
  lines with it. `handover pause` rewrites `statusSummary:`, which nineteen live docs hold entirely in the
  lines below the key; leaving them orphaned splices the old text onto the new value
- `src/handover/hookGate.ts` — the `Stop` gate disarms on `stop_hook_active`, which is the HARNESS's own signal;
  do not replace it with a counter. The harness also overrides after a fixed number of consecutive blocks
- `hooks/handover-run.sh` and `src/cli/commands/handover/hookRun.ts` — both fail OPEN and always exit 0. For a
  `Stop` hook a non-zero exit is itself a way to block, so the exit code must carry exactly one meaning
- `hooks/handover-run.sh` also short-circuits in SHELL when no journal exists. Measured: launching the CLI
  costs ~2.5s, a quarter of the hook's deadline, and `Stop` fires on every stop/clear/resume/compact. The fast
  path takes it to ~0.5s. Keep it: inert by default only helps if it is also free by default
- `AGENTS.md` — the re-entry block is tier 2 (the harness re-injects it); `skills/orchestrate/SKILL.md` is tier 3
  (prose, lost on compaction). A rule that matters belongs in the ledger or in AGENTS.md, not only in the skill
- `src/stateHome.ts` — `runs` must stay a SIBLING of `handovers` and outside `orchestration/`, for the same
  tripwire reason the pair below records

**If the live Slack app's scopes, name or event subscriptions change** (a template behind the live app
revokes scopes and renames the app when applied):

The templates are a **user-facing product surface**, not internal notes, and they are **tiered**: the trade
between capability and risk belongs to the user, so the default is the permissive one, it is required to say
so, and a safer alternative is offered beside it rather than buried. That shape is what the list below keeps
true.

- `templates/slack-app-manifest.full.json` and `…agent.json` — both carry the LIVE scope set. A manifest is
  applied whole, so Slack revokes any scope the pasted file omits: a template behind the app is a loaded gun,
  not a stale comment
- `templates/README.md` — the tier table. Adding a tier means adding a row here AND a `long_description`
  statement in the file itself; a tier whose trade-off is only in the doc is a trade the user cannot see
  where they make it
- `src/__tests__/unit/connect/slackManifest.test.ts` — the scopes whose absence is destructive are pinned by
  NAME there (the real-time-search family on both tokens, `metadata.message:read` on the bot), plus the
  agent-vs-standard delta, the `{{APP_NAME}}`/`{{BOT_DISPLAY_NAME}}` fields, and the tier statements —
  including that the DEFAULT admits it is the least secure and names the safer tier
- `src/connect/slack.ts` — `SLACK_REQUIRED_USER_SCOPES` must stay exactly the MINIMAL tier's user list; a test
  asserts the equality, so the constant and the template move together
- `docs/slack-agent-surface/manifests-and-layout.md` — the tier table, the fields-to-populate note, the first-install warning, and
  what the Agents feature costs and buys
- `skills/onboard/SKILL.md` — steps 3 and 4 are where the user makes the choice, so they carry the same tiering,
  the same field substitution, and the same first-install warning

The names are `{{APP_NAME}}` and `{{BOT_DISPLAY_NAME}}` — **fields an onboarding flow populates**, never real
names. A committed real name renames whatever app the template is pasted into.

How to read the live set without an export: the `x-oauth-scopes` response header on an `auth.test` call with
each token. **There is no gate comparing the two** — it needs live tokens, so it cannot be a CI lint lane —
and that gap is deliberate and named rather than silent. Nor are the files validated against Slack's own
schema: `apps.manifest.validate` wants an app CONFIGURATION token (`xoxe-`), and refuses a bot token with
`not_allowed_token_type`. Both gaps are also stated in `templates/README.md`, where someone editing a template
will actually be looking.

**The load-bearing pair, stated once so it is not rediscovered:** the snapshot must live outside
`$SLOPWEAVER_HOME/orchestration`, because the tripwire treats reads of that tree as a pass having lost the
task. Changing either without the other silently breaks the other.

- `src/cli/manifests/codex.ts` — both verb `summary` strings, which `--help` and `catalog` print
- `src/devLint/schedulerBypass.ts` — the explanatory strings, which are emitted in lint failures
- `src/codex/client.ts` — the file header, and `src/codex/prompt.ts`'s capability paragraph, which tells
  **Codex itself** what it can do

A relaxed constraint is **permission, not a change** — these claims stay accurate until something acts on
the permission.
