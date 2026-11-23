# Tags: one vocabulary across the localhost setup

Tag everything the way AWS tagging practice tags a whole estate — not only the service, but the VPC, the subnets and the load balancer — so the board, the Queue,
the seats and the pages can be filtered, grouped and triaged by the same facts. This page is that model, and it says
which parts exist today. The row
schema it stands on, and how a tag is written, is [row-tags.md](../skills/handover/reference/row-tags.md); the key
list is `TAG_KEYS` in `src/handover/rowTags.ts`, and nothing else defines a key.

## Five rules, each borrowed from AWS practice

- **One registry, one spelling per fact.** AWS tag policies fix the allowed keys and values; here the closed
  `TAG_KEYS` list does, and a typo is refused naming the nearest key. `platform` is the provider key: there is no
  second `provider=` spelling.
- **Tag the whole estate, not the obvious resource.** The model gives a board row, a Queue card, a workstream, a
  seat, a published page and a pull request tags. The board row holds them and the Queue card inherits them today
  (§ Every resource).
- **Tags propagate from the resource that owns the fact.** ECS copies a service's tags onto its tasks
  (`propagateTags`); here the board row owns every declared fact and every other resource is to read its tags from
  the row, never a copy of its own that can drift.
- **Derived where it can be, refused where it cannot.** A key computed from something the row already has (`kind`,
  `priority`, `reply`, `origin`, `repo`, `run`) is never written, and a write naming one is refused with the field to
  change instead. A declared value outside its key's rule is refused, never stored.
- **A new name is introduced on purpose.** `workstream=`, `substream=` and `area=` name things that grow; a value the
  board has never carried needs `--new-value key=value`, so `iso-certfication` cannot quietly start a second
  workstream.

## Every resource, and where its tags come from

| Resource       | Its tags, in the model                                                                              | Today                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Board row      | Declared: `tagged` events in its journal. Derived: its own fields and run journal. Owns every fact. | Written by `handover tag` and `register --tag`; folded by `rowTagsOf`, published on `list --json` and `row --json` |
| Queue card     | The tags of the board row, or rows, it belongs to.                                                  | Inherited, and filtered by the Queue's `?tag=` ([tag filter](console/queue-tag-filter.md))                         |
| Workstream     | IS a tag, `workstream=<slug>`; its areas, substreams and impact are gathered from its rows.         | The Queue's workstream band folds `workstream=` and `impact=`; areas and substreams not yet                        |
| Seat (session) | The tags of the row its run belongs to; that row's `run=` says where the run journal stands.        | Not yet                                                                                                            |
| Published page | The tags of the row whose run recorded it as an `artifact`.                                         | Not yet                                                                                                            |
| Pull request   | The tags of every row whose `pr=` names it.                                                         | Its Queue card inherits them; nothing else reads them yet                                                          |

A workstream has no register of its own, by design ([workstreams.md](workstreams.md)): it exists exactly while a row
carries its tag. So "a workstream tagged with the areas it covers" is to be gathered when it is read — tag the rows
`area=`, and a workstream covers every area its rows do. Nothing stores the aggregate, so nothing can disagree with it.

A **substream** is one milestone of a workstream. Its name starts with its workstream's, as in
`iso-certification-policy-acceptance`, and a row tagged with one is tagged with its parent `workstream=` too. Both are
conventions the tagging seat keeps, not checked rules: the registry validates the kebab shape only, so a write can
set a substream with no workstream beside it.

`run=` is the run journal's lifecycle and never a claim that a seat is alive. An open cycle outlives a session that
died holding it. `handover reap` marks it orphaned only when it can prove that session dead, and it cannot for a Codex
writer, so such a cycle stays `open`.

## The keys

| Key                 | Source   | Holds   | Values                                                                                               |
| ------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `platform`          | declared | one     | slack · linear · github · gmail · notion · calendar · drive · vanta · none                           |
| `audience`          | declared | one     | the owner (the first value `src/handover/rowTags.ts` allows) · team · person · channel               |
| `workstream`        | declared | several | a kebab-case name; a new one needs `--new-value`                                                     |
| `substream`         | declared | several | a kebab-case milestone, prefixed with its workstream; a new one needs the flag                       |
| `area`              | declared | several | a kebab-case area (security, platform, …); a new one needs the flag                                  |
| `impact`            | declared | one     | critical · high · medium · low                                                                       |
| `controls-resolved` | declared | one     | a whole number of failing compliance controls the row's act resolves                                 |
| `effort`            | declared | one     | xs · s · m · l · xl, Linear's t-shirt estimate                                                       |
| `pr`                | declared | several | `owner/repo#N`                                                                                       |
| `preapproved`       | declared | one     | cassette-recording                                                                                   |
| `steer-hatch`       | declared | several | vulnerability-fix-topup-gate, journalled by `vulnerability-fix topup --steer-row` on the steered row |
| `needs`             | declared | several | an integration (`src/handover/integrationNeeds.ts`); none of its credentials stored holds the row    |
| `kind`              | derived  | one     | doc · ask · tag                                                                                      |
| `priority`          | derived  | one     | p0 · p1 · p2 · p3                                                                                    |
| `reply`             | derived  | one     | drafted · none                                                                                       |
| `origin`            | derived  | one     | finding                                                                                              |
| `repo`              | derived  | one     | the checkout's directory name                                                                        |
| `run`               | derived  | one     | open · waiting · orphaned · ended · none                                                             |

`run=` reads the run disposition: `none` never started, `open` an unclosed cycle, `waiting` parked on the owner,
`orphaned` its session died holding it, `ended` finished, closed or abandoned. An unreadable journal derives no
`run=` and no `reply=` rather than a guess.

## What is not there yet

Tags are written (`handover tag`, `register --tag`) and published on `list --json` and `row --json`, and `list --tag`
filters by them; the Queue's `?tag=` filter reads them off its cards. The per-resource readers for seats, pages and pull requests land as their
own pull requests, and this page grows with each.
