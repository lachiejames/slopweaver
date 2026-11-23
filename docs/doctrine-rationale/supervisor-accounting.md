# The supervisor accounts for every stuck chat

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The other half of [the fleet fills its own capacity](fleet-capacity.md), governing the same sweep contract. The
rule is
[`skills/supervisor/SKILL.md` § 7b](../../skills/supervisor/SKILL.md#7b-account-for-every-stuck-chat--before--7as-fill-step),
worked through in [`skills/supervisor/reference/stuck-chats.md`](../../skills/supervisor/reference/stuck-chats.md),
and it runs BEFORE § 7a's fill step on purpose: an idle fleet is cheaper than a stuck one.

**The supervisor keeps chats progressing and surfaces blockers to the owner.** The rule exists because the
owner went looking personally and found what the sweep had not said: several chats in one day left stuck on a
prompt or a blocker, none of them surfaced.

**The measured instance is why this is a rule and not a reminder.** A bot turn on a team-visible channel
wedged and was surfaced by nobody until the OWNER found it six hours later, in public, while the sweep
ran throughout. The sweep was not down. It read the fleet, filled capacity and republished the briefing, and
none of that required it to say anything about the wedged row, so it said nothing. **A tick that reports the
fleet without accounting for its stuck rows is indistinguishable from a tick that had none**, which is the
same failure shape § 7a had already fixed for an under-cap fleet — hence the same fix: name every row in the
narration, and treat silence about one you saw as the defect rather than the pause.

**This ask was dropped at intake, which is why it needed its own doc.** It arrived inside the voice dump that
produced § 7a — wake every five minutes or so, check on every session, and make sure each is progressing —
and only the capacity half became a board doc.
The half about sessions progressing was not refused, argued or deferred; it simply never became anything, and
the owner found out by asking whether fixes for it had landed. A dump carrying two asks needs two docs.

**The classification is three-way, not two-way, and that is what makes it actionable.** "Stuck" collapses two
things a supervisor owes opposite responses: a chat parked on a menu or a keypress is the supervisor's own to
answer, never the owner's, while a chat parked on a blocker only the owner can clear belongs in the react-now block that
same tick. Reading a row and calling it "stuck" without splitting those two is how a menu nobody pressed sat
for hours beside a blocker nobody escalated.

**The watch is not the list, and that is the half the first draft got wrong.** Written the same night, the
rule said to read every `needs-input`, `silent` and `idle` row `session watch` returns. The owner then found a
session parked on a Claude Code permission prompt in the cmux sidebar, which the watch had classified
`working`, after it had sat over an hour. The cause is coverage rather than misclassification. The watch was
then an INCREMENTAL drain with an empty fold per invocation, so an attention raised in one tick and never
answered was invisible to the next. Measured over `~/.cmuxterm/events.jsonl`, folded per workspace
across the six supervision hooks: 19 workspaces sat on an unanswered `agent.hook.Notification`, the oldest over
two hours old, while the same tick's watch reported five. The fold itself is sound — of 52 notifications, 33
were cleared by a real `UserPromptSubmit` and none by a non-human event. So the sidebar counts as evidence and
a `working` row is not proof of progress. There is no mechanical shortcut yet, since `cmux list --json` exposes
no permission-wait field at all, and that is filed as its own defect.

**The fix for that forgetting is what produced the opposite defect, and the pair is the actual lesson.**
Persisting the fold beside the cursor fixed the forgetting, so the paragraph above no longer describes the
code — it is the reason, not the behaviour. That change shipped no
eviction half, and there the two halves of one mechanism come apart: `foldSessionActivity` only ever SETS
keys, so no closed workspace is ever removed, and `applyEvent` clears `attentionSinceIso` only on an event
FOR that workspace, so a session that died holding a `Notification` is `needs-input` forever. `urgency()`
sorts `needs-input` first, so the corpses sort above every live row. MEASURED (repro: `slopweaver
session watch --idle-minutes 10 --json` joined to `slopweaver cmux list --json` on `workspaceId`): 411 rows,
385 unmapped, ZERO of those 385 live, 212 reading `needs-input` of which 7 were, and the first live row at
rank **163 of 411**. Six sessions were genuinely waiting on the owner, the oldest 920 minutes, and none was
above the fold.

**Generalise it as a class rather than as this verb's bug: a state flag cleared only by an event FOR its
subject can never be cleared once the subject dies, so making its fold durable without also bounding it
converts under-reporting into over-reporting — and the stale entries sort to the TOP, because "urgent" is
what sorts first.** The fix (the owner's pick of the options) is age as the discriminator rather than
deletion: an unmapped row stays reportable for an hour, which is the window in which `mapped: false` still
means what § "a row the watch cannot map" says it means, and older ones collapse into one counted line behind
`--include-stale`. A `mapped` row is never collapsed however quiet, and nothing is collapsed at all when the
cmux inventory read FAILED — that read returns `[]` on failure, which marks every row unmapped, so an age
test over it would blank the whole gauge on one socket hiccup.

**The same shape was then measured on a second surface, which is what makes it a class rather than a bug.** A
gauge reports on what entered its own view and is structurally blind to what never did. The watch folds from
a cursor and loses an unanswered attention. `slopweaver turn dispatch --sweep` enumerates only asks carrying
an ACTIVE dispatch, returning early when there is none, so an ask that was never dispatched reads as
zero-and-healthy. Measured by the loop the same night, the owner asked, got silence, re-tagged and got
silence again, while every gauge read clean and the re-tag was dropped too. Hence the rule's form: a card the
owner can see with no dispatched row behind it is a stuck chat whatever the gauges say, and a clean gauge is
never on its own evidence that nothing is stuck.

**A row the watch cannot map to a workspace is the sharpest case, so the rule names it.** It sorts to the top
as `needs-input` and renders as a bare id with no title and no cwd, so it is simultaneously the most urgent
signal `session watch` produces and the only one the supervisor cannot act on — which makes skipping it the
path of least resistance. The rule requires reporting it as unmappable instead; the verb-side fix is on the
board as `session-watch-row-unmappable-to-a-workspace`.
