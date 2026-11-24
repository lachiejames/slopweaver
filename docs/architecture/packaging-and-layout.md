# Packaging and layout

Part of [Architecture](../architecture.md).

## Packaging

Distributed as a Claude Code and Codex plugin. Claude commands receive their plugin root from the host;
Codex skills resolve their own installed `SKILL.md` and invoke that plugin root's launcher by absolute path.
They never trust an ambient `slopweaver` on `PATH`, which may belong to another checkout. Node dependencies
are NOT committed — a `SessionStart` hook installs them into the host's persistent plugin-data directory on
first run (or when `package.json` changes), and the launcher runs the built `dist-cli`, else the TypeScript
source via `tsx`. No native build.

## Layout

**Every top-level entry, `src/` in full** — a partial map reads as a complete one and never announces when
it stops being true. Re-measure with `git ls-tree --name-only HEAD` and `find src -maxdepth 1 -mindepth 1`. The one thing
deliberately not listed is the root-level config and ratchet files (`package.json`, `tsconfig*.json`,
the `*-baseline.json` ratchets, …), each of which names itself.

**The largest trees under `src/` carry their own rule file.** `src/admit/`, `src/atlas/`, `src/cli/`,
`src/corpus/`, `src/devLint/`, `src/handover/`, `src/live/` and `src/outbound/` are each named by a
`paths:`-scoped `.claude/rules/area-<name>.md`, loaded only when a
session touches that tree and costing every other session nothing. What belongs in one is what the root doc
cannot afford to carry: the claims a subsystem exists to hold, sourced from what its file headers already
say. The reasoning, and the two options it was chosen over, are in
[agent-docs-practice.md](../agent-docs-practice.md) § "The directory axis".

```
.baselines/             # the committed ratchets the lint gates and `dev profile` compare against
.build/                 # a committed SwiftPM cache stub (CACHEDIR.TAG, a debug log); nothing reads it
.claude/                # the hard code rules, loaded as instructions every session
.claude-plugin/         # the Claude Code plugin + marketplace manifests
.codex-plugin/          # the Codex plugin manifest
.github/                # CI workflows, CODEOWNERS, the pull-request template
bin/slopweaver          # launcher (resolves config + deps; runs the built dist-cli when its manifest and
                        #   entry both exist, except for `dev build`, which rebuilds it; else the source via tsx)
config/                 # the Vitest lane configs and the lint TypeScript config
desktop/                # the Electron Mac app that hosts the console — `desktop install` puts it in /Applications
docs/                   # this doc, the security model, the constraint set, the atlases
eval/                   # the frozen cases, fixtures and baselines the deterministic scorer grades
hooks/                  # the SessionStart and PreToolUse hooks the plugin installs
scripts/                # the shell shims those hooks and the hygiene gate are invoked through
site/                   # the work console and the docs it embeds — a Next.js app, its own Yarn project
skills/                 # THE command surface — one SKILL.md per verb (AGENTS.md rule 4)
stubs/                  # ambient type declarations for a dependency that ships none
supabase/               # the store's local Supabase config and its Drizzle migrations
templates/              # the seed files `init` copies into a fresh $SLOPWEAVER_HOME
tools/                  # the `yarn tsx` spec-lock and surface generators, and provider-surface probes
src/                    # everything below
```

Every top-level entry under `src/` — the directories first, then the loose modules:

