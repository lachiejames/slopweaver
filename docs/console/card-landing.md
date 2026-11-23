# What the owner says with a card open lands on that card

A child of [the console](../console.md), which carries [the call transcript](voice-context-and-calls.md#the-call-is-written-down-as-it-runs--a-dropped-call-is-still-read) this reads.

The owner's ruling, option A: what the owner says while a card is open lands on that card, relayed or not. The
problem it closes: the owner opens a card, remembers steering it the day before, and finds it unchanged, because the
steer became a new row and never touched the card; a question asked with a hand step open reached nothing. A card
is open in that sense when THE OWNER opened it: one the voice put in front of the owner takes only a relayed steer (below).

**Narrowed on the owner's word**: words that are obviously not answers to the open card are never treated as answers to
it. A greeting and seventeen stretches about vulnerability bumps, said with a hand step open, once landed on it and
took it off the owner's Queue, its paste fields dead. Being said with a card open is where words were said, never what they answer, so three rules hold:

- **Only the voice's judgement lands words.** `relay_steer` requires `answers_open_card` on every relay: true only
  when the owner's words answer the card the owner had open, however few words they share with it ("send it", "option B"). The
  relay's `about` is that card only when it is true (`site/lib/heardOver.ts` `relayAboutJudged`), its first call-file
  line carries `answersCard: true`, and `talk transcript` lands an utterance only when such a relay about the same
  card heard it (`src/talk/cardUtterance.ts` `transcriptCardUtterances`). Unrelayed words stay in the call file for
  `talk unread`, and leave the card where it is. A line written before the field existed carries no judgement and is
  never read as one.
- **A hand step never takes words.** It settles when the step is done (`hand done`, its settle check), so every
  landing path refuses it with `NOT_AN_ANSWER` (`src/talk/cardAnswer.ts`), and the Queue overlay draws a hand row
  whatever landing or steer the ledger already holds on it (`site/lib/cardLandings.ts` `landingVerdict`). Its secret
  fields take a paste for as long as its card is open, settled or not, because `secrets set` gates the name and
  never the step, so the owner can still use the text boxes after it leaves the Queue
  (`site/components/console/SecretFields.tsx`).
- **Greeting or filler alone is never an answer**, on any card and whatever the voice said: "Uh, good morning", "um,
  but, where was I", a bracketed `[chuckle]`. Bare assent ("okay", "yeah", "right") is not filler, because said to
  the voice's "shall I send it?" it is the owner's yes.

So every stretch of speech names the card open when it BEGAN (`open`, `site/lib/transcriptSink.ts`) — read at its first
transcript event, the earliest the Live API gives the page, since it sends no speech-start; in the desktop app the
call runs in the voice window, so that card is the console window's, carried across with its page identity
(`carriedPageView`, `site/lib/desktopPageReading.ts`; [the shell](../../desktop/README.md)) — and after
each append `talk transcript` cuts the call into finished utterances (`src/talk/cardUtterance.ts`) and lands each
on its card (`src/cli/commands/talk/cardLandApply.ts`). An ask gets the owner's words as its `ruling`, so it waits on a
session; every other card gets a `--dispatch` row carrying the owner's words, or the relay row when the voice relayed
them; a relay over an ask is born with no `repo:` and filed into the ask once its run starts or it settles. Either way a row in `$SLOPWEAVER_HOME/talk/card-landings.jsonl` records it, `talk cards` reads it, and
the Queue (the Alignment page, for an act) and the voice's `action_items` stop drawing that card (`site/lib/cardLandings.ts`). A relay lands the same way,
on the card the owner's words began over rather than the one open when the voice relayed them. Words begun over more than one card land on the card the owner's latest words began over, when it is still open and the voice judged them its answer, and on no card otherwise — the transcript then lands each on its own (`site/lib/heardOver.ts`'s `relayJudgeable`): walking the Queue, the owner said "Next card, please" over one card and answered over the next, and 5 of 8 answers had landed nowhere. Words begun over NO card are not a second card: "bring me the first card" said over none once made the owner's rejection of the card the voice then opened a relay about nothing, and since the transcript lands nothing over a voice-opened card (below), it reached no card at all. **When a steer on one card also answers another, close BOTH** — the owner's rule given with A, and automatic, because Queue cards must refresh. The voice names the other cards in `relay_steer`'s `also_answers`;
the page accepts a key only when the latest `action_items` answer this call served it and it is still on the owner's Queue
(`site/lib/alsoAnsweredCards.ts`), at most five, never the open card, a hand step or a check-in; and `talk relay
--also-answers` lands each one in order, each under the draft-or-channel veto below against its own text, a refusal said
per card on stderr. **Whether the owner's words decide that card is the voice's judgement, exactly as `answers_open_card` is**:
nothing in code reads meaning, so the bounds limit WHICH cards a wrong or injected judgement can clear (served this
call, still current, five at most), the landing carries the owner's whole utterance, and `talk restore` lifts a wrong one. The
keys are bound into the turn's digest and kept by the words-alone retry, so a replay cannot change the targets, and
`talk transcript` lands nothing a relay already landed this way. The manual path stays for what the voice did not
name: `talk land --card <second> --words … --anchor … --decided …`, the same utterance on both; never for a key the
relay line's `alsoAnswers` already lists. A call anchor whose utterance is not in the call file yet exits 4 (deferred) and writes nothing, so it never registers a row beside one a later segment already landed; run it again. Under a call anchor the call file is the authority: the landing carries the whole utterance and the instant the owner began it, and `--words` that are not a run of what the owner said there are refused.

**A relay made before the owner finished speaking lands on no card.** A relay whose `heardTailCut` is not `false` —
cut, or a voice relay that never said — leaves the card on screen and every `--also-answers` card on the Queue, says
`not landed on <card>` per card on stderr, and opens its row `HELD:` (`src/talk/relayCutHold.ts`), on a replay too:
a landing is the owner's word on the card, and cut words may stop short of a no.

**A relay naming a draft or channel the card never mentions stays off it.** Two relays about a public
mis-send to a programme channel once landed on an unrelated ask. So `talk relay` reads the exact referents in the owner's
words — an `sd-` id, or a channel some draft was parked for — and lands on the card only when the card shares one: a
`post:` card by its own draft id, any card by a draft id in its key, an `ask:` by an id, channel id or `#name` in its
text (`src/talk/relayChannelSteer.ts`). Otherwise the row stays on the board, not landed, and the chair's line says
`not landed on <card>: <why>`. Words naming no referent land as before, bar an `ask:` the close's draft gate cannot
read (`readExactDoc`): that is withheld whatever they name, since the gate refuses every tick on it. Only an `ask:` card's text is read, so a `pr:`, `hand:`, `review:` or `act:` card
lands words naming a draft or channel only when its key carries one: a channel alone over a `pr:` card is withheld
and the chair places it.

**The card must be THE OWNER'S.** A pull request's card is keyed `pr:<owner>.<repo>.<n>` (`src/talk/prCardKey.ts`), so two
repositories' `#n` are two cards. One is refused when the landing reading the ledger held when the owner spoke lists `n` under
THAT repository in its census as opened by somebody other than the login the token read as (`src/talk/cardSubject.ts`);
a bare `pr:<n>`, written before keys carried a repository, names no pull request and is refused. The reading is
the one in force at `--decided`, never the newest, and the first verdict is kept in a ledger under `talk/`
(`src/talk/cardNotOwnerStore.ts`) and read before any reading, so a refused card stays refused when their pull request merges or an utterance's instant moves. Only that positive evidence refuses: the
census lists open pull requests only, so the owner's own, merged since, is absent from it and still lands, as does any card
when no reading is recorded. A refusal is `CARD_NOT_HIS` before any write — `talk transcript` passes
it over, a relay says so on stderr, `talk land` exits 1. An every-author reading once put a colleague's pull request on the owner's Queue, and the
twenty-three utterances the owner spoke with it open each landed on it.

**A card the voice put in front of the owner is not one the owner opened.** The voice reading a Queue item out must
never be what removes it from the Queue. The voice's `open_card` once moved the console onto an ask while the owner
was away from the computer, read it out, and the owner's next aside — that they would be back at the computer in a
minute to look properly — landed on it as a ruling, as did a calendar question, a thank-you and the owner's bug
report about it. So the address `open_card` opens carries `by=voice`
(`cardPagePath`, `site/lib/openCard.ts`; the desktop shell sets it on every card it loads for the voice,
`desktop/src/consoleCardAddress.ts`), the page reads it with the card (`openByOf`, `site/lib/pageVoice.ts`; also on Alignment, where an act's address lands,
until the owner's touch on any box, or typing into one, takes the marker off, `withoutOpenedBy`) — judged as the page registers that card
(`heldReading`), never as the owner speaks, since the address moves an effect before the card does, and handed to the
desktop shell marked the same way (`publishedPath`) — each stretch
of speech carries `openBy: "voice"` beside its `open`, taken at its first event like the card, and `talk transcript`
lands only `transcriptCardUtterances` (`src/talk/cardUtterance.ts`): none said over a card the voice opened. A run of
the owner's speech splits where the opener changes, so words over each are judged apart. Nothing else reads the field: a
relay still lands on the card the owner's words began over whoever opened it (`heardOver` reads `open` alone), so a steer
the voice hears as one still takes the card off; a press is the owner's act; card laps still count the card;
`talk land` still resolves a call anchor against every utterance. The owner's own click on any row rebuilds the address
through `panelHref`, which drops `by`, so a card the owner chose — the one the voice opened included, once the owner clicks it —
takes the owner's words as before; a reload keeps it. A line written before the field existed carries no `openBy` and
lands as any owner-opened card does. The marker is the address, not a signed record, so an address the owner types by hand keeping `by=voice` reads
as the voice's, as does speech beginning in the one effect between the owner's click or touch and the page
registering it; both err the safe way — the card stays on the owner's Queue, and a relay or press still acts. The
ways it can err the other: the voice reopening the card the owner has open under an absorbed ask's address leaves it the owner's,
and a row absorbed into a hand inside that same one effect can take either opener. A
page path the desktop shell carries back has headroom over any card address it loads (8192, marked and bounded
before the load), so a voice-opened address is never dropped for the page before it. The residue: a desktop shell built before this refuses a card
address carrying `by`, so the app must be rebuilt (`yarn app`) for the voice to open a card there at all.

**A relayed steer over a voice-opened card lands from the chair's intake mark**, because a Queue still showing cards
the owner steered on a while ago reads as stale. MEASURED, 98 cards: 22 drawn after the owner steered on them. The
one ranked first: the owner rejected a card `open_card` had opened, the relay named no card (`about: ""`), so neither the transcript nor `talk relay`
landed anything — while the chair had marked the turn `answered`, witnessed by the relay row. So `talk cards` derives
a landing (`source: "intake"`, `src/talk/intakeCardLandings.ts`) from exactly that join: an `answered` or `card` mark
whose witness leads with a relay row `talk-<12 hex>`, bare or before a colon or a space, that `talk relay`'s receipt ledger carries (one it does not is a
named gap), its `talk-call:<call>#<segment>` pointer, the owner's segment with that
id, and the register card open with `openBy: "voice"` when it began. Never text matching. A mark witnessed by
anything else is the chair answering THE OWNER'S question and lands nothing; admitting those derived 127 landings over 24
cards on the same reading, most of them questions. The derived row is never written to the ledger; a card-wide
restore at or after its mark, or a kept settle of its relay, lifts it exactly as a ledger landing. A call file that
will not read is printed as an `intakeGaps` entry and its card stays drawn.

**A landing holds only the card the owner spoke to** (`landingFloorIso`, `site/lib/cardLandings.ts` `landingVerdict`). An
ask's floor is when its question was last asked: words decided before a re-ask never answered it. A held post's floor
is the newer of its hold, unless that is the hold saying the yes was not the owner's, and a change of meaning dated by
its `judgedIso` — beside that hold too, a change that hold set down included (`site/lib/postJudgement.ts`
`postLandingFloor`) — the owner's ruling that a yes not being sent says why, kept for news the owner's words have not seen. Before this, any hold drew a post past every landing, which was 21 of the 22. **A recut in flight is drawn as one**: a landed card whose newest holding landing's work row is `IN FLIGHT` with
an active run stands on the Queue as _Recut in flight, &lt;row&gt;_ in the check-in tier, off the badge
(`site/lib/queueLayout.ts` `recutRow`); the voice's `action_items` leaves it out, since nothing on it waits on the owner.
**A park is drawn, never hidden**: a newest holding landing whose relay carried the owner's triage park (`talk cards --json`
`triage`, `src/talk/cardLandingTriage.ts`) stands below the rest with the owner's ruling as a pill (`parkedRow`), on the
Queue and in `action_items` alike, because a parked card waits on the owner, not on a session
([the triage pass](voice-triage-pass.md)). A relay marked cut (`heardTailCut: true`) carries no park, and shadows an
older relay's park on the same row rather than falling back to it; one recorded before the field existed keeps its own.
The residues: a steer the chair carried only in a hold's prose (3 of the 22) is out of reach of a structured join;
and a card an intake landing hides stays hidden while its relay row waits unrun — the unpicked-steer gate (below)
reads relays that named a card, so the relay row on the board is what keeps that work visible.

Why the earlier fix for a Queue card vanishing mid-reaction with nothing saying who took it did not close it:
it measured the same mechanism — an aside and "[mouth noise" landing through the transcript — and fixed what the owner SAW,
keeping the panel open and naming whose words took the card, while keeping the landing itself as option A's accepted
trade. The card still left the owner's list on the next aside.

The trade the owner accepted, which stands on a card the owner opened: a general remark said with a card open pulls that card
("citation chips" said over a pull request's card, for one). `talk restore --card <key> --anchor <where> --why <why>` puts it back, lifting every landing on it so far, and an ask the owner's words answered is asked
again; one a later ruling answered stays answered, and the verb names that ruling.
`handover settle --card kept --card-why <why>` on the relay row writes a KEPT restore instead: it lifts only that relay's landings — its anchor, or a landing whose work is its row — never another steer's, holds against one of them written later, and its reason shows on the card and in `hand list` (`src/talk/cardKeep.ts`). A build before it reads that row as a plain restore.
The residues: a desktop app built before its preload said `carriesOpenCard` carries the page alone, so words said in its voice window land on no card until it is rebuilt (`yarn app`); an utterance is landed only once something proves it finished — the voice speaking, a relay beginning, the owner speaking with another card open,
or the call closing — so switching cards in silence, the voice silent too, leaves the last words landing at the next of those, and a call that dropped mid-sentence lands its last words when the owner's next call opens, or when its last batch arrives after that, and so does a call that closed while a relay of its last words was still sending, or whose last batch failed to land; a relay whose `sending` line reaches the call file only after a batch landed the utterance (made after it, or begun while that batch was in flight) adds its own row beside the dispatch row, and a settle keeping the card lifts only the relay's own landing, so `talk restore` puts back the dispatch row's; an utterance a batch landed before all its words arrived lands again whole on the same work row, whose text keeps the shorter words while the ledger and the call file carry them all; and a restored ask's
question has no Slack post handle, so a correction re-posts it. A card whose id is past 160 characters, the card-key bound the
console and relays already had, is never the card open, so words said over it land on none. A run journal takes no lock,
for any writer on main, so a ruling appended between a restore reading an ask and re-asking it puts the card back anyway.

## The Queue walk: moving on takes the card off

Moving on to the next Queue card takes the one left off the Queue, unless the owner says to come back to it. Only
words the voice judged an answer land, so without this a card the owner reacted to without answering would stay up
when the voice opened the next.

**The page decides that the walk moved, not the voice** (`site/lib/cardWalk.ts`). When `open_card` or a triage pass's
`triage_next` puts card B in front of the owner while card A is still the card left, it writes a `card-move` line to the call
file. The card left is the one the page has open, else the card the walk last put in front of the owner (its `front`): once
the owner is done reacting to a card it goes from the Queue, even when the owner followed the card's linked report, so
the page held no card while the owner ruled on it and moved on — a case that once left a card up for days.
That needs all of:

- A was resolved by `read_card`, `open_card` or `triage_next` on this walk. The owner's press of a fresh call starts a new walk; a reconnect
  or rollover carries it, as it carries the open card, so a drop the owner never saw cannot make a card the owner moved past stick.
  The `also_answers` served set is bound to the call id instead: it stands for what the voice's context holds.
- The console really opened B.
- B is a different card.
- Both keys and the request id pass `talk transcript`'s own shape, so one bad line never costs the whole batch.

The voice marks one exception, which only it heard: `come_back_to_previous` on `open_card` when the owner said to come back
to A. A park verdict in a triage pass outranks the move, as every landing does.

A ruling said with no card open names the card the walk put in front of the owner in `relay_steer`'s `also_answers`, which
admits that card beside the latest `action_items` listing (`site/components/voice/talkToolRunArgs.ts`). Nothing infers
a ruling from a call that closed.

`talk transcript` applies the moves under the card-landing lock after the answers have landed
(`src/cli/commands/talk/cardMoveApply.ts`):

- **A move on** appends a row to `$SLOPWEAVER_HOME/talk/card-moves.jsonl` (`src/talk/cardMoveLedger.ts`). This applies
  to ask, draft, post, review and pr cards only. A hand step, an import and a check-in each settle another way.
- **A come-back** defers A instead ([coming back to a card](coming-back-to-a-card.md)).

A move writes no ruling, registers no work and checks no subject gate. The owner's words over A ride along, exactly as the call
file holds them, and nothing is written in the owner's name when the owner said nothing. A call the desktop test instance touched
moves nothing.

Moves have their own ledger, not a third row kind in the landing ledger: every older reader of that ledger refuses a
kind it does not know. A move's identity is its anchor (`call:<callId>#move:<requestId>`) and its card, so a batch
posted again writes nothing, and a later batch carrying more of the owner's words grows the row.

- `talk cards --json` carries the active moves (`moves`) and the move lines that did not read (`movesUnreadable`).
  Each ledger's refused lines also travel described (`unreadableLines`, `movesUnreadableLines`): the line number and
  the `cardKey` and `atIso` the line recorded, when it recorded strings for them.

**A refused line is a gap only where the card it names is read.** A line recording no card key may hide any card, so
it is a gap everywhere. A line whose key fails the card-key grammar (a space in it, say) can be no card anyone draws,
so it is a gap nowhere, though `talk cards` still lists it. A line naming a real card is a gap only on a surface
reading that card: the Queue and the voice's `action_items` for the cards they built, `talk steers` and a relay's
settle for the steer's own card, `hand list` for its open steps, and the pack's recently-off section for lines
written inside its look-back. The approved-draft gate reads every card, so only a non-card key is skipped there.
A voice that named every refused line would tell the owner a steer may be unread over a card none of them is about.

- The Queue hides a moved-on card after the park and hand/import rules and before every steer, unless the row's floor
  says it has news since.
- **Recently off your Queue** names it as moved on to B during the Queue walk, with what the owner said.
- `talk restore --card <key>` lifts its moves as it lifts its landings, and a restore wins over a replay of the same
  move for good.

A move frees on ANY news since, weaker than a landing: an ask asked again, and for every other card its currency
floor (a pull request's update, a draft or post restaged) — never an ask's re-confirm, which a sweep makes routinely
(`site/lib/cardLandings.ts` `moveHolds`). A move whose write failed is owed: the next call's sweep retries it even when
every word of its call landed (`movesOwed`). A retry is judged at the instant the owner moved on, never at the retry's: a
`talk restore` since then beats a late moved-on row, and any Queue press on that card since beats a late come-back
deferral — dated when the owner said it, so the deferral ledger's fold, which keeps each card's latest press by time, ranks it
below a press that lands mid-retry. An `open_card` or `triage_next` still in flight when the walk or the call changes — a fresh call pressed, typed or rolled
over — steps no walk and records no move (`CardWalkSeam.stamp`).

**The residue**, named by Codex's pre-mortem and older than this change:

- An also-answered card whose landing fails is said on stderr, and the relay still succeeds, as the open card's
  always has. Nothing owes it a retry.
- On the desktop, `open_card` answers "opened" before the page publishes the new card, so words said in that gap
  are heard over the previous card.
- One relay names at most five other cards.
- A build from before this change refuses a batch carrying a `card-move` line, so rebuild with `slopweaver dev build`.

Age alone, a card nobody walked past, is still the supervisor's sweep
([card freshness](../../skills/supervisor/reference/card-freshness.md)).

## A card the owner has just steered on collapses, and comes back if nothing took it up

The owner's ruling: the card the owner is steering on collapses and leaves the list at once, so it feels heard — and
in the same breath, that can be bad if it costs trust in the system, by looking worked on when it is not yet. Trust
is the acceptance criterion, so the collapse is optimistic and accountable.

**The moment the voice starts a relay** about the card open as it sends (`about` equal to the open card; a relay
naming no card, a check-in walked with no card open, an Automations `recipe:` card or an Alignment-page `align:`
question collapses nothing — no register holds those two), the page
records the steer (`site/components/console/steered.tsx`, kept in `localStorage` so the console window hears the
overlay window's call) and the card leaves the Queue (an act, the [Alignment page](./alignment.md)), the badge, the voice's `action_items` and its triage pass before
its landing has even been read. Nothing is drawn in its place: the Queue ends at its last card, by the owner's ruling; a panel open on it names the relay
holding it (below).

**A panel the owner has open on that card stays open** until the owner closes it or opens another, drawn from its snapshot with
every press held, and its "Since you opened this" section names the words holding it off the list, dated, and the
work row (`site/lib/cardDeparture.ts`, `site/components/console/CardDepartureNote.tsx`): the earliest active landing
on it first — the owner's words heard by the transcript with the card open, the owner's words relayed by the voice, or a session
landing them from another card — and every later one behind a fold; a relay no session picked up says so. It dates
the words, never the instant the card left, since words said on a panel already off the list are later than that. The voice's `read_page` says
the same of the open card, so it never asks the owner to rule again on a card the owner's words already took off. A
card vanishing while the owner is still happy to keep reacting to it, with nothing saying whether the voice or the
supervisor is acting on it, is the failure: an aside about the bot once landed on an open dependency-bump card
through the transcript, "[mouth noise" on the next, and a relay on that one closed its panel mid-sentence. A word said while a card THE OWNER opened stays open still lands on it; one said over a card
the voice opened does not (above).

**`talk steers --json` is the authority** (`src/talk/steeredCards.ts`, `src/talk/steeredCardsRead.ts`). Joined
exactly: the relay's receipt, ITS landing on THE card it named (anchor `talk:<turnId>`), and positive evidence of
action — a run event at or after registration on the relay's row or the row its landing names (a steer on an ask is
a ruling on that ask), a settlement on the relay's own row or on one asked after it registered (a settlement carries
no instant), an intake mark on `talk:<turnId>`, or a check-in ruling it wrote.
Delivery into the chair's chat is not action. Settled, the steer is forgotten for good and the landing keeps the card off the list as before.

**It comes back into the list, and the page says nothing of why** (`site/lib/steeredCards.ts`). "Not recorded — the relay was refused"
banners under the last card cost the owner confidence, so nothing is drawn there. A refused relay is the chair's to hear, never the owner's page's: `talk unread` prints
the owner's words with the relay that was refused after them, and the gate below refuses a tick over a steer nothing
acted on. It comes back when the relay was refused; no relay row exists two minutes after the owner spoke; it never landed
on the card; the first chair tick that STARTED after registration finished with nothing acted on it (a tick already
running read its intake before the relay); or no tick at all ran for 45 minutes. Each of those is a steer nothing is
working on. **A hiccup is not one of them**: a steer the owner already gave is never asked for twice, and a visual sign that
the asked-for work is under way but hit a transient issue is worth surfacing. So a record that cannot be read (the verb
erroring, a journal, the tick ledger, or a line of the landings or relay ledger not reading) keeps the card collapsed for as long as it lasts, and never brings it back to be asked again. A `kept` settle or a restore brings it back the same way. A later action
still settles a returned steer. The card returns only when every active landing on it is this relay's, as the first segment or a later one; one another
steer also landed on stays held. A steer that came back is forgotten once no landing holds its card. The owner's
NEWEST steer on a card, by when the owner spoke rather than where storage holds it, decides whether it shows: a later steer still waiting keeps it collapsed over an older one that
came back, and a later one that came back shows it over an older one still waiting, as does one that came back from
the same instant. A settled steer is forgotten and never shows a card. Measured over six days,
124 card-landed relays: intake marks came a median 1.8 minutes after registration, 31 of 39 before the next tick,
and 59 had no evidence of action at all — those are the silent losses this exists to surface.

**The chair cannot record a pass that would bring one back.** A steer sitting unacted should only ever mean no fleet
session had the capacity to pick it up; seven once sat for hours. Surfacing the loss was not enough while nothing on the chair's side read the same verdict, so `supervisor
tick close` and `tick-record` refuse a tick while a steer registered before that tick STARTED is unacted
(`src/supervisor/unpickedSteerGate.ts`, over this same reading; hatch `SLOPWEAVER_ALLOW_UNPICKED_STEERS`). A relay
naming no card is outside it: it raises no card to come back.

The residues: only steers THIS browser collapsed are accounted for, never older relay landings in the ledger,
which would flood the Queue with cards steered days ago; storage that refuses a write keeps the steer in that window
alone, merging what other windows write rather than adopting it. No count forgets a
steer: it is held until something acts on it, or until it came back and no landing holds its card,
so a steer that came back keeps its card on the list for as long as a landing would otherwise hide it. The one age
is `talk steers`' own week-long window (its `sinceIso`): a steer sent before it is forgotten rather than called
unrecorded, and its card falls back to what its landing says, as before this section. Storage
cleared while a console window is open is written back from that window; cleared with none open (site data wiped,
or evicted), the steers are gone, and their cards fall back to what their landings say, as before this section. A
store that is there but does not read loses them the same way. A hiccup AFTER
the chair took the steer up — the send it asked for failing and being retried — draws nothing here: the steer settled
on that take-up, and no ledger yet journals a retried failure against the relay that asked for it.
