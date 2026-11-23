# Edge cases the loop must handle

Bundled reference for the `loop` skill. Loaded when the body links here, not on every turn.

## A DM from someone other than the owner — nudge toward a channel

A DM the owner personally sends is visible to the owner by construction — it is the owner's own conversation.
A DM from anyone ELSE is not: the owner cannot see it, cannot follow up in it, and cannot notice if it goes sideways. When the
surface is `dm` and the asker is not the owner, gently note in the reply that a shared channel would let
others (including the owner) see the question and the answer — never as a refusal or a scold, and never
instead of actually answering the question asked. This is judgement, composed in your own words each time,
the same way every other part of the answer is — not a fixed line inserted by a template.

## A tag from someone not on the responder whitelist

The whitelist is the tag decision tree's GATE (`src/live/listen/whitelist.ts`): **who may tag the bot and get
an answer at all**, nothing more. What happens to an ask past it is the tree's steps (b) to (d), printed in
every `turn brief` and `turn resume` (`src/live/turn/tagDecisionTree.ts`) — a general ruling of the owner's covers the
kind of ask (`general-rulings.json`), else the asker is on the trusted tier (`trusted-askers.json`), else `turn block --need ruling`
waits on the owner visibly in the thread.

The gate itself is not your job. It is deterministic, in code, and it runs before this stream ever hands you
anything: an unlisted tagger gets a fixed line through the door (never a message you compose) — **a wait, not
a refusal**: a line saying the owner has not made a general ruling on this yet and is being brought in to
approve this one. It tags
the owner when the profile holds a valid Slack user id for the owner (otherwise the same wait names no one), is logged loudly and is recorded in the door ledger. You will never see this tag as a mention. **If
you're reading this because someone says the bot "didn't respond," check the listener's log — the wait line
is already there, and the door ledger (`door_event`) recorded it.** The owner's approval is free-form, and it
reaches you as the owner's compound instruction below: add them, then answer their question. A past approval is
never a grant for a later ask.

The whitelist decides whether to act at all, AND whether the answer may be sent — the same list,
`responders.json`, gates both, with no owner carve-out, so a whitelisted non-owner is never admitted and then
left unanswered. If an asker on the whitelist cannot be vouched for some OTHER reason (a `ReplyJudgement` a
private repository supplies can add finer-grained conditions), it is withheld: the door files the
draft in `slopweaver queue list` with its reason, and a notice still goes to the thread, so nobody is left in
silence. An owner who is not themselves on `responders.json` gets no replies either — there is no carve-out,
by design.

## A compound owner instruction: "add X to the whitelist, then answer their question"

This is judgement, the same way tier is — never a keyword filter. An owner message that (a) names a person
and instructs adding them to the whitelist, AND (b) refers to answering a question of THEIRS already sitting
in the thread, is TWO steps disguised as one turn: an admin action, then a full second turn for the
referenced person's own message, attributed to THEM as the real asker. A bare "add X" with no reply
reference is an ordinary single admin action, not this.

This formalises a real live incident: a reply to a newly-whitelisted person only went through
because its brief had been hand-anchored to the OWNER's own later message instead of theirs, which
incidentally made `askedBy` resolve to the owner — an accidental bypass of the reply gate, not a real pass.
The steps below are that same move, done correctly and on purpose.

1. **Resolve the referenced person's Slack user id.** A `<@U…>` tag in the owner's own message is authoritative.
   Otherwise, use whatever live-read tools you already have — read the thread
   (`slopweaver slack read-thread <permalink> --json`), check the mention index / corpus for an exact-match
   identity — never invent or guess an id from a name alone. If you cannot resolve it with confidence, say so
   in your acknowledgement to the owner and stop — a wrong id added to the whitelist is a real security
   action, not a guess to shrug off.