```
src/__tests__/          # the unit, integration and subprocess lanes, their fixtures and cassettes
src/admit/              # the admit door — every side effect's one gated pathway, its ledger, the
                        #   withhold verdict + the queue a held reply lands in, and the main-checkout guards
src/alias/              # `alias` — the organisation-owned mailboxes an assistant plan signs up on: the
                        #   address shape and the Cloudflare email-routing rules behind it
src/appSurfaces/        # where ON THE APP a dependency is reached, derived from a checkout, for a vuln-fix PR
src/atlas/              # one directory per synced atlas platform: Slack (slack.ts for conversations,
                        #   slackApi/ for the Web API map), cloudflare/, vanta/, onepassword/, datadog/ and
                        #   the rest. atlasFile.ts is the shared generation-and-archive file format, kit/ the
                        #   shared publish-and-read protocol the atlases use, and registry.ts the list of
                        #   them — see docs/atlases.md
src/audit/              # `audit` — a read-only quality and cost snapshot over the on-disk corpus
src/automations/        # the console's Automations page: every recipe's purpose, health and last outputs, read-only
src/autonomy/           # the AUTONOMY LEDGER: every act a session took under graduated autonomy and the
                        #   owner's retroactive steers on them, appended to the store's `autonomy_event`
                        #   through `port.ts` — acts and steers interleaved, folded newest-first on read
src/briefing/           # `briefing check` — the fleet-briefing page's caps, and the reader that applies
                        #   them to a page it did not render (src/outbound/briefing/ is the writer), plus
                        #   the reader half of the computed correction marks a republished page carries
src/browser/            # `browser` — the Playwright verbs that drive the owner's own Chrome: sessions, one
                        #   interaction at a time with a screenshot of its result, cookies, downloads,
                        #   break-glass
src/builtCli/           # the built CLI's stamp and staleness guard: a `dist-cli` tree that no longer
                        #   matches its source refuses to answer rather than falling back to tsx, unless the
                        #   stale-build hatch is open
src/canon/              # the canon gates: stale references, doc coverage, moved headings, diagram
                        #   references, the always-on documentation budget
src/capacity/           # what is unused on every ceiling a seat spends (machine load, Claude and Codex
                        #   windows), which one binds, and why the fleet is the size it is
src/checkouts/          # measuring and syncing the pinned main checkouts
src/cli/                # verb framework + dispatch spine + the verbs (lazy-loaded manifests)
src/claude/             # which Claude Max plan the fleet runs on: the header gauge, the limit
                        #   classifier and the N-plan choice. Pure; performs no credential operation
src/cmux/               # the one owned cmux control-socket client: spawn, sidebar, events, liveness
src/coderabbit/         # validates the committed `.coderabbit.yaml` against CodeRabbit's own published
                        #   schema
src/codex/              # the Codex brain (build-time planning + diff review), repo-read-only
src/codexPlugin/        # `codex plugin-sync` — publish the checkout's HEAD as the installed Codex plugin
src/connect/            # per-source reachability + scope preflight
src/consoleProfile/     # `perf console` — timing the console's pages and verbs against a budget
src/context/            # the always-loaded context a Claude Code session receives, whatever the project,
                        #   at session start through the `SessionStart` hook's `profile hook`; `profile
                        #   context` renders it
src/corpus/             # CorpusRecord atom, the connectors, bronze writer/reader, compaction, slices
src/cycle/              # `cycle reconcile` — the current Linear cycle joined to the owner's own open
                        #   items, proposing what to close and which projects the owner leads are overdue
                        #   an update. Proposals only; it performs no write of any kind
src/datadog/            # a live Datadog client with no synced store (reads go straight to the API); its
                        #   one write is `seriesSubmit.ts`, gauge points to /api/v1/series, door-routed.
                        #   `metricsProducer*.ts` run a producer the profile declares and read what it printed
                        #   (`datadog produce`); this repository computes no metric of its own
src/desktop/            # `desktop install` — the Mac app's one copy in /Applications, its signing and stamp
src/detective/          # `store detect` — how many Haiku detectives a recall wave fans out, which lead each
                        #   opens on (atlas, Datadog, Hex), and the brief each is handed
src/devGate/            # `dev gate` — hygiene + PR format + evidence-handoff + answer-quality, no short-circuit
src/devLint/            # the bespoke ratchets (door coverage, unbounded spread, operation labels, …)
src/environment/        # `doctor`'s environment probes: can this machine run Slopweaver, graded from
                        #   gathered facts, fatal or a warning, never a false miss
src/eval/               # the answer-quality scorer (answerQuality/): deterministic, it grades an answer on
                        #   the claims, caveats, attributions and certainty its case's golden declares, and
                        #   self-tests inside `dev gate`
src/events/             # the append-only supervisor event stream and its offset-resumable cursor
src/fleet/              # `fleet` — each seat's health verdict, crash loops, burn per host, what landed
src/footprint/          # the footprint scan — everything the owner is involved in, grouped into
                        #   workstreams. Canonical entity keys (a pull request qualified by repository, a
                        #   Slack link resolved to its thread ROOT), provenance as a discriminated union so a
                        #   private supervisor turn can never compose team-facing text, the three-fact rule
                        #   that stops a quiet thread claiming somebody is blocked, and an append-only
                        #   assignment ledger holding ONLY which workstream a node is in. Status is recomposed
                        #   live, so this stays a view over the board rather than a second register
                        #   (docs/workstreams.md says why that matters). No verb reaches it
