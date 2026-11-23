---
name: atlas
description: Answer a question from what an atlas already holds, and keep the answer's claim boundary attached — what was measured, when, on which surface, and what a zero here does and does not prove. Use when routing has already picked a platform and the session now has to read its stored evidence and say something true about a provider. Phrases like "what does the atlas hold for X", "does this org have any Y", "what do we know about that platform's setup", "the atlas says zero — is that real".
argument-hint: "<platform> [--kind <kind>] [--surface <name>] [--query <words>]"
---

**This skill starts after a source has been chosen.** `/slopweaver:route` plans which legs to consult;
this is the job of turning ONE selected atlas into an answer that survives being quoted.

Named for the job rather than for a platform, on the owner's ruling: there is no `datadog` skill and
no `vanta` skill, because the reach and the honesty contract are identical across all of them and only the
estate facts differ — and estate facts are state, not tooling ([§ Where the gotchas live](#where-the-gotchas-live)).

A JOB that spans several of these nouns is a different thing and does get a skill: a compliance-control
question crosses `atlas vanta`, `policy` and `write vanta`, so the procedure for taking one control
from failing to passing is [compliance](../compliance/SKILL.md) — which defers every contract on this page
rather than restating it. Asking here whether a `vanta` skill exists and reading only the sentence above is
how a turn ends up loading nothing at all.

## The one thing this skill exists to stop you doing

**An atlas answering zero is not a provider holding none.** A lookup that returns nothing has causes that
are identical at the wire: nobody ever looked, the credential is fenced out, the last attempt failed
halfway, the surface is not configured, or the thing genuinely is not there. Only the last one is a fact
about the organisation.

The verb refuses rather than letting you get that wrong, so most of your obligation is to READ what it
hands back instead of re-deriving it:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas <platform> read [--kind <kind>] [--surface <name>] \
  [--query <words>] [--id <id>] [--include-stale] [--limit <n>] [--after <id>] [--json]
```

| Exit | What it means                                                                            | What you do                                                                 |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0    | a selection of STORED records, with its claim boundary attached                          | answer, and carry the boundary into what you write                          |
| 3    | nothing matched AND the evidence cannot establish a zero was ever measured               | **this is information, not a dead end** — the refusal names what is missing |
| 2    | an unknown platform, kind or surface — a typo that would otherwise have selected nothing | fix the invocation                                                          |
| 1    | the atlas could not be read at all                                                       | `atlas doctor`, then the platform's own sync or walk                        |

Those rows are in PRECEDENCE order. An atlas that cannot be read back at all is refused (1) before the
selection is made, so a `--surface` typo against an unpublished atlas reports the generation, not the typo.

An exit 3 is the answer to a different question than the one you asked: it says _this atlas cannot speak to
that_. Go and get the named evidence — the platform's own `sync`, `walk` or `refresh` — or say in your
answer that the question is unanswered and why. Never paraphrase a refusal as "none".

`--accept-unproven-empty` takes the zero anyway and attaches the refusal to it. Use it when you are asking
what the atlas STORES rather than what the provider holds, and say which you meant.

## What to carry into the answer

Everything below is on the read's own output. Quoting a count without them is how a measured page becomes
a claim nobody can check:

- **counts are of stored records**, never the provider's population, and a full page proves no completeness;
- **when each kind last synced successfully**, and whether its latest attempt failed;
- **which surface the evidence came from** — an API cell may not stand in for a browser one, and both
  surfaces are mandatory by ruling, so a one-surface answer says so;
- **open gaps and the permission boundary**, which are the atlas writing down what it could not see;
- **what the atlas deliberately withholds**, which the boundary lists by ground;
- **an absent field inside an entity is never evidence the setting is off** — the atlas holds the
  provider's own JSON and judges no field inside it;
- **each row's own NAME, and the field a `--query` hit** — a row leads with what the provider calls it,
  carries its `providerId` on the id line, and prints one `matched "<token>" at <path> — <excerpt>` line
  per token. Read those before quoting a count: they are how you tell a real hit from a word buried in a
  template, and `--query password` over JumpCloud policies returns WiFi profiles on exactly that basis.
  A row whose provider names it nothing keeps the generic head lines, and that absence is itself a fact.

## Before you read: WHICH atlas, and is it the right thing to ask?

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas probe <keyword> …     # which atlas even carries these words
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas <platform> coverage   # what it knows it does NOT know
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas doctor                # can every atlas answer at all
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas freshness             # which are behind their own window
```

**`atlas probe` is the rung BELOW all of these, and it is the only one that asks all 35 at once.** It reads
the five atlas tables in the store rather than each atlas's generation off disk, which is what makes an
estate-wide count affordable — 1.7 to 2.4 s for the whole thing. Two rungs: the platform's own handle for a
thing (`provider_id`, the kind name) and what a channel learned about it (`detail`), counted per
`(platform, kind)` with each cell's last successful sync beside it. It needs `slopweaver store import-atlas`
to have landed, and says so plainly when it has not. **It only SIZES** — everything the rest of this file
says about the claim boundary is `read`'s job, and the probe's own closing lines point at it.

Two distinctions decide whether you have the right store at all, and both are on the descriptor:

- **A surface map is not an entity store.** Several atlases here map what a platform's API and console
  OFFER without holding one record of this organisation's. Asking such an atlas "how many X do we have"
  gets a correct and useless answer. `coverage` says which surfaces are filled.
- **A non-empty kind can still answer NOTHING about the estate, and both verbs say so.** The count a
  kind reports is of STORED records, not of this organisation's records — `atlas datadog read --kind monitor`
  once answered "29 matching STORED entities" and every one was an SDK operation compiled from the Datadog
  client, while the account ran hundreds of monitors. A record only counts as this organisation's when a
  surface the descriptor declares `authoritative` REVEALED it: saw it, and no `discovery` surface ever did.
  An authoritative surface filling in the contents of something a declaration already carried says what the
  platform offers, not what you have. A kind holding no such record prints `NOT ANSWERABLE ABOUT THE ESTATE`
  under its counts, and `atlas doctor` names those kinds on the platform's row. Read that line before quoting
  a number: the grade ANSWERABLE is about the atlas, and this line is about the question you actually asked.
- **The atlas is not the corpus.** An atlas holds what EXISTS in a platform; the corpus holds the
  thread — what people said, decided and did. "What did we decide about X" is `/slopweaver:store`, not this.
  A cell in `held-elsewhere` names the store that answers instead; go there.

Stale is a reason to resync, not a reason to hedge: run the descriptor's own `resyncCommand`, or its
`walk` for the browser surface, and read again.

**Who called what in GCP is an atlas-shaped read of its own**: `google audit-log` pulls Cloud Audit Logs
org-wide into a local generation and reads a least-privilege plan against what was exercised. Its claim
boundary — retention, partial data-access logs, sinks out of Logging — is
[gcp-audit-log](reference/gcp-audit-log.md).

**Never DECLINE an atlas you have not graded — the answer form refuses it.** Answering a Vanta
password-control question, a turn listed the jumpcloud and google admin atlases under what it could not
see while `atlas doctor` graded both ANSWERABLE and `atlas jumpcloud read --kind policies --query password`
returned matching stored rows. So a blind spot naming an atlas this install can read is a door refusal
(`ANSWER_DECLINES_READABLE_ATLAS`, `src/admit/declinedAtlasGate.ts`), fired at the answer pre-flight and
again at the door. Two things discharge it and neither is a form of words: read the atlas, or name the KIND
you could not see rather than the atlas — an atlas grades answerable as a whole while one of its kinds has
never synced, and saying the kind is the true sentence. The override token is `answer.declined-atlas:v1`,
journalled like every other one.

Reading the rows is what settles a question like that one: a `--query password` hit over device policies can
be a WiFi profile, a lock-screen policy or a configuration profile that merely carries the word, and none of
those is a password-complexity policy. It is the standing example of why the name and the match witness are
the first thing you read.

## Where the gotchas live

**Tooling, skills and rules are CODE and live in this repository. A platform's estate facts — its gotchas,
its caveats, the two live prod env spellings, the facets that died post-OTel — are STATE and are never
checked into git.** The owner's ruling: a platform's gotchas and caveats are state rather than tooling, so
they are never checked into the repository.

So this skill holds no platform's numbers and no platform's quirks, and neither does any reference file
beside it. They live in two places outside the repository, and you read both:

- **what a platform HOLDS** — the atlas generation itself, under `$SLOPWEAVER_HOME`;
- **what an investigation LEARNED the hard way** — the knowledge register, one row per lesson with its
  verdict, its evidence and the command that settles it again.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge recall "<the words this investigation mentions>" --domain <platform>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge list --domain <platform> --tier 1
```

**Read the register BEFORE investigating a platform, not after** — the second ask should be smaller than
the first. And when this turn learns something the register did not hold, record it through
`/slopweaver:knowledge` rather than writing it into a file here; a gotcha in the repository is a gotcha
every other install inherits and nobody can correct.

## What this skill does NOT own

Writes. Every Slack, GitHub, Linear and Vanta write goes through its own job skill and the door — an atlas
is read-only by construction and several declare `refuse-every-write`. Reaching a provider live is the
platform's own verb, not this one: `atlas <platform> read` makes no network call at all, by design.

The compliance JOB, too: which control is failing, what its own tests say would close it, and the posture
reads and policy verbs beside them are [compliance](../compliance/SKILL.md).

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