2. **Perform the whitelist edit**: `slopweaver responders add --user <id> --reason "<why>"` — the reason is
   the owner's own instruction, restated in your words, not invented. The ONE write path for
   `responders.json`, never hand-edited; a running listener re-reads it per tag, so no restart is needed.
   `slopweaver responders list` prints who is on it, by id and name, before or after the edit.
3. **Find the referenced person's own message** this instruction is actually about — read the thread live and
   pick the exact message (their "latest question," or one explicitly named). Note its own `messageTs`.
4. **Run the FULL four steps for THAT message**, exactly as if it had just arrived on the stream:
   `turn brief --channel <theirs> --message-ts <theirs> --thread-ts <theirs> --user <their-id> --surface
<theirs> --text "<their own question text>" --rides <the owner's messageTs>`, judge, dispatch, then
   `turn answer ... --accounted-for-ts <the owner's own compound-instruction messageTs>`. That last flag
   matters: the owner's instruction is necessarily a LATER message in the same thread than the question it
   authorises answering, and the live thread-freshness check (`turn answer`'s own re-read right before
   posting) would otherwise refuse this answer as stale — refusing the very thing that authorised it. Naming
   the exact instruction message excludes ONLY that one message from the check; a genuinely new, unrelated
   message still correctly refuses. `--rides` rides the owner's card, never a second ([why](live-card.md)).

   **`--accounted-for-ts` takes a COMMA-SEPARATED LIST, not one ts**, and step 5 below is where that
   matters. The single-ts form above is the minimum this step needs, and reading it as the whole contract is
   how a real acknowledgement got refused (measured): by the time the owner's own message is
   acknowledged, the thread usually holds several later human messages — the owner's follow-up, and the referenced
   person's reply supplying the context that the answer was actually built on. Name **every** later human
   message this answer genuinely accounts for:
   `--accounted-for-ts 1787723767.154969,1787725626.249119`. The bot's own posts are excluded already, so
   they never need naming.

   This is not a way around the freshness gate, and the distinction is the whole point: name a message only
   because you READ it and the answer reflects it. A message you have not read still belongs in the check,
   and the refusal is the gate working. The refusal itself is helpful rather than opaque — it prints each
   unaccounted ts and its author, so the honest fix is to read those messages and decide whether the answer
   still holds, then name them.

   **On a moving thread, `--read-through` is the flag you want and this list is not.** `--accounted-for-ts`
   names messages one at a time, which is right for a compound instruction and wrong for a live incident:
   the boundary it leaves in place is the ADDRESSING message, so every reply since the ask counts as new
   forever and one omission refuses. `turn answer --read-through <ts>` moves the boundary to the point the
   answer actually read up to, so the delta is only what landed after that. Read every message in it, then
   add `--delta-cleared` when none of them touches a claim the answer makes: it posts with a door-composed
   one-line freshness note and costs no review round. `--delta-cleared` with no `--read-through` works too
   (the note then names the addressing message), so the route a refusal names is always one that posts.
   When one of them DOES touch a claim, that is not this flag — fix the claim and re-open review narrowed to it.

   **Every `--read-through` you pass is stated on the answer**, empty delta or not. No code can check what
   you read — the ceiling is only the thread's newest human message — so the claim goes in the room, and an
   over-claim is caught by the person whose message you skipped.

5. **Acknowledge the owner's own compound-instruction message too** — a short, honest line confirming the add
   and that their question is being answered now, composed in your own words each time, never a fixed
   template and never silence.

## A permanently-ignored ask never reaches you at all

`slopweaver turn ignore --channel <id> --message-ts <ts> --reason "<why>"` records "never reconsider this
exact message" — a SEPARATE, standing registry from a fresh `no-response` judgement (which records one
attempt, not a permanent suppression). Once recorded, the listener drops that exact ask before any capture
effect, and `turn brief`/`dispatch`/`resume`/`answer` all refuse it too, as defence in depth. Use it when the
owner says something like "don't ever ask me about that one again" — never for something you merely judged
`no-response` this one time. An ask ignored by mistake is reopened with the same flags plus `--remove`; it
settles nothing, and `listen recover` can surface the ask again once it is lifted.

