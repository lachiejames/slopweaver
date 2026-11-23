# Turn mechanics — the cases inside a turn, not at the address

Five things that go wrong (or need care) once a tag is already admitted and a turn is running: costing a
proposal before checking it exists, reading a capability contract without clobbering the live brief, a
message an old turn left wearing two reactions, a second card an ended ask left standing, and a grounding-id
refusal that is not terminal.

## A proposal-shaped ask — check before you cost it

An ask that proposes creating, adopting or standing something up ("should we…", "what would standing this up
cost") ASSUMES the thing does not exist yet. That assumption is the first present-state claim your answer
rests on, and every cost, risk and day-one bullet under it is void if the thing is already there.

The only answer of the tagging dogfood the owner marked BAD: the bot costed a repository holding
102 pull requests, from inside a checkout whose own `git remote -v` names that repository. Its decision was
well-formed — `truthMode: "current"`, two live legs — and both legs were `catalog` (what this build can do)
and `audit` (what is in the local corpus). Neither could ever have answered "does it exist". The contradicting
evidence was one search through the door away.

So, when `turn brief` tells you the ask proposes something:

- your decision must name at least one **REQUIRED provider/repository/atlas**-class leg — one that reads the
  world outside this process. `turn dispatch` refuses a decision without one, quoting the wording that
  tripped it. Optional does not count: the incident's own second leg was optional.
- your answer's evidence must carry a **`premiseChecks`** entry: `subject`, `finding`
  (`exists`/`absent`/`inconclusive`), `how`, and `checkedAtIso`. `turn answer` refuses a proposal answer with
  none, whichever way it is grounded — including `conversation`. It renders above the rest of the trail, as
  "What I checked before answering", because it is what the rest of the answer rests on.

`inconclusive` is a real finding, not a hedge: a check that could not settle it is worth stating, and stating
it is what stops the premise being assumed by default.

## Reading a capability contract without clobbering the brief

`turn brief` is the only place a capability's contract — what it covers, its freshness, the command it runs
— is printed, and a full brief is a write: it overwrites the ask's brief file at its default path. MEASURED
DATA LOSS: a session re-ran `turn brief` with a throwaway `--text` on an ask that already had
a started turn, purely to read two capabilities' contracts, and silently destroyed the live turn's own
pinned question and evidence. Two guards, both in `turn brief`:

- **`turn brief --contracts --text "<question>"` is the read-only door.** It prints the exact same
  capability lines a full brief carries and writes NOTHING — no brief file, no lifecycle row. No
  `--channel`/`--message-ts`/`--user`/etc. is needed; only `--text`, since a capability's materialised
  command can depend on the question. Reach for this whenever you want to check what a capability does,
  never a throwaway full brief.
- **A plain `turn brief` REFUSES to overwrite a brief whose ask already has a started turn**, unless
  `--force` is passed explicitly. This is defence in depth for the case above: even a session that forgets
  `--contracts` and reaches for a real brief cannot silently clobber one already in flight.

## A message an OLD turn left wearing two reactions

Every automatic path converges the tag, but an ask that is already TERMINAL never runs over one again — so a
message left wearing a contradictory pair (a failed attempt's warning beside its retry's completion emoji,
or a stale hourglass) stays wrong forever, and no terminal, sweep or ignore will come back for it.

`slopweaver turn settle-reaction --channel <id> --message-ts <ts> --to completion|stopped|acknowledged|for-a-human` is
the by-hand correction. It rides the same convergence every live caller uses — the whole lifecycle set is
retired before your ending is added — so a human's own `:tada:` is never touched, and repeating it for the
same ask and ending is a no-op. `--message-ts` is the addressing message's OWN ts, exactly as every other
turn verb keys on.

**Which of the four endings.** `completion` means it was answered. `stopped` means it ended with no answer
and someone should look. `acknowledged` (`:ack:`) means it was read and judged and no reply was owed — the
outcome the other two both misreport, since the tick claims an answer that never happened and the warning
reads as an error that never happened. `for-a-human` (`:for-a-human:`, `profile.json`
`slackBot.forAHumanReaction`) means it was read and judged, a reply IS owed, and the bot deliberately left it
for a person to give — never `:ack:`, which would tell the asker nothing is coming. A `no-response` or
`for-a-human` decision settles to its own ending on its own; you only reach for this verb when one of those
reported a reaction it could not settle, and the judgement itself still stands. So it REFUSES swapping one
judged ending for the other — `--to acknowledged` on an ask left for a person, or `--to for-a-human` on a
triaged one — behind the `judged-ending-swap` hatch (`SLOPWEAVER_ALLOW_JUDGED_ENDING_SWAP=1`), for a judgement
reviewed and found wrong.

It REFUSES an ask the listener never captured (exit 3), because putting a lifecycle reaction on a message
the bot never touched would be inventing a signal rather than correcting one. Reach for it only to correct
a message a real turn left wrong, never to decorate one.

## A second card an ended ask left standing

An ask can carry two progress cards: a second one posted over the first while it still stood. The lifecycle
names only the LATER one as the ask's card, so the sweep, the ticker and the terminal all settle that one,
and the earlier card stays mid-checklist. An answer reaps it; a triage, a hand-off to a person, a withheld
answer or a failed reap does not.

`slopweaver turn retire-card --channel <id> --message-ts <ts> --working-ts <card ts>` deletes that earlier
card, named EXACTLY — never read off the ask's current card, which is the one that is not orphaned. It
refuses, deleting nothing, unless the ask posted that card, it is not the ask's current card, the ask has a
terminal event other than `withheld` (the Queue may still release one) with nothing after it (a redelivered capture reopens the ask too), and no other unfinished ask
recorded the card; the refusal names which check failed (exit 3). A card Slack already reports gone exits 0. Not
`slack delete`, which checks only that the bot owns the message, never that the card is an orphan.

## A grounding-id refusal is not terminal

Measured live: a worker's full investigation grounded its answer on the `slack-read-thread`
verb — never a routable capability on any brief — and `turn resume --answer` wrote the same durable,
sweep-finalised FAILED marker a worker's own considered `--failed` give-up writes. The loop's sweep
finalised the ask before the worker had any chance to fix the one field and retry. `validateAnswerForDispatch`
(`src/live/turn/briefAnswerable.ts`) refuses a `"verb"` grounding whose `capability.id` is not one of the decision's own
`needs`; reading the thread has no capability id of its own, so it can never satisfy this check.

This refusal is decidable from the decision and the answer's own bytes alone, so `turn resume
--answer` refuses it WITHOUT writing the durable/printed FAILED marker — fix `answer.json`'s `grounding` and
re-run the exact same command. Only an explicit `--failed` is a real give-up. `turn resume` also prints
the decision's own `GROUNDING:` line next to the `DECISION:` line, listing exactly which `capability.id`
values a `"verb"` grounding may claim.

**"I read the thread" deliberately gets no grounding kind of its own.** A `grounding.kind: "thread"` naming
the thread's own `ts` as evidence was considered and rejected: `"conversation"` already exists for exactly
"context and judgement alone answer this" — reading the thread IS gathering that context — and it is already
refused when the decision named a `required` live need, which is the one case where thread-reading genuinely
cannot carry the claim on its own. A dedicated `"thread"` kind would let a worker claim the thread as evidence
for a live/factual assertion without ever touching the capability the decision actually required, which is the
exact failure grounding validation exists to prevent. Ground on `"verb"` naming the capability whose evidence
backs the claim, or on `"conversation"` when context and judgement genuinely are the whole answer.