src/freshCut/           # `slopweaver fresh-cut produce` — one parentless commit over a main commit's tree,
                        #   written into a NEW local repository with no remote — and `fresh-cut verify`:
                        #   re-derive the tree, then the hygiene gate and every private term over every
                        #   file, findings to the home only;
                        #   `fresh-cut accept` appends one accepted line (a read owner-address line, or
                        #   another class on an owner anchor) to the state-home reviewed-residue list
                        #   that verify subtracts, counts and binds by its sha256
src/gcloud/             # the state of Google Application Default Credentials, so a seat waits on the owner's
                        #   sign-in
src/gcpAudit/           # one GCP audit-log pull: every container, its retention and routing, entries to disk
src/gold/               # distil — gold markdown, its brief/answer pair, cache and index
src/goldDebt/           # the GOLD-DEBT LEDGER: `slopweaver gold owe|debts|settle` — every pull request
                        #   that merged at silver or bronze, what gold proof it still owes, what is
                        #   blocking it, and how it was settled, in `ledgers/gold-debt.jsonl`. Nothing
                        #   in the landing lane reads it: a merge is never delayed, the debt is remembered
src/grants/             # `grant` — the journalled grant: one decision the owner already made, recorded,
                        #   checked by the session that performs it, and refused only by a named check
src/hand/               # `hand` — the register of steps only the owner's hands can take, the floating macOS
                        #   note that carries one, and the push lane that tells the owner on arrival
src/handover/           # orchestration docs: the board, the run journal, probes, gates, typed endings
src/hatch/              # the escape-hatch register — each declared way through a policy refusal, in one place
                        #   — and `hatch open`'s journalled outbound hatches
src/hex/                # `hex` — reading the Hex workspace live: projects, connections, cell sources, a
                        #   cell's bounded output and run history. Read, never ingested
src/home/               # `home reclaim` — the obviously-junk bytes in $SLOPWEAVER_HOME (rebuildable trees
                        #   in a finished Codex pass's scratch), and a journal of what each reclaim took
src/hygiene/            # public leak-class gate
src/incident/           # `incident` — a new incident channel found, judged, and the one note asking to share
src/init/               # idempotent $SLOPWEAVER_HOME scaffolding + the `seed --demo` fixture
src/judgement/          # judgement mining and the owner-directive overlay, both brief/answer shaped
src/knowledge/          # the knowledge register: what an investigation LEARNED, one row per lesson with its
                        #   verdict and the command that re-checks it — ONE register, `domain` a facet
src/lib/                # the shared leaves: Result, IngestError, the safe* boundaries, git, hashing,
                        #   paging, atomic writes
src/live/               # the inbound half: Socket Mode listener (tags only, prints — never answers), the
                        #   turn brief+answer verbs a visible session drives by hand, the per-source
                        #   live reads, and the automation store
src/measurement/        # measuring one workstream read-only — where every field on the console comes from
src/memory/             # the auto-memory corpus checker, sweeper and write-time gate
src/monitor/            # `monitor` — named conditions over this machine's own ledgers, each posting a hand
                        #   card when a new subject starts firing, plus the cmux notification filter
src/onboard/            # the cold-start plan: tiers, per-source refresh commands, prompts
src/onboardEval/        # onboarding self-evaluation: score a run of the onboard skill, diff it against the
                        #   last run, file the worst friction as board docs — see `slopweaver onboard eval`
src/orgHealth/          # `org-health` — the incident channel's announcements and the snapshot its monitor reads
src/outbound/           # the write half: a typed form + pure renderer per surface — every provider,
                        #   plus briefing/ for the fleet-briefing page, whose react-now block carries two
                        #   groupings (team-facing first) and a card per open pull request — and the freeze
                        #   plus computed correction marks a page the owner has already read is republished
                        #   with
src/pages/              # `page publish` — a local page for a session to end in: the document shell, its
                        #   frozen bytes, the store write, and the file address
