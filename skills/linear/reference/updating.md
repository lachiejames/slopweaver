# `update` means replace, and that is a real constraint

Why a body-replacing update is complete-shaped rather than patch-shaped, what `--fields-only` is outside of,
the three states `assignee`, `cycleId`, `parentId`, `projectId` and `estimate` each have, and the retired-team refusal.

Linear's update is patch-shaped; this form is complete-shaped. The stored markdown cannot be turned back
into a form, so `update` can only mean **replace the description from an authoritative form you supply** —
never "recover the issue and edit one field". Handing it a stale form would silently overwrite whatever
someone changed in between.

Two guards follow from that, and **both are about PROSE rather than about the ticket.** A body-replacing
`update` touches only issues slopweaver created, proved by a local ledger because a personal API key
attributes every write to _you_ rather than to an app — and it refuses when the description has changed
since slopweaver last wrote it.

`--fields-only` is outside both, deliberately (owner ruling). It sends neither `description`
nor `title`, so it provably cannot reach a word anybody wrote, and it works on **any** issue — including the
hand-filed ones nobody's ledger has ever heard of, which is what a cycle-hygiene close list is made of. What
it changes is state, priority, estimate, project, labels, **cycle** and assignee: the structured metadata
every teammate already edits from the Linear UI. A field the request never sends is a field it cannot clobber, and
**the title is one of the fields it never sends** — the form is complete-shaped, so its `title` is whatever
you happened to author, and sending it while moving a state would rename the ticket silently. To rename, use
a full update.

### `null` clears a field; omitting it leaves the field alone

`assignee`, `cycleId`, `parentId`, `projectId` and `estimate` each have THREE states, and the two that look
alike are opposite instructions (`"parentId": null` takes the issue out from under its parent):

| The form says       | What the write does                                             |
| ------------------- | --------------------------------------------------------------- |
| the field is absent | leaves it exactly as it is                                      |
| `"cycleId": null`   | takes the issue OUT of whatever cycle it is in                  |
| `"assignee": null`  | clears the assignee, handing it back to the team                |
| `"projectId": null` | DETACHES the issue from its project, without touching the issue |
| `"estimate": null`  | clears the estimate                                             |
| a value             | sets it                                                         |

A detach is how an issue wrongly attached to a project comes back out of it: never cancel, archive or delete
the issue to get it out of a project it did not belong in.

This exists because "move it to the backlog" means three things to a human — a Backlog state, out of the
cycle, off your name — and a verb that could only ever SET an assignee could assign a ticket and never hand
it back. A `null` assignee never touches the roster at all: there is no key to resolve when the instruction
is "clear it", and the membership gate has nobody to check.

The dry run names both in words (`(REMOVED — …)`, `(CLEARED — …)`) rather than showing a blank, because
CLEARED and UNSET look identical in a preview and do opposite things.

The read-back still runs on both paths, so an update against an issue that does not exist is refused either
way.

## Taken unasked: Linear as a mirror of Acme work

Rule 10 covers Linear ([why](../../../docs/doctrine-rationale/rule-10.md)): an edit that
makes Linear say what is true about **Acme** work is taken rather than carded, and Slopweaver's own tooling
never enters Linear at all. Three flags carry it.

- **`--unasked --why <text> --said <text> --by-session <text>`** marks the write as one nobody asked for. Before
  anything is sent it refuses a closure (a `stateId` whose catalog type is `completed`, `canceled` or `duplicate`), any
  assignee change, set or cleared, and a body that mentions someone — each reaches a person, so each waits on
  the owner's word. The three accounts are checked against the ledger's own rules first, so a `said` it would refuse
  stops the write rather than orphaning it. After the write, one row lands in the autonomy ledger: kind
  `linear-issue-create`, `linear-fields-update`, `linear-issue-update` or `linear-body-rewrite` (with
  `-unconfirmed` when the outcome is unknown), subject the issue URL, witness naming the issue's Linear activity
  history as its rollback. Never record it again by hand.
- **`--rewrite-filed --expect-updated-at <iso>`** replaces the body of a ticket a PERSON filed, which the
  ownership ledger otherwise refuses. Read the issue first (`linear read <key> --json`), take its `updatedAt`,
  and pass it: any edit since moves that instant and the write refuses. Update-only, and never with
  `--fields-only`.
- **`--move-team`** sends the form's `teamId`, moving the issue to that team; without it an update never moves
  a team. The dry run says `(MOVED here — --move-team)` beside the team. A workflow state and a cycle belong to
  a team, so a move names the destination's `stateId` (from `linear states --team <dest>`), `"cycleId": null`,
  and the `labelIds` to keep.

## Moving a named set of issues: `linear move-issues`

`slopweaver linear move-issues --to <key> --identifier <KEY-1,KEY-2,...>` previews a batch move and writes
nothing; `--apply` performs it. Each move IS `linear issue update --fields-only --move-team`, called
in-process, so every gate above still applies to it. The issue keeps its title, body, assignee, parent and
estimate; its state maps by exact NAME, and only to a state of the same type; it leaves its cycle and its
labels. Refused per issue, every reason listed: in a project, carrying any label, assigned to anyone but the
token's user, archived, already there, a parent with children in its own team (Linear moves those along with
it), no single destination state of that name, or one of another type (a started child landing `completed` can
auto-close its parent). `--apply` moves only a plan with no refusal, records the destination's states as the
door's evidence first, writes in order and stops at the first failure or throw, reporting each row `landed`,
`failed` or `not attempted`. Exit 0 all would move, 3 none would, 1 some refused or a write failed. Re-run
after a batch: the plan is a preflight, not a transaction, and a moved issue no longer answers to its old
identifier.

## A team the install retired is refused

`$SLOPWEAVER_HOME/linear-retired-teams.json` lists the teams the fleet no longer files into, each with its id,
key, the team to file into instead, and why: `{ "teams": [{ "teamId", "teamKey", "fileInstead", "why" }] }`. An
issue create, an issue `--move-team`, and a `linear project create|update` whose `teamIds` names a listed team
are refused before the door, and the refusal names the team to use. An absent file retires nothing; a present
one that will not parse, or is not a regular file (a symlink included), refuses every such write rather than reading as empty, and only fixing the file clears
that. The one way past a listed team is the journalled
`retired-linear-team` grant (`slopweaver hatch open retired-linear-team --reason …`), for a filing the owner asked
to land in that team. It exists because the owner left SUP and the fleet kept filing there, copying the last
batch's tickets: nothing chose SUP, and nothing said no.

When a response is lost, an update that sent any field, a parent or a team move reports indeterminate rather
than landed, because the read-back sees only the body and the title.
