---
paths:
  - "src/live/**"
---

# Working in `src/live/`

Reading the world as it is NOW, and running one bot turn over it. Scoped to this tree; the doctrine it
implements is `AGENTS.md` rules 2 and 3 — no headless model, and one door.

## The wrapper owns the claims, never the payload

`providerRead.ts` is deliberately smaller than a provider object schema. GitHub, Linear and Notion own their
payload shapes and change them independently; Slopweaver owns the claims AROUND those bytes — where they
came from, when they were read, what address was resolved, and what the read withheld. `data` stays
`unknown` so a generic wrapper cannot pretend to understand an object it only transports.

The document shape is wider than the shared reader on purpose. `ProviderReadSource` is the three sources the
SHARED reader serves; `ProviderReadDocumentSource` adds the Google doors — Gmail, Drive and Calendar — which
reuse the freshness, the bounded coverage and the residue without reusing the reader, because a mailbox is
addressed by query and by message id, a Drive by query and by file id, and an event by a calendar and an id
within it, rather than by object URL. `providerRead.ts`'s doc comment on the union says the same.

## A retrieved record is not the thing; go and read the thing

`recordReadPlan.ts` turns a pinned record into the sanctioned verb that reads the REAL object. For GitHub,
Linear and Notion it DELEGATES address parsing to each provider's own parser — the exact code that would do
the reading — because a second notion of a valid address would drift, and the drift surfaces as a plan
promising a read that fails. The other branches are not that shape and you should know which you are in:
Slack only tests the permalink for `/archives/`, so a malformed one still plans a read its own parser will
reject; Gmail and Calendar are addressed by `sourceId` rather than by URL and build their command directly.
Tightening one of those is a real improvement, not a doc fix. The owner's ruling this implements: the world
model is one tool in the toolkit, leaned on but never taken at face value.

## A turn is an ordering claim, so the effects are seams

`turn/run.ts` injects a poster and a query as plain function seams. A test passes fakes that record their
calls and asserts the exact sequence — no network, no clock, no `vi.fn`, which
[testing.md](testing.md) bans outright. The orderings are the contract: acknowledge before working, advance
before answering, and never claim a step finished before it did. In a DM, and only there because a channel
thread has no title row, the thread is NAMED before anything is posted into it. Some effects are survivable
and are carried in the outcome rather than ending the turn; `run.ts` says which, and that list is not
something to guess at. Transport belongs to the listener and is absent from the handler by design.

**The one IRREVERSIBLE effect runs last, and that placement is the contract.** A correction turn may declare
in its answer form that it supersedes an earlier answer of this bot's in the same thread; `turn/supersession/`
settles that after the replacement has posted and after every survivable courtesy effect, so nothing between
the answer landing and the delete can throw with the old answer already gone. It takes TWO declarations — the
composer's `supersedes` and the reviewer's own warrant on the verdict, which is why `runTurn` never carries the
verdict and the seam is built in `poster.ts` where both are already in hand. A failure there is a secondary
diagnostic, never a failed turn: by the time it runs the thread already holds the right answer.

**The second declaration only exists because the PACKET asks for it**, so `reviewVerdictSection.ts` renders the
deletion duty and a `supersession` in its example verdict whenever — and only whenever — the form declared one.
That half was missing once and nothing failed: the packet says "write EXACTLY this shape", every test of the
lane supplied the warrant itself, and a real reviewer following the packet left both answers standing. A
reviewer duty with no instruction in the generated packet is not a duty, whatever the code that reads it does.

**At most once is a property of the JOURNAL, not of how often the caller runs.** `turn/supersession/run.ts`
reads its own log back before writing an intent, and refuses `ALREADY_ATTEMPTED` when this exact
`(turnId, targetTs)` pair already has one. It is judged on the INTENT row and never on the result, because
an intent with no result is a session that died mid-delete — the case where trying again is least safe,
not most. Correlating on the turn alone would refuse a turn that legitimately supersedes a second message.

**Two things bound that guard, and both are its construction rather than an oversight.** It is a read then a
write with no lock between them, so it holds across SEQUENTIAL runs — the crash-and-redispatch case it exists
for, and the only one `runTurn` produces, since it awaits the seam once. Two processes driving the same
`turnId` at the same instant would both read before either wrote, and closing that needs a lock rather than a
better read. Second, a journal it cannot fully READ refuses on `JOURNAL_UNREADABLE` instead of reading as
empty, and that covers both halves of `store.ts`'s deliberate tolerance — a failed open, where only `ENOENT`
means a fresh install, and a LINE that will not parse, because the row it skipped may be the very intent it
came to find. An audit may read past a bad line and this guard may not. Two Codex passes found those halves
one at a time, one by chmod-ing the log to `0200` and the other by leaving a torn tail for the next append
to run into; each watched a second `chat.delete` go out. The append writes its own leading newline now, so
the torn tail costs one unreadable line rather than two.

