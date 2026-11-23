# Definition of done: an atlas is not done until it ANSWERS

Part of [Atlases](../atlases.md).

**A board doc raising an atlas pull request is not finished when the sync runs. It is finished when the
atlas answers a question through the same read path the bot uses, and the bugs found on the way are fixed
in that pull request.** The owner's steer, after a dogfood page showed every cross-check atlas the owner's ISO
flows needed reading as empty before a single flow ran: building atlases that are never wired into the bot
is an illusion of productivity, and an atlas called done that nobody can do anything with is decorative.

Spinning a bot up per atlas can look heavy-handed; the owner's ruling is that it is expected anyway: the
listener is temporary, and the session raising the pull request stands it up itself. So the bar has two
halves that do different
jobs — a mechanical floor that runs everywhere for free and gates the pull request, and a listener proof
that is what makes the floor mean anything.

## What a generic `read` may answer, and when it refuses

Answering is not the same as answering HONESTLY, and the gap between them was measured on a dogfood turn:
`atlas <platform> read` selected a page of entities and both encodings threw away the coverage, the
permission block, the acquisition history and the gaps of the kinds it selected over — so a kind with an
`unavailable` cell and no successful sync answered `0 matching entities` at exit 0, indistinguishable from
an organisation that holds none.

`src/atlas/kit/readAnswer.ts` is the single home of the rule that closes it, and `skills/atlas/SKILL.md` is
how a session is meant to read the result:

- **exit 0** — a selection of STORED records, carrying its claim boundary: what the count is of, that a
  full page establishes no provider completeness, that an absent field inside an entity is not evidence the
  setting is off, plus each selected kind's coverage, freshness, gaps and permission boundary;
- **exit 3** — nothing matched AND **ANY** selected kind's evidence cannot establish that a zero was ever
  measured. Any rather than every, deliberately: one unmeasured kind in the selection makes the zero over
  the SELECTION unproven, however well the kinds beside it were measured. The refusal names which evidence
  is missing, per kind, and `--accept-unproven-empty` is the registered escape hatch;
- **exit 2** — an unknown platform, kind or SURFACE, so a typo never manufactures a successful empty read.

The codes are in PRECEDENCE order, not preference order: an atlas that cannot be read back at all is
refused at exit 1 by `refuseUnanswerableAtlas` before any selection is made, so a `--surface` typo against
an unpublished atlas reports the unpublished generation rather than the typo. Both refuse; neither answers
a zero.

A historical zero is answered rather than refused: a successful acquisition older than the atlas's window
really did measure it, and what it needs is its date attached. The `--json` document is version **2**, a
union discriminated by `outcome`, and its refusal arm carries no `entities` field at all — an empty array
beside a refusal is the original defect re-entering through the wire format.

**A row says what it IS, and why the query selected it.** The same dogfood turn found the second
half of the same defect one level in: a page that WAS answered rendered each matching JumpCloud policy
as an operation plus an opaque id, leaving password policies indistinguishable from unrelated policy
classes such as a WiFi profile. `src/atlas/kit/entityLabel.ts` closes it for
every atlas at once, deriving from the provider's own payload rather than asking 37 adapters to declare
anything: the headline leads with the entity's own name (`ATLAS_NAME_KEYS`, measured — 84% of an
install's 667 kind files carry one), the displaced `providerId` moves onto the id line so the reproduction
handle is never lost, and each `--query` token gets one witness line naming the field that carried it
(`detail.template.configFields[7].label`), an excerpt of what it says, and how many other fields also
carried it. Name, excerpt and address each carry a declared cap, so no line's width comes from the data —
the address is the one that is elided from the HEAD, because the leaf key is what says which field
answered. `--json` gains `name` and `matchedOn` additively; the version stays 2. The walk that decides
a row and the walk that explains it are the SAME walk, so a row cannot be selected with no witness to show
for it — and the deciding half renders no path at all, because it runs over every stored entity
across the entire stored population before anything is paged.

## The floor, mechanical, and it gates the pull request

```bash
slopweaver atlas doctor <platform>     # the atlas you shipped: ANSWERABLE or the run fails
slopweaver atlas doctor                # the estate: no atlas may be left DARK
```