src/pane/               # `pane pr-status` — open pull requests ranked by why each is blocked
src/pdf/                # `pdf` — the PDF text extractor a doored provider's attachment reaches: judged on
                        #   the bytes, text and page count, never OCR. `policy` reads its layout runs apart
src/perf/               # `dev profile` — what it can profile (a gate, a lane, a verb), V8 profile reading,
                        #   and the recorded heap baseline a run is checked against. The `perf` noun's fleet
                        #   read is src/live/perf/
src/plans/              # `plans` — the register of the Claude and Codex plans a session can be seated
                        #   on, validated, and its generated Claude projection
src/policy/             # `policy` — a Vanta policy or evidence doc rendered to a verified PDF, and a change
                        #   drawn as an HTML review page
src/prformat/           # the pull-request description format gate
src/profile/            # the owner's words, steer kinds and standing asks the profile and console read
src/proof/              # the `yarn why` golden-proof capture and side-by-side compositor
src/proofPath/          # what counts as proof OUTPUT in a repository path, so none is ever committed
src/queueDefer/         # a Queue card the owner put off ("Come back to it"), and the fold the Queue page
                        #   orders by
src/queueRefusals/      # `queue refusals` — the Queue cards a gate withheld, and why
src/queueStopping/      # `queue stopping` — the cards stopping the owner's work that the owner's Queue
                        #   leads with
src/readings/           # `reading` — the readings ledger: the last document each slow verb printed, who
                        #   took it and when it was true, so a console page shows it instead of taking the
                        #   read
src/reflect/            # `reflect` — the self-improvement loop's readers over how this system
                        #   behaved: which tool calls FAILED (Claude Code's telemetry), the day's local
                        #   friction ledgers (`brief`), and the orchestration board's own hygiene (`board`)
src/retrieval/          # the fan-out: shard planning, reader instructions, quote-checked collection
src/review/             # review cadence, reviewer suggestions, code-owner state and landing decisions
src/route/              # multi-source planning for one visible turn (current / history / unavailable)
src/secrets/            # local token store (0600, no-echo, never argv)
src/sessionStart/       # the ranked to-do list — the item shape, the rules that order it once rule zero
                        #   and trace-before-ranking have said which items exist at all, the board leg that
                        #   detects the WAITING ON OWNER slice, and how a row prints
src/sessions/           # the session ledger a supervisor chat keeps, context-depth reporting, and what
                        #   compaction costs the fleet (`session compaction` — the window replay and the
                        #   dropped-re-read signal, an owner ruling), and the Claude session store and
                        #   per-turn token cost every session read shares
src/silver/             # derive — directory, identity, cross-ref graph, opportunities
src/spend/              # `spend` — a company card's snapshot: headroom, declines, charges per vendor and month
src/stateHome/          # the areas of the $SLOPWEAVER_HOME contract, one module each, composed by
                        #   src/stateHome.ts and imported by nothing else
src/store/              # the selected Postgres (Supabase) store, local by default: its schema and
                        #   migrations, `store ingest`/`load`, the typed query layer `store read`/`cite` sit
                        #   on, the atlas tables, identity, the fleet mirror, and `store backup`/`restore`
src/supervisor/         # the chair: its tick record and the gates on it, intake, digests, the chair's model
                        #   and cadence, and which visible host owns a turn
src/sweep/              # `sweep` — which board rows no longer earn their keep, classified by the evidence
                        #   each carries (`sweep board`), closed or settled one row at a time through the
                        #   register's own verb (`sweep apply`), and journalled so what it took stays findable
                        #   (`sweep list`)
src/syncRun/            # the sync-run ledger: one run file per source a `refresh` fetches, and its fold
src/talk/               # `talk` — the console voice: composing its ChatGPT-plan call, the bounded reads of
                        #   this checkout and the board it answers from, and relaying the owner's spoken steer
                        #   to the board — and, when asked, into the supervisor chat
src/testLanes/          # the unit lane's CI shard split and the merge its coverage floor reads
src/transcripts/        # the Claude session transcripts on this machine, read structurally — the human
                        #   turns, the counts, the tool errors, and the retention bound that keeps an empty
                        #   answer honest
src/velocity/           # `slopweaver velocity` — trailing-window pace from git + the local ledgers: merges/
                        #   day, docs landed/day, doc latency, turns/ask. A read, never a target
