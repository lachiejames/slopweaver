# The fourth surface: the work console at localhost:3000

Part of [The console, the board, and the session ledger](../console.md).

The site's root IS the console (a polished SaaS work console with the docs embedded, the
live UI most prominent). `site/app/(console)/` is a root layout of its own — a sidebar topped by the
Acme/Slopweaver context switcher, each context carrying its own mark (Acme's a synthetic drawing), then the six pages the owner opens and Settings and Docs at its foot,
and nothing explanatory (the instance's name does not earn the top-left corner) —
and the docs sit under `/docs` through Nextra's `contentDirBasePath`, a `content/console/<page>.mdx` per page
saying how it is derived, reached from `/docs` rather than from the page. [docs-site.md](../docs-site.md) is the site itself,
and how it runs: a production build from the main checkout (`scripts/docs-site.sh --serve`) that rebuilds and
restarts itself whenever that checkout's HEAD moves.
The sidebar's pages, in order: `/queue`, then `/alignment` (between queue and
pull requests), then `/pull-requests` — the Queue and Pull requests are the two whose badge is drawn hot, waiting on the
owner's word (the ones with the numbers next to them need to be together; Alignment sits between them), `/workstreams`
(the owner's outcomes, each a bar from the problem raised to the loop closed), `/automations`, `/fleet`
(Fleet: what each running session did, is doing and does next; its Next view leads with what the owner
would wake up to — what the measured pace lands overnight and how long the ready work lasts — then Next up
and the owner's steers); `/` opens the Queue (`next.config.mjs`). The sidebar is cut to the pages the owner opens:
every element on the UI must earn its place, and the owner does not visit a Steers page or a talk and voice
page. `/alignment` is a sixth, between the Queue and Pull requests, because how Slopweaver aligns with the owner
while the owner lives in it is one of its most special properties and must be prominent. It holds the acts to look back on, the owner's voice as measured from the owner's sent Slack and,
the owner's steers and whether each was applied, in its `#steers` section ([alignment](alignment.md)).
The voice's controls and record live in the call widget (below).

There is no Setup page and no first-run flow (its pages live in the settings modal or tabs, so everyone reaches the right place without being forced through a
sequence; the owner hates onboarding flows). Nothing redirects anyone anywhere, and `/setup` itself redirects to `/queue#settings/models` (`next.config.mjs`). Connecting a plan
is **Settings → Models** (`ModelsSettings.tsx`, [settings](../../site/content/console/settings.mdx)): two provider cards
while none is connected, each plan's usage-limit drop-down once one is, and a Connect that opens the provider's own
sign-in page in the browser (`plans connect`), never a terminal. While no plan is connected the sidebar's
Settings entry carries a dot (`NoPlanDot`, `noPlanConnectedOf`), and every page that can be empty draws one designed
empty state (`PageEmpty.tsx`, marked `data-page-empty="<surface>"`): what will appear, what makes it appear, and —
while a current plans reading holds no plan — **Connect a plan**, which opens Settings on Models (`pageEmptyActionOf`).
The Queue, Pull requests, Workstreams, Automations, Fleet and Alignment's act list carry it; Alignment's rulings name
what makes one appear and offer no button. It stands only on readings proven now (`provenNowOf`, `emptyProvenOf`): a
list emptied by a reading kept over a failed or refreshing read draws a plain "as of the last reading that answered"
line instead, never a blank. The owner's voice is no step: it is learnt from the owner's sent Slack, never asked
(asking questions is the wrong way). The board and the autonomy ledger stay read-once, so
a new board row still needs a page open to appear.

Every entry carries a number or says why it has none (every sidebar item
has a number badge next to it). One registry, `SIDEBAR_ENTRIES` in `site/lib/sidebarCounts.ts`, names each
entry's decision, and the shell draws only what it decides, so an entry cannot join without one. The Queue's and the
Pull requests' counts are drawn hot while nonzero; three counts are NEUTRAL, never hot: Workstreams counts the unfinished ones in the context
shown (zero when every one is done, abandoned or kept here only — it should show zero, not a hundred), Automations
the ones switched on whenever they next run (the verb's `switchedOn`; the owner's pause or a disabled row stops it counting,
the fleet's fix hold does not), Fleet the sessions working now (the number the Fleet glance prints, through the same
function; every badge reads the live channel, so a `?fixture=` page freezes only itself). Alignment carries the general-ruling questions the owner has not answered, never acts (the number that page's head
prints, 0 when nothing waits), neutral too. Settings and Docs carry no number by design, and each row's hover says why: Settings holds
plans and preferences and carries a dot instead while no plan is connected, Docs is reference. A count made from several readings prints nothing until every one of them is
current; it never sums the ones that arrived. The badge sits
inside its row, so the whole line is one click. The sidebar keeps what the owner opens, as measured on the owner's own visits. Above the Docs link sits the update
line: up to date, or one update with every change it brings in one list, the owner's asks
first, read as sentences in a release-notes modal, and in the desktop app the one Update now button under it ([runtime](../docs-site/runtime.md)).
A landed update says nothing more; only a failed one leaves a line. Nothing sits above the update line: the
per-source freshness strip, its notice and the Incidents indicator were cut as noise. A Slack panel still says how old its stored copy is
beside its own "read" receipt; `slopweaver automation freshness --json` is the reading
([source freshness](../../skills/automation/reference/source-freshness.md)).
Two drill-downs are reached from a row rather than the sidebar: `/queue/mail/<slug>/<digest>` (one email draft, whole) and
`/fleet/session/<id>` (one session's latest turn). It is a different surface, not a different truth: every
tile shells a `slopweaver` verb and renders what the verb printed, so the console and the terminal cannot
disagree.

Six properties are what make it trustworthy rather than decorative, and each is a mechanism:

- **A closed allowlist is the only place an argv is assembled** (`site/lib/liveVerbs.ts`). The route takes
  a SLUG off the URL and looks it up; nothing the URL carries is ever spliced into a command, and `store read`,
  `turn` and `cmux spawn` are simply not in the map — so "no tile launches a model" (rule 2) is a
  property of the data structure rather than of anyone's restraint. Every row runs a verb, never `git` and
  never `gh` (rule 3).
- **A failure is a value, never an empty render.** `LiveResult` carries `notMeasured` with the route's own
  reason and the tile draws a staleness mark (`StaleMark.tsx`) where the value goes, whose hover leads with
  `<Subject> could not be read. <one plain line>` and folds the raw reason under **Full message** (`plainReasonOf`,
  `site/lib/plainReason.ts`: a transport or coded failure gets a fixed sentence, a raw-looking one a generic line,
  never a guess; `WarningMark.tsx` renders it once for every page). **A console sentence that quotes a read's reason
  keeps the two apart** (`QuotedReason`, `site/lib/quotedReason.ts`): the page model carries the console's own words
  and the reason exactly as the read gave it, and `PlainWhy` (`RawFold.tsx`) draws the words, the plain line and the
  fold, never the raw inside the sentence. A console whose failures render as an empty card is one you stop
  trusting the moment a figure looks surprising. **A failed read never blanks a reading already drawn**
  (`liveStateAfter`, `site/lib/liveState.ts`): the reading stays with its own stamp, the mark beside it says why
  nothing newer is and how old what is drawn is, and every count, badge and press judges by the latest read
  (`latestReadOf`). **A read in flight is a spinner** (`ReadingIndicator.tsx`), never a sentence in the value's
  place: something not loaded yet is shown with a progress
  indicator, never text. `ReadStandIn` and `ReadMark` (`site/components/live/LiveMarks.tsx`) are the two every page draws.
  **A not-connected integration is a state, never that mark**, so declining to connect one does not break everything. When a reason says a door has no token or grant
  (`notConnectedOf`, `site/lib/integrations.ts`, one registry row per integration), `StaleMark` draws
  `ConnectIntegration.tsx` in the triangle's place: "Slack isn't connected" and a Connect button opening that
  integration's paste fields and consent verb. A refusal printed as words (a press, the Alignment page's pull
  request lookup) goes through `IntegrationFailure`; an outcome whose effect is unknown keeps its words. A
  missing message, a missing scope or a 403 keeps its own explanation. The Slack thread panel, whose corpus
  error cannot say which it is, asks `connect slack --check --json` for `tokenPresent` first
  (`site/lib/slackConnection.ts`).
- **Two lanes, and the split is measured.** `fast` may be polled on a timer; `slow` is read once when the
  page opens, bar a measured long poll where a reading must not age: the Queue re-reads the board once a minute
  (`site/lib/queueRegisterPolls.ts`), since read once it drew asks 18 hours old on a window left open. MEASURED
  on this machine: `fleet status --json` produced no output inside 180
  seconds, so it is **absent** from the map rather than slow-laned — a tile polling it would show the last
  answer while a request nobody can see was still running. The board's placement comes from
  `handover list --json` instead. Reproduce with `time slopweaver handover list --json`. **Its size, not
  its speed, is what can blank the queue page.** MEASURED on this machine, uncapped: it answered
  in 7.2s and printed **28.6 MB**, of which row `summary` text was 96%, so `GET /api/live/board` round-tripped
  28.35 MB in 31.5 seconds and the page gave up long before the verb did. Each row's `summary` is cut at `BOARD_SUMMARY_CHARS` (320,
  `src/cli/commands/handover/listJson.ts`), back to the last whitespace so a URL or key is never cut into a
  different valid one, and the document publishes a `summaryTruncation` tally beside
  the rows, because a cap is a legitimate engineering choice and a SILENT one is not
  (`src/lib/truncation.ts`). MEASURED the same day against the console served out of this worktree:
  `GET /api/live/board` answered 200 in **9.2 seconds with 1.98 MB**, carrying 2,675 rows and the tally
  `{ cap: 320, measured: 2675, truncated: 2427, keptChars: 829639, droppedChars: 26354593, longest: 570555 }` —
  so the longest summary the board OFFERED is still readable on the document while no row on the wire
  exceeds 320. The tally is measured BEFORE anything is cut; taken off the capped strings it would report
  zero dropped characters on every board. That same response is the binary pin's witness too: the main
  checkout carries no cap, so only the serving tree's own `bin/slopweaver` could have produced it.
  **A cap that is honest about its size can still be dishonest about what it removed**, which is why each
  row also carries `summaryAnchor` — the first Slack permalink in the row's summary, read BEFORE the cut.
  The summary is where a board row most often keeps its thread and the link is rarely near the front:
  MEASURED over the 2,678 docs on this machine, 142 rows carry one and the cap alone would have removed
  **125** of them, so the board panel's thread view would have gone quietly missing on five rows in six that
  have one. The panel prefers the uncut anchor and falls back to parsing the row's question and reason,
  which are not capped.

- **The binary is the SERVING checkout's, never the inherited `PATH`'s.** `site/lib/slopweaverBin.ts`
  walks up from `process.cwd()` to the first directory holding `bin/slopweaver` and `spawnVerb` launches
  that path; no `bin/slopweaver` above the server is a stated failure naming every directory it
  looked in, never a launch. A bare `spawn("slopweaver", …)` with no shell resolves off whatever `PATH` the
  server inherited — which is not the interactive shell function, and was once the MAIN checkout
  while the work stood in a worktree — so every tile was answered by a tree the reader could not name.
  `site/` is a separate Yarn project whose lane-reached sliver is its PURE modules alone, so the class is
  held down by a gate under `src/`: **`console-verb-binary`** refuses a literal first argument to `spawn`/`exec`/`execFile`
  and their `Sync` twins anywhere under `site/` (`src/devLint/consoleVerbBinary.ts`). Every child also runs
  with `SLOPWEAVER_LAUNCHER_QUIET=1` (`site/lib/launcherQuiet.ts`), the marker a `command:` probe already
  sets: the launcher's advisories and the stale-seat warning are notes for a terminal, so the console skips
  the stale-seat git work on every read, and a failure's stderr tail is the verb's own lines rather than an
  advisory printed before it ran. **And every child is pinned to that checkout** with
  `SLOPWEAVER_CLI_DIR=<its root>` (`consoleChildEnv`, the same module): the launcher runs
  `${SLOPWEAVER_CLI_DIR:-$PLUGIN_ROOT}`, so the right `bin/slopweaver` alone still let a `PLUGIN_ROOT` the server
  inherited run another tree. MEASURED: the console served from main ran every verb out of a supervisor
  worktree's `dist-cli`, so the board carried no `referenceContext` and a drawer's `QQQQ-178` stayed
  words beside a linked `17941`. `PLUGIN_ROOT` is kept, not scrubbed — it has plugin duties of its own. A running
  server keeps the code it was started on, so the pin reaches it when it next restarts. `console-verb-binary`
  refuses a `spawn(<resolved>.bin, …)` whose `env` does not carry `consoleChildEnv({ …, root: <resolved>.root })`
  — the same stale tree had also drawn 673 check-in rows the owner's class steers had already settled.
- **A button's verb line is READ off the act list, never typed at the call site.** `actLineFor`
  (`site/lib/actVerbs.ts`) turns a button's act slug into the command the press runs. One string, so a label and
  the act under it cannot drift apart in silence (21 verb lines hand-typed as second copies of allowlist `title`s
  did, measured). No page prints the verb a READ came from.
- **A read still in flight is a progress indicator, never words** (something not loaded
  yet is shown with a progress indicator, never text). `Spinner` and `SpinnerBlock`
  (`site/components/ui/spinner.tsx`) draw it, with what is being read as the label on hover; a read that FAILED
  keeps its visible reason, so loading and broken never look alike. `console-loading-prose` in `yarn lint`
  refuses a read or load word followed by an ellipsis anywhere in the console's source.
- **A page shows its data and at most one line about it, and no page says how it was read** (a minimalist approach with progressive
  disclosure, not paragraphs; the owner never looks at "how this page is derived" links or "how this was read" folds). No page head, tile or
  settings panel links its derivation page, and a tile has no footer fold. **No page carries a method fold either**
  (the owner ignores "how this page is derived" and never clicks it; anyone who wants to know just asks):
  how a section's figure is counted or what order its rows are in is written HERE, under `docs/console`,
  and the voice answers it from there. `site/components/console/About.tsx` is a labelled disclosure for DATA a
  list folds away (the census's not-placed list), never a caveat or method fold. A
  failure always shows — a staleness mark, a `FIXTURE` stamp, a fleet not observed, an unresolved sweep, a
  listener graded anything but healthy, a capacity hold, alert or unmeasured reading, a route-stamped age
  (`· on read`, its sentence on hover), a table cut short stay where the value would have been. The derivation
  pages under `/docs/console` stay reachable from `/docs`: one lead sentence, every section a `<details>`.
- **One poll per verb per page.** `useLive` shares a channel per slug: the sidebar's badge and the page's
  tile reading `hand list` cost one child process between them, on the shortest interval either asked for,
  and `refreshLive({ slug })` is what a press calls to re-read the register it wrote to. **A revisited page
  does not start from "loading."** When a channel's last reader leaves, its last wire answer is kept
  (`site/lib/liveRetained.ts`) and the next mount draws it at once, with its own stamp and the progress indicator beside it
  until the read that mount started lands. It is handed off at teardown, never cached on arrival, so a read
  in flight when its page unmounted cannot refill what a press cleared. `refreshLive` clears it even with no
  channel alive, and a tile still drawing a kept reading when a press lands drops back to loading, and a channel torn down empty or on a failed fetch leaves nothing kept. There is no expiry:
  a mount reads again at once, IN THE FOREGROUND LINE for a slot, the stamp states the age, and the kept set is
  bounded by the slugs and fixtures the route accepts. A kept or saved reading never counts as current for that
  line (`Channel.drewCurrent`, `liveReadPriority`): MEASURED, Fleet drew "read 3.4h ago" kept readings
  while their re-reads waited behind every shell tick, and the owner read the fleet as quiet. **Nor does the first load after a restart**, which that page memory cannot cover:
  the route saves each real flight's successful reading, never a failure or a fixture, as
  `<slug>@<epochMs>.json`, named by the instant it was true, in the directory `scripts/docs-site.sh` names in
  `SLOPWEAVER_CONSOLE_SAVED_READINGS_DIR` — one per state home under the cache root's `console/saved-readings/`, and
  none, so nothing saved, for a server started without it; a writer deletes only older files and a read takes each
  slug's newest, so no console process sharing the directory replaces a reading with an older one
  (`site/lib/savedReadings.ts`). A page's first channel asks `/api/live-saved` once,
  outside the live-read slots. A saved reading fills only a key this page has neither pressed nor had an answer for,
  always marked refreshing, is cleared by the page's first successful answer for its key wherever a remount has moved it
  (`site/lib/savedReadingDraw.ts`), and moves none of a read's bookkeeping, so the mount still reads. Saved data is shown marked as refreshing. MEASURED on a production console, a
  fresh browser per run, median of 3: Fleet first drew in 12.5 s with nothing saved and 2.3 s with saved readings,
  the Queue in 7.0 s and 2.4 s; the live board read still takes 13 to 17 s behind it. **The one mount that does not re-read** joins a channel another component is
  already polling with an answer younger than that poll (`site/lib/liveJoin.ts`; a read-once channel always
  reads, since nothing keeps it current): the shell's badges poll the Queue's registers on every page, so a page's tiles
  re-reading them on each click was a dozen child processes for answers seconds old. A press always reads.
  **Two tabs, one process.** The route coalesces: a read of a verb already in flight rides that flight and gets
  its answer and its stamp (`site/lib/liveFlights.ts`), and after a press every read of that verb goes out `fresh=1`
  until one lands an answer — its retry, and the first read of a page opened later, included (`site/lib/liveFresh.ts`).
  A `fresh` read never rides a flight already under way but starts its own for later reads to ride — so nothing is cached and no press is ever answered from before its write. **A read the server dropped is read again.** The route answers every verb outcome
  as a 200, so a `fetch` that threw or a 5xx is a restart, never the verb: the tile's staleness mark says it is
  reading again, and it re-reads after 1, 2, 4, 8 then every 15 s until an answer lands, read-once tiles
  included and not held by a call (`site/lib/liveRetry.ts`). MEASURED: a swap 45 s after the owner's hang-up killed the
  reload's first reads, and the Queue badge and Talk's earlier calls stayed empty until two hard refreshes.

A verb that stamps its own `observedAtIso` is believed; one that does not gets the route's receipt time and
the tile says the stamp is the route's, because conflating the two lets a cached answer present itself as a
fresh reading.

**A number that changes between loads is live, or carries its own age** (such numbers are relatively live). It polls on a `useLive` cadence its measured cost allows; a read too slow
to poll shows how old it is. That age is re-told every ten seconds (`site/components/live/ReadingAge.tsx`), in every
tile's stamp too — told once at render it froze, so a read-once tile said `just now` for as long as the page stayed
open. A tile whose figures also stand on another channel names it (`Tile`'s `alsoFrom`) and its stamp ages the OLDER
reading (`site/lib/readingAge.ts`), its hover saying which; Fleet's Next up and Your steers age the read-once board
rather than the minute-polled reconcile beside it.

**How fast it is gets measured, not felt.** `slopweaver perf console` (`src/consoleProfile/`) launches its own
headless browser, never the owner's Chrome, loads every fixed page cold and clicks every nav item and flow warm, and
prints TTFB, paint, drawn, fully loaded, blocking, heap and DOM per row against the budgets in
`src/consoleProfile/budget.ts`, plus each live verb timed alone. Serve the build it walks from a checkout
nobody is editing: a tracked edit with no rebuild makes every read refuse mid-walk.

**The voice is the one thing in the console that reaches a model, and only when the owner starts it.** A floating
orb sits bottom right of the owner's screen in the desktop app's overlay (`site/components/voice/VoiceWidget.tsx`, mounted
by `DesktopVoiceOverlay.tsx` so one session follows the owner across pages) and nowhere else — a browser tab draws none
and starts no call (one floating widget, the desktop app's; `site/lib/voiceStart.ts`), saying what the voice is doing and for how long — hearing
the owner, reasoning in its delegated turn, running a named tool, speaking, or gone quiet — as a fold over the session's
own delegation and response events (`site/lib/voiceActivity.ts`). It is in one of three states the owner picks and keeps
across calls and restarts — the orb alone, the middle, or full screen — opening in the middle and never moved by a
call (`site/lib/voiceWindow.ts`). The middle is its call card (`CallCard.tsx`), sized Small, Large or by dragging its
left or top edge (`site/lib/messengerSize.ts`): a header carrying the voice's state and
every control, the band saying what the owner is looking at and what the voice has read of it, both fixed-height, the conversation
(`Messenger.tsx`) and the box to type in. One tray at most takes the conversation's place, none by default and the same
one carried onto the stage's left half — the running list, the newest ten things the owner, the voice and the fleet left each other,
each with a copy icon, kept in `$SLOPWEAVER_HOME` by `slopweaver talk list` / `talk list-add` (`RunningListTray.tsx`,
`app/api/talk/list`), where every draft of the owner's words the voice composes (a message, review comment or script the owner will
paste, say or react to) goes, asked for or proposed, instead of being read out; the session details, every lookup
this call folded like a session card's tool calls (`VoiceSession.tsx`); and the microphone and speaker
(`AudioDeviceMenu.tsx`; `site/lib/callTrays.ts`). The session details tray also holds what the retired Talk & voice
page did: the call's relays, folded to one line and kept to their newest entries
(`VoiceProvider.tsx` caps them), the earlier calls' transcripts as they were written down (`slopweaver talk calls`, a
dropped one reading "no end recorded"), and the call's ChatGPT plan settings — voice, model, plan left, talk minutes
and who pays (`CallPlanSettings.tsx`) — each closed until the owner opens it. The card's **talk** opens a realtime call on
the owner's ChatGPT plan through
`app/api/talk/offer` (`slopweaver talk offer` composes it, a `codex app-server` child holds it, no credential in
the page, and a plan refusal is shown, never paid around); what it may call is
`site/lib/talkToolsList.ts`, a closed list whose `TalkDoes` type is `read | preference | show | list-write | relay | draft`
with no generic write arm; `offer_copy` is its one `list-write`, onto the running list and nowhere else;
`draft_edit` and `draft_restore` rewrite only the parked Slack draft on the card the owner has open, through
`app/api/talk/draft` (`slopweaver slack draft revise|restore`), never sending it
([the one draft write](../security/voice-boundary.md#the-one-draft-write)); and
the page posts its relay writer, `relay_steer`, to `app/api/talk/relay` (`slopweaver talk relay`) only when
`site/lib/relayGate.ts` passes the call — a gate in the page; the route itself checks the press's origin and
the body's shape, not the gate. Messenger's box runs the same thread with no microphone
(`app/api/talk/typed`, `slopweaver talk offer --typed`; [typed and voice](typed-and-voice-one-conversation.md)).
While a call is live the page also beats a lease to `app/api/console/call`, so a
rebuild at a landing holds its swap, and the reload it would force, until the owner hangs up
([docs-site/runtime.md](../docs-site/runtime.md#the-production-console-built-and-served-rebuilt-when-the-checkout-moves)). What leaves the machine and why is
[`content/console/call-widget.mdx`](../../site/content/console/call-widget.mdx); the whole flow, turn by turn, is
[voice-flow.md](../voice-flow.md).
