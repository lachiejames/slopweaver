# A project UPDATE is not a project update

Two verbs whose names collide because Linear's own API collides, and the one required field that makes a
status report worth posting.

**Post early, and name the uncertainty** (a rule for every Linear write, not only this one): an
update that says "on track, but the backfill may slip a day — we will know Thursday" is worth more than a certain
one a week late. Pick the health the evidence supports now and say in the summary what would change it. The daily
[linear briefing](../../automation/reference/linear-briefing.md) proposes each overdue or overtaken update for the
owner's yes, with the issue comments and project descriptions the same rule covers.

Two different verbs, and the names are Linear's rather than a choice made here:

- **`linear project update`** EDITS the project — its name, dates, lead, description.
- **`linear project-update create`** posts a **status report** to it: the thing everyone watching the project
  is notified of, and the thing whose absence makes a project look abandoned.

Linear's own API has the same collision (`projectUpdate` is the project editor; `projectUpdateCreate` posts a
report), so renaming either here would put this surface at odds with every provider document you might check.

**`health` is required, and it is the field that matters.** `onTrack`, `atRisk`, `offTrack`, spelled as
Linear spells them. Linear leaves it optional and a report posted without one leaves the project reading
whatever it read before — which is the silent staleness the verb exists to end — so the form refuses to let
you skip it by accident. Mean "unchanged"? State the current value.

It is **create-only**, like a comment and for the same reason: everyone watching has already been notified,
so a correction is a NEW update, exactly as a human posts one in Linear's UI. The id is derived from the
project, the health and the rendered body, so the same report cannot be posted twice — and changing only the
health produces a new id, because the same words at a different health are a different report.

**An update answering a `cycle reconcile` proposal carries `fields.overdueSince`** — the proposal's own
`movedAtIso`. The id is then keyed by the project and that instant alone, never the body: a proposal's draft is
recomposed on every pass, so a body-keyed id let one overdue window be answered twice. With it, a second answer
to the same window is refused as a duplicate however it was reworded, and a real post moves the window.

A status update whose claims are ticket references gets those turned into real links by the bare-reference
gate, which is why this form leaves `evidence` optional where a comment requires it.

## The identical pair one layer up

`linear initiative update` EDITS an initiative; `linear initiative-update create` posts a status report to
one. Same collision, same provider names (`initiativeUpdate` versus `initiativeUpdateCreate`), same required
`health`, same create-only posture, and the same optional `evidence` for the same reason. The one difference
worth knowing is on the OBJECT rather than the report:
[initiatives-and-images.md](initiatives-and-images.md).