src/visualEvidence/     # image admission — what a session RECORDED about looking at a picture, keyed by
                        #   the picture's own bytes, and the boundary every Slack attachment crosses. An
                        #   image with no record cannot be sent (hatchable); one recorded unfit can never
                        #   be (a hold, no hatch). An owner ruling
src/wait/               # `wait`, the shared `--wait`/`--timeout-seconds` flag parser a verb
                        #   spreads into its own spec, and the backoff loop printing only what changed
src/waiting/            # the ONE ranking of what waits on the owner — blocking a colleague, blocking the
                        #   fleet,
                        #   then check-ins (never an autonomy act: those are the Alignment page's) — read by the push lane, the briefing, the Queue and the
                        #   voice (mirrored in site/lib/waitingRank.ts under a drift test)
src/workstreams/        # `workstreams` — the owner's outcomes register, each bar derived from its dated
                        #   timeline
src/worktree/           # `slopweaver worktree` — create/inspect/retire a worktree, with its OWN
                        #   installed node_modules rather than a symlink to a shared tree
src/atlasHome.ts        # where each atlas's generation lives under $SLOPWEAVER_HOME, one resolver per
                        #   platform
src/atlasHomeAirtable.ts # the Airtable atlas's paths, split out of atlasHome.ts
src/atlasHomeFigma.ts   # the Figma atlas's paths, split out of atlasHome.ts
src/atlasHomeGoogle.ts  # the Google Admin and Google SecOps atlases' paths, split out of atlasHome.ts
src/atlasHomeInngest.ts # the Inngest atlas's paths, split out of atlasHome.ts
src/atlasHomeJumpcloud.ts # the JumpCloud atlas's paths, split out of atlasHome.ts
src/atlasHomeShared.ts  # the path helpers the atlas path resolvers share
src/atlasHomeVanta.ts   # the Vanta atlas's paths, split out of atlasHome.ts
src/atlasHomeWorkos.ts  # the WorkOS atlas's paths, split out of atlasHome.ts
src/config.ts           # runtime config from the environment (home, repo, the env, file, gh token chain)
src/homeDir.ts          # the dependency-free $SLOPWEAVER_HOME resolver config.ts and stateHome.ts share
src/profile.ts          # the persona seed at $SLOPWEAVER_HOME/profile.json, and its strict parser
src/profileStore.ts     # the effectful edge that reads that seed back
src/stateHome.ts        # the one typed $SLOPWEAVER_HOME contract: the entry composing src/stateHome/
```

## Module shape

Within a `src/cli/commands/<verb>/` directory, pure logic and its effectful shell are split by the testing
rule's pure-core/effectful-shell requirement (`../../.claude/rules/testing.md`) — `core.ts` holds what a unit
test can call with no I/O, `run.ts` is the CLI dispatch that calls it. That one rule scales with a command's
actual shape rather than forcing one file pair on every verb:

- **One verb, one pair** — `core.ts` + `run.ts`, the default (`compact/`, `fleet/`, `alias/`, `policy/`, …).
- **Several substantial subverbs** — a `<subverb>Core.ts`/`<subverb>Run.ts` pair per subverb, alongside a base
  pair for the top-level verb where one exists (`github/`, `linear/`, `slack/`, `proposal/`), or with no base
  pair when every subverb stands alone (`atlas/`, `notion/`).
- **Subverbs share their pure logic but not their effects** — one shared `core.ts`, several
  `<subverb>Run.ts`, no per-subverb `Core.ts` (`checkout/`, `home/`).
- **Nothing pure worth isolating** — `run.ts` alone (`derive/`, `doctor/`, `seed/`, …); don't invent an empty
  `core.ts` to match a pattern.
- **Pure logic shared by sibling commands** — its own `core.ts`, no `run.ts` of its own, imported by the
  commands that dispatch it (`grant/core.ts`, used by `grant show`, `grant perform` and `grant refuse`).

A domain's error union file is named `errors.ts` when the domain owns its own directory
(`corpus/github/errors.ts`, `live/slack/errors.ts`); when several domains' error files sit flat as siblings in
one shared directory with no per-domain subdirectory, disambiguate with `<domain>.errors.ts`
(`corpus/compact.errors.ts`, `retrieval/loadCorpus.errors.ts`, `outbound/github/attach.errors.ts`) —
dot-separated, never camelCase-joined.
