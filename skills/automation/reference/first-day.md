# A scheduled post's first day

A scheduled post's first firing in a channel says what it is, and tags nobody. A channel member's first sight of
it answers the question of what this is and whether it now posts every day: a few lines saying it is a trial,
how often it posts, that feedback is wanted, and that it gets turned off if it is useless.

## Who writes the intro, per kind

- **`alert-summary` and `datadog-alert-digest` rows do it themselves.** Until a run of the row has SUCCEEDED
  — `firstSucceededIso` in `definition-runs.json`, not merely a run record, because a door-refused or
  dead firing is stamped too — `automation run-due` passes the read leg `--intro`. The lines are the
  row's own `params.intro` (one to four), or, with none, lines derived from its cadence alone
  (`src/live/automation/firstFiring.ts`). Neither card kind can mention anyone.
- **An `investigate` row is answered by a session, so the session does it.** The answer form has no `intro`
  field, so on the row's first answer its `lead` says the same four things. It tags nobody but the owner, who
  approved being tagged on the daily ISO post.
- **A `verb-run` row's verb composes its own card**, so it sets the card form's `intro` on its own first post.

## Why a row's own intro is checked when the row is PLANNED

Every bound the card puts on an intro line — the count, the width in UTF-16 units, no line break, no raw link
or mention, no `[n]` marker, no ticket-shaped id, and the packing rules — is also in `introSchema`
(`src/outbound/artifact/introAndRank.ts`), which the row's params and the `--intro` flag both parse.

That symmetry is the whole point. A line refused at the POST leg is refused at EVERY firing, because the row
never exits 0, so nothing records a success, so the day-one intro is attached again next time. One bad line
would strand the row forever rather than cost it one day. For the same reason the derived intro names the
channel rather than the row's label: a label is free text, and a colon or a ticket id in one would be
inherited by every firing.

**An `investigate` row's `question` is the same class, and it is checked the same way.** It is posted
verbatim as the `lead` of a no-fold message, so the packing rules judge it exactly as they judge an intro
line. MEASURED: `compliance-daily-standup`'s question
carried a 34-word sentence and a colon-introduced list, so `slack post --as bot` exited 2 on every attempt
and `C0SYN000001` went two days with no daily post, behind an `ASK FAILED · slack post --as bot exited 2`
line naming neither the rule nor the sentence. `planInvestigate` (`src/live/automation/investigate.ts`) runs
`aboveFoldFindings` over the cells the door itself builds (`noFoldAboveFoldCells`, so the `trailing` run is
in scope) and refuses `VOICE_REFUSED`, naming the recipe, every finding and the file to edit.
`slopweaver hatch open voice-rules --reason "<why>"`, then `slopweaver automation run-due`, lifts it, exactly as the same hatch lifts the
same refusal at the door — `automation run-due` IS the invocation somebody types to force one firing, and a
refusal whose own escape does not work is the wedge `.claude/rules/error-handling.md` exists to avoid. With
the hatch honoured in both legs, the plan-time check is a strict subset of the door's.

**`automation due` runs the same checks on every read, before the slot fires.** The rows are state, so no test
can see a registered question; `unaskableInvestigateRows` puts every enabled `investigate` row through the
params parse, the 500-char prompt cap and the packing rules (hatch closed) and prints `automation due · UNASKABLE ·`
with the refusal and the file to edit. MEASURED: `datadog-regression-hunt-daily` grew to 769
characters and was refused only when its slot fired; its first rewrite fit the cap and still packed a colon list.

The residue, stated rather than discovered: the operator's PRIVATE exact voice rules and the measured length
register cannot run in a pure check, so an em dash in a row's own intro line or question is still caught only
at the post leg; a day-one post that lands just before its process dies is introduced again; and a row whose
channel is edited does not re-introduce itself in the new channel.

## The shape above the fold

Up to ten lines — a headline plus nine — as a colour-coded ranked list (`indexStyle: "ordered"`, every line
opening with 🔴 🟠 🟡 or 🟢), with the extras below the fold. The field-by-field contract is
[the card form](../../slack/reference/the-card-form.md).

## A `verb-run` row has no intro leg, so its verb carries its own

`firstFiringIntro` reaches a verb through `--intro`, which `live/automation/alertSummary.ts` and
`live/automation/datadogAlertDigest.ts` both pass. **`live/automation/verbRun.ts` passes nothing** — it runs a row's
`params.argv` verbatim, by design, so a posting `verb-run` row cannot be introduced from the recipe side at
all. A posting verb derives its own, from a record it appends ONLY after its send exits 0 — the same "has
this row ever delivered" property `firstSucceededIso` measures, read where the verb can actually see it.
Giving `verb-run` a real intro leg is the general fix and is still owed; a second verb reaching for this
pattern is the signal to build it rather than to copy the derivation.
