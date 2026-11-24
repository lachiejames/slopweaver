# The voice's context pack — what a lookup reads before it calls anything

Part of [The console, the board, and the session ledger](../console.md).

A voice that takes many minutes to respond does not feel like a conversation, so the owner wants every lookup made
as fast as it can be. Timed, the time was not in the tools — each came
back in milliseconds to a few seconds — but in the delegated model thinking between them, 100 to 3,000
reasoning tokens a step at `high`, and three of ten ordinary questions were answered WRONG because no tool
could see seats or landings at all.

So `slopweaver talk pack --write` gathers, once, what those questions need: the asks the board says are the owner's
with the owner's own words behind each, every cmux seat's title and last message, the owner's last day of turns to the
supervisor, and the base branch's last day of commits (`src/cli/commands/talk/packRun.ts`, pure half
`src/talk/contextPack.ts`). The owner's turns are what `classifyRecord` reads as a person, and the pickup line `cmux spawn` types to boot a chair is not one (`src/transcripts/spawnPickupLine.ts`): read as the owner's, it had the voice open a call with "you pasted the handover". `talk offer` rides the stored file in at mint (composing the board would cost a connecting call seconds) and leaves out one over 60 minutes old or 1 MiB, saying so. `talk pack --write` refuses
past the same bound (`packPastBound`): storing the whole continuity once grew it to 1.44 MB, and from then on
every call ran without it. The console keeps it fresh itself (`site/lib/packKeeper.ts`): every 10 minutes while it is open it runs `talk pack --write --if-older-than 30`, and a call minted without one asks for a rebuild at once, because otherwise a call can open on an 80-minute-old pack nothing has rebuilt since the morning. The chair's sweep is a second writer (`skills/supervisor/reference/sweep-contract.md`).
**A pack that rides in is in place before the first word, in the thinking model only.** The console sends `thread/start`, whose `developerInstructions` carry the pack, before `thread/realtime/start` (`site/lib/talkPlanCallWire.ts` `prepareThread`), so any turn the voice delegates reads it. The voice itself never does (`src/talk/planSession.ts` `talkInstructions`), and a bare greeting is never delegated: on one call the owner's bare hello got "Hi there. I'm ChatGPT…" 1.4s later with no tool call, which made the pack look as if it never loaded. What the first word needs is who the voice is to the owner, not the board, so the [greeting lines](../../src/talk/colleagueGreetingLines.ts) ride the voice prompt AND the voice session's starting history, as one `developer` `initialItems` entry on `thread/realtime/start`: in the prompt alone the voice still opened "Hi! I'm ChatGPT…" on 2 of 4 real calls. `desktop e2e --call --only call-live` says only "Hello." on a real call and FAILS (`self-introduced`) when the voice's first final segment names a product, introduces itself or lists what it can do; `report.json`'s `call.openings` carries the words judged. Whether a given call's pack rode in or was left out is printed by `talk offer` at mint and not recorded per call. **The owner's voice rules ride ahead of all of it, fresh at every mint and whatever the pack did**: [the owner's voice rules at mint](voice-rules-at-mint.md).
An ask whose row names a pull request also carries the owner's words stored on every OTHER row naming it (`prWords`, two
drawn, the rest counted with the rows to read), and, when one of those asked for proof, the last `handover currency`
reading's verdict on its live body (`src/talk/packProofs.ts`): an unmet one leads the entry as `SAY THIS FIRST`,
ahead of the question; a body that reading could not read is said as not checked, never as missing. The pack makes
no GitHub read of its own, and a missing reading is the `proofs` section unread.
A section that could not be read is named as unread, and a section cut to its byte budget says "N more not shown", so the voice never states a total it did not see.
A section not wholly read states no total in its heading. The glossary section is `TALK_GLOSSARY`
(`src/talk/glossary.ts`) itself, never a copy, cut to its byte budget like every other section.

**Measured**: the ten questions replayed through the same delegated Responses loop — same model, instructions
and tools, the real `talk` verbs as tool executors — one run each. Seconds end to end, median
and worst of ten; "right" is each answer read against the board, seats and log as they stood.

