# A triage pass: one Queue card at a time, on a clock the owner sets, every card seen

A child of [the voice flow](../voice-flow.md#2--what-the-voice-reads); it opens cards exactly as
[the voice opens the card](voice-opens-the-card.md) does, inside [voice-boundary](../security/voice-boundary.md).

The owner says it is triaging time; the voice says the first item is up, brings that Queue card in front of the
owner, and gives a quick TLDR. The goal is that the owner has actually had a quick look at each thing in their
Queue, never queue-zero. The voice only suggests; nothing is parked automatically.

**Triage is a mode of the Queue, never a page of its own.** Rapid triage walks the Queue's cards one clock each — two
minutes a card and ten a briefing unless the owner names another length — in the typed console as well as on a call, with a countdown the owner can see beside the Slopweaver menu bar item and a chime at
zero. The owner starts and stops it by voice, by typing, or from the menu bar, and while it is on every floating note and the
voice's overlay carry **Pause timer** and **Turn triage off**.

- **The menu bar** shows `m:ss` left on the card, `Time up` once it is spent unruled, `Paused`, or `Triage` between
  cards, and nothing while triage is off; its menu reads Start triage, or Pause timer / Resume timer and Turn triage
  off (`desktop/src/triageClock.ts`). The voice's window is the one authority: it reports the clock, the shell draws it
  (`desktop/src/triageShell.ts`), and a reload of that window ends the countdown with the pass.
- **A floating note** reads the shell's `hand-steps/triage/state.json`, rewritten every half second while triage is on,
  and shows its two buttons only while that file is fresh; a press is one file in `hand-steps/triage/commands/` the
  shell hands the voice's window (`src/hand/note/triage.ts`).
- **Every press on a call is said into it as the owner's words** ("Pause the triage timer.", "Turn triage off.",
  `site/components/voice/triageCommandRun.ts`), so the model calls `triage_clock` or `triage_end` and the server's view
  of the card in front of the owner moves with it. Off a call the page runs the same tools itself, and starting sends "It's
  triage time." to the typed conversation.
- **The chime at zero** is the server's line on a call; off a call the page rings the **attention** chime itself
  (`useTriageDing`, `site/components/voice/OrbCues.tsx`), and the typed conversation is never told the time is up in
  words.

**Three tools, no key.** `triage_next` and `triage_end` are page-answered reads, like `open_card`, and
`triage_clock` is a page preference (`src/talk/triageToolSchemas.ts`). The page holds the pass
(`site/lib/triageWalk.ts`), so the model never picks the card:

- **Triage is on only on the owner's word.** A pass begins, or a stopped one is picked back up, only when the owner's own newest heard
  words ask to triage (`heardTriageAsked`, `site/lib/triageAskGuard.ts`: a triage word inside an ask such as "let's
  triage" or "triaging time", un-negated, inside the last 240 characters or anywhere in the owner's newest stretch of speech,
  the last mention deciding; "is that a triage card?" is no ask). The stretch half is there because an ask to start
  triage followed by about 280 characters more in the same breath was refused twice, one toast each. A menu bar press is typed into the call as the owner's words, and a tool call arriving while those words
  are still being written streams them to the page first (`TypedInTurns.toolCallArrived`), so the guard reads the
  press it answers. Otherwise `triage_next` refuses before it reads the Queue, and the next
  card outside a pass is `action_items` and `open_card`, with no clock. A pass already running in this call carries on
  without a second ask. The owner's press of a fresh call stops a pass an earlier call left running, keeping the owner's place
  (`stopTriageForFreshCall`), and the server drops the card that call held (`TriagePresented.seat`, mode `fresh`); a
  reconnect or rollover carries both on. Without the guard, an ask to be taken to the next Queue
  card began a pass 1 of 9, and two minutes later the voice said "Time's up on that card" over the owner's answer,
  though the owner had never turned triage mode on.
- The first `triage_next` starts a pass from the Queue as it stands, in the Queue's own order (`triageOrder`).
- Each call puts ONE card in front of the owner through `open_card`'s own presenter (`runTriageNext`,
  `site/components/voice/triageRun.ts`). The answer is the card plus where the pass stands: seen of how many, cards
  out for rewrite, and whether this card arrived since the pass began or came back rewritten.
