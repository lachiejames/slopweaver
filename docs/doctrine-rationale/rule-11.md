# Rule 11 · One concept, one name; one name, one concept

## What the owner asked for

A dead-code audit found places where one thing carried different names, and places where two different things
shared one name. All of it gets fixed, so everything reads coherently everywhere — `vulnfix` as a verb beside
`vulnerability-fix` as a skill is the example to consolidate. One consistent name per concept across commands,
skills, pages and docs, and different names when things mean different things: that is doctrine, not a
one-off cleanup.

The audit had found nine. Fleet lived at `/now` while the sidebar called it Fleet, and something opened
`/fleet` and got a page that did not exist. The Board page drew a component called `Workstreams.tsx` while
the real Workstreams page was something else. Machine drew `Console.tsx` while "console" meant the whole app.
Setup lived at `/onboarding`. The `vulnfix` verbs sat behind the `vulnerability-fix` skill. None of them
needed code removed; every one cost a reader a guess about whether two names meant one thing.

## What the gate can decide, and what it cannot

Two surfaces declare their names in exactly one place each, so a divergence there is a fact, not a reading:

- **The command surface.** Every CLI noun is a `MANIFEST_MODULES` row and every skill is a
  `skills/<name>/` directory. Two of these name one concept when their names differ only by separators
  (`session-start` and `sessionstart`), by a regular plural (`policy` and `policies`), or by one
  abbreviating the other (`vulnfix` splits as `vuln` + `fix` against `vulnerability-fix`). Every pair is
  compared, so two nouns spelling one concept two ways fails too.
- **The sidebar.** A linked `SIDEBAR_ENTRIES` row carries an address, a key and a label for one page, and all
  three must spell the same name. That is the shape of the `/now` defect and of Setup at `/onboarding`.

The abbreviation rule needs the expanded name to have two or more segments. Without that guard every prefix
reads as an abbreviation, and the `hand` skill and the `handover` noun are two different concepts.

**Prose, React composition and module names are review's.** A page composes several components with no
primary one (`/workstreams` draws `WorkstreamCandidates` and `WorkstreamTiles`), and an English word in a doc
can correctly name a process the code calls something else: the onboarding process is still onboarding even
though its page is Setup. A criterion over either would encode route-specific knowledge or refuse correct
text. So a component rename such as Board's or Machine's is made by hand, and a green `naming-doctrine` run says
nothing about them.

The gate's debt register only shrinks: a divergence it does not hold fails, and a row that stops firing fails
too, so each rename deletes its own row in the same pull request.

## The integration glossary

Everything Slopweaver reaches is an **integration**, and an atlas is a feature of one — the owner took every
lean on the integration-layout page. Each concept below has one name.

| Term                  | Means                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **integration**       | One external system Slopweaver reaches: Slack, Datadog, Knock. Its id is a lowercase slug (`google-admin`). The unit everything else hangs off.                                                                                               |
| **feature**           | One thing an integration can do, from a closed set; each integration declares which it has: **connect** (its credentials and the preflight proving them), **atlas**, **ingest**, **read**, **write**, **listen**.                             |
| **atlas**             | The local map of what an integration holds. An integration has at most one.                                                                                                                                                                   |
| **kind**              | One section of an atlas. A _surface_ kind maps what the system offers (API methods, dashboard routes); an _entity_ kind maps what this account holds (channels, monitors).                                                                    |
| **ingest**            | Copies an integration's history into the corpus (bronze).                                                                                                                                                                                     |
| **read**              | Fetches an integration's current state on demand.                                                                                                                                                                                             |
| **write**             | Changes an integration, through the admit door and a typed form.                                                                                                                                                                              |
| **listen**            | Receives an integration's events (Slack).                                                                                                                                                                                                     |
| **source**            | Where a corpus record came from: an integration's ingest, `gold` or `self`. "Source code" and "source file" are plain English; neither is a term nor names a type.                                                                            |
| **leg**               | Any one place an investigation reads: an integration's read or atlas, the store, the corpus. Routing plans legs.                                                                                                                              |
| **capability**        | Routing only: one row saying what one leg can answer and how to reach it (an integration manifest's `routing`, `integrations/hex/integration.ts`). It never names a feature; routing's rows derive from the features an integration declares. |
| **door**              | The gated route a read or write goes through (rule 3). A feature goes through a door; a door is not the integration.                                                                                                                          |
| **model host**        | What runs a model session: Claude or Codex.                                                                                                                                                                                                   |
| **token minter**      | The function that turns a stored credential into a short-lived access token for one integration (an OAuth client-credentials exchange).                                                                                                       |
| **OS**                | The operating system Slopweaver runs on. Node's `process.platform` keeps Node's spelling.                                                                                                                                                     |
| **integration state** | What `$SLOPWEAVER_HOME` keeps about one integration (a catalogue, cached records). The fleet's own state beside it (queue, worktree pruning, spend) is named for what it is.                                                                  |
| **lane**              | A test lane, and nothing else: unit, subprocess, cassette or replay.                                                                                                                                                                          |
| **cassette lane**     | The test lane replaying recorded HTTP traffic (`src/__tests__/integration/`, `config/vitest/integration.ts`, `setup-polly.ts`).                                                                                                               |
| **connected app**     | One app connected _inside_ an integration's own account: what Vanta, Trelica and Jam each call an "integration".                                                                                                                              |
| **IdP**               | A sign-in service configured inside an integration (an access gateway's login methods).                                                                                                                                                       |

**Provider, platform and connector are retired** from our own vocabulary: every meaning they carried has its
own row above. **The wire rule** is not a term but the one place another system's words survive: a JSON key, a
URL path or an SDK type that an integration defines keeps its spelling, because the name is the integration's,
not ours. Every identifier we write uses the glossary.

**The vocabulary half of the gate.** `naming-doctrine` refuses a retired word as a whole segment of a type,
interface, class or enum name, an exported binding, or a typed field. The wire rule is read from syntax, never
from a name: a QUOTED field (`"provider": string`) is another system's key, a React component rendering
`<X.Provider>` keeps React's spelling, and a generated file is its generator's. Locals, parameters and object
keys are review's. The exact criterion and its blind spots are in `src/devLint/namingVocabulary.ts`; its
register, `.baselines/naming-vocabulary-baseline.json`, only shrinks, and each rename rewrites it with
`yarn tsx src/devLint/namingDoctrine.entry.ts --rebaseline` in the same pull request.

## History is not renamed

A rename moves every CURRENT surface and its canon at once, with no alias verb, no redirect from the old
address and no "formerly known as" prose — the no-legacy rule, applied to names. What it does not do is
rewrite history: an append-only journal row, a measured slug in a past run, or a stored value an older build
wrote stays exactly as written. Either current state is imported once, or the old bytes stay as historical
input that no current writer emits. A bulk find-and-replace that rewrote a recorded measurement would make
the record lie about what happened.
