# Row tags: typed `key=value` facts a board row carries

A card is chosen by a tag the row DECLARES, never by a regex guessing at its words, and the board filters on one
spelling per fact. A row relates to one or several workstreams, and a workstream carries an impact. Design page:
`~/.slopweaver/pages/board-row-tags/index.html`. The vocabulary across the whole setup — which resource inherits
which tag — is [docs/tags.md](../../../docs/tags.md).

## The three rules

- **The key list is closed.** `TAG_KEYS` in `src/handover/rowTags.ts` defines every key, whether it holds one value
  or several, the values it takes and what it means. An unknown key is refused naming the nearest real one. Adding a
  key is a change to that list and nowhere else.
- **A tag lives in the row's journal** as a `tagged` event (`set`, `drop`, `why`), the way a ruling does: history
  kept, no hand-written doc rewritten. It is inert in both run folds. A later event wins; one event that sets and
  drops the same key is refused rather than ordered. A drop names a whole key, or `key=value` for one value of a
  key that holds several; the fold still applies a value drop a hand-edited line carries on a one-valued key. Every row event must be plain JSON data (`src/handover/plainData.ts`), so none loses a field on
  the way to disk.
- **A derived key is computed, never written.** `kind`, `priority`, `reply`, `origin`, `repo` and `run` are read
  from the row's own fields and run journal, and a write naming one is refused with the field to change instead. `reply` is `drafted` or `none`
  off the draft the open question offers: a declared `reply=drafted` would outlive the answer that removed the draft.
  `run` is the journal's lifecycle (open · waiting · orphaned · ended · none), never a claim that a seat is alive.

A journalled assignment the running build's registry refuses — a key since removed, a value since narrowed, a key
since made derived — is KEPT with source `unrecognised`, and set apart: shown so it can be fixed, never matched or
acted on. The write path refuses it; the reader never erases it, and it never contradicts a derived value.

| Key                 | Holds   | Values                                                                                                                     |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `platform`          | one     | slack · linear · github · gmail · notion · calendar · drive · vanta · none                                                 |
| `audience`          | one     | owner · team · person · channel                                                                                            |
| `workstream`        | several | a kebab-case workstream name                                                                                               |
| `substream`         | several | a kebab-case milestone, prefixed with its workstream by convention                                                         |
| `area`              | several | a kebab-case area name                                                                                                     |
| `impact`            | one     | critical · high · medium · low                                                                                             |
| `controls-resolved` | one     | a whole number of failing compliance controls the act resolves                                                             |
| `effort`            | one     | xs · s · m · l · xl                                                                                                        |
| `pr`                | several | `owner/repo#N`                                                                                                             |
| `preapproved`       | one     | cassette-recording                                                                                                         |
| `steer-hatch`       | several | vulnerability-fix-topup-gate — written only by `vulnerability-fix topup --steer-row`                                       |
| `context`           | one     | work · slopweaver                                                                                                          |
| `needs`             | several | gmail · calendar · drive · outlook · fathom · slack · linear · notion · datadog · vanta · hex · trelica · outlook-calendar |

`rowTagsOf({ fields, events })` (`src/handover/rowTagFold.ts`) answers `{ tags, unrecognised }`: `tags` is what a filter matches and a card reads,
declared then derived, each marked with its source. `fields` is one shape from either kind of row — `fieldsOfDoc` for
an authored doc or ask, `fieldsOfSlackTag()` for a Slack tag projected from the lifecycle — so a filter reads one
derivation whichever row it meets. `fieldsOfDoc({ doc, run })` reads `reply` and `run` off the ONE run disposition,
so the two cannot contradict each other. A consumer such as the workstream band or the Queue's `?tag=` filter
([tag filter](../../../docs/console/queue-tag-filter.md)) folds `row.tags` only.

## Writing a tag

```bash
slopweaver handover tag <slug> workstream=iso-certification impact=high --why "<why>"
slopweaver handover tag <slug> --drop impact,workstream=hiring --why "<why>"
slopweaver handover register --ask "<...>" ... --tag platform=slack,workstream=hiring --new-value workstream=hiring
```

- **A write names the state the row should be in.** What the row already holds is reported as `already so` and left
  alone; a run that changes nothing exits 0 as `unchanged`. So re-running a write, or the recovery command a failed
  one prints, is always safe. It converges once the failure's own cause is fixed — a read-only journal fails the
  retry as it failed the write — and when the failure left an undecodable line the advice names that line to repair
  first, since no tag is written over a line nothing can read. `register --tag` also refuses a slug an ARCHIVED doc
  claims under any filename.
