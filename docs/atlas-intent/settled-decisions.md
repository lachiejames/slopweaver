# The goal the definition serves

Part of [What an atlas must be](../atlas-intent.md).

The bot should be an expert when asked anything about a platform: whatever a person could learn about it, the
atlas lets the bot answer.

One atlas per SaaS app, and the owner expects a great many of them. The atlas definition is formalised so it applies
to **any SaaS platform**, one atlas for every SaaS app, in a clean code shape consumable across apps. Each atlas
covers **both the API surface and the browser surface**, cataloguing everything.

## Properties the owner has ruled on, that a kit must not un-decide

Each of these is a standing decision, not a derived design principle.

| Property                        | The rule                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Coverage is first-class         | Coverage is a first-class property of an atlas.                                                    |
| Honest about its own gaps       | An atlas is honest about how much it knows and where its own gaps are.                             |
| Accumulate, never replace       | An atlas accumulates; a new read never replaces what an earlier one found.                         |
| The gap list is a deliverable   | A gap list ships alongside the atlas, naming everything found broken.                              |
| Stored so a human can grep it   | Storage is JSON, one file per kind, greppable.                                                     |
| Kept in sync, staleness visible | Old content goes stale, so the atlas is kept in sync and up to date, and its staleness is visible. |
| Read through a verb             | The atlas is read through verbs, so an agent can call it easily.                                   |

## Where the code lives, and where the data lives

It is [the partition](../constraints/partition.md) applied to atlases: the code that generates an atlas ships in the
plugin, while the atlas itself lives as hidden files under the user-level state directory. The atlas tooling lives in
the public repository; the atlas implementation and its results live somewhere private.

The same line runs one step further out: certain things belong in the code in Slopweaver because it is tooling,
skills and rules. But gotchas or caveats about one installation's Datadog setup are not checked into the Slopweaver
Git repo, because they are state rather than tooling. So a platform's LEARNED caveats join its
results outside the repository, in the knowledge register (`skills/knowledge`) — which is the `memories`
table (`docs/store/tables-and-atlas.md` § The tables), read by `knowledge recall`. The
practical consequence for an atlas: neither `skills/atlas` nor any reference file beside it may carry a
platform's own numbers, quirks or spellings — those resolve at runtime from the state home, never from a
constant.

**What a generic read may present as a zero is a REFUSAL rather than a convention.**
`src/atlas/kit/readAnswer.ts` is the single home of "unavailable evidence is not negative evidence": a
selection that matched nothing, over a kind whose coverage cannot establish that a zero was ever measured,
exits 3 and names what is missing instead of answering zero. Claim 9's honesty about exclusions and §4's
about disagreement are both carried into every answer as a claim boundary, rather than being available in a
different verb. `skills/atlas/SKILL.md` is how a session is meant to read one.

## What this page does NOT settle

The nine claims are about atlas **content**. They do not decide engineering shape — how a channel is
stored, whether two atlases share a base type, what the verb surface looks like. Those are open, and
separating them from the content intent is the point: the content is locked here so that only genuine
engineering choices remain arguable.

One question is undecided, and it is not anyone's to answer on the owner's behalf:

1. **Which surface a consumer is handed when the two disagree.** Both records are kept and the owner decides the
   rest only once the owner can see real instances (§4) — so this stays open by choice, not by omission, and what
   settles it is real disagreements put in front of the owner rather than another design pass.

Everything else is ruled and lives in its claim: screenshots are held (§5), an undocumented endpoint is
usable if it works (§2), what an atlas holds is per-platform on the who-else-holds-it test, and a highly
voluminous surface is enumerated and declared rather than stored whole (§6), the browser is the ingest
fallback rather than the first reach (§7), and the atlas is distinct from the corpus (§8).
