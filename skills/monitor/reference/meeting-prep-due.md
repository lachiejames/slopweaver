# `meeting-prep-due`: a meeting's prep page, on the owner's screen before it starts

MEASURED: the prep page for the owner's one-on-one was cut the day before. Minutes before it the owner asked the
voice where it was, and then went in without it. Nothing tied the page to the meeting, so nothing could put it
in front of the owner.

- **This monitor floats a page; it never writes one.** MEASURED: an owner's external session started with no
  page because no tag existed and nothing wrote a brief unasked. The writing half is `calendar prep-due`, run hourly
  by `meeting-prep-hourly`: it registers a seat row per meeting, and the seat publishes and tags the page this
  monitor floats ([calendar](../../calendar/SKILL.md) § Meeting prep).
- **The tie is the tag.** A page is tied to one event INSTANCE, never to a person, so it fires once. The tag
  carries the start the live read returned, which keeps the pass local. A moved meeting fires at the old time
  until `page tag` is re-run ([page](../../page/SKILL.md)).
- **The card is a NOTICE whose Open button is the page.** Nothing waits on the owner. Its note floats at the
  `meeting-prep` level (`noteLevel`), above every other note stacked on screen, so the page the owner needs next is never
  under another card. It cascades from the top-left, apart from the ordinary notes at the top right, so it never
  covers one of their titles. It names one meeting only, the soonest: the one the owner walks into next.
- **A note gone without the owner's press comes back on the next fired pass.** A notice is on no list, so nothing else
  raises it again once its panel died or a restart took it down. A fired `monitor check` re-raises an open card
  whose note reads absent, at its level (`src/monitor/noticeReraise.ts`). A note still up is left alone, and so is
  one off macOS, where there is no note to lose.
- **The owner's snooze holds until its time or the meeting's start, whichever comes first.** A notice that came back on
  the next tick would be a nag the owner could not stop. The first reader to consume the snooze marker (the console's
  `hand list` poll, an earlier check in the tick) writes it to the snooze store, `hand-steps/snoozes`
  (`src/hand/snoozeStore.ts`). A note's standing reads an active snooze as dismissed, so the re-raise leaves it
  down, and `tick close` passes a fleet health note the owner put down the same way; `hand wake` brings it back once the
  snooze lapses, if the card is still open. `hand show` of the card forgets it. A card the owner snoozed that the pass
  moves off for a sooner meeting settles with the owner's snooze first, so `dismissedKeys` holds it like a Done rather
  than bringing it back once the sooner meeting starts. A Later in the older ledger (`src/hand/laterPresses.ts`)
  reads the same way.
- **The owner's Done holds until the meeting starts.** The meeting still reads due after the owner closes the note, so the
  card the owner settled is held off the register's history rather than re-posted on the next tick. A card the pass
  itself settled because a sooner meeting fell due is not held, so a later meeting in the same hour comes
  back once the sooner one starts. The register tells the two apart by what the settled row says: the pass
  writes its "still fires" departure line, the owner's Done writes anything else (`dismissedKeys`). The last settle is
  the last row written, never the latest instant, because the owner's Done and the pass stamp on different clocks. A fired `monitor check` reconciles the owner's Done
  markers before it reads open cards, so a press made between ticks is a row before the pass judges.
- **It settles when the meeting starts.** Its key carries the start (`lapsesAt`), so it settles even on a pass
  that cannot read the ledger.
- **The chair fires it every tick, last.** Every other note stays up beside it, cascaded; its level, not its
  place in the tick, is what keeps it in front.
- **Only the due page is asked of the store.** The pass picks the due tag from the ledger first, then asks the
  store whether that one page is published, so a tick with nothing due opens no connection. A store that cannot
  answer reads unmeasurable, naming the page, never as a page that is not there.

Code: `src/monitor/meetingPrepDue.ts` (the card and which tag is due), `src/monitor/meetingPrepDueSource.ts` (the
ledger read and the store check), `src/pages/meetingTag.ts` (the tag), `src/pages/published.ts` (the store check),
`src/cli/commands/page/tagRun.ts` (the verb, which refuses a page the store does not hold).