| Effort | no pack: median / worst | right | with pack: median / worst | right | tool calls (no pack → pack) |
| ------ | ----------------------- | ----- | ------------------------- | ----- | --------------------------- |
| high   | 23.6s / 51.9s           | 7/10  | 17.9s / 44.2s             | 10/10 | 10 → 7                      |
| medium | 11.0s / 19.2s           | 7/10  | 9.7s / 23.7s              | 10/10 | 11 → 5                      |
| low    | 8.3s / 11.2s            | 7/10  | 7.4s / 13.5s              | 10/10 | 10 → 7                      |

The pack buys correctness; reasoning effort buys speed. `TALK_REASONING_EFFORT` (`src/talk/sessionConfig.ts`),
which every plan launch carries, is `medium` — the owner's pick over `low` and keeping `high`: the most
deliberate effort whose median (9.7s) lands in the 5–10s the owner asked for.

**While a call is live, the console's own polls step aside** (`site/lib/liveQuiet.ts`). The owner's recording of a
call put 20.8s of eight relays' 87s in the browser's queue behind the six fast-lane reads fired every twenty
seconds — one relay waited 12.1s of its 18.2s before the route saw it — so those ticks are held from the
moment a call starts connecting and each held reading runs once at hang-up, 1.5s apart, so the catch-up is
not the same burst. The counts on screen are therefore true again within seconds of hang-up, never during the
call. What still shares the machine: a read already in flight when the call starts, and a channel's first read. A card that left the owner's Queue in the last day is still found, marked removed ([how](voice-finds-a-card-that-left.md)). "Is there already a card for this" searches the whole board by topic, Queue or not ([how](voice-finds-a-card-by-topic.md)). "Where is the briefing" reads all four places a session ends in, and the files a card or run names, before it says a word about whether one exists ([how](voice-finds-a-deliverable.md)).

## Continuity across calls — a fresh call knows what the owner last steered

A fresh call has to know the steer the owner gave the previous one minutes earlier. The pack already carries the
owner's supervisor turns; what it lacks is freshness — it is rebuilt once a sweep, so a relay made minutes before is
not in it — and a shape that says "the owner's last steer, and what became of it".

So `talk offer` reads, FRESH at every mint, what the last calls left off (`src/talk/continuityRead.ts`, pure half
`src/talk/continuity.ts`, about 0.1s): every steer the voice relayed in the last three days with the owner's own words and
what became of it — the row's settlement and witness, an intake mark, the latest act on the row, or only that it
reached the chat — the owner's turns typed straight into the current supervisor chat with its next reply, the calls
themselves as they were written down (below), and the rulings journalled since. The lessons recorded since come from the stored pack, since opening the store costs seconds, and are the only half of this read the pack stores.
The block leads the delegated instructions, ahead of the pack; the owner's last steer's words, and every turn the owner typed since
their last call (below), also go on the VOICE's own instructions, because the Live model never sees the delegated ones —
so the voice can answer "where were we" with them, never unasked and never with what became of that steer (`src/talk/continuityRender.ts`).
`recent_steers` (`slopweaver talk recent`) reads the same thing on demand, over a longer window and with the lessons read live.

**Measured** as the pack was: ten "what did I last steer, did it land" questions, each to a fresh session of the
same delegated loop at `high`, one run each, both arms at once over the same state. "Right" names the
steer the question means — the owner's newest by any route for "my last steer", the voice's last relay for "what I told
you" — and its state, with no false claim about which came last.

| Arm                                         | median / worst | right | tool calls |
| ------------------------------------------- | -------------- | ----- | ---------- |
| pack only                                   | 33.5s / 91.4s  | 9/10  | 11         |
| pack + where you left off, relays only      | 10.6s / 36.9s  | 7/10  | 2          |
| pack + where you left off, with typed turns | 15.3s / 28.0s  | 10/10 | 1          |

The middle row is why the typed half exists: with relays alone, a fresh call named a relay sixteen minutes
older than the console batch the owner had just typed to the supervisor as "your last steer", three times in ten. The
pack-only arm got there by calling `read_supervisor`, at twice the time; its one miss named a typed turn
nineteen minutes older than the owner's newest. Re-run on the landing tree over the same state, the typed-turns arm held:
10/10, 14.5s median, 26.2s worst, four tool calls.