The orderings are NUMBERED in `turn/run.ts`'s own header and each one has a module: `turnBegin.ts` 0 and 1,
`turnCursor.ts` 2, `turnQuery.ts` 1, `turnDelivery.ts` 3, `turnSettle.ts` 4, `turnWithheld.ts` 5. The LIST
stays in `run.ts` because an ordering is a relation between phases and no phase module can state one, and
each module points back at it rather than restating it — `unit/live/turn/turnLayers.test.ts` fails a module
that drifts, or copies the list, or imports back up the ladder. `unit/live/turn/run/*.test.ts` is still the
witness for the sequence itself, driving the real `runTurn` over every ending.

**One delivery result is deliberately NOT an ending, and the ladder carries it as an `Err`.** A door refusal
on WARN-tier findings alone means the same worker still holds the answer, so `turnDelivery.ts` returns
`AnswerSendRefusal` rather than settling anything, `turnSettle.ts` stops the status re-assert timer and
finalises no indicator, and `runTurn` folds no completion — it answers
`Result<TurnCompletion, AnswerSendRefusal>` for exactly this. A `hold` is still an ending, and so is a
WITHHOLD — warn-tier itself, so `posterAnswer.ts` matches its finding CODE before it asks about severity.
An answer whose rendered payload the wire guard would refuse is the same non-ending
(`ANSWER_FORM_UNSENDABLE`), checked BEFORE the door: thrown from the guard mid-send, it once read as a break
and posted a public failure card over a live worker.

## The bot's own threads are re-read later, and nothing new answers them

`listen/recoverOwnThreads.ts` registers every thread the bot posted into over the last 14 days, read off
`slack/placementJournal.ts` (the row each guarded post settles), into the recovery sweep's thread inventory with the
cursor AT the bot's FIRST message there, so a reply between two of its posts is never jumped, and never one
settled after the sweep's own clock. They sit beneath every other registration, so an existing cursor always wins. A
reply found there takes the sweep's existing candidate path and becomes an ask exactly as a live one would; a reply
that neither tags nor addresses the bot stays read and unanswered. That is the whole of it: a re-read feeds the ask
detection that already exists, never a second answering path (rule 2). An unreadable journal registers nothing and
says so on stderr. A sweep whose foreground spends the whole read ceiling still keeps two background reads, one per
lane (`recoverThreadPlan.ts`'s `backgroundBudget`), or a registered thread would never be read. Replay: `subprocess/replay/followupFindsStrandedReplySynthetic.test.ts`.

## A witnessed thread is a tap on the frames, never a second address path

`listen/witnessTap.ts` wraps `SocketConnection.frames()` at the `openConnection` seam and reads each frame
AFTER `consumeMentions` has pulled the next one, so the ack still goes first and `socket.ts` does not know it
exists. Three properties are the contract: the ADDRESS path wins any overlap (a message tagging this bot, or
one `parseMentionEvent` admits, starts the watch but is handed off by the address loop alone); the tap keeps
its OWN dedupe window and honours the listener's scope; and it runs under `--follow` only, because a one-shot
stdout must stay one object. A witness line is not an ask — it never touches the ask lifecycle, a card or a
reaction, and `src/live/witness/` journals how each one ended. A throwing witness handler is logged and
absorbed: the address path never dies for it. A person's tag of THIS bot opens an own watch the same way
(`ownThread` lines, no profile entry); the ONE way such a line becomes an ask is `witness help`, run by the
visible loop, which journals `helped` and then calls the SAME capture handler a tag does — never a second
capture path, and never from the listener.

**A stand-down is a journal row, never the snapshot.** `witness stand-down` reacts, then journals `stood-down`
in the witness journal, because the listener owns `witness-state.json` and overwrites it from memory; with no
`--message-ts` it journals a `thread-stood-down` row tied to no message and reacts on nothing. Every
reader asks `threadStandDown` (`src/live/witness/standDown.ts`): the tap after its gate admits a line (an
unreadable journal hands nothing off), `witness help` before any fact, `witness dispatch` under its lock (a
line handed off just before the row landed boots no worker), and `turn brief` for `stoodDown` (an
unreadable journal reads as never stood down, so one bad line cannot stop every tag). The address path is
untouched, so an explicit tag there is still answered.

## The no-op that is not a bug

A Slack tag arriving when no session is running is a no-op BY DESIGN. Never add queue consumption, a restart
or an automatic retry here, and never a card asking the owner to tag again.
