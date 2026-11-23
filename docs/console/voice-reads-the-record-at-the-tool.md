# The Queue tools read the record at the tool

The counts the voice may say, and the corrections it makes when it says one wrong, are
[the voice holds to the record](voice-holds-to-the-record.md). This page is where the cards and figures those tools
answer from come from, and how long each call may wait for them.

## The record, read fresh at the tool

The owner approved reading the record and never the page's copy. `action_items`, `read_card`, `open_card`, `triage_next`, `triage_end` and a relay that also answers a card each read
the record first, before they answer (`readQueueRecord`, `site/components/voice/useQueueRecord.ts`). That is one fetch
of `/api/voice-record` (`site/lib/voiceRecordRead.ts`), which runs every live verb the Queue projects from on
the server, inside one foreground slot with a 17s deadline (`site/components/voice/freshVoiceRecord.ts`). Measured on
the owner's machine, 15 verbs: 13.0s on the server against 36.3s through the browser's 3 slots. Repro of the first:
`curl -s -o /dev/null -w '%{time_total}' localhost:3000/api/voice-record`. The server runs them as four processes at
once, never one child per verb (`VOICE_RECORD_GROUPS`, `site/lib/voiceRecordBatch.ts`): `board` and `review-drafts`
each as its own child, the rest as two `slopweaver console batch` processes. Fifteen children timed every source out
at machine load 28 to 66, because each paid its own Node boot, 20.7s of CPU between them against 4.95s for the same
verbs in one process. A batch runs only the read verbs on its witnessed list (`CONSOLE_BATCH_VERBS`,
`src/cli/commands/console/batchVerbs.ts`), each shown to print the same bytes there as on its own, since a verb
writing past the collector would land outside its line; `site/__tests__/unit/voiceRecordBatch.test.ts` pins every
batched read to that list. `review-drafts` runs alone because a batch refuses a verb declared external-write, and
`github review-draft` is, for its `post`. Each process is bounded by what is left of the server's 15s deadline when
it launches (`voiceRecordTimeLeftMs`, `voiceRecordVerb`), so every one is killed at the same instant and none
outlives the answer, and no page poll rides it. A killed batch is still read for the lines it
printed first, after at most `spawnVerb`'s 1s pipe drain, so the answer is back by 16s, inside the browser's 17s; a
verb it never reached is named as out of time. Every console child
starts in the launched pid itself, never under a tsx wrapper (`consoleChildEnv`, `site/lib/launcherQuiet.ts`), so
the kill reaches the verb on a checkout with no built CLI too. A verb that fails is
that register's own failed reading, so it is named unread, never read as empty. `read_card` and `open_card` name it
in a not-found refusal and beside a card they found, `triage_next` and `triage_end` beside a pass's summary
(`withRecordUnread`, `site/lib/voiceRecordQueue.ts`), and a relay's `also_answers` refusal in place of calling a card
gone (`alsoAnswersOf`, `site/lib/alsoAnsweredCards.ts`), and beside a relay that landed naming other cards, since
it stood on the read that found them current (`alsoAnsweredBy`). The autonomy acts are the Alignment page's cards, never an
action item, so only the card tools name them unread (`cardOnlyUnreadOf`). The steers the owner made on this
call are laid over that record, so a card the owner just moved is not shown back in its old place. A held steer
is judged against the fresh `talk steers` reading, so when that reading did not arrive its card stays collapsed
and the reading is named unread (`heldSteersUnreadOf`, `site/components/voice/recordReadings.ts`), never left out
as gone. The workstream priorities are named unread too, since without them the order said is tier order. A
settled card's refusal carries the same unread list as any other. The list is added after the answer was fitted, so
it is held to a 2 KiB budget of its own (`fitUnread`, `site/lib/unreadFit.ts`): reasons shortened visibly first, and
only past the shortest the trailing sources folded into one entry saying they were not named. A failed verb's reason
is its stderr, of any length, so the autonomy acts' row is held to that budget where it is made (`cardOnlyUnreadOf`)
and every refusal that words the list into a sentence (a missing or undrawn card, `also_answers`) speaks it through
`unreadClause`, under the same budget; a card key past 4 KiB, longer than any register mints, is refused
before a refusal can speak it back. A refused or skipped opening's reason, a seam's own words, is held to 600
characters (`refusedOpening`, `skippedOpening`, `site/components/voice/openCardAnswer.ts`), so an act settled
mid-open, or a card the screen failed to draw, answers under the cap with its unread list beside it. A card's cap reserves
exactly that budget, so a long list never carries the answer past the page's tool cap to be refused whole, and so
does `triage_end`'s, its trailing rulings left off and counted past it (`fitTriageEnd`,
`site/components/voice/triageEndFit.ts`).