**Ignoring an already-captured ask also SETTLES its indicators**, because ignoring is a terminal ending like
any other: the tagged message converges to the stopped reaction and the standing checklist card is finalised
with your `--reason` on it. An ask ignored before the listener ever captured it raised nothing, so that case
stays a purely local registry write. This is why the verb is `external-write` and door-routed rather than
`local-state`.

**A whole CONVERSATION can be permanently ignored too** — `slopweaver turn ignore-conversation --channel <id>
--reason "<why>"` names one channel rather than one message, checked at the SAME entrances. Use it when the
owner blacklists a whole DM or channel ("every tag in here is ignorable") rather than one message — 21
individual `turn ignore` calls never stops the NEXT tag; one conversation-level entry does. It settles every
already-captured, unresolved ask that channel currently has, and `--remove` lifts it; `--list` shows every
channel currently suppressed.

## Dropped tags — the WIDENED manual pass, deliberate, never on a timer

The scheduled sweep already catches most of what the sections above describe, on its own cadence. This is a
deliberately BROADER one-off the owner asks for by name — after a non-zero `abandoned-at-close` (a tag lost
when a connection closed mid-frame), or for tags that arrived while no listener process was running at all.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen recover --bot-user <the bot's USER id> \
  --channels <the channels it answers in> --discover-channels --since 3d
```

It skips anything already answered, too old, `wrong-place`, not addressed to it or permanently ignored, and
prints a `turn brief` command per survivor — run those as if they had just arrived on the stream.

**Widen with `--discover-channels`, NEVER by typing a longer `--channels`.** It ADDS the bot's own
`conversations.list` membership to what you typed; `--channels` says only where it may REPLY, so it widens no
audience and a survivor outside it returns `wrong-place`. A typed list cannot know a channel the bot joined
yesterday: the literal copied shift to shift never named `C0SYN000011` (`#acme-bugs`), a private
channel the bot IS a member of, so every pass was blind to it. `slopweaver atlas slack` answers the OWNER's
membership, not the bot's. The walk is REFUSED unless the token holds `channels:read`, `groups:read`, `im:read` and
`mpim:read`, since Slack filters it by scope and says nothing about what it dropped.

Do not stretch `--since` to weeks unasked: nobody wants replies to questions they resolved days ago.

**An empty `recoverable` is only good news when `completeness` says `complete`** — an unopened channel
yields no candidates, so a pass that skipped **most** of its channels read as clean. A partial pass
exits `1` and still prints its survivors: take them. [Coverage](manual-recovery-coverage.md).

## A second tag from someone already being answered

**What counts as a follow-up**: a reply into the SAME thread while that asker's earlier ask is still active,
or another top-level message in the same channel while it is. Either shape is one person adding to their own
question, and BOTH are judged, never parked: a queue of parked tags once held 34 behind asks that had already
ended.

**The brief is what tells you.** When the asker has anything in flight, their brief opens an `ALREADY IN
FLIGHT FOR THIS ASKER` section naming each ask and its state. Fold the follow-up into the running ask, answer
it on its own, or judge `no-response` with `"exclude": true`, which writes it to the permanent exclusion
registry with your rationale as the reason.

**"In flight" is what `activeAsks` says, and two exclusions matter.** A `lease-expired` ask still counts —
unfinished business nobody is currently doing, but a new tag must not double-work it. An ask NO SESSION
ROUTED stops counting past the sweep's own 30-minute bound, loop up or not (measured: two held the owner's
slots for 752 minutes), because `turn dispatch --sweep` would already have called it over.

**Never start a second worker on a thread one is already answering.** Measured: a follow-up
admitted beside a live worker produced a second answer claiming "the first attempt never got going, nothing
ran". The in-flight section exists so that is visible before the dispatch, not after the send.
