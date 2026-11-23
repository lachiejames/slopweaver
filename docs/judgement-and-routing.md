# Judgement and routing — how a turn decides where to look, and whose taste it applies

Two adjacent subsystems that are easy to confuse, so the split is stated first:

- **Routing** answers _which sources should this turn consult?_ It plans; it never calls anything.
- **Judgement** answers _what does the owner think?_ — a slowly-mined profile of the owner's taste, plus a fast
  overlay of rulings the owner has just made.

Neither decides an answer. Under operating-doctrine rule 2 the deciding happens in the visible session; both
of these hand it evidence and constraints.

## Routing

```bash
slopweaver route plan --question "what are my open pull requests?" --json
slopweaver route capabilities-merge --from .agents/slopweaver-capabilities.json --json
slopweaver route evaluate --cases eval/routing.cases.json --decisions decisions.json --json
```

`route plan` matches a question against a capability table and returns a plan: current truth is required,
history can be added as context, and a matched source that is **unavailable stays visible with its reason**
rather than disappearing. `route evaluate` scores a visible session's real routing decisions against the
frozen cases in `eval/routing.cases.json`.

`src/route/routingCapabilities.ts` is deliberately **not** `sourcePlan.ts`. It reuses the same overlay and
`{question}` substitution mechanics but makes no term match at all: it answers only "what can this context
actually reach", leaving relevance to the session's own judgement. That is the difference between the
keyword-planning lane and the judgement lane, and it is the whole point of
[the routing-is-judgment work](./routing-preflight-proof.md).

Slopweaver ships only **generic** capability rows. A private installation adds or replaces rows by merging a
validated profile at the CLI boundary, which is what keeps a private installation's own organisation names,
repository paths and provider identifiers out of this shared, team-facing repository — see
[the partition](./constraints/partition.md).

### An atlas is routable because it is REGISTERED, and a source noun cannot go dark quietly

A merged row is hand-authored, so with merged rows alone a source is unroutable until somebody remembers to
write one. MEASURED on a live install: 47 rows named **13** platforms while
`atlasPlatforms()` registered **37**, leaving 24 registered atlases — aether, the very pentest portal a turn
had just needed, among them — that no routing judgement could ever be offered. Two mechanisms close it, and
neither is a list to maintain:

- **The atlas half is DERIVED.** `src/route/atlasCapability.ts` builds one row per `atlasPlatforms()` entry,
  suppressed only where some row already reads that PLATFORM (an id key cannot work — one install's overlay
  carries twenty `vanta-*-atlas` rows for one platform). A derived row is born available carrying its
  command and the atlas's own sentence about itself; `atlasReading.ts`'s grading is still what downgrades a
  generation that cannot answer. The measured cost of grading 37 generations rather than 13, and why
  `Promise.all` makes it worse, is in that module's header.
- **The rest is a TOTAL partition over nouns.** `src/route/sourceNouns.ts` classifies every noun in
  `NOUN_GROUPS` as source-reading or not, the not-a-source side carrying a reason, and
  `unit/canon/sourceNouns.test.ts` fails on a noun in neither list, a noun in both, and a source-reading
  noun no capability row reaches. `CommandMeta.effect` is deliberately not the criterion: measured on this
  build, 80 verbs declare `external-read` including `worktree list` and `cmux processes`, while
  `slack read-thread`, `store cite`, `store query`, `knowledge recall` and `identity resolve` declare
  `local-state` or `none` and are exactly the readers that have to stay routable.

A row may name a cheap SCOPE command and put the real reading verbs in its `coverage.detail` — the pattern
`drive`, `gmail`, `calendar` and `browser` established, because a verb taking a URL or a search expression
cannot have a natural-language question substituted into it. The canon check reads the whole row for that
reason, not just its argv.

## Turn-level judgement eval

`route evaluate` scores a routing DECISION against a frozen case. `yarn eval:turn` scores a composed piece of
JUDGEMENT, for a measured class of judgement bug: five review rounds burned on
one ask before the admit door's own `ANSWER_DOES_NOT_TAG_ASKER` check finally caught a missing asker mention
([`src/reflect/collectReview.ts`](../src/reflect/collectReview.ts)), and a follow-up worker composing "the
first attempt never got going, nothing ran" while the dispatch record proved the first worker was alive
([`src/live/ask/burst.ts`](../src/live/ask/burst.ts)).

`eval/turn.cases.json` carries the same "given this input, expect this outcome" shape as
`eval/routing.cases.json`, extended from a routing decision to a model-composed text: each case's `input`
is a hand-written prompt reconstructing one incident (the committed replay fixtures under
`src/__tests__/fixtures/replay/` back the deterministic subprocess replay lane instead — see
`.claude/rules/testing.md` § the replay lane — and are redacted structurally, so they are not themselves a
usable model prompt), and `expected` is a set of deterministic properties `eval/judgementAssertion.ts` checks
against the reply: forbidden phrases/glyphs, and whether the asker or a live worker gets acknowledged.

This is the one eval lane a real model call is allowed in — every other lane in `eval/` is deterministic, no
LLM on the gate. The call goes through `eval/turnProvider.ts`, which routes through `productionCodexClient`
(`src/codex/client.ts`), the repo's one sanctioned model-egress boundary — never a new SDK client, and never
a headless `claude` launch. It spends the registered Codex plan a seat with no `--plan` and no `--force` would
take (`decideCodexSeat`, `src/codex/seatDecision.ts`), so a pause and a usage limit hold here exactly as they do
for a seat, and a register with no Codex row refuses the case: a plan comes only from the user's own sign-in, never
the login `$CODEX_HOME` happens to hold.