- The next card up takes the one before off the owner's Queue, as `open_card` does, even when the owner left it for its linked
  report first; a park verdict keeps it, drawn parked ([the Queue walk](card-landing.md#the-queue-walk-moving-on-takes-the-card-off)).
- A card that reaches the Queue mid-pass is walked too. A card that left before the owner reached it is skipped and counted.
- When every card is seen, `triage_next` answers `done`. `triage_end` stops the clock and returns what the pass came
  to: seen of how many, each verdict, cards still out being rewritten, cards not reached.
- **Ending stops the pass, never drops it** (`stopTriageWalk`). The next `triage_next` picks it up at the next card the owner
  has not been shown, so no card the owner already ruled is put in front of the owner, nor its Slack thread opened, a second time
  — bar one the owner sent back, once it is back rewritten, which comes first as it always does.
  When ending dropped the pass, the next began at card 1 of 93, and the voice skipped back through eight cards the owner had ruled, a second each, opening
  each one's thread into a stack of error toasts. The tool words and prompt lines say why the model never needs to
  end a pass to stop the clock, nor call `triage_next` several times in a row. A stopped pass is inert until
  `triage_next` resumes it (`resumeTriageWalk`): no clock is owed, a relay's `triage_card` is refused, and an open
  still resolving when it stopped leaves it exactly as it stopped.
- A pass left idle longer than `TRIAGE_PASS_IDLE_MS` (30 minutes) — counted from the stop once stopped — is replaced by a
  fresh one on the next "triaging time". That pass walks the Queue as it then stands, still leaving out every card the owner
  ruled whose words have not changed (`settled`), while the owner's ruling lands it off the Queue
  ([card landing](card-landing.md)). The pass lives for the provider's life, so a plan-call rollover carries it; a
  fresh call stops it, as above.

**The pass survives a reload.** `useTriageWalk` keeps it in `localStorage` (`site/lib/triageWalkKept.ts`, read
strictly: one field off shape and nothing is kept). A reload brings it back STOPPED (`reloadedTriageWalk`), with no
card in front of the owner and no clock, so `triage_end` and `triage_clock` refuse until `triage_next` resumes it. A card the owner
had in front of them and had not ruled is walked again; one the owner ruled stays seen. A pass still running when the page
went is stopped at the instant its last card went up, so the 30-minute idle rule judges it exactly as before. It is
one pass per browser: when another tab keeps the pass, an open tab drops its own copy and stops its clock, so its next
call resumes the browser's pass rather than starting over (`keptTriageWalkChanged`).

**The clock is a timer, a countdown and a line.** Each card opened starts its clock in `useTriageWalk`, which reports
its deadline to the menu bar (`site/lib/triageClockReport.ts`). One clock runs at a time: the next card replaces it, the owner's ruling spends it, the end stops
it, and opening any OTHER card mid-pass stops it (`open_card`). A stop also ends a clock already posting its line, so
a busy floor's retry never says the time is up over a card the owner opened since (`site/lib/triageClockRounds.ts`).

**The owner names the length; the voice never picks one.** Said as the card opens ("ten on this one") or once it is
up ("give me five more minutes"), by voice or typed, the length rides `minutes` on `triage_next` or `triage_clock`
`running`, a whole number from 1 to 120. Unsaid, a card gets `TRIAGE_CARD_CLOCK_MS` (two minutes) and a briefing —
a card naming a page for the owner to react to — `TRIAGE_BRIEFING_CLOCK_MS` (ten), `triageClockLengthMs` in
`site/lib/triageWalkClock.ts`. The answer's `clock` note names the length it runs and tells the voice never to pick
one. The page refuses a `minutes` the owner's newest words do not say — as digits, as number words, in hours, or as
"half an hour", "a quarter of an hour" (`ownerMinutesOf`, `site/lib/clockMinutesGuard.ts`, reading the same window as
the triage ask, each length at its longest, so "half an hour" never passes 60 and "one hundred and ten" never passes 10) — and a `minutes` on a pause. Its residue, stated: a number said about something else in that window passes. The length is kept in page memory per visit, never in the kept pass, so a reload's resumed card starts
on its own default. "Give me a minute" with no length named stays on the card, as before.

**A card the owner closed or left owes no line.** Not every move away is a tool call: the owner can close the card, or open another
from the Queue, and the pass still holds it current and unruled. So the clock counts the card shown when its open
said it went onto the owner's screen (the open answers before the page draws it), or whenever the page has it open during the
visit, the owner's own open included. Once this card has been shown, every firing and retry checks it is still open (`triageClockOwedOnScreen`,
`site/lib/triageWalkClock.ts`). A mismatch spends the firing; opening the card again does not bring it back, and a
`triage_clock` restart after the owner closed it still counts it as shown (`shownVisitAfter`). Without that
check, a card's clock started, the owner closed it and opened another unruled, and four minutes later the voice said _"Two minutes are up. Why not park it"_ over a card the owner was not looking at. A card the voice
read with nothing open (the switch below off, or an open that failed) has no screen to leave, so only the pass
decides its line. What the page cannot close: its view of the owner's card lags the owner's move by a render, and by one shell event
more in the desktop voice window, and a line already posted before the owner moved still lands. The server checking the open
card as it hands the line over would close both.

When it runs out the page posts the visit id to
`/api/talk/call/[id]/triage-due`, and `PlanCall.announceTriageDue` hands the voice `TRIAGE_DUE_TEXT`
(`site/lib/triageDueWords.ts`) as a developer message, once per visit id, a second after the page rings the
**attention** chime, and at once starts the turn that carries `TRIAGE_SUGGESTION_TURN_TEXT` itself (an owed start
with why `triage`, no window). The page holds the post while the owner's microphone is sounding (`triageDueReady`), and the
server refuses while the owner's utterance is still open (deltas with no `done` yet), while the owner or the voice holds the floor,
a tool call is pending or a Codex turn is running (`floorRefusal`); the page posts again every few seconds while the
line is still owed. Without those holds, the line was handed over 72 seconds of the owner's words whose transcript had stalled,
and the voice, with no turn armed, answered the owner's bug report with "Send it, then." Every stop is itself a tool call inside a turn, and its answer clears the card on the
server, so a due request delayed past a pause, an end or another card is refused rather than said late. A line
already handed cannot be taken back, since the app-server has no call that would, so its own first sentence tells the
voice to say nothing if the owner has ruled, paused, ended the pass or moved to another card by the time it answers.

**The due line names the card actually on the owner's screen.** A successful `triage_next` answer carries the visit id it put
up (`triageVisit` on `/api/talk/call/[id]/answer`), and the server records it in one process-wide holder
(`site/lib/triagePresented.ts`) once `PlanCall.answer` reports it settled a successful `triage_next`; a visit beside
any other answer is ignored. A `triage_end` or `open_card`, whatever rides beside it, a `triage_clock` that did not
restart the clock, or a `relay_steer` carrying the owner's triage ruling clears it as the page claims the call (the `claim`
route), before the page can run it, so a call the server then times out has cleared it too, and even when the tool
failed. Claims are numbered, so a `triage_next` claimed before that stop and answered after it never names its card
again, since the page stops its clock before it opens a card, and a
`triage_clock` that restarts the clock names its card again. Pause or restart is read from the arguments the model
called `triage_clock` with, as the server received them, never from the page. `triage-due` answers **403** for any
other id.
Each voice call is seated with a generation as it is made, so a late `triage_end` from a call that has rolled over
cannot clear the newer call's card, and an older call is refused the newer call's line. A rollover's fresh call says
the line on the card the call before it named, since the page's clock carries on across it, and so does a reconnect;
a fresh call clears it. A typed conversation is never seated, so it names nothing.

