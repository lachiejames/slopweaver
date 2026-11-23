# An opened card's properties

Part of [the Queue](./queue-and-triage.md), in [The console, the board, and the session ledger](../console.md).

The properties a Linear issue shows — status, priority, workstream or project, and what is related — apply to a Queue
card too. So an opened card carries ONE properties section, label left and value right the way Linear's issue sidebar
does (`components/console/CardProperties.tsx`, model `site/lib/cardProperties.ts`). Every label earns its place: no
effort, no slug or internal id, no "Read from" command line, and no tag pills under it.

The section finds its rows through the ONE join the card's tags come through (`cardJoinOf`, `site/lib/queueCardTags.ts`,
listed per kind in [the tag filter](./queue-tag-filter.md)), so a property and the page's filter never disagree about
which rows a card belongs to.

| Line       | What it reads                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | An ask, its row's own status. Any other card, the state its record is in: a hand step waiting on the owner's hands, a held reply or parked post "parked for your yes", a review drafted, a pull request open or draft, an act done.                                                                                                |
| Priority   | The most urgent band of the rows it belongs to, and whether it was stated on the row or is the kind's default ([row priority](../../skills/handover/reference/row-priority.md)) — never naming the row by its slug.                                                                                                                |
| Workstream | Every `workstream=` tag the card inherits, as a citation by the workstream's NAME: hover for its progress (phase and percent, a linked count, or the day a closing one closed beside its state), click for its page. A spinner while the register reads, a staleness mark when it fails, and it says so when it holds no such one. |
| Tags       | A message card: who the message tags, one identity chip per person, stacked. An id the roster does not hold is listed as unresolved, never under a guessed name.                                                                                                                                                                   |
| In thread  | A message card: who is in the thread it lands in, from the same live reading its draft slot draws — a spinner while it loads, and a staleness mark whose hover says why when the thread could not be read.                                                                                                                         |
| Related    | The rows it belongs to other than its own, by their own words (question, else summary, else reason) as plain text with their status — never a board-row link, by the owner's ruling — what they are blocked by, and the pull requests their `prUrls` and `pr=` tags name as citations — each once.                                 |

**Every card has a status and a priority**; a line with nothing to say (no workstream, no related row, not a message)
is not drawn. A card on no board row takes its Queue tier's default — p0 for work a colleague waits on, p1 for work
blocking the fleet, p2 for a check-in — and says it is a default. While the board reads, a spinner sits under its
lines, and a staleness mark whose hover says why when the board read failed or did not wholly read — naming each
document or row's tags that did not — rather than drawing the card as belonging to no row. A slug naming several rows
is the data, not a failed read, so the section says that in words.

**The owner is never in the people lines.** Who the owner is comes off the first post sent as the owner; when no card
says, the section says that it could not, since the owner may then be listed among the people. A held bot reply records
no people of its own yet, and says so. Recording tagged ids, a complete thread roster and the owner's own member id on every producer is the
follow-up `queue-card-evidence-envelope`.