**Residue.** The block is a snapshot at mint: a reply the supervisor writes during the call is `read_supervisor`'s
or `recent_steers`' to find. Only the current supervisor chat's typed turns are read, not an earlier chair's.
Typed chat and the call are one conversation: what the owner typed since their last call reaches the next one, and a typed
steer after a call names it — [one conversation](typed-and-voice-one-conversation.md). The screen draws only what the owner
and the voice said to each other, never the owner's supervisor-chat turns. The voice volunteers no figure, status, relay's delivery or side note, and every line the console puts in its mouth is recorded with why, so "where did that come from" has an answer ([the owner's P1](voice-says-only-what-was-asked.md)).

## The walk — any run of items, the voice carries it and never goes quiet

Walking a run of items with headphones on, the owner should never sit waiting for a next item the voice does not know
they are ready for. In one call walking the workstream candidates the owner had said the word next six times in
twenty minutes: only check-ins carried a walk, and the relay note told the model to answer what the owner said **or**
go on to the next item, so relay after relay ended on an acknowledgement.

- **Any run of items is a walk** — a register, a card set, the owner's queue, the owner's check-ins, an interview (a run
  of questions the voice is asking the owner), or a request to keep giving the owner things to react to. Once the owner
  has reacted, the answer ends with the
  NEXT item in the same turn, after a beat; never a bare acknowledgement while items remain. Both prompts carry it
  (`src/talk/sessionConfig.ts`), and so does every relay's note (`SILENT_RELAY`, `site/lib/relayAnswer.ts`), because a
  reaction is usually a steer and the relay's answer is what the model last reads.
- **A lookup never silences a walk, and neither does a relay or the owner's pause.** A next question that does not depend on the
  lookup goes over as commentary before it looks, and the voice is handed it mid-turn once the owner's words are quiet; that
  restarts the progress line's window; a pause after a finished thought ends the owner's turn at once. Why, and its limits: [walk silences](walk-silences.md).
- **An answer and the question after it are two beats**, because with no gap between them the owner can miss the
  question and have to ask again. The voice finishes the answer, takes a breath of silence, then asks the question as its own sentence; the
  thinking model puts that question last, on its own line. A prompt is the only lever: `thread/realtime/start` takes no
  pacing setting, and Codex's handoff voices the final answer whole.
- **"Next" skips**; a question or tangent is answered and the same item's question is put again in one line, so the
  turn still ends on something for the owner to answer without a decision the owner has not given being skipped past.
- **"Rapid fire"** is each item's title, one line of evidence and the question. **The end** is "that's the last one".
- **The voice speaks the next item the thinking model hands it**, never trimming it to keep a turn short: its
  "say there is more and wait" rule is scoped to outside a walk.
- **A walk reads only what the owner has not ruled.** In one call, asked for a candidate the owner had not steered
  yet, the voice read one the owner's steer on another workstream had already superseded. Before reading an item the model checks its own reaction
  (`verb workstreams candidates`, one line per candidate with the owner's latest reaction, on the voice's read list —
  `--json` is refused, being past the 24 KiB tool answer), `recent_steers`, and this call; a steer on one item can
  settle another. A ruled item is named with its ruling in one clause and skipped, and "one I haven't steered yet"
  is answered with how many remain.
- **A named card is read whole before the first sentence.** The owner comes to a card expecting the voice to have read
  it and everything it links to; on one card the model had read the row and the PR, not the linked HTML mockup. So
  "this one" reads the card and every page, screenshot, pull request and row it links to DIRECTLY (not the links
  inside those; its briefings arrive [already read](voice-opens-the-card.md)), and the first sentence carries a
  detail from a linked page; the voice's waiting line is a word or two, never "I'll take a look". A link that will not open is named after everything else is read, and when none
  would open the first sentence says so and why, with the card's own words carrying the rest. In a walk the
  answer reading item N has also read N+1's card and links, which stay in the thread's context, so the answer after
  the owner's reaction does not wait on them. That is not concurrency — nothing runs while the owner speaks; the delegated thread
  is idle between the owner's turns — and it moves N+1's reads onto N's answer.
- **A bare GitHub attachment link is not readable yet.** A card's `github.com/user-attachments/assets/…` mockup
  reaches no door the voice has: `github read` wants an issue or pull request, `browser` withholds the signed S3
  landing it redirects to, and no talk tool but `read_screen` returns an image. The voice names it as the link that
  would not open; an image-returning read is its own row.
- **Measured** on the real delegated thread, replaying the owner's 55 turns from that candidates call: answers ending on something
  for the owner went from 21 of 55 to 54 of 55 ([walk silences § Measured](walk-silences.md#measured)).

## The check-in walk — the voice reads them unasked, and one verdict clears a rule

The owner paces away from the computer; the voice picks the next check-in, reads it out, the owner reacts, clarifies
or goes on a tangent, and it goes on to the next without the owner's push. And pushing back on CodeRabbit is routine, so a check-in asks whether the reason the fleet gave held in THIS case, with
that reason and its evidence in front of the owner — never whether the kind of act is right.

- **The pack carries them** as RULES (`src/autonomy/checkIns.ts`): every act card still waiting on the owner's word (the
  [Alignment page](./alignment.md)'s, never the Queue's), grouped by kind and place (a GitHub `owner/repo`, a web host, the board, this machine), the rule clearing the most
  cards first, each read as its newest act — what was done, the reason, the evidence, the board row and that row's
  tags (`src/talk/packCheckIns.ts`). Its section is 12 KiB of the block's 46 KiB, and not yet re-measured on the
  bench above. `slopweaver talk check-ins [--skip <n>]` is the same page read fresh off the register, on the
  voice's read list, for past the pack and after a few rulings.
- **A verdict rides the relay.** `relay_steer` takes `check_in` (the act's `act:` key) and `covers` — `rule`, or
  `this` when the owner limited it — and the page posts that act as the relay's `about`, whatever card is open, with
  `--covers`. `talk relay` records the owner's HEARD words as the owner's word on the newest act of every card the verdict reaches
  (`src/talk/checkInRuling.ts`), under `talk:<turnId>`, so a replayed turn writes nothing twice; a card the owner's word
  already settled is refused rather than overwritten, and a ruling that fails never fails the relay.
- **It is per card, never a class steer.** A class steer settles future acts too, and the kinds the owner still wants
  asked about are kept off every class (`skills/autonomy/reference/class-steers.md`); a verdict settles the cards
  that are there now. A check-in moves no Alignment count, since that count is the general-ruling questions the owner
  has not answered and never an act. The voice's `action_items` answer counts no act.
- **The relay's answer tells the model to say how many cards the rule covers** — from what it read the owner, since the
  answer comes back before the verdict is recorded — and to read the next one in the same answer
  (`site/lib/relayAnswer.ts`'s `handedOffAnswer`); the voice's own paragraph keeps the walk moving, since a voice told
  nothing waits to be asked. How many it actually cleared is journalled on the relay's line.

## The candidates walk — a ruling is written to the candidate the same turn

A voice that reads the owner workstream candidates the owner has already ruled on is a bug: nothing it relayed reached
the candidate, and it had no way to read which the owner had settled. Pacing is [the walk](#the-walk--any-run-of-items-the-voice-carries-it-and-never-goes-quiet)'s; this is the walk's memory.

- **It reads only what is open.** `workstreams candidates --unruled` is on the voice's read list
  (`src/talk/modelReads.ts`) and is the only list it offers the owner; `--ruled` names each ruling — the owner's word, the day and
  what the owner said — for when the owner asks about one the owner settled, newest ruling first. Both are the text form (`--json` is
  refused to the voice): a candidate id is at most 80 characters (the file refuses longer, the relay's own bound), a
  name is cut to 80 so it can never push the ruling off the line, and the listing stops at 17 KiB once escaped, under
  the 20 KiB a verb answer carries, ending on how many it left out rather than being cut mid-list.
- **A ruling rides the relay.** `relay_steer` takes `candidate` (its id) and `reaction` (the owner's word), the page passes
  them through, and `talk relay --candidate --reaction` appends the reactions row through `recordReactions`, the
  same writer as `workstreams react`: `via` `word`, `bySession` `talk:<turnId>`, `heard` the owner's words
  (`src/talk/candidateRuling.ts`). The turn's digest binds the ruling, so a replay naming another candidate or word
  is refused as a conflict even when the first write failed and left no row; an exact replay writes nothing. One
  turn carries one ruling, never beside a check-in verdict.
- **The answer counts it as ruled for the rest of the call** (`site/lib/relayAnswer.ts`'s `handedOffAnswer`): the
  page answers before the post writes it, so a fresh `--unruled` read may still list it, and the model is told
  never to offer it as open again. Whether it was written, or is still open and why, is journalled on the relay's
  line. A refusal never fails the relay — the owner's words still reach the board.

## "What now" gets options, and the fleet's state gets a measurement

"What now" gets two to four costed options and a lean; the fleet's state is measured first, or names who is finding
it and where it lands. The case and the paired runs: [voice offers options](voice-offers-options.md). The owner's ask for a fix on a team repository gets one question first, once a call, and the owner's answer stands: [discuss first](voice-discuss-first.md). An explanation leads with one concrete example and keeps it, and a judgement question is asked only after the owner's recent steers are read: [example first](voice-example-first-and-steers-read.md).

## The call is written down as it runs — a dropped call is still read

A dropped call must not lose the steers the owner gave it, as it did when the transcript lived only in the page. So
the page appends every line of a call to `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl` (`0600`, in a
`0700` directory) through `slopweaver talk transcript` behind `/api/talk/transcript`: the open, each stretch of
speech when first heard and when the grouper closes it, a 4 s snapshot of the one still open, every relay line and
tool line, [its exact answer kept](../security/voice-relays-and-retention.md) after delivery, each completed message the thinking model wrote (`wrote`: [why](voice-holds-to-the-record.md)), and the close. Beside them, what Codex says of a turn that is not an item: a `model-wait` line for any stretch of 35 s or more the turn waited on the model with no item running (measured on the server, so a page replay never writes it twice), and `codex-retry`, `codex-error` and `codex-warning` for app-server's `error` (`willRetry` deciding which) and `warning` notices (`site/components/voice/planWiringCodexLines.ts`). Nothing re-sends a turn on its own: Codex's `willRetry` is the only re-send, since a second send of the owner's words is its own harm. One batch (a 0.8 s spawn idle, 14–33 s at load average 70–113) is in flight at a time, the
route's bound on it two minutes. No answer, a failed append or a timed-out run (503) puts it back at the front,
retried within 4 s; a malformed batch is refused (422) and said on the page (`unappendedStatus`). Each line carries a
`writeId` minted as it is queued and kept through retries, and the verb skips an id the file already holds, so a
batch the route killed after it appended goes in once (a ten-second bound once killed starved appends and fourteen
batches of one call went in twice). The last rides a `keepalive` request as the page hides, queued again if unanswered
(`site/lib/transcriptSink.ts`, `site/lib/talkTranscript.ts`, `src/talk/callStore.ts`). A call with no close line
reads "no end recorded — it dropped or the page went away". Words said over a card: [card landing](card-landing.md).

**Only the owner's console writes the owner's live home, and every call says which console it came from.** A fleet finding: a seat witnessing its branch console on `:3001` played synthesised speech into a browser, and two
calls landed in the owner's real call store as the owner's own speech and reached the chair as the owner's words. So both
talk routes pass the verb where the SERVER serves from (`site/lib/consoleOrigin.ts`: its checkout, the port it
listens on as Next sets `PORT`, `DOCS_SITE_PORT` or 3000), never the page or a request header. The verb stamps that origin on every `open` line,
replacing any the page sent, and refuses (exit 2, so the page drops the batch) a console that is not the owner's — a
checkout that is not the owner's main checkout (git must confirm a main worktree the owner's `profile.json` declares, so a linked
worktree, an unreadable one or a separate clone is not), or any port but the default — writing into the user-default
home (under `$HOME` or the account's own home) or anywhere inside it, into any home holding a `profile.json` (an
install's live home, wherever `SLOPWEAVER_HOME` points), into a home or handover dir holding any symlink
or hard-linked file (a link can carry a write into the owner's home, and a fresh witness home holds none) (`src/talk/callOrigin.ts`,
`src/cli/commands/talk/consoleOrigin.ts`, hatch `SLOPWEAVER_ALLOW_NON_OWNER_CONSOLE_LIVE_TALK`, read from the console
server's environment). Relaying with `--deliver-to-supervisor` or waking the chair from such a console is refused from
any home with no hatch at all: words typed into the owner's chat read as the owner's, so only the owner's console types there. A witness run
starts its console on its own home: `SLOPWEAVER_HOME="$(mktemp -d)" DOCS_SITE_PORT=<port> yarn docs`. A call with no origin
predates the stamp and is read as the owner's, so a console that is not the owner's appends only to a call it opened itself, under
its own origin, and never revises a segment begun under another — even with the hatch open; a malformed one makes its line unparseable rather than unstamped. Speech on
a stamped call that is not the owner's is never among the owner's words: `talk unread` names it as not the owner's, with its origin (`foreign`
in `--json`), and a mark passes it, so it neither reaches the chair as intake nor wakes it. A stretch keeps the console it began on, so a
later open never re-labels the owner's words (`src/talk/unreadWords.ts`). A call the desktop TEST instance placed through the owner's own console carries `origin.instance: "e2e"` and is never the owner's either: [how it is marked](../../skills/desktop/reference/e2e.md).

**A plan call writes its own token cost down** (the owner wants to know what a call costs as it ages). The delegated
Codex thread is ephemeral, so the app-server's `thread/tokenUsage/updated` is the only record of it: `PlanCall` passes
each one for its own thread to the page as a `usage` event, on a replay ring of its own so a long call's usage never
evicts a tool call the page has yet to claim, and the page appends a `usage` line — the turn's `last` counts, the
thread's running `total` and the model's context window, or `null` when unknown. `talk calls` folds one per turn, the
latest wins. A realtime-v3 call's own audio usage still is not reported to the page; this measures the thinking half.

**The 90-minute ceiling is the console's, not OpenAI's** (`PLAN_CALL_LIMITS.lifetimeMs`, `site/lib/planCallContract.ts`):
a measured call ran 89.9 minutes, past the API's documented 60-minute Realtime cap, before ours fired. **A pause
before it saves the owner**: past 80 minutes a call rolls over in one, and so does one whose thread's context passes 85% of its window, before
Codex compacts it mid-turn ([call rollover](call-rollover.md)). A call that
had gone live and ends on any reason the owner did not ask for plays a clipped cut-out (`site/lib/callDropCue.ts`); the owner's
hang-up, a page leave and a start that never went live are silent. **A lost link is heard and seen within seconds,
never mistaken for a slow reply, and that same drop reconnects on its own until it succeeds, still seeing the owner's screen,
never past the page, and every attempt is written onto the dropped call**: [call reconnect](call-reconnect.md).

It has seven readers. `talk calls` is what the call widget's session details tray folds as **earlier calls** under the relays;
`talk recent` carries the calls beside the steers; and the mint's block names the owner's words on the owner's last call (the newest
WITH A LINE) after the owner's last relayed steer as never relayed, and the voice's opener leads with them, so the next call
picks up from what was said, the [link it was reading](call-reconnect.md#the-link-it-was-reading) and, [minutes after the owner's last](call-reconnect.md#a-call-the-owner-starts-minutes-after-their-last),
its last exchange, never asking the owner to say it again (`unrelayedWords`, `src/talk/continuityCalls.ts`). The fourth is the chair; the fifth `talk cut-ins`;
the sixth `talk thread`, the speech alone of every call and typed conversation, which the messenger and the stage open
on ([one conversation](typed-and-voice-one-conversation.md)); the seventh `talk fidelity`, each answer beside the tool answers its turn read and
what the voice said beside what it was handed ([a summary keeps its source's claims](voice-holds-to-the-record.md#a-summary-keeps-its-sources-claims)). The residue:
a snapshot is at most 4 s old, so a stretch's last seconds are lost if the page dies; a browser crash sends nothing.
A desktop voice renderer crash still closes its call ([call reconnect](call-reconnect.md#the-voice-window-crashed)).

## Every word the owner speaks reaches the chair

Every word of the owner's transcripts with the voice is seen by the supervisor, and a word going unseen must be
impossible. The relay carries the voice's reading of a steer, and in one morning it dropped three whole ones (the
named acceptor, voice manners, the Notion policy proposal and Pino redaction); the chair found them only by reading
the call files itself. So the chair reads the call files, not the relays:
`slopweaver talk unread` prints every segment of the owner's speech appended since the `supervisor` cursor, relayed or not,
each named `talk-call:<callId>#<segmentId>`, and `talk unread --mark` records them read. The sweep runs both every
tick ([voice-unread](../../skills/supervisor/reference/voice-unread.md)), and `supervisor tick-record` refuses a tick
while any FINISHED word of the owner's is unread, however young (`src/supervisor/voiceUnreadGate.ts`, hatch
`SLOPWEAVER_ALLOW_UNREAD_VOICE_WORDS`). A stretch the owner is still speaking is named instead of refused once the chair has
read its start: it is unfinished, not cut, its call has written no end since it last opened, a snapshot of it is
behind the cursor, and it grew within 60 s of the tick. A monologue snapshots every 4 s, so refusing it once held a chair's
pass for ten minutes with every finished word read. Nothing marks it read: it refuses a later tick once
it is final, its call ends, or it stops growing — the last is how a call dropped without an end line still refuses.
The residue is named: a chair's LAST tick may pass a stretch it has read only the start of. A stretch nobody has read
any of still refuses, so the chair reads and marks once more right before recording. A partial overtaken in flight by
its final, landing after a mark of that final, is still reported as finished.

**A finished stretch wakes the chair; the relay is not how the owner's words arrive.** The supervisor reads the owner
live whether or not the voice relays, rather than starting only once the voice has relayed a few times. And a turn
per stretch and per relay took several turns for one thing said, so the chair hears a call as **one turn per quiet stretch**: nothing is typed until the owner has been quiet
`QUIET_BEFORE_DELIVERY_MS` (two minutes, `src/talk/chairWake.ts`) since the owner's last word — any unread stretch's newest
snapshot, or a spoken relay's hold — and then ONE `[voice batch]` line names every stretch and held relay since the
last, in order (`src/talk/chairBatchLine.ts`). A finished stretch sets the server's one pending wake, pushed back by
each after it, to run `slopweaver talk wake-chair` with its console origin 5s past the floor
(`site/lib/talkCallAppend.ts`); the chair's `talk courier --follow` asks the same every 5s, catching a relay held
last or a wake a restart lost ([relay-courier](../../skills/supervisor/reference/relay-courier.md)). It types through
the relay's guarded path — the pinned workspace, never over the owner's half-typed words, never an interrupt
(`src/talk/supervisorDelivery.ts`) — a pointer, never a summary (the chair reads the call file), so a forged
one costs a read. One unread batch costs one line: one typed, queued or unconfirmed holds the next 10 minutes while
the `supervisor` cursor is short of its bytes; one being typed holds while its process runs; a skipped, failed or
stranded one holds nothing (`talk/chair-wake.json`). A stretch the chair marks short of is still finished and unread,
so `tick-record` refuses that pass. The intake audit counts the line witnessed by the relay rows it names; `profile
words`, the voice's window on the chair and a quote's check leave it out as a turn of the owner's.
A failed relay is journalled, never reported ([voice-failure-toast](voice-failure-toast.md)), and where a relay went — the board, the chair's chat, refused — is said only when the owner asks whether a steer landed ([why](voice-says-only-what-was-asked.md)).

**How the read counts a word read** — a byte cursor per call file, a batch that fits one tool result, a stretch
printed by its newest snapshot, the 16,000-character cap and the residue no verb closes — is
[how the chair reads a call file](how-the-chair-reads-a-call-file.md).