**The owner can pause the clock.** `triage_clock` with `paused` stops it and arms no clock on any card until `running`
restarts it on the card in front of the owner, counted afresh from now: the minutes the owner just named, else the
length that card ran before. A pause is never `triage_end`, and never a relay.

**The pass obeys the "Open cards and links" switch.** With it off, `triage_next` still walks the card, starts the
clock and takes the owner's ruling, but answers `onOwnerScreen: false` with a `switchOff` note: the voice reads the card to the owner
and says, once in the pass, that "open cards" puts each card in front of the owner.

**At zero, three ways out; the voice suggests, the owner rules.** The line only tells the voice to say the time is up
and the owner's ways out are coming, never to name or affirm a verdict itself; the turn the server starts names the
three ways out in one sentence — decide it (send it, rewrite or drop), name what's missing (needs more info), or park
it (a working session or the slow triage hour) — then ONE of them as its suggested verdict and label, with its reason
and a question. The card stays where it is until the owner gives their call or agrees to the
suggestion. Nothing in the pass moves a card on its own.

**The owner's ruling travels on `relay_steer`**, the relay writer, as `triage` and `label` (`src/talk/triageVocabulary.ts`),
with `triage_card` naming the card it rules. It lands on the card that was in front of the owner as the model's answer
carrying it BEGAN (`triageVisitFor`): the page hears each Codex turn start (`codex-turn`, `started`) and notes the
card then current, only once its open has gone through (`site/lib/triageTurnFronts.ts`, kept for the page's life, so
a replayed start never re-notes a later card), so a relay in the same answer as a `triage_next`, or in an older
answer running beside the one that put the next card up, lands on the card the owner's words were about. Two unruled cards
can never swap a ruling. A ruling whose answer the page never heard begin lands only on a card nothing can be
confused with; while both cards are unruled it lands on neither, and the voice is told so. A refused open in between
leaves no card before the next one, so a ruling never reaches two cards back. Either way only a card whose open went
through (`markTriageOpened`), never one still opening or refused, and never on a pass `triage_end` stopped. An open
that read the card but could not put it on the owner's screen, the owner's switch off or the window refusing, went through: the voice
reads that card to the owner, so the owner's ruling on it counts.