- **A new workstream is refused as a likely typo** unless `--new-value workstream=<v>` names it, with the nearest
  existing spelling offered. `substream` and `area` carry the same guard: a key opts into it with `newValueNeedsFlag` in
  `TAG_KEYS`, and no code names one. An acknowledgement of a value that already exists is accepted and said to be unneeded, never refused.
  No value may contain `,`, the separator every flag lists tags with.
- **One board-wide lock** (`row-tags`, `src/handover/tagStore.ts`) is held by every tag write and every
  registration, so the board a write judges cannot change under it. A tag lands only on the ONE live row claiming the
  slug whose doc is `handovers/<slug>.md`; a journal that is a symlink, a hard link or holds an undecodable line is
  refused rather than written through. `register --tag` also refuses a slug with any history — an archived doc or an
  existing journal — and judges every tag BEFORE the doc exists, so a refused tag leaves no row. What the lock does
  not cover (a writer outside these verbs, a hand edit) is named in that file's header.
- `--dir` is refused: a journal is keyed by home and slug, so a custom board's row would share the home board's.

## Reading and filtering

```bash
slopweaver handover list --tag workstream=iso-certification --tag '!impact'
slopweaver handover list --tag platform=slack,reply=drafted --json
```

- **Every term must hold** — repeated `--tag` flags and comma members AND together, a repeated term counts once.
  `key=value` needs that value, a bare `key` any value, `'!key'` none (quote it for the shell). `!key=value` is
  refused, and so is every term the registry could never match, before the board is scanned (exit 2). A derived key
  is filterable although no write may name it.
- **A filter narrows which rows PRINT, never a fact about the board.** The hidden-terminal count, collisions and the
  JSON `summaryTruncation` stay about the whole board; a `filtered by --tag …: N of M row(s)` line says what was left
  out, and `--all` widens both halves.
- **An unrecognised tag is never matched**, so `'!key'` selects a row whose only value of that key is unrecognised.
- **A journal read incompletely** (an undecodable line, or no read at all) marks its row `tagsIncomplete`. A filter
  naming a declared key, `reply` or `run` warns on stderr for every such row, excluded ones too, since its verdict on them may
  be wrong; a filter over doc fields alone reads nothing from the journal and stays silent.
- `list --json` and `row --json` carry `tags` (`{ key, value, source }`), `unrecognisedTags` (`{ key, value }`) and
  `tagsIncomplete` on each row; `list --json` adds `tagFilter` (the deduped terms) and `rowsBeforeFilter`. A
  consumer such as the workstream view folds `row.tags` only. `ask` and `offer` take no `--tag`: an ask is tagged
  by `handover tag` once it exists.

## What a tag decides

**`needs=` holds a row while this install is not connected to what it names** (the board knows what is
connected). A row ranking in `RUN NOW` (a parked seat a standing-session ruling lifts there
included) declaring an integration whose whole credential set the secrets store lacks is `blocked`, never offered, and stays on the board; storing the credential frees it on the next
reconciliation. Tag it with `handover tag <slug> needs=fathom --why "<why>"` — the board never infers a need from a
row's words. Each value and its connect command is a manifest's `connection` (`src/integrations/<id>/integration.ts`),
read by `src/handover/integrationNeeds.ts`;
[top-band](top-band.md) says what `reconcile` prints.

**`context=` is a board row's stated workspace in the console**, the same tier as its `workspace:` line
(`site/lib/registerPlacement.ts`'s `boardRowPlacement`), and its `repo` field never places a row: that is the checkout the
seat ran in. The console reads a declaration only off a row whose `tags` read whole and whose `tagsIncomplete` is
`false` (`site/lib/boardContext.ts`). A row whose tags or journal read in part is a finding the default rule draws in `self`
([one-board](one-board.md)), whatever else it carries: it may be hiding a declaration that says otherwise. A `context=` disagreeing with the row's
`workspace:` is a conflict; one over a contrary pull request places the row and marks what it overruled. A board
row's words never place it. Tag one with `handover tag <slug> context=work --why "<why>"`.

## What is not there yet

Declared tags reach the AUTHORED rows (doc, ask). A projected Slack-tag row is keyed by its lifecycle pair rather than
a journal slug, so it carries derived tags only and passes no events. Hand steps are not board rows and carry no
tags, so the hand-step gates still read a step's sentence: the drafted-as-the-owner card (`src/hand/draftAsOwner.ts`) and
the decision, sign-in and reaction gates (`src/hand/decision.ts`, `src/hand/step.ts`). They wait on a typed
hand-step design of their own.