The client still goes through `codexClientEnvironment`, so an `OPENAI_API_KEY` exported into the shell cannot
outrank the routed home's own login here either. No path in this repository hands the SDK an inherited credential. **Advisory only**: `yarn eval:turn` is not wired into `yarn validate` or CI. It
reports what it measures; nothing here gates a merge yet.

## Judgement

Two objects, deliberately not one:

| Object              | Latency                        | Provenance                                                                 |
| ------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| **Mined profile**   | slow; immutable between passes | evidence-derived, from a bounded scan of named private sources             |
| **Owner directive** | immediate                      | only a feedback memory carrying `metadata.slopweaver.ownerDirective: true` |

```bash
slopweaver route profile-brief --sources sources.json --held-out cases.json --json
slopweaver route profile-answer --answer profile-draft.json --json
```

Mining reuses the same brief/answer protocol as `distil` and `turn` rather than inventing a third: the verb
writes what the visible session is shown, the session composes the profile, and `route profile-answer`
validates it before anything is written. Two checks close the gap a schema-only validation would leave —
**self-consistency** (every example's `sourceHash` must be the sha256 of its own text, which a hand-edited
or fabricated example cannot satisfy) and **held-out leakage** (no accepted example may match a case the
routing evaluation held out, because mining on the test set makes the evaluation meaningless).

**What reaches the brief is a contract, not a walk order** (`hash-spread-v1`, `src/judgement/sourceSelection.ts`).
Each source is bounded at 500,000 UTF-16 chars, separators included. The old prefix walk spent that whole budget on
whichever files sorted first by name: measured, one voice-call transcript of a whole tree reached the
brief. Now each file is ranked by the hash of its path and content, top-level directories are drawn in turn so one
large subtree cannot starve a small one, a file over an eighth of the budget is shown as a declared head, middle
and tail excerpt, and a file that no longer fits is skipped and counted, never sliced. Every manifest row carries
its `coverage` (selected against candidate files and chars, excerpted, budget-skipped, per stratum) and a
`selected` receipt per shown file, and both feed the manifest hash, so a different sample is a different
provenance. A manifest is checked against one schema before it is hashed, at build and again at acceptance,
because JSON writes `-0` and every non-finite number as values it cannot tell apart. The receipt hashes are the scan's own: they prove what the brief SHOWED, never that a mined example
came from it.

**Routing is balanced across `act`, `ask` and `refuse`** (`src/judgement/miningBalance.ts`). A profile mined from
corrections alone learns only to hold back, so `route profile-answer` refuses, by name and with its counts, a
routing section that does not label every principle and example with its `decision` and every counterexample
with the wrong call (`example.decision`) and the right one (`expectedDecision`), or that misses any of these: at
least one principle and two examples per decision, no example class over twice the smallest, at least one
counterexample per wrong decision, and both directions (an ask or refusal that should have been an act, and the
reverse). The labels are optional in the profile schema, so a profile mined earlier still parses; only the
acceptance gate requires them. A brief pinned under an older version (`judgement-mining-v1`) is refused as stale.

An **owner directive** is standing guidance that binds every turn. A **correction** is a second type, not an
optional field on a directive: it is bound to one record the bot got something wrong about, and it applies
only when that exact record is in front of the answer. **Matching is exact set membership on the
source/container/sourceId tuple, never similarity** — a correction firing on a fuzzy topic match would put
words in the owner's mouth about a record the owner never saw. A memory is exactly one kind, so one that gains or loses its
subject changes kind: its sync retires the other kind's entry with the same id from the same memory file as the new
one activates. The same id from a different file is another ruling and stays. A pair already stored, or imported
from a legacy file, stays readable until that memory next syncs, which heals it; nothing migrates or refuses it.

## Where it lives

- **`src/route/`** — `profile.ts` and `profileStore.ts` (the host-neutral source description and its
  overlay), `sourcePlan.ts` (the keyword planner), `routingCapabilities.ts` (the judgement-lane inventory).
- **`src/judgement/`** — `sourceScan.ts` (a symlink-refusing, binary-refusing tree scan that refuses an
  unreadable directory by name), `sourceSelection.ts` (the pure selection contract), `miningBrief.ts` +
  `miningStore.ts` (the brief/answer pair and its pinned checkpoint), `manifestSchema.ts` (the one schema
  every manifest is held to before it is hashed), `miningPrompt.ts` (the words a session
  is shown), `miningBalance.ts` (the routing balance gate),
  `ownerDirective.ts` (the ruling overlay's shape and merges), `ownerDirectivePort.ts` (the one door to the
  store's `owner_directive` and `owner_correction` tables; `ownerDirectiveStore.ts` orchestrates it,
  `ownerDirectiveRows.ts` speaks SQL, `ownerDirectiveImport.ts` imports a legacy `owner-directives.json` once),
  and a typed error union per module.

## What they do NOT do

- **Neither calls a source.** `route plan` chooses; the session or another verb fetches.
- **No mined content lives in this repository.** What they keep as files is written owner-only under
  `$SLOPWEAVER_HOME/judgement`, tightened at every write rather than left at the default mode; the owner's
  directives and corrections live in the local store, in tables the bot role cannot read.
- **Similarity never concludes.** It may nominate a source; it never decides that a correction applies.
- **A directive is not a memory.** Only a feedback memory explicitly marked as an owner directive becomes
  control; ordinary memories never do.
