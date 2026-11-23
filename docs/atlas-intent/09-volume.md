# 9 · An exclusion is only ever a VOLUME measurement, and a gate refuses the rest

Part of [What an atlas must be](../atlas-intent.md).

The owner's standing rule, set on the Cloudflare Zero Trust card where Rulesets sat as a declared exclusion
and thirteen kinds as deferred: an atlas missing coverage is **unacceptable**. The ONLY convincing reason to
exclude a kind is that pulling it is **highly voluminous** — the owner's example, a terabyte on this
machine. Everything else is an unacceptable exclusion.

This is claim 6's bound made enforceable, and the two together are one rule read from both ends: §6 says a
voluminous family is a DISPOSITION rather than an exclusion, and this claim says nothing else may be an
exclusion at all.

**Why it needed a type rather than a sentence.** MEASURED across all 36 descriptors the day the rule was
typed: **226** entries stood in `excludes`, every one free prose, and most of them withheld no record — they
were bounds on what the atlas DOES (never sends a write, never photographs a page of somebody's data) or on
what a stored record CARRIES (a field name and not its value, never a credential). Cloudflare's were bare
noun phrases with no reason at all, which is what put them on the card. A rule stated in prose beside prose
cannot tell an unreasoned row from a reasoned one.

So `AtlasDescriptor.excludes` (`src/atlas/kit/contract.ts`) is a discriminated union on a **ground**, and the
ground is what a gate reads. Ten grounds, of which **four withhold a record**:

| Ground             | Withholds a record | What it must also carry           |
| ------------------ | ------------------ | --------------------------------- |
| `shape-index`      | yes                | a volume basis — measured, or not |
| `disclosure-bound` | yes                | the owner ruling that settled it  |
| `payload-not-map`  | yes                | —                                 |
| `not-fetched`      | yes                | what would close it — **REFUSED** |
| `held-elsewhere`   | no                 | the holder                        |
| `never-acted`      | no                 | —                                 |
| `names-not-values` | no                 | —                                 |
| `secret-material`  | no                 | —                                 |
| `out-of-platform`  | no                 | —                                 |
| `claim-not-made`   | no                 | —                                 |

**The gate.** `slopweaver atlas <platform> coverage` exits `3` on three shapes, each a FACT rather than a
reading of prose: an exclusion on the `not-fetched` ground, an exclusion claiming `shape-index` on an
`unmeasured` volume basis, and a kind whose coverage cell is still `deferred`. It reads the whole atlas, so
no `--kind` or `--state` filter can buy a green exit.

**`deferred` is in the gate for the same reason the other two are.** MEASURED across the 24 published
generations in `~/.slopweaver`: 44 cells stood `deferred` and exactly **two** carried any
volume reason. The rest read `17 of 32 declared page(s) reached` — a walk that has not finished, which is
missing coverage wearing a settled word. One atlas's own cells are
`slopweaver atlas <platform> coverage --state deferred`; the register across every atlas is
`slopweaver atlas backlog --deferred`, below.

**`not-fetched` is expressible on purpose, and refused rather than banned.** A ground an author cannot state
is a ground an author mislabels, and a mislabelled row is invisible where a refused one is a name on a list.
The row carries what would close it, so a refusal arrives with its own remedy.

**The two grounds that are not volume SURVIVE, and the refused rows are a backlog.** Two of the four
record-withholding grounds rest on rulings the owner made personally rather than on volume — `disclosure-bound`
(Hex's result sets, jam payloads) and `payload-not-map`
(image layer bytes, rendered files, cache artifacts). Under the sentence at the top of this section neither
is a volume reason, so both were carried as declared grounds and listed for the owner on the exclusion ledger
page rather than accepted silently. The owner read the twelve rows and ruled: the two grounds survive; all of that data belongs in the local
Supabase store; the refused rows are a backlog the fleet keeps working through; and the work starts with
Datadog, Vanta, Linear, Slack, Notion, GitHub, Cloudflare, JumpCloud and Google Admin, in that order.

Three things follow, and each is code rather than prose:

- **Both grounds are settled decisions, not debt.** Neither is a candidate for the gate, and neither ever
  appears in the backlog register.
- **A refused row is a backlog row, never a gate on an atlas pull request.** `slopweaver atlas backlog`
  sweeps every atlas, orders the refused rows the way the owner ruled they should be worked — the
  owner's nine named atlases in the owner's sequence, then the rest densest-first — and **always exits 0**. `slopweaver atlas
<platform> coverage` still exits 3, because its question is whether ONE atlas is complete today.
  `src/atlas/kit/backlog.ts` carries the order and why the exit code is what it is.
- **A weighed voluminous family's destination is the local Supabase store**, as the owner ruled — which is a
  destination rather than a licence to stop measuring: a family has to be weighed before anybody can say
  what landing it costs ([the store](../store.md)).

**The census, and how it moves.** It is a shrinking register of refused rows: `not-fetched` and unweighed
`shape-index` claims. Landing a real measurement removes one entry and is meant to fail
`src/__tests__/unit/atlas/kit/exclusionGround.test.ts`, so the debt shrinking is a line in a diff — Datadog's
occurrence-body row, weighed at **millions of log events in a single UTC day** (even for the
smallest family that row covers), took one off. Re-derive the whole register with
`slopweaver atlas backlog --json`.

**The deferred half has its own register, and it is the bigger one.** `slopweaver atlas backlog --deferred`
sweeps the gate's third refused shape the same way and in the same order. It is a FLAG rather than the
default because a deferred cell is a property of the published GENERATION, not of a descriptor — the
exclusion half reads no store at all, and that cheapness is worth keeping. MEASURED on this
install (`slopweaver atlas backlog --deferred --json`, 21.6s over 36 atlases): **324 deferred cells across
18 atlases**, of which **288 are Datadog's** — its 144 kinds, each unfilled on both the `api` and `console`
surfaces because this build has never made a live Datadog pass, and Datadog is #1 in the owner's order. An atlas
with no published generation is reported as **NOT COUNTED** rather than as clear: an absence and a clean atlas must never print the same sentence, which is the same honesty
`src/atlas/kit/answerable.ts` enforces for a dark generation. `src/atlas/kit/deferredBacklog.ts` carries
that property and why the count is cells rather than atlases.
