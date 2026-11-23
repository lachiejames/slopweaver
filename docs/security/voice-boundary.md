# The console-voice boundary (`slopweaver talk`)

Part of [Security & trust](../security.md).

The second opt-in egress in the product, and the only one that carries your voice. It is per-session:
nothing here runs until you press the voice orb the desktop app floats at the bottom right of your screen — a
console page in a browser tab draws no orb and starts no call (there is one floating widget, the desktop
app's) — and the session then FOLLOWS you across console pages, because the widget is global —
until you press end beside it or quit the app, which tears it down locally.
**"Locally" is the honest word** — see the shutdown bullet, which says exactly what a teardown does and does
not prove about the remote side.

- **Who pays: the owner's ChatGPT plan, and nothing else.** A call runs on the owner's ChatGPT plan, through a local
  `codex app-server` thread, and a plan that refuses is a refusal the page shows — no platform.openai key, model
  or voice is ever tried (the owner's ruling). The plan is a Codex row of the plan register, routed as a Codex seat
  is, so its pause and usage limit hold and a Claude-only install has no voice. How a call runs is in
  [the console-voice detail](../console-voice-boundary.md#who-pays-and-how-a-call-runs).
- **What leaves the machine, and to whom.** To **OpenAI** directly, and onward to the public web through it —
  this machine opens no connection past OpenAI's own host. **OpenAI then searches the public web on the thinking model's behalf**:
  the Codex thread that reasons for the call keeps its live web search (the owner turned it on), so a query it writes leaves OpenAI as a public web search, and the pages it
  reads come from hosts OpenAI's search picks, not from any register here. Its prompt forbids putting a row, a
  file, a name or a tool result into a query (`src/talk/sessionConfig.ts`); that is an instruction, not a
  mechanism, so treat a query as able to carry anything the session holds. What crosses is your
  **microphone audio** and the model's synthesised speech back; the session instructions; the **names and
  JSON schemas** of the tools the console exposes; every tool CALL the model emits; and every tool RESULT the
  console returns. The results are the widest of them: a `talk code read` result is an excerpt of your
  own source, **`file_read` is a window of ANY file on this machine** and `file_list` any directory (the owner's
  pick — [what it refuses and masks](../console-voice-boundary.md#any-file-on-this-machine)), `board_row` is a whole board row including your own earlier words, `read_page` is the card or pull
  request you have open and every row the page draws, `read_supervisor` is the last ~12 KiB of what you and the supervisor chat said to each other,
  `supervisor_history` is every turn of yours and the chair's in up to the last 24 hours holding a phrase (≤14 KiB),
  `recall` is every call turn, relayed steer, ruling and knowledge claim holding its words, all time, as counts and
  excerpts, and `recall_open` one of them whole with a preview of the call turns around it (each ≤16 KiB, read off this
  machine's `talk/`, `runs/` and `handovers/archive/` and the local store only),
  `origin` is a row's provenance with your quoted words and the transcript records its anchors name (≤16 KiB),
  `knowledge` is recalled claims from the local knowledge register (≤14 KiB), `glossary` is a fixed list of
  the fleet's words, `verb` is what one read verb a seat can run printed (≤20 KiB) — a pull request, a Linear
  issue, a Datadog count, and, because the list carries them, **your mail, calendar and Drive files**; past
  20 KiB the whole output is kept for a day in a `0600` file under `talk/verb-spill/` on this machine, and only
  the windows the voice pages through `file_read` (credentials masked) leave it — and
  `browser` is the element outline of one page opened in your own signed-in Chrome (≤20 KiB),
  `slack_thread_after` is one Slack thread read live with your own Slack token — the message a link names and every
  message after it, whole, authors named from the local member rows (≤18 KiB) —
  `slack_unread` is a one-line list of your unread DMs and Slack activity read live with your own user token
  (a quote, the people and a reply count a row), `slack_open` is the one thread or DM conversation a message link
  names — a row of it, a card's thread, the one on your screen — read whole (≤18 KiB), the page adding one
  `notOnOwnerScreen` line naming the thread the call last put in front of you when it read another, `slack_channel`
  is one channel named off your screen, a link or an id, read live with the same token as `slack_open` — its
  newest 50 top-level messages with reply counts, no reply read (≤16 KiB) — all three writing nothing, `slack_send_outcome` is what became of a Slack send you asked for on the
  call — your message's link, the reason a held draft gives, or the words a refused send printed — read off the
  thread and two local registers, writing nothing, and
  `read_screen` is a picture of your whole screen — every app on it — and all are sent because answering the
  question you asked requires them. A look you ask for in words sends one such frame with no tool call: the page
  takes it and the server steers it into the Codex turn answering you, beside a sentence of its own
  (the console's screen-look page has the reason). The draft of the Queue post card your newest words began over goes the
  same way, with no tool call, into each Codex turn those words start: text `read_card` already sends, only sent
  sooner, as quoted data in its own delimited block, and recorded on the relay gate as a read
  ([why](../console/voice-holds-to-the-record.md#the-cards-draft-rides-the-same-steer)). **`slack_thread_after` reads the one thread its link names and writes
  nothing** (`src/talk/slackAfter.ts`): it is `slack read-thread`'s fetch without the attachment stage that keeps
  that verb off `verb`'s list, and Slack text was already in this class — `browser` opens Slack in your signed-in
  Chrome and `verb`'s `store` reads return the Slack corpus. **`verb` runs only a verb on the closed list in `src/talk/modelReads.ts`**,
  each traced to write nothing, spawn nothing and end on its own bar the two kept effects below, with a path, home, wait or write flag — and any argument
  shaped like a filesystem path — refused. `talk capabilities` on that list sends only the catalog's own verb
  names and summaries, which the code tools already read. Two kept effects, neither aimed by any argument: Google's
  own access-token refresh into the matching `secrets/*-oauth.json` grant (`src/secrets/googleGrant.ts`), and
  `codex route`, the Codex plan meter, which asks each Codex store's `codex app-server` for its account and rate
  limits (no model turn, OpenAI only, [data flow](data-flow.md)), leaving the app-server's own `installation_id`
  and SQLite state inside that store, and files each store's `codex_sign_in_observation` row in the local store from the
  answer — never the store's `codex_fleet_cap` row, which a read under the gateway's deadline (handed down as
  `SLOPWEAVER_CHILD_DEADLINE_AT_MS`, `src/lib/childDeadline.ts`) does not file. That deadline fits a live read of
  about thirty Codex stores; past that every row says the live read was not launched and why. The per-store record
  work after the batch is not budgeted, so a register of thousands outruns the kill (MEASURED: 20,000 stores
  were killed at 16s) — far past the five plans owned. **`browser` opens only a host the browser register names** (`src/browser/inspect.ts`), never one
  serving what any customer of that platform published (`notion.site`, `githubusercontent.com`,
  `slack-edge.com`), withholds a page that redirected off the register, has no action vocabulary, and closes
  its tab. **`browser_open` (`browser present`) holds an address to the same rules** and closes a tab that landed
  off the register, but LEAVES a registered one open for the owner (a Slack permalink goes to the owner's Slack desktop app with no
  tab at all, through a `slack://` deep link whose workspace id is one `auth.test` with your own Slack token — it reads
  no message — and when it cannot, the desktop-app handoff tab is closed, its look kept local: the answer is fixed
  words, never the page) — so a row the model read can put a registered page
  in front of the owner, never an unregistered host, and never a click. The owner's own console is the one exception, opened as a
  desktop-app tab on a loopback console only: its pages, never its `/api/` bar a published page's own bare document,
  never a framework `/_` path (`/_next/image` fetches any URL it is handed), nor `/view` framing either
  (`src/browser/presentConsole.ts`), so a console address cannot make the owner's app run a verb or spend a token. **`read_card` and `open_card` add no reach of
  their own**: `read_card` opens nothing at all, and `open_card`, called for the card the call turns to or on the owner's ask (more often than before, never further), opens a card's
  first published page by slug and its Slack thread through that same `browser present` (a thread the call
  already showed the owner is skipped, so it opens less, never more), and moves the console
  to the card — in the desktop app main accepts that move only from the voice window and only
  as a `/queue?` or `/alignment?` path with one `open` and nothing past the Queue's own parameters
  (`consoleCardPathFromMessage`, `desktop/src/consoleCardAddress.ts`); what it sends back is the card and its addresses, the class `action_items`
  already sends. The owner's `openCards` stage switch off, it opens nothing. **`triage_next`, `triage_end` and `triage_clock` add
  none either**: `triage_next` opens the card the PAGE picks through `open_card`'s own presenter, its clock
  is a page timer and one fixed developer line per card (`triage-due`) with the fixed turn the server starts behind
  it, its countdown drawn beside the menu bar item, and `triage_clock` only pauses or restarts that timer. The one
  argument either takes past that, `minutes`, is a whole number the page checks against the owner's own words
  (`site/lib/clockMinutesGuard.ts`); it sets a page timer's length and reaches no server, line or provider. A press of
  Pause timer or Turn triage off — the menu bar, the overlay, or a floating note's file in `hand-steps/triage/commands/`
  — carries a command name and nothing else: on a call it is said as one of four fixed sentences
  (`TRIAGE_COMMAND_WORDS`), and the shell takes a note's file only by its exact name shape, fresh, from a directory it
  keeps `0700`. `triage-due` answers 403 for any visit but the one a successful `triage_next` answer
  of the newest call put up (`site/lib/triagePresented.ts`), so a forged id moves no line, and a fresh call clears it.
  A pass begins only on the owner's own heard words asking to triage (`site/lib/triageAskGuard.ts`), never on the model's
  reading of "the next card". **`focus_set`,
  `focus_end` and `focus_quiet` add no egress**: they set what the page watches, the desktop shell's
  `slopweaver:front-window` answers only the voice window during a call with the front application's name, bundle id
  and window title (a fixed JXA program, no frame, no Accessibility), and that sample stays on the page — the plan
  label, the application's name and the minutes are all `/drift` carries, into one fixed spoken line
  ([why](../console/voice-notices-drift.md)); off ISO in work hours, `/iso-nudge` carries one ISO card's key and
  subject and the minutes, a card `action_items` already sends ([why](../console/voice-nudges-iso.md)). **`meeting_skip`
  adds none either, and holds its skips nowhere durable**: the calendar and event ids and title it holds came off a
  calendar read the model already made, stay on the page, and travel only to this machine's own `/meeting-due` route,
  which uses them only to leave a meeting OUT. Its one durable trace is the `skipped: <titles>` line the call
  transcript keeps for every tool, which no meeting check reads ([why](../console/voice-notices-meetings.md)). Neither triage tool can be steered into carrying what the
  model read to a host of its choosing. A path is looked for where a verb would read one too — after `--flag=`, a `kind:` prefix or a
  short flag — and the verbs run with `GIT_OPTIONAL_LOCKS=0`, so a `git status` they run never rewrites
  another session's index. A bare file name inside a flag bundle has no path shape to catch, so the git
  walk under `velocity run` takes its ref after `--end-of-options`, where git refuses `-pO<file>` without
  opening it (`src/velocity/gitEdge.ts`). Three residues are named rather than closed: an open redirect on a registered host
  (the request that reaches it goes out before the landing is checked); a Postgres statement, which runs on
  after the 16 s deadline kills its client (the one model-written pattern, `store probe --regex`, is refused
  for this); and, on an unbuilt checkout, the CLI under `tsx`, which the deadline's kill does not reach.
  `file_read` and `file_list` reach anywhere on this machine except a credential store — `$SLOPWEAVER_HOME/secrets`,
  the hygiene denylist, `~/.ssh`, `~/.aws`, `~/.gnupg`, a keychain and the like — or a credential-named file
  (`.env`, `*.pem`, `id_ed25519`), refused on the path as asked and on where it resolves; a credential inside an
  ordinary file is masked, and a window the hygiene gate still flags is withheld whole. A PNG, JPEG or WebP
  (by its own first bytes) is sent as a picture instead — re-encoded on the page, so its metadata stays here,
  and **unmasked in pixels**, exactly as a `read_screen` frame is. The other tools'
  verbs read Claude Code's own `~/.claude` — the session transcripts under
  `projects/` that `read_supervisor`, `supervisor_history` and `origin` quote, and the `sessions/` registry that
  says which chat is the pinned supervisor. Nothing the page shows is pushed into the call as you move
  around the console: a card's words reach the model only as the result of a `read_page` it asked for
  (`site/lib/pageVoice.ts`), never as an instruction, because an instruction is read with the authority of the
  prompt and a card's text must never arrive dressed as one.
- **The context pack crosses at mint, once per call.** `talk offer` appends the pack `talk pack --write`
  stored (`$SLOPWEAVER_HOME/talk/pack.json`, `0600`) to the delegate's instructions: the asks waiting
  on you with your own words behind each, every cmux seat's title and last message, your last day of turns to
  the supervisor, and the base branch's last day of commit subjects. It is the same class of data
  `board_row`, `action_items` and `read_supervisor` already send when asked, sent before the question
  instead of after it, and bounded section by section (`src/talk/contextPack.ts`). A pack older than 60
  minutes is left out rather than sent, and the offer report says which (`pack`). While a pack rides in, every
  relay is registered as heard-only (`readsAfter: context_pack`, `site/lib/relayGate.ts`): the pack reaches the
  model as instructions, and the relay gate cannot tell which of its words shaped a steer.
- **Your voice rules cross at mint, on every call and typed conversation.** `talk offer` reads what
  `slack voice-rules` prints, fresh, and puts it ahead of everything else in the delegate's instructions
  (`src/talk/mintVoiceBrief.ts`, at most 24 KiB): your response-shape memory verbatim and your banned words and
  phrases, which no call sent before. They go to OpenAI on your ChatGPT plan like the rest of those instructions,
  and the delegated thread pays about 5,000 tokens for them on every turn.
  The offer report says which state rode (`voiceBrief`), never a word of it; a brief that cannot be read or is past
  the budget sends none of the body.
- **Where the last call left off crosses at mint too, on every call.** `talk offer` reads your voice relays of
  the last three days fresh — your transcribed words, what the voice relayed, and what became of each: the
  row's settlement witness, an intake mark's witness, the last act on the row — with your turns typed into the
  current supervisor chat and its replies, the recent calls' own transcripts, and the rulings journalled since,
  and appends them ahead of the pack; the lessons recorded since come from the stored pack
  (`src/talk/continuity.ts`, ≤23 KiB of sections, plus one lead line naming the link the newest call last read
  through a tool — at most 2,000 characters, already sent once as that tool's argument). Those transcripts are your
  raw words, kept on this machine only, at
  `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl` (`0600`), written as each call runs so a dropped call is not lost —
  each answered read tool's line keeps the link it opened, so a signed link opened there is kept there too;
  words said with a card open are repeated per landing in `talk/card-landings.jsonl` (`0600`) and on the row they
  landed on (`src/talk/cardLandingStore.ts`). Your last
  steer's words, and a newer typed turn with the reply, also go on the VOICE's own instructions, so it can
  answer where you left off when you ask. It is the class of data `read_supervisor` and
  `board_row` already send, and it rides even when the pack is left out, so every relay of every call is
  heard-only (`mintCarriesStandingData`). The delegate's own web search counts the same way
  (`web_search`, a standing read beside `context_pack`), because its results reach the model through no
  tool call the page sees, and so do its code-mode `exec` (`code_mode`), which Codex keeps and runs inside the thread, and its `collaboration.*` sub-agents (`collaboration`), which a launch cannot remove. Every `relay_steer` answer counts as a read too, as every tool answer does: it
  is handed back before the post runs, so it carries only the page's own hand-off note or the gate's sentence, never the verb's output, and it lands right after the relay's own boundary, so it makes no later relay heard-only. Any tool call that rejects counts the same, since its message is text the page did not write. `recent_steers` sends the same read on demand (≤20 KiB).
- **The audio does not pass through slopweaver.** The call's `codex app-server` child performs the SDP
  offer/answer exchange (`thread/realtime/start`) and then steps out of the way: the media and the data channel
  run **directly between the desktop app's voice window and OpenAI**. Only the tool calls come back to this machine, over
  same-origin routes on localhost.
- **The typed box sends the same class of data, minus the audio.** What the owner types into the orb messenger's box
  ([typed and voice](../console/typed-and-voice-one-conversation.md)) goes from this machine to OpenAI on the same
  plan, as a `turn/start` on the delegated Codex thread — no realtime session, no microphone, no synthesised
  speech. Everything else in the list above crosses exactly as on a call: the instructions, the tool names and
  schemas, every tool call and every result — so a Slack permalink the owner pastes is read through `slack_open` (or
  `slack_thread_after`, for what came after it) with the owner's own token and the thread it names is sent. The thread's written answer streams back to the console
  server and from there to the page over localhost. It is started only by the owner's send, never while a call is up, and
  drawn in the messenger it was typed in. A send DURING a call goes into that call instead: the owner's text, verbatim, as
  a `user` item on the realtime session (`thread/realtime/appendText`), so it reaches OpenAI exactly as the owner's speech
  would, and a Slack link in it is read through `slack_open` the same way.
- **A file the owner attaches in the box crosses only when the model reads it, and only through `file_read`.** The
  paperclip, a paste or a drop ([typed and voice](../console/typed-and-voice-one-conversation.md)) takes ONE picture (PNG, JPEG or
  WebP, by its own first bytes, up to 8 MiB) or UTF-8 text file (up to 1 MiB); anything larger, or any other
  binary, is refused whole with the reason and never cut down. Picking it sends nothing off the machine: the page
  posts it over localhost to `/api/talk/attach`, which runs `slopweaver talk attach` to keep a copy at
  `$SLOPWEAVER_HOME/talk/attachments/<uuid>/<name>` (`0700`/`0600`, scratch to the store, so never copied into
  the store). The owner's next send then carries one line naming that file, its kind, its size and its path, and
  that line goes to OpenAI with the owner's message, exactly as above. The BYTES go only if the thinking model then calls
  `file_read` on that path, as every `file_read` does: text as masked windows, a picture re-encoded and unmasked.
  There is no new endpoint, no upload API and no provider beyond the ChatGPT plan's. During a call the voice is
  told to hand the file to the thinking model; that hand-off is instructed, not forced.
- **No credential reaches the page.** The plan login stays in the routed row's `auth.json`, read by the Codex child
  alone; the page is handed a thread id and an SDP answer and nothing that could be replayed.
- **The reasoning runs at OpenAI**, not on this machine. The realtime session hands each turn to the local
  Codex thread, whose model runs on OpenAI's servers with the tool list, so the decision of which tool to call
  — and therefore which of your files to ask for — is made off-device. Judge this boundary on that basis, not on
  the console's localhost origin.
- **It is not a rule-2 headless model, and the reason is structural rather than a promise.** Doctrine bans
  a model a slopweaver process launches where you cannot see or interrupt it. This one is owned by the
  desktop app's voice window you are speaking into, floating over your screen, with what it is doing and for how long, a
  level-driven orb and the conversation, with what is being said at its foot: there is no daemon, no queue it drains, no restart, and nothing starts it
  but your press. **In the desktop shell** (`desktop/README.md`) the same page runs in a transparent window
  over your desktop instead, its orb always on top, and the console window hands every start to it — still
  one call, still drawn, still started only by your press. Reopening the app after quitting it mid-call restores
  the window and the conversation and never the microphone (it waits for the press that starts a call). The shell adds no egress: it loads the console from localhost and nothing else.
  It takes each frame — a `read_screen` call's, your look ask's, or the one a typed message of yours asks for — itself, natively, under the Screen Recording permission you grant
  Slopweaver, so no share is asked of you; the frame is your screen as you see it, the voice's own window in it,
  and it answers the still only to that window
  ([what that trades](voice-relays-and-retention.md)). On your ask it can also dim your screen round one box of
  that still (`focus_screen`): that draws on your own screen and sends nothing anywhere, so the boundary is
  unchanged, and it is neither a relay read nor a writer.
- **The running list is stored here, and the voice can read it.** What you, the voice (`offer_copy`: a draft of your
  words composed for you, a message, review comment or script) and a fleet session put on it is written to
  `$SLOPWEAVER_HOME/talk/running-list.json` (`0600`), newest ten, kept across calls and restarts and sent nowhere by
  being added (`src/talk/runningListStore.ts`, `slopweaver talk list-add`). It reaches your clipboard only on your
  press, and a link in a voice item is drawn as text naming its address on hover, never one a click follows. Its one
  egress is the voice's `running_list` read, which sends the ten to OpenAI as any tool result is sent — through
  `talk list --voice-safe`, which masks credentials in every item, whoever filed it, and withholds one whose text
  still carries a secret after masking, naming only its number. Your own add during a call also tells that call the
  list changed, in a fixed line that carries none of the item's words.
- **What the voice offers is checked and recorded on this machine.** An `offer_copy` reaches the page the way every
  tool call does: over the call's localhost event stream, held in the console server's memory until the call is
  forgotten (`forgetPlanCall`), on a Codex thread started ephemeral. Before it is added, the page posts it to
  `/api/talk/copy-voice` behind the console-press guard, which hands it on stdin, never argv, to
  `slack voice-rules --check-stdin`: that reads your private rules and prints a verdict naming only the rule broken,
  never the text, so the check leaves this machine nothing and writes nothing down. The offer's `destination` travels
  the same local route and decides one thing: `slack` adds `--slack-draft` (the parked-draft shape, and no paragraph
  past 70 words), whose shape reasons name counts and paragraph numbers, never a word of the draft. On a call it is also written once, as it is added, to the call's own
  `0600` file under `$SLOPWEAVER_HOME/talk/calls/` beside the transcript, through the same local route
  (`site/lib/runningListCopy.ts`, `src/talk/callOffer.ts`). A relay of your reaction to it carries the exact offer
  onto the board row in a marked block, through the same local route and a `0600` file; your quoted heard words
  beside it, never the block, say what you decided ([relays](voice-relays-and-retention.md)).
- **The page sends nothing on the data channel.** Codex mints the session, so the page answers every tool over
  localhost to the Codex child and never writes a client event on the channel — no instruction, no
  `session.update`. What the page cannot steer through that channel is bounded by what it does not send, not by
  a list OpenAI enforces. The owner's nudge does not widen this: the page posts an empty body, and the console server
  hands the voice one of its own fixed developer messages (`nudgeTextOf`, `site/lib/talkPlanWords.ts`) to answer the
  words the session already holds, or carry on from them when the voice spoke last, and stops its own thread's running Codex turn, over localhost to the child.
- **Mute is the microphone track only.** The widget's mute disables your microphone track at the press, so
  what you say leaves the desktop app as silence. The plan's v3 session has no `session.input_audio.mute`, so the
  model is still in the call and can finish a turn you began, and a transcript fragment of what you said just
  BEFORE the press can still arrive after it, and counts as your words — so mute is not a stop: the voice can
  still finish answering, or relay, what you said before you pressed it.
- **What shutdown actually does, stated rather than promised.** Pressing end beside the orb hangs up: your
  microphone track goes silent and any screen share ends at once, and the console server is told, which sends
  `thread/realtime/stop` and kills the Codex child. As for `pagehide` when you leave the console and a
  connection the transport reports closed, one `stop()` stops the microphone tracks, detaches the audio element,
  closes the audio meter, the data channel and the peer connection, and bumps a generation that refuses any tool
  answer or startup continuation still in flight — a share chosen in a picker still open is closed, never kept —
  so a microphone permission that resolves after Stop releases itself rather than reopening. Three limits are real and are named rather than smoothed over. **Moving between
  console pages does not stop it, by design, and neither does switching to another app or
  minimising the console window** — pressing end or quitting the app does. **Stopping does not cancel a verb
  already spawned**: an offer in flight can still finish creating a remote session, and a relay already
  posted still completes its write, which discarding the response cannot undo. And **local teardown is not
  confirmed remote closure**: `thread/realtime/stop` is sent and the child killed, but nothing OpenAI answers
  confirms the session finalised, so what a teardown proves is that your microphone is released, this machine
  is no longer connected, and the Codex child is gone.

## The one draft write

The voice's first write to words that go out as you: it edits the parked Slack draft on the Queue card you have
open, while you watch, and **never sends it**, with every capability a live edit needs. Three tools, `src/talk/draftToolSchemas.ts`:

- `draft_edit_start` hands the model the open draft's words as plain text — the text `read_card` already sends —
  and puts your latest words and its one-to-five-line reading of them on the card, under a moving border.
- `draft_edit` saves the model's rewrite as the next version; `draft_restore` puts an earlier version back as the
  next one. Both run `slack draft revise|restore` through `/api/talk/draft`, behind the console-press guard, the
  words on stdin and never argv (`site/lib/draftEdit.ts`).

**The page aims every write, never the model.** No tool takes a draft id, an anchor or your words: the draft is
the card open on your Queue (`?open=post:<id>`), the quote is your latest finished turn from the page's own
transcript, and the anchor is `talk-call:<call>#<turn>`. A file, a row or a card the model read cannot aim an
edit at another draft or put words in your mouth.

**No relay gate, and the residue said rather than discovered.** An edit needs a finished turn of yours on the
call, but unlike `relay_steer` it does not require that no third-party read came after it, so text the model read
could shape the new words. What that can reach is bounded: the words of a draft you are looking at, saved locally,
never sent, and the earlier version one "put it back" away.

**What a revision cannot change, because the event does not carry it** (`src/outbound/slack/draftRevision.ts`):
the channel, the identity, the thread, the files and the prior-ask proof stay the row's own, and the digest is
recomputed over them. A rewrite may drop a tag or an `@here`/`@channel`, never add or repeat one, because a new person or room
reached is a new audience, which is a recording's call. A restore puts an earlier version back whole, its tags
included: "put it back" is the owner's word to reach whom those words reached, never anyone the row has not held. It is admitted as a Codex candidate is: your voice rules, the form schema, the PR-lead check,
reading the conversation's surface with your own Slack token, which is the one call it makes past this machine.

**What it refuses**: a bot row, a released or dropped row, a row whose words its editable text cannot write back exactly, a row carrying your yes (a hold for "not the owner's yes" sets it
down first, and the new words wait for a fresh yes), and a row whose Codex pick is still owed. Every version is
kept in the local parked-draft register under `$SLOPWEAVER_HOME`, so nothing is lost to an edit. Sending is
unchanged: the release command the card prints (`slack reply|post --as me --draft <id> --approve <digest>`), on
your yes, and an edit changes the digest, so a yes given to older words never sends the new ones. A digest binds
words, not a version: putting a version back brings back its digest, so a release command printed for those words
sends exactly those words again, and never any others. That hold already leaves the digest alone the same way.
