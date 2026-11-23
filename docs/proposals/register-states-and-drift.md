# The register — a place to track proposals, not just publish them

Part of [The golden proposal, as a form](../proposals.md).

Publishing one proposal is [the loop above](../proposals.md#the-loop). Tracking ten of them — which are still strawmen, which were
decided, which superseded which, and by whom — is a different question, and it is answered by a SIBLING
domain: one append-only event journal per proposal under `$SLOPWEAVER_HOME/proposals/register/<slug>.jsonl`,
folded into current state on read. It mirrors `src/handover/ledger.ts`'s own typed-event-plus-fold shape
rather than a mutable snapshot, because a decision, a supersession and a Slack announcement are all facts
about a MOMENT — a snapshot would either discard the reason a status changed or reinvent an embedded history
array to keep it.

```bash
slopweaver proposal list [--status <s>]                                  # every tracked proposal
slopweaver proposal show <slug> [--history]                              # its folded state, and the sequence behind it
slopweaver proposal status <slug> <strawman|shared|discussed|partially-implemented|implemented|withdrawn> --why "<reason>" [--date <iso>]
slopweaver proposal decide <slug> --decision "<text>" --decider "<name>" --why "<reason>" [--outcome approved|rejected] [--date <iso>]
slopweaver proposal supersede <slug> --by <slug-or-url> --why "<reason>" [--date <iso>]
slopweaver proposal audience <slug> --audience "<who this is addressed to>"
slopweaver proposal record-slack <slug> --permalink <url>
slopweaver proposal follow-up <slug> --ref <handover-doc|linear-ticket|pr-url> [--label "<text>"] [--date <iso>]
slopweaver proposal record-feedback <slug> --kind <pushback|acknowledgement|support|question> --who "<name>" --what "<text>" [--where <permalink>] [--date <iso>]
slopweaver proposal answer-feedback <slug> --id <fN> --how "<what was done>"
slopweaver proposal feedback [--slug <s>] [--kind <k>] [--unanswered]    # what people said, pushback first
slopweaver proposal drift [--slug <s>]                                   # whose page does not say where it ended up
slopweaver proposal sync --source <notion-page-id-or-url>[,<id-or-url>,...]
```

## Nine states, and the one that is derived

The states come from backfilling the owner's real proposals. The owner's own list: strawman/open,
approved-not-started, partially implemented, implemented, superseded, rejected, stale — plus, separately,
that the owner liked `shared / discussed / decided` as, in the owner's words, a ledger showing what decisions
were made, with whom, when and why.

| Status                  | What it means                                                                    |
| ----------------------- | -------------------------------------------------------------------------------- |
| `strawman`              | Written so it can be picked apart. Nobody outside has seen it. The default.      |
| `shared`                | A wider group has actually seen it.                                              |
| `discussed`             | People engaged with it.                                                          |
| `decided`               | Approved, and nothing has started yet — the owner's own approved-not-started.    |
| `partially-implemented` | Some of it landed; some has not.                                                 |
| `implemented`           | It landed end to end.                                                            |
| `rejected`              | The group said no.                                                               |
| `superseded`            | Something else replaced it.                                                      |
| `withdrawn`             | The author pulled it — which is not the group refusing it, so both states exist. |

`decided` keeps its name rather than becoming `approved-not-started` because the decision LEDGER is what the owner
asked the register to hold, so the status that says a decision happened should say so; the folded `decision`
carries who, what, when and the outcome.

**`stale` is deliberately NOT one of them**, and that is the same lesson `docs/constraints/coupled-claims.md` records for
`blocked`/`blockedBy`: a state that can be both declared and derived will disagree with itself, with nothing
to say which side is right. What the owner described as stale is two different questions, and each has its own query:

- a doc that never got updated to say where the proposal ended up → `proposal drift`;
- feedback nobody answered → `proposal feedback --unanswered`.

**The atomic-event invariant covers three statuses.** `decided`, `rejected` and `superseded` are reachable
only through `proposal decide`/`proposal supersede`, each recording its extra fields in the same event as the
status. `proposal status` sets the other six and always requires `--why`. Reopening is allowed and the record
of what happened stays.

A rejection is NOT a second event kind. It is an `outcome` on the one `decided` event, because a rejection is
a decision — same decider, same date, same reason — and duplicating those three fields into a parallel event
is how two shapes start to drift. A `decided` line with no `outcome` decodes as `approved`.

## `proposal drift` — two timestamps, no model

The register stores where a proposal lives as a provider-tagged address (`{ provider, id, url? }`), and each
provider answers from the clock it actually keeps:

- **Notion page** — the page's `last_edited_time`.
- **Linear document** — the document's `updatedAt`, read by id through the same read the `linear document` door
  checks its writes with (`linear read` does not expose that field).
- **Local page** — the instant of its newest freeze. A local page's one writer is `page publish`, which freezes
  every version it writes, so the newest freeze is the last edit slopweaver made; a hand edit to the file is not
  seen, the same edge the page door's own freeze-and-diff model has. The page must still be a readable file on disk: its freezes
  outlive it, and a deleted page read off them would look fresh.

One client per provider serves a whole scan, so a provider's rate scheduler paces every read. So:

> a proposal whose newest MATERIAL event happened after its page was last edited is drifted.

**Material** means an event a reader of the page would need to see and cannot: the decision or rejection, the
supersession, the withdrawal, the moves to partially-implemented or implemented, and the follow-ups the
proposal spawned. It excludes `created` and `destination-linked` (the page trivially knows those), `slack-linked` and
the feedback events (those live in Slack, and nobody expects a proposal doc to carry them), `audience-set`,
and the `shared`/`discussed` moves — announcing a doc is not a change to it. A wider set would flag every
entry the moment it was registered, and a check that always fires is a check nobody reads.

Three things it deliberately does not claim, each of which would otherwise be a quiet lie:

- **A clean result is the ABSENCE of evidence.** Any edit advances the destination's clock, so an edit after the
  decision does not establish that the edit was about the decision. The clean arm is called
  `no-drift-evidence`, not `current`.
- **Occurrence time, not append time.** Every event records when the CLI wrote it; a backfill of July's facts
  in August files them all under August, which against a July page edit reads as drift that is not there. So
  a decision is timestamped by its `decidedIso`, `status`/`supersede`/`follow-up`/`record-feedback` take
  `--date`, and a report says whether the timestamp it used is when the thing happened or only when it was
  written down. An event with no occurrence date falls back to append time and says so.
- **An unreadable timestamp, a missing or trashed page or document, a missing token, a local page deleted or never
  frozen, or an undecodable journal line is `unassessable`,** never folded into a clean result. A page the provider cannot
  return reported as "no drift" is a silent degrade wearing a green tick.

It reads each destination and writes nothing at all, which is why it is `external-read` rather than the
`local-state` `sync` carries. Finding drift is the verb working, so it exits non-zero the way a blocking `lint`
finding does, and so does a scan with any `unassessable` row: a proposal it could not see has not been found
clean.
