# Typed chat and the call are one conversation

The owner expects the console to behave like an assistant: what was arranged by text is still known when the owner
then calls, and the other way round. Three seams make the console's typed and spoken
surfaces one conversation, each reading the same records rather than a copy. The continuity read they stand on is
[voice context and calls](voice-context-and-calls.md#continuity-across-calls--a-fresh-call-knows-what-the-owner-last-steered).

- **Typed, then a call.** `typedConversationOf` (`src/talk/typedConversation.ts`) takes every turn the owner typed
  since the owner's last call ended — straight into the supervisor's chat, or relayed by `talk relay --typed`, each with the
  chair's answer — and the voice's own instructions carry them oldest first, framed as earlier turns of THIS
  conversation. "The owner's last call" is the newest call that has written a line, so the call being minted is never its
  own floor; with no such call it is the continuity window's floor, and the voice is told typing before it is not
  shown (`typedReadFloorLines`). A chair turn opening like a relay line, bare or inside a paste wrapper, but matching
  no steer row is the owner's own typing and rides as one. The newest turns that fit 3 KiB ride; older ones
  are counted, and a partial read says so — of the typed side, even with no turn to show or when the chair's
  transcript outran the tail `talk supervisor` reads (`SupervisorWindow.tailCut`) or held a line that is not a record
  at all (`undecodable`), and of the calls, whose unread
  file may be the owner's real last call and so make the floor too early. Every mint reads from the owner's last call's
  OPENING —
  stamped when the call began, before its own mint read (`useCallTranscript`) — so a turn typed DURING a call, or
  while it connected, reaches the next one, a reconnect included; a call opened before the read's own floor, or whose
  file has a line that did not parse, leaves that floor, said. A typed steer that never reached the board is said as
  missing (`src/talk/turnFiles.ts`). Each answer sits beside its own turn, as the voice is told it, even when it came
  after the owner's next one. This is what the voice KNOWS, never what the screen shows: the next bullet.
- **A call, then typing.** A console steer's line into the chair (`relayTurnLine`) names the call it follows, how
  many of the owner's stretches the chair has not read, and the owner's newest words on it, read off the supervisor's
  own `talk unread` cursor and never advancing it (`src/talk/steerCallContext.ts`). The owner's typed words and the
  verify pointer outrank the whole clause: it rides only when the owner's words fit beside it uncut, and the quotes take only the
  room left. A read that fails is said on the line. The chair's half
  is [routing](../../skills/supervisor/reference/routing.md).
- **One transcript on screen, and only theirs.** The history the owner opens must end on the last message either side
  sent the other, and hold nothing the owner never said or was never told — no supervisor chatter. So the messenger and the stage draw the call files' speech and nothing else — every
  earlier call and typed conversation, then the one going on now — read by `talk thread --json`
  (`src/talk/chatThread.ts`, `site/lib/chatThread.ts`). A call another install's main checkout recorded — a home carried
  from another machine — is left out of it, torn lines and all: its origin names a main checkout at a path under none
  this home's profile declares. That is a path rule, not an install identity, so a home declaring no main checkout keeps
  every call. The owner's turns into the supervisor's chat and the chair's prose
  after them are context the voice is told, never messages on screen. A typed turn carries a small `typed` mark, and
  each stretch after an hour's quiet, or on a new day, opens under its date in words (_"Yesterday"_ and the time of day). A
  conversation giving way is carried on the page until the read that has it on disk lands
  (`site/components/voice/useEarlierConversation.ts`), and a read lacking it never takes it away — a batch can land
  after a later one — unless the read says it left older history out (`cut`) and the turn falls ahead of everything
  it holds; a reconnect or rollover is the same conversation going on. Only the forty turns the stage draws live are
  left out of the earlier history; a turn of the conversation on now older than those is drawn there instead
  (`liveWindowOf`), so no turn is drawn in neither place. Opening the messenger or the stage reads the thread again,
  so a call held in another window is there; it is a read on opening, never on focus, which the owner ruled out.
  The read passes over silent calls until it holds the newest twenty anyone spoke on, so no run of them hides the
  last line. A read that could not open a call file never takes a turn away, and the history ends on a line saying
  a call could not be read rather than on an older turn passed off as the last. A turn whose every line the
  transcript sink lost — a batch the route refused for good, or the queue's oldest past its bound — is never on
  disk, so the page keeps its carried copy for its own life (`site/lib/transcriptSink.ts` names those turns), and
  over the disk's older snapshot when only a later batch of the turn was lost. A
  turn stands in the order it began, across every call, never the order its lines landed in a file or its call
  opened — every line of a turn names when it began, so a refused first batch does not move it — a carried turn too, set among the read's by when the page first showed it, never when its conversation
  ended; the read goes on past the twentieth speaking call until no older-written file can hold a later one.
- **The orb's messenger — the voice's typed twin.** A voice that asks the owner to paste a link "here" needs a here,
  and it has to be one the owner can find and use during a call: what the owner wants is the archive's intercom
  widget. So the desktop overlay, the one floating widget, opens in the middle state, a call card over the orb
  (`site/components/voice/CallCard.tsx`, `site/lib/voiceWindow.ts`), laid out top to bottom: a header with the
  voice's state over what it is running, then talk or hang up, the microphone, the running list, session details, a
  size menu (Small, Large, Full screen, Reset size and position) and close, the strip under it folded in, and the card
  resized by dragging its edges away from the orb, which itself drags anywhere on screen and opens the card on the
  side with more room ([placement](../../desktop/docs/overlay-placement.md)); a band saying what the owner is looking at and what the voice has actually read of it
  (`MessengerBand.tsx`, `site/lib/messengerBand.ts`); the turns (`Messenger.tsx`); and last a box placeholdered
  **Message**, one line tall at rest with no line of instructions under it. The controls are round icons named on hover,
  like the stage's, never over the transcript. Messenger has no button of its
  own; a tray takes the turns' place, one at most, the same one carried onto the stage's left half, none by default:
  the running list, the session details, or the microphone and speaker. The running list (`RunningListTray.tsx`, [store](../store.md)) is the
  same in both media: a typed turn calls `offer_copy` exactly as a call does, and the item outlives both. A send
  opens the call's own delegated thread with no realtime session — `talk offer --typed` composes
  it, `/api/talk/typed` starts it (`site/lib/talkTypedSession.ts`) and each message is a `turn/start` on that thread
  through `/api/talk/call/<id>/say`. It holds the provider's seat as a call does (`useTypedTalk`), so its tool calls
  run through `answerTool` and its relays through the same gate, the owner's words count as heard, and the thread's writing
  streams onto the same transcript. Its call file is marked `surface: "typed"`, so a later call reads it as
  continuity. It is the console's one text input,
  beside the secret paste a hand step keeps; a card wanting the owner's words points here, and the card the owner last touched is the open item it names. One
  conversation per console (`site/lib/talkArbiter.ts`, ruled on the server over every tab): a call started while the
  typed thread is idle ends it first, and waits while an answer is still being written, or for `TYPED_UNSURE_HOLD_MS`
  after a send of unknown fate unless the thread says sooner; a newer typed conversation replaces an older one.
- **Typing into a live call.** A Slack thread link pasted into the box mid-call has to be sendable. So with a call up the box's button
  reads **send to the call**, and it and Enter post the owner's words to `/api/talk/typed-in` (`site/components/voice/
typedInClient.ts`), which finds the one live voice call itself — the window the owner types in may not hold it — and
  refuses when there are two, or when the one up was made after the owner pressed send, since another window started it
  once the call the owner was typing to had ended. `PlanCall.typeIn` (`site/lib/talkPlanCall.ts`) appends them VERBATIM as a `user` text
  item (`thread/realtime/appendText`), never wrapped inside a developer message, so the voice takes them as the owner's turn;
  a retry under the same page id is never written again and is told what the first write came to, and the call's floor holds every other line of its own until the hand-off ends — a tool's result is not one: it answers a call the voice made and is waiting on, so it is never held.
  If within `typedInKickMs` the voice has neither spoken nor started a turn, one developer line tells it to answer
  the owner's message, a Slack link in it read whole through `slack_open` (`site/lib/talkPlanTypedIn.ts`), whose answer
  says when it is not the thread the call last put in front of the owner
  ([once per call](voice-reads-a-slack-thread.md#a-thread-is-put-in-front-of-the-owner-once-per-call-and-a-read-of-another-one-says-so)). The call streams
  a `typed-in` event back, and the window holding the call shows the owner's words as the owner's, writes them to the call file and
  feeds them to the relay gate as heard (`typedInHandler`, `planWiring.ts`). The call stays up; Enter never ends one.
  A refused send puts the owner's text back into an empty box; a send of unknown fate says **maybe sent** and does not.
  A write the session never answered may still be in the voice's context, so it streams back as the owner's turn all the
  same, with no kick. A look the owner typed does not wait out the owner's turn: the console starts the Codex turn carrying its frame,
  which writes to the thread rather than the voice.
- **Attaching files.** Among the controls a call gives the owner is deciding what to share and uploading files, more
  than one at a time, each shown as a thumbnail with an X to remove it. The paperclip beside
  the box picks several at once, each a picture (PNG, JPEG or WebP, up to 8 MiB) or UTF-8 text file (up to 1 MiB), up
  to `MESSENGER_ATTACH_MAX_FILES` (10) waiting at a time, the rest left out and said so. Each is kept the moment the owner
  picks it, all at once: `site/components/voice/attachClient.ts` posts it to `/api/talk/attach`, which runs
  `slopweaver talk attach` (`src/talk/attachmentStore.ts`) to keep a copy under
  `$SLOPWEAVER_HOME/talk/attachments/<uuid>/`. A tile per file above the box (`MessengerAttachments.tsx`) shows a
  picture's thumbnail or a text file's icon, its name and size, and an X, until the owner sends or removes it. Pictures
  pasted into the box (⌘V of a screenshot) or files dropped ANYWHERE on the page go the same way, so a screenshot pastes
  straight in (the window-wide drop is `useWindowFileDrop.ts`, which outlines
  the composer while a file drag is over the page): `messengerTransferDecision` takes every file, leaves a paste that
  also carries text as a text paste, and names a clipboard picture under the browser's generic `image.png` for the
  instant it was pasted (`pasted-<UTC instant>.png`, `-<n>` after the first) so two screenshots read apart. Anything
  else is refused whole with the reason, never cut down. The owner's next send, typed or into a call, carries one
  line per file after the owner's words (`site/lib/messengerAttachment.ts`), name and path JSON-quoted; the files leave the box only
  once the send goes:
  `[Attached: "notes.md", a text file of 4.0 KB, saved at "<path>". Read it with file_read.]`. The thinking model's prompt tells it to `file_read` that path before it
  answers, the voice's to hand it off, and the call's kick line says the same. What leaves the machine and when is
  [the voice boundary](../security/voice-boundary.md)'s.

**Residue.** A turn the owner types into the chair's chat DIRECTLY after a call gets no call-context clause — the chair
reads `talk unread` as it always has. Whether the realtime voice answers a `user` text item on its own, without the
developer line, is unmeasured: the developer line makes it answer within 0.8s, measured, and is sent only on its
silence, so either way the owner is answered. A send is bound to the call that was up at the owner's press by
wall-clock instants on the one machine, so a clock stepped backwards between a call ending and the next being made
could let it through. And a hang-up while the owner's message is still being written streams it back to a page that has already stopped listening,
so that one message, which the voice may have heard just before it ended, is not in the call's file. A typed message takes one look at the owner's screen only when its own words ask for one, and a question about seeing is answered in words ([voice sees the owner's screen](voice-sees-the-owners-screen.md)); a typed thread's opening counts as a call for the
continuity floor. On the plan, a realtime session with text output and a realtime websocket are both refused
(codex-cli 0.157.1), which is why the box runs on `turn/start` rather than realtime when no call is up. An attached
file during a call reaches the thinking model only if the realtime voice hands the turn off, which its prompt
instructs and nothing forces. A kept copy is never deleted, and one the owner removed before sending stays on disk.