**A take-back that names no card is asked about, never relayed as it stands.** The page's rule covers a ruling; it
cannot cover "wait, no, not that one" said after the next card is up — measured once at 1.1s after the relay — which is about
either card. Both prompts ask "which card?" and treat neither as ruled until the owner says
(`src/talk/triageLines.ts`). The backstop is the approval: a yes on a draft refuses while a later relay on the same
call, within the next two cards, carries a take-back or another verdict and rules no card of its own
([pre-approved](../../skills/slack/reference/pre-approved.md)).

The verdicts:

| Verdict                | What the row asks of the chair                                                 |
| ---------------------- | ------------------------------------------------------------------------------ |
| `send-it`              | it is ready to go out as the card stands                                       |
| `needs-more-info`      | find what is missing and put it on the card                                    |
| `park-working-session` | no act now; the Queue already draws it parked, so settle the row               |
| `park-slow-triage`     | the same, for the slow triage hour                                             |
| `rewrite`              | rewrite from the owner's words and `talk restore` it now, so the pass finds it |
| `drop`                 | the owner does not want it; nothing goes out; drop or close what it proposes   |

Labels: `waiting-on-them`, `waiting-on-me`, `come-back-to-it`, `action-now`. `talk relay --about <key> --triage
<verdict> [--label <label>]` adds one line to the row's ask (`triageRulingLine`), so the chair reads the verdict
even when the owner's words were only yep, do that. The turn stores it too (`triageRuling`), and every surface the chair
reads the owner's words through — the relay's typed line, `talk unread`, the approved-draft tick gate — prints it beside them
with the voice's question before them (`src/talk/answerContext.ts`). A relay carries one ruling: `--triage`,
`--candidate` or `--covers`.

**A parked card stays on the owner's Queue, parked, with the owner's label on it.** `talk cards --json` carries each landing's
`triage` from the relay whose anchor it landed under, ruled or not, else the relay its work row names, since an ask
card's work is the ask itself (`src/talk/cardLandingTriage.ts`), and `triageUnreadable` for relay
lines that did not read. A relay turn a crash left registered with no receipt line, named by the landing's anchor or by its work row, is
read off its own turn file (`src/cli/commands/talk/cardsIntakeRead.ts`), and one of those that does not read counts
there too. A landing carrying a park draws its card below the rest with a pill such as "Parked,
working session · waiting on them" (`landingVerdict`, `site/lib/cardLandings.ts`; `triagePillWords`), never hides
it, so the chair never runs `talk restore` or `queue defer` for a park. `action_items` lists it after the rest too,
with the pill's words as `parked`, so a full list cuts it first and `beyondCap.parked` says one is past the cap. A park steer this page just sent never
collapses its card either (`site/lib/steeredCards.ts`), and a park landing at or after the row's floor outranks any
steer still waiting on the card: a steer is dated by when its relay reached the page, not when the owner spoke it, so a later
one moves the card once its own landing is newer. A park older than the row's floor holds nothing, as any landing. A park stays parked even while a session runs its
row; any other ruling on a recut in flight rides the recut as its pill.

**A card the owner cannot follow comes back first, and the owner never waits on it.** `rewrite` takes it off the Queue like any
landed relay. The pass moves on. Each next `triage_next` looks for it first, and it is back once it is on the Queue
again after the pass saw it gone, or once its words differ from the ones the owner could not follow. A rewrite posted as a
NEW card is walked as an arrival.
