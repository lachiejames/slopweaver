# The push lane — one banner, on arrival, never on age

`slopweaver hand push` is safe to run on a schedule, and that is the whole design.

## The rule that decides whether the owner keeps it switched on

A notification goes out when the outstanding set has GAINED a member since the last recorded pass, and at no
other time. Not on persistence, not on departure, and **never on age**: there is no clock read anywhere in
`src/hand/push/select.ts`.

That is the owner's ruling that a wait on a person is a STATE and not a countdown, made mechanical. A lane that
re-pinged every fifteen minutes about a sign-in the owner already knows about is one the owner switches off, and switching
it off takes the sign-in case with it.

| What the pass sees          | Sends | Records | Why                                                               |
| --------------------------- | ----- | ------- | ----------------------------------------------------------------- |
| a member arrived            | yes   | yes     | the only reason a banner is ever posted                           |
| the same set again          | no    | no      | the owner already knows; recording nothing keeps the ledger small |
| a member departed           | no    | yes     | so the same subject can push again if it comes back               |
| nothing, and nothing before | no    | no      | nothing is waiting on the owner                                   |

**Recording a departure matters as much as recording an arrival**, and it is the half that is easy to miss:
if only sends were recorded, a step the owner cleared would stay in the "already pushed" set forever, and the same
step posted again next week would arrive silently.

**A snoozed step is not outstanding while its snooze holds** (`src/cli/commands/hand/push.ts` filters it out
before the selection): the owner chose when it comes back, so it departs, and when the snooze lapses it ARRIVES again —
an arrival, not an age. The one clock read is that filter's; `select.ts` still reads none. The note itself comes
back through `hand wake` ([snoozing](snoozing.md)).

An absent ledger is an empty set, so the first pass on a fresh install pushes everything outstanding exactly
once. A ledger that is present but UNREADABLE refuses, because treating it as empty would re-push everything
the owner has already been told about.

## Both of the owner's cases are local reads

The blocked sign-in comes off the ask-lifecycle log that `turn block` writes — every ask standing `waiting`
on the owner whose need is not `other`. A `ready-to-resume` row is deliberately not a subject: the owner has already done
that one, and what is owed is a re-dispatch by a session.

"These PRs are ready, pick code owners" arrives as a **posted hand step**, not as a second GitHub ranking.
The session that got the pull request ready already knows: under rule 10 it cleared the CI, the threads and
the conflicts itself and then met the one thing it cannot do. Re-deriving that here would be a second ranking
to keep in step with `src/pane/sections/prStatus.ts`'s, over the network, inside a notification lane — and
the first time the two disagreed the owner would get pinged about a pull request that was not actually ready.

## The banner REFUSES rather than truncating

Rule 7: shape is enforced by the SCHEMA, never by review. Title 40, subtitle 60, body 120. macOS clips a long
line silently and with no ellipsis, so an over-long line arrives as a sentence that stops — which is the
failure the rule names. `buildPushNotice` refuses instead, and a headline the register already capped is
CUT at a word boundary, which is a different operation and the only place cutting happens.

Three arrivals are one banner naming the top one and the count, never three banners. The top one is the
first by the one ranking every surface shares (`src/waiting/rank.ts`): a colleague's blocked work, then the
fleet's, then a check-in — so a Slack ask outranks a dogfood step that arrived beside it. A banner ranks by tier
alone; only the Queue and its voice lift the owner's focus workstream in behind the owner's PR reviews (`site/lib/queueFocus.ts`). The detail is in the
floating note and in the register, which is progressive disclosure on a surface with room for one line.

**The note is raised BEFORE the banner is written**, so the banner can say where the step went: "The note is on
screen, top right" when it launched or kept one — in front of any other step's note already up, which stays —
and "It is in the menu bar list" when the raise failed. A banner promising a note that is not there is the lie
this orders out. The residue: a launch reports before its window draws, so a note that dies drawing still read as
on screen; its step stays open, in the menu bar list.

## Stated residue

A notification posted through `osascript` carries the script runner's own notification identity. If banners
are switched off for it in System Settings the lane is silent, and there is nothing in the code that can tell
— the call still succeeds. That is a limit of the surface rather than a bug waiting to be found.