## The screen, checked against the record

The screen is still what the owner sees, so it is checked against the record rather than trusted
(`recordQueueAnswer`, `site/lib/voiceRecordQueue.ts`). In the desktop shell, the screen is the console window's
snapshot (`site/lib/queueScreenVoice.ts`). In a browser, it is the page's own readings. When the
record and the screen hold the same cards at the same tiers, `action_items` keeps the screen's order and figures.
When they differ, or the screen did not answer, every figure is unread and the `unread` entry names the difference.
For example, "the record holds X (team-blocked) and the screen does not". The screen is asked once the record has
arrived (`recordThenScreen`), since a page change during a 17s read would pair old counts with a new context.
`open_card` asks the screen again just before it moves the console (`undrawnNowWhy`), and a card that screen has not
drawn is read, said to be on the record but not drawn, and the console is not moved. One deadline covers the whole
tool: the 20s every read tool gets, set as the record read starts. Every deadline, in the page and the
`/api/voice-record` route alike, is read on the monotonic clock (`performance.now()`), so a wall clock set back never
stretches one. Each wait reads that clock again immediately before it starts (`byDeadline`, `screenAskChain`), so
the time a timer's setup takes never starts one past the deadline, and `byDeadline` re-arms its timer off that last
reading, so time lost before the timer was armed never stretches the wait. The record read ends 3s before it
(`QUEUE_SCREEN_RESERVE_MS`), and every screen ask after it, the one before a move included, gets only what is left
(`screenBy`). A screen ask still out at the deadline is unreached, so the console stays where it was and the answer
says so, never a late move after the voice has talked over the call.

## The residue

The 15 verbs are read across four concurrent processes, one after another within a batch, not at one instant, so two
registers can straddle a write between them. Nothing bounds one verb inside a batch but the kill of the whole batch,
so a verb that hangs costs every verb queued after it in that batch; each batch runs its heaviest verb first. The parallel calls one model turn makes share one read begun within a second of them (`sharesReadUnderWay`,
`SHARED_READ_WINDOW_MS`), rather than doubling the load; a call later than that starts its own, so no answer stands
on a read begun before the owner's last words. Only a read begun later replaces the one held (`newerRead`), so an
older call's slow read landing last never puts its record back under a newer call still answering. A newer call's
record can still replace the one a card tool began on, so `read_card`, `open_card` and `triage_next` track every card
read they take (`trackedCardReads`) and name a source unread at any of them, never only the first's. A card's linked briefings, an act's pull-request lookup, `open_card`'s console move and its page and thread
(`browser_open`) still run after the record, the screen ask too, which queues behind one already in flight and is
never started once every caller waiting on it is past its time (`screenAskChain`, `site/lib/screenAskChain.ts`),
through their own routes, but inside the same deadline (`boundedCardSeams`,
`site/components/voice/boundedCardSeams.ts`): one still out at it is said to be unread, not measured, or a move the
console did not confirm and may still make, never waited on. The deadline is the calling tool's own, returned by
its record read (`QueueCall`, `site/components/voice/talkToolRunTypes.ts`), so an overlapping later call never lends
an earlier one its time.
