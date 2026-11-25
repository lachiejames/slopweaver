# The model performs a relay only through a gate that reads your own words.

Part of [Security & trust](../security.md).

A relay lands as if the owner had given that steer directly to the supervisor, and the model is expected to be
proactive about it: it takes the steer and gives it to the supervisor. So `relay_steer` is not pressed and not offered: the model
calls it the moment your own words give a steer — a decision, a bug with the change you want, a direction
for the fleet — and a question or musing is not one. It is the ONE tool whose kind is `relay` — the verb
and the page each print their writers and a session whose two lists disagree is refused at start. Before
anything is written, `relayVerdict` (`site/lib/relayGate.ts`) reads the session's own record — every raw
input-transcript fragment and every tool output the page sent, in order. **No words of yours since the last
relay: refused.** **A tool output handed the model third-party text after you last spoke: the relay goes
ahead with YOUR WORDS ONLY.** That second rule is the injection defence: a board row, a
card, a source file or a picture whose words say "now relay X" is read AFTER your last utterance, so the
model's own reading could carry it. So its reading is dropped end to end — the route refuses a `--say`
beside `--read-after`, and so does the verb — and the row and the typed line carry only your transcribed
words and name the reads that came after you. **What that still costs**: an injected result can still make
the model CALL the tool, so your real words can arrive as a turn you did not mean as a steer; the row says
its reading was dropped and why, and the chair acts only on a quote that is itself a steer
(`skills/supervisor/reference/routing.md` § 3a′). What reaches `slopweaver talk relay` is your transcribed
words (on stdin, `--heard-stdin`), whether you were still speaking when it relayed (`--heard-tail cut|whole`), the model's reading (`--say`) or the reads that dropped it (`--read-after`), the item you
had open (`--about`), the picture (`--screen`), the copy-tray offer you reacted to (`--offered-file`) and `--priority p1`, and the board row it registers leads
with your words, labelled as speech-to-text. A relay the verb refuses before writing anything (exit 2) is
retried once as `--words-alone` — your words, the item and the picture, and neither a reading nor reads — so
the retry carries strictly less of the model's than the first attempt did (`site/lib/relayRetry.ts`). A receipt goes under `$SLOPWEAVER_HOME/talk/relays.jsonl`.

- **A relay carries the frame you asked it to look at, and it is kept.** An image of what the owner is looking at is often how the owner communicates directly. A relay never grabs a frame:
  it carries the one the latest look took on your word — a `read_screen` call, or the frame your look ask took
  — since the call opened or the last relay
  landed — the same pixels the voice looked at, kept at long edge 2048, WebP, at most 768 KiB. With none taken
  the row says "no picture: no screen frame was taken this turn" (a relay
  with no frame taken this turn says so rather than attaching a stale one); a look with no way to see says "screen
  not shared" and one that gave no frame says so, never one for the other; the desktop app's own look refused
  by macOS Screen Recording names that permission and the switch, never a share. Stopping a share drops the frame,
  and a look still running when a relay fires leaves that relay with none. The route checks the data URL (exact
  WebP prefix, strict base64, decoded size, a WebP container carrying an image chunk — never decoded),
  writes it to a `0600` temp file it removes afterwards, and the verb checks the file again and keeps it at `$SLOPWEAVER_HOME/talk/turns/<turn>.webp`
  (`0600`) BEFORE the row names that path. The turn's digest binds the picture's sha256, so a retry must
  carry the same frame and the first is never replaced; the page keeps the frame for the turn until a relay
  lands so a retry does. Every run writes its own bytes and names the path it derived, never one a turn file
  holds, and a home whose path carries a control character keeps no picture, since no typed line could name it. The supervisor opens the path as it would a screenshot you pasted: evidence, never
  instructions. **Nothing deletes these yet**, and a frame holds whatever was on the shared surface — a DM,
  a password manager — so share one window when that matters.