`doctor` grades every atlas through `findAtlasPlatform`, which is the same guarded door `read` and
`coverage` go through, so what it exercises is the shipped behaviour rather than a restatement of it. Three
grades and what each means:

| Grade         | What it says                                                                                   | Does it fail a run                        |
| ------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ANSWERABLE`  | every entity the manifest vouches for read back                                                | no                                        |
| `DARK`        | a generation is published and the reader cannot see what it vouches for — the decorative state | **always**                                |
| `UNPUBLISHED` | nothing has ever been synced here, and the atlas SAYS so rather than answering zero            | only when a platform is NAMED — see below |

The asymmetry is the point. A sweep that went red for every atlas nobody has synced on one machine would be
red permanently and therefore ignored; naming your own platform asks the shipping question instead, where an
atlas with no generation is exactly the failure.

## The proof, and it is what makes the grade mean something

A green `doctor` proves the store round-trips. It does not prove the atlas is worth reading. **The owner's
ruling: an atlas is DONE when a temporary listener for the bot has answered a Slack tag posted as the owner
over it** — and the session raising the pull request stands that listener up itself, so the owner never has
to look at Slack. The session in charge dogfoods by posting into Slack as the owner, tagging the bot, and
seeing what happens; that is encouraged, not merely allowed.

Eight steps, and each one is load-bearing. **The first three cost no listener slot**, which is the point of
their ordering: every one of them is a way the proof was going to fail anyway, found before the token is
taken rather than after.

1. **`slopweaver atlas doctor <platform>` exits 0 first.** A `DARK` or `UNPUBLISHED` atlas cannot be proven
   by a tag, so proving one would burn the slot for nothing.
2. **`slopweaver turn brief --contracts --text "<your question>"` returns an atlas capability.** Read-only,
   writes no lifecycle row. MEASURED, and this is why it is a step: an atlas passed
   `doctor` with thousands of entities, took the token, posted a clean tag as the owner — and the brief showed the router
   had no atlas capability at all, so the question could not route anywhere. **"The atlas can answer" and
   "the bot can reach it" are different claims**, and a row looks done on the first without the second.
3. **Something must vouch for the bot's own Slack id**, or the tag is refused before it is sent. MEASURED at
   both gates on the same run: the mention path refuses with _"the only match carries no trusted email"_ and
   the raw-body path with _"nothing knows that id … confirm it in the identity roster (slopweaver identity roster replace)"_. It is a
   once-per-install step, not a per-session one, and the id is read back through the door with
   `auth.test --expect user_id` rather than guessed.
4. **The listener is a VISIBLE interactive session** running the loop in its own workspace — rule 2, no
   exception. Never headless, never detached, and never the standing loop, which stays down. It **stands
   down the moment the permalink is captured**.
5. **It runs the BRANCH's code.** `bin/slopweaver` executes the ambient `PLUGIN_ROOT`, so a worktree proof
   silently exercises `main`. Export `SLOPWEAVER_CLI_DIR` at the branch worktree, or launch with
   `--plugin-dir` at it. A proof that ran main's code is not a proof of the branch.
6. **The tag goes through the door as the owner** — `slopweaver slack post --as me` — into **the bot DM only,
   never a shared channel**, and its text NAMES the atlas so the permalink is self-describing in the Proof
   cell.
7. **The question must be ATLAS-ONLY.** This is the step that decides whether the proof means anything: if
   the corpus, a live API or general knowledge could have produced the same answer, a plausible reply proves
   nothing. Name a thing only that atlas holds, and require the answer to carry the atlas's own ids, URLs or
   counts back. A bot that answers plausibly from somewhere else is a FAILED proof, and worth reporting as
   one.
8. **The Slack permalink is the evidence in Proof of the solution**, gathered on the head that lands. Arm the listener after
   CI's `build` is green on the head you will land (`slopweaver github checks --wait`) and BEFORE `slopweaver github enqueue`, so the
   permalink exists while the pull request is still open.

**Bugs found while proving it are fixed in the same pull request, not carded.** That clause is the owner's, and it is
the half that turns the check from a report into a repair.

## A proof attempt has THREE endings, and the third is not a failure

The owner's ruling, about the bot's own turns rather than about atlases — but a proof tag IS a
turn, so it governs here too. **Answered** is the gold proof. **Failed** means something is broken, and the
bug is the work. **Blocked on the owner** is neither, and collapsing it into the second is the thing the owner
ruled against: a bot blocked on something only the owner can solve has not failed, and signing in or
approving something risky are nearly the only cases that arise.

So a proof attempt that reaches a step only the owner can perform ends **paused on the owner, with no clock on
it** — hourglass on the progress card's step line rather than a failure, a tag to the owner in the thread, a
react-now card on the fleet briefing, the ask left NOT done, and the whole thing resumable whenever the owner
does the thing.
Grading it as a failed proof sends the next session hunting a bug that does not exist.

**One consequence is this page's rather than the owner's, and it is the collision between the two rules: a paused
proof MUST release the listener token.** One listener runs on this machine at a time, and a session waiting
an unbounded time for a sign-in would hold every other atlas behind it. The row pauses; the listener stands
down; the token goes back.

## One listener at a time, and how you ask for the turn

The one hazard the owner named is two sessions doing this at once, and the owner asked the supervisor to
coordinate it. So
the token is a handshake, not a convention:

- **Before arming**, `SendMessage` the pinned `/slopweaver:supervisor` session asking for the listener token
  and naming your platform. Wait for the literal reply **`listener yours`**. Never arm on silence, and never
  probe for the token by arming one and seeing what happens.
- **After** the permalink exists and the listener is down, send **`listener released`**.
- The pin moves between handoffs and the token ledger moves with it, so address whichever session
  `ListAgents` shows pinned rather than a remembered name.

## What this closed, measured

MEASURED over the real `~/.slopweaver`, by sweeping every registered platform through the read
path: **12 of 31 atlases held a published generation the reader could not read back, and every one answered
`entities: []` and exited 0.** Vanta vouched for 21 kinds over 12 MB on disk and reported nothing; CrowdStrike
answered nearly all of the ten thousand-odd entities it held and silently dropped its whole browser-console half. The cause
was one commit: the kind-file layout became `.jsonl` and nothing migrated the generations already written, so
`atlasHome.ts`'s `kindFileName` guarded the DECLARATION while the DATA went dark. Nothing was lost and
nothing detected it, which is the whole argument for this section existing.

`slopweaver atlas doctor --repair` rewrites such a generation into the current layout, restamps its manifest
digests and archives what it replaced under `_superseded` — it fetches nothing and discards nothing. Run
against a populated install, it moved the estate from only a subset of answerable atlases to the full
available set, with no dark atlas remaining.

**The store names that state, so the refusal can too.** A kind whose `.jsonl` is absent while its `.json`
sibling sits beside it grades `superseded` rather than `missing` (`kit/store.ts`), and a dark refusal says
the records are on disk RIGHT NOW under the pre-`.jsonl` name and names `--repair` for exactly those kinds.
Two things follow, and both are the rule rather than a note. `superseded` is in `darkKindsOf`'s union in
`kit/answerable.ts` **explicitly**: a kind whose manifest cell records `entityCount: 0` falls out of the
missing arm the moment it is graded `superseded`, and out of the published-vs-projected arm because nothing
is short of zero — so without that member a whole generation in the old layout would grade ANSWERABLE and
answer nothing. And `legacyKindFilePath` lives in `atlas/atlasFile.ts` alone, because the repair and the
grade had derived the same name twice; a reader and a repair disagreeing about what a kind file is called is
how this class regenerates.

Why the message and not only the verb: the reader is where a session meets this. Reported as
_"the manifest vouches for these and the files are gone"_, those dark generations cost a session a day of
looking for corruption that was never there. A refusal that delegates the which-of-two-states question to a
second verb is a refusal that has not answered it.

An atlas is ground truth about a system's **shape**: every Datadog service and span attribute, every
Cloudflare DNS record and Worker, every Vanta control and vendor, every Slack conversation that exists.
The world model (`refresh` → `derive` → `distil`) is the other half — what people _said_. An investigation
reads the atlas to find out what is there, then reads the world model to find out what was decided about it.

**Why it earns its cost:** an agent guessing a metric name finds what it already thought of. An agent
reading the atlas finds the monitor nobody knew was mis-scoped. Atlases are what surface unknown unknowns.