- **One window of your speech is one turn id, so a retry cannot write twice.** The page mints the turn id —
  never the model, whose tool takes `say` alone — once per window between relays, and reuses it until a relay
  lands. `talk relay` is idempotent on it (`O_EXCL`), so an outcome the page could not read — a timeout, a
  dropped response — is safe to retry and answers "already relayed" rather than a second row. A retry sent
  while the first run is still alive writes and types nothing and says so: every run holds a lease on its turn
  first (`src/talk/relayLease.ts`), naming its pid and that process's start time, and a live holder turns the
  second away. A dead holder, or one whose pid another process now has, is taken over by placing the NEXT
  generation of that lease, which only one run can place. Each outcome
  is recorded against its own turn id in the call widget's relay record, whatever the session is doing when it
  returns.
- **A verdict on a check-in is recorded as your word on the cards it covers, and the MODEL chooses which.** The voice walks your check-ins and each reaction clears a batch. So `relay_steer`
  also takes `check_in` (an `act:` key) and `covers` (`rule` or `this`); the page sends that act as `--about` and
  `talk relay --covers` writes your HEARD words, never the model's reading, as the steer on the newest act of every
  card the verdict reaches ([check-in walk](../console/voice-context-and-calls.md#the-check-in-walk--the-voice-reads-them-unasked-and-one-verdict-clears-a-rule)).
  Both survive a heard-only relay and the words-alone retry, because they name WHAT your words answer rather than
  reading them. **What that still costs**: an injected result could make the model name a different check-in, or
  `rule` where you meant one card, and your words would land on cards you were not judging. Bounded: the key must
  be an act still waiting on you, the cards reached are only those of its own kind and place, a card that already
  carries your word is refused rather than overwritten, the steer is your exact words under `talk:<turnId>`, and
  `slopweaver autonomy list` shows every card it settled. Nothing class-wide is ever written.
- **A relay made while you were still speaking acts on nothing.** One whose `--heard-tail` is `cut`, or a voice
  relay that never said, lands no card, writes no check-in or candidate ruling, stands no discuss-first go-ahead and
  records no channel steer that would widen where a draft may go (`src/talk/relayCutHold.ts`,
  `src/talk/relayHeldSteer.ts`), because cut words may stop short of your "no, wait". Its row and turn file are still
  written, the turn file keeping every word, and a channel steer that only narrows where a draft may go is still
  recorded, since it only refuses a send.
- **A ruling on a workstream candidate is written onto the candidate, and the MODEL chooses which and the word.**
  Without it a spoken ruling never reached the candidate, and the owner was asked again.
  `relay_steer` takes `candidate` and `reaction`, and `talk relay` appends one reactions row with your HEARD words
  ([the candidates walk](../console/voice-context-and-calls.md#the-candidates-walk--a-ruling-is-written-to-the-candidate-the-same-turn)).
  **What that still costs**: an injected result could make the model name another candidate or word. Bounded: the
  id must be a candidate that exists, the turn's digest binds the ruling so a replay can neither write it twice nor
  swap it for another, the row keeps your
  exact words under `talk:<turnId>`, and the latest row stands, so a wrong one is corrected by your next word.
  A yes may promote a register tile, exactly as `workstreams react` would; nothing reaches a person.
- **A reaction to a copy-tray draft carries the exact draft, and your heard words stay what you decided.** A
  relayed "send that one" would otherwise reach the board with your words and not
  the text they answered. So the page logs each offer as it lands in the tray, and a relay since the last one
  carries the newest as `offered`; the route checks it is one tray offer (`copyOfferWireOf`), writes it to a `0600`
  file, and `talk relay --offered-file` checks it again (`src/talk/relayOffer.ts`) and writes it whole onto the row
  in a marked block, `<!-- relay-offer:start talk:<turnId> -->`, each part fenced longer than any backtick run in it
  (`src/talk/relayOfferRow.ts`). The block is the text you were shown; the quoted heard words beside it are the
  authority on whether you approved, rejected or amended it, and no code classifies that. The turn's digest binds
  the offer, so a retry with another offer or none is `RELAY_CONFLICT`, and a run that died between registering
  the row and writing the block is finished by its retry. **What that still costs**: the words-alone retry and a
  typed steer carry no offer; the page's log restarts when the call reconnects or rolls over, so an offer from
  before that is not carried; and a failed mirror after the write is logged, not fatal.
- **What the gate cannot see.** Speech-to-text of something playing near your microphone is
  indistinguishable from you — the voice reading a card aloud included, whenever the microphone's echo
  cancellation lets its speech back in. The row says its words were transcribed rather than typed, and a relay lands
  as a board row you and the supervisor read — never as an act on the world.
- **The screen is taken, one still per look, by the desktop app — the only place a call runs.** The look binds to what is in front of the screen and works across all apps. A browser tab starts no call, so it shares nothing. Under a desktop app too old to look itself,
  `read_screen` answers only while you have pressed "look at my screen" beside the orb and picked a surface in the
  picker; with no share it refuses and tells the model to ask you. The desktop app needs no share, because macOS lets one app
  share the screen at a time and the floating voice is the app you have open: its overlay asks main for ONE still
  of the display it sits on (`desktop/src/main.ts`, `slopweaver:capture-screen`, answered to the overlay only),
  under the Screen Recording permission you grant Slopweaver itself, never a terminal. Either way a frame is
  grabbed only when the model calls the tool or your own words ask for a look, fitted to the size the provider
  looks at and sent as ONE image — over the call's data channel for the tool, steered into the answering Codex
  turn for your ask (`PlanCall.attachLook`) — the same tile cost as a full-resolution capture, about 1,105 input tokens for a 16:10
  display (`site/lib/screenFrame.ts`).
  **What the desktop app's look trades**: with the permission granted, nothing on screen runs BEFORE a look the
  way Chrome's sharing bar does. What bounds it: the page takes the still only on a `read_screen` call or a look
  ask in your transcribed words (`LOOK_ASKS`, `site/lib/lookAck.ts` — the page's matcher, so no tool result can
  fire it, while speech near the microphone can, as it can a relay), and main
  refuses one unless the voice's window reports a call AND holds a live microphone track of its own — the track
  macOS marks with its own indicator — asked before the look and after it, so a hang-up mid-look
  yields no picture (`lookRefusal`, `desktop/src/nativeCapture.ts`; both are what that window reports, so a lying
  renderer could pass it, while the model cannot). With no call up, a typed message whose own words ask for a look
  takes one frame while the messenger is open, a question about seeing takes none, and closing the messenger forgets
  an ask not yet taken (`typedLookGate`, `site/lib/typedLookGate.ts`; `lookRefusal` again, asked before and after). The
  edge pulses, during every call, for every look that took a
  frame, just after the frame — looks landing together share one flash; and "only on the owner's ask" is
  the model's instruction, NOT a gate — an injected tool result could make it look unasked, and the pulse is the
  mark that it did. A `screencapture` verb was weighed and not built for exactly that reason with no pulse at all.
  **What neither can do** is redact: whatever is on the screen when the tool fires — a password manager, a DM — is
  in the frame, and in the app so is the voice's own transcript as it is drawn. When that matters, end the call.
- **The supervisor window is prose, never tool output.** `slopweaver talk supervisor` reads the tail of the
  pinned supervisor's transcript and keeps only your turns (typed, or queued while it was mid-turn) and the
  chair's own text outside a sidechain (`src/talk/supervisorWindow.ts`). A tool result — where a file's or
  a Slack message's words ride — is never in it, and a relay the voice typed in is marked as the voice's.
- **A relay is typed into the supervisor chat as your turn, through one narrow sender.** The line types into the supervisor console as if the owner had sent it. After the gate above
  and after the board row exists, `talk relay --deliver-to-supervisor` types one line into the pinned
  supervisor's cmux chat (`src/talk/supervisorDelivery.ts`), presenting the `CMUX_SOCKET_CAPABILITY` the
  console inherited from the cmux surface that started it (`docs/cmux-client/socket-and-measured-facts.md` § 1) — a credential, never
  logged, persisted or sent anywhere but that socket. The guard that refuses every other session's
  `cmux send` to the supervisor is unchanged — a spawned session's report typed into your box would read as
  your words, and that is still refused. The same hook refuses `talk relay --deliver-to-supervisor` from
  every session but the pinned supervisor, so only the console's one relay route runs it — the call's, spoken or
  typed (the next bullet). It matches the command with its quotes removed, so a quoted flag
  or a `bash -c`, `yarn`, `node` or `tsx` wrapper is refused too. It is a tripwire, as the `cmux send` half
  is: the page's gate runs in the browser, the verb cannot re-check it, and a flag assembled at run time
  still reaches the verb. Nothing a same-user shell can reach authenticates the caller, so a session that
  dodges the hook deliberately can still type a line; that is the stated residue. The chair acts on a
  `[voice relay <slug>]` line only when the real `talk log` lists that slug as delivered and it is not a
  repeat (`skills/supervisor/reference/routing.md` § 3a′), which stops a line typed from another home, a
  `SLOPWEAVER_HOME` pointed elsewhere, from being acted on. The flag refuses `--dir`
  and `--home`. It types nothing into a
  composer holding your own half-typed text, never interrupts a running turn, types no control character
  as a key, types once per turn even when two runs race, and opens every line with `[voice relay <slug>]`
  so the chair can make that check. Only your words are ever cut to fit the line; the picture's path and
  the verify pointer always survive whole. Like any typed turn
  it is attributable, never authenticated (`.claude/rules/cross-session-messages.md`).
- **A console cmux refuses hands the line to the chair's courier, never a wider socket.** A console started wholly
  outside cmux holds no capability and is refused (`cmux-access-denied`). A relay the console spawned,
  past its console-origin gate, then drops one
  request file naming only the turn id into `talk/courier/pending/` and waits three seconds for
  `talk courier --follow`, a background task of the pinned chair that cmux did start, to take it
  (`src/talk/relayCourierHandoff.ts`). The courier reads the turn off disk, types it only when it is registered and
  carries no delivery yet, and claims the delivery first, so a courier stopped mid-type never types it twice. It runs
  only where `CMUX_WORKSPACE_ID` is the pinned chair's, the hook refuses it from every other session, and no token
  crosses a file. Untaken, the relay records `failed (courier-unavailable)`; in every case the row is on the board
  and, when the line did not reach the chat, the voice says so only when the owner asks whether it landed. The same
  courier types the chair's wake when the console could not. A hand run of `talk relay` cmux refuses is never handed
  over, and stays `failed (cmux-access-denied)`. **The residue, stated**: the console holds no credential the
  courier can check, so a same-user process passing the console flags itself can still reach the chair this way; it
  could already write your files directly. The socket strips the presented capability out of every frame cmux sends
  back, and never replays a keystroke after a lost reply (`src/cmux/socket.ts`).
- **A typed steer has one route: the call's chat.** No other field sends typed words to the fleet: the secret paste a
  hand step keeps stores a token, and the named search boxes in Settings and on the Store page only narrow a view,
  the Store's value filter going to the read-only `store rows` and nowhere else.
  `site/__tests__/unit/textInputs.test.ts` refuses any other field. A message typed in the
  messenger is a turn on the call's own thread, so it relays through the same gate and `/api/talk/relay` as a
  spoken one, carrying the card the owner last touched as the item the owner had open; no other page writes a relay or a board
  row. `talk relay --typed` stays a verb a session can run, with no console route behind it.
- **The code the voice can read is bounded, and says what it cannot see**: tracked files only, literal search,
  byte budgets with an explicit `truncated` marker, fail-closed — [the detail](../console-voice-boundary.md#the-code-the-voice-can-read).
- **Any other file on this machine is `file_read`, credentials kept here**: a credential store or
  credential-named file refused on both spellings of its path, a credential inside a file masked, a window the
  hygiene gate still flags withheld — [the detail](../console-voice-boundary.md#any-file-on-this-machine).

- **Retention is OpenAI's, and we make no claim about it.** The call's Codex thread is started ephemeral, so
  Codex keeps no rollout of it on this machine — a statement about this machine, not about OpenAI. What OpenAI
  keeps, and for how long, is governed by your ChatGPT account exactly as the Codex passes are.
- **The console keeps its own journal of that thread instead**, at
  `$SLOPWEAVER_HOME/talk/threads/<callId>.jsonl` (`0600`, directory `0700`; then `.part-000001.jsonl` past 24 MiB):
  the exact `thread/start` request, the thread id, every `turn/started`, `turn/completed` and `item/completed` of that
  thread — reasoning, web searches, completed messages, tool calls — and **every tool answer whole**, recorded as it is
  handed back, before the thread reads it. Deltas and the realtime transcript are not in it; the call file has those.
  Written through `slopweaver talk call-thread-append`, the batch piped on its stdin so nothing unmasked touches disk
  on the way, which masks every credential and private-denylist word to `[REDACTED:<label>]` (identifiers are kept),
  replaces an inline image or audio by its type, length and SHA-256, cuts an entry past 8 MiB with the cut stated,
  and withholds a capture whole, naming why, when a secret survives masking — judged before any cut, so a cut can
  never shorten a surviving secret past recognition. It is an AUDIT record: `slopweaver talk call-thread --call <id>`
  reads it a page at a time, and no search reaches it — not recall, not continuity, not `talk calls`
  (`src/__tests__/unit/talk/callThreadIsolation.test.ts`); only a read handed its path (`talk file`) opens one. A retry's `writeId` already written counts as repeated
  only when its stored line is the one it would write; the same id on a different capture refuses the batch and the
  journal says so, rather than dropping it. **The residue, stated**: the queue is in the console's
  memory, written one batch at a time; a signal drains it for up to 30 s, and a SIGKILL, a crash or a drain past
  that loses what was not yet written — the drain, or else the process `exit` hook, says how many per call on stderr,
  a SIGKILL nothing. `talk/threads` stays on this machine only (the backup keeps your words
  and the record, call threads and tool answers out): it is classed local-only like `talk/attachments`, so
  `store import-fleet` never copies it into your store and no `store backup` dump carries it. A wiped Mac loses it.
- **What a conversation leaves on THIS machine.** No audio is written here. The transcript is, as each call
  runs, at `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl` (`0600`), so a dropped call is not lost, with each completed
  message the thinking model wrote, and the link each answered read tool opened, which the next call's mint sends back so it never asks for it again.
  Each tool line also keeps **what the model was handed, secrets masked**, so a
  wrong spoken answer can be traced to what it read: the text as sent, up to 24 KiB of UTF-8 (`TOOL_OUTPUT_MAX`), an
  image only as a fixed stand-in, never its bytes. The page pipes each batch on the stdin of `slopweaver talk
transcript`, never through a staged file, and the verb masks every credential and private-denylist word in EVERY
  line — tool answers, the owner's words, the model's — to `[REDACTED:<label>]` before the append, with the masker the thread
  journal uses (`src/talk/callSanitise.ts`), so one pasted token no longer keeps the whole call out of the store and
  the backup. A string a secret outlasts every pass in is replaced whole; an answer the markers grow past 24 KiB keeps
  none, counted; an unreadable denylist, a dangling link at its path included, appends nothing and the page posts the
  batch again. Lines written before
  this landed are not rewritten. It is the answer after `file_read`'s masking, since that is
  what the model got, written once the answer was delivered so keeping it never delays one — onto the call the tool
  began on, after its close if the owner hung up meanwhile (`site/components/voice/toolAnswerSettle.ts`); a page that dies
  between delivery and that append loses it, the price of keeping the write off the answer path — and it never feeds a
  model again: continuity and `talk calls` leave it off, and `slopweaver talk call-tools --call <id>` reads it back
  a page at a time. The answer stays on THIS machine: `store import-fleet` strips every tool line's `answer` before
  it stores a call file (`src/store/fleet/callToolAnswerStrip.ts`), so your store and backup keep
  the call's words and its tool lines without what each tool returned. The line names the turn that called it (`turnId`), so `slopweaver talk fidelity`
  reads each answer against what its own turn was handed, here on this machine and with no model. The session tray's folded output (`VoiceSession.tsx`) is page memory and goes with the page;
  this file is what outlives it. A RELAY is
  different and durable by design: `slopweaver talk relay` writes a receipt under
  `$SLOPWEAVER_HOME/talk/relays.jsonl` **and** registers a real board document, which the board mirror may
  in turn write into your selected store. `slopweaver talk log` lists the receipts, each naming the board
  slug it created and what became of its typed line (`typed`, `queued`, `stranded`, `skipped` or `failed`);
  it never claims the supervisor read or acted on anything — a typed line is a line in its chat, and a
  registered row is a row on the board, nothing more.
