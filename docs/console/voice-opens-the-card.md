# The voice puts the card it is talking about in front of the owner before it speaks

A child of [the voice flow](../voice-flow.md#2--what-the-voice-reads); the boundary it stays inside is
[voice-boundary](../security/voice-boundary.md).

When the call is about a Queue card, the owner wants that card open in front of them. The smooth version is a
colleague who says "let's look at this", hands over the thing and talks about it; the rough version starts talking
about the thing without showing it.

**What the owner's steers on this add up to.** They do not conflict; each narrows the one before:

- **By default, unasked.** The voice opens the card the call turns to without being asked, and when one card is
  finished and the call moves on to another, it puts the next one directly in front of the owner. Console tabs make
  getting back to what the owner was reading easy. The limit is the card the call turns to: an unasked open that moves
  the console off a briefing the owner is reading onto an unrelated card is the failure.
- **Every card the call is about**, not only the next one.
- **Where: never forward.** There is no dedicated voice tab, and the app is never brought forward, restored or opened
  for a card: the owner clicks on the app when they want to see it, and finds the card there when they switch. In a
  full-screen call the card never appears beside the orb; it waits behind the viewer until the owner leaves full
  screen.
- **Where: the pinned Queue tab.** The card lands in the pinned Queue tab — the one static tab, which ⌘W only hides —
  and the strip is moved to that tab, so a briefing the owner opened beside it keeps its own tab and the walk never
  runs in a duplicate Queue. A `browser_open` that opened a second Queue tab, with the next card following it there,
  left the owner looking at a duplicate. The pinned tab is the owner's Queue, not a voice tab.

**An Alignment card is a card too.** The voice and the typed messenger are tested against every Queue AND Alignment
card. Measured, every act stood unread on both surfaces while a key resolved only among the Queue's rows. So `read_card` and `open_card` resolve the Queue first, then the cards it
recently dropped, then the Alignment page's acts (`act:<id>`) (`cardToolPlan`, `site/lib/cardToolPlan.ts`); the page
asks no voice question, so an old `align:voice-<id>` key reads as no card. `action_items` and its counts never include them. An Alignment card opens
on `/alignment?open=<key>`, and a ruling question carries no card key, so no tool names one. A finding act is read only
once its branch's pull-request lookup settles, then drawn from it as the page draws it (`readActPull`,
`site/components/console/useActPull.ts`).

**When putting a card in front of the owner is undesirable.** The owner asked for no heavy-handed rule, so this is
judgement, and these
are the cases it covers. The first three are what the desktop shell does for every card; the rest are the voice's to
judge.

- **The owner is in another app** (Slack, the owner's browser, a call). The card goes into the console window's tab
  and the window is never brought forward, restored or opened for it; it is there when the owner switches to the app.
- **The call is full screen.** The card never appears beside the orb. It loads in the tab under the stage and waits
  there until the owner leaves full screen.
- **The console window is closed.** Nothing opens. The card is that tab's page when the owner next opens the window.
- **The owner said not to.** "Don't open that one" skips that card, and the openCards switch (below) turns off every
  one.
- **The owner is mid-way through something on the page the owner is on**, such as a secret pasted into a card's field
  and not yet set (`SecretFields.tsx` keeps it in the page alone, so moving the tab drops it) or a briefing the owner
  brought up personally, and the call has not turned to a card. A card only named in a list, or read ahead in a walk,
  is `read_card`, which moves nothing.
- **The card the owner would be shown is the one the owner already has open.** That is `read_card` too, and reopening
  it would mark it the voice's and stop the owner's words landing on it.

A card address carrying a `view` from the page the owner is on (the Pull requests page's, or a Queue view) is refused
by the desktop shell, so every `open_card` on such a call comes back `card refused` even though the voice called it.
`cardPagePath` (`site/lib/openCard.ts`) never sends a view.

**Two tools, one resolver.** `open_card` is what the backend prompt calls whenever the call turns to ONE card the owner
does not already have open: the owner asks about one, the voice raises one while none is open, the owner's word on the open one (the owner ruled it, asked for the
next, or is done with it) moves a walk on, or the owner asks to see one. A reaction while the owner reads, or to a card just put in front of the owner, is never that word, and
a card just opened never ends on an offer to send it back (`docs/console/resume-cases.md`). It
runs before any answer about the card or any question for the owner's steer. `read_page` says which card the owner
has open. That card is `read_card`, never reopened: reopening the owner's own card would mark it the voice's and stop
the owner's words landing on it. `read_card` opens nothing on the owner's screen. It is also for a card read ahead in
a walk until the walk reaches it, one the owner said not to open, and one that left the owner's Queue. A card only named, in passing or in a list ("what is waiting on me"), is not turned to. Neither tool
is ever offered (`src/talk/sessionConfig.ts`, `src/talk/cardToolSchemas.ts`). Both resolve the key against the SAME
rows `action_items` answers from (`actionItemProjection`, `site/lib/talkActionItems.ts`; in the desktop shell the
console window's own, asked for at the tool, `site/components/voice/useQueueScreen.ts`) by the Queue's own
exact-then-alias rule (`openCardPlan`, `site/lib/openCard.ts`), and both answer with the card, every address it
links — pages with their file paths, the thread, any pull request — and **every briefing it links, already read**.
A card read AHEAD during a walk is a `read_card` too.

**The runner reads the briefings, never the model.** The owner expects a card's briefings read without asking when
the card opens, and, when one will not open, to be told it could not be read. Measured over a week's calls, the model reading each briefing itself through
`file_read` read 5 of 20 whole: raw-markup windows, the shell's style block eating most of the first, and a
`--from` it chose past the rest. So `briefingSlugsOf` (`site/lib/cardBriefings.ts`) names every briefing a card
links — a `file://` page or the console's own `http://localhost:<port>/api/page/<slug>/index.html`, which four cards
in that sample carried and no page list did — and the runner reads each through `/api/talk/briefing/<slug>`, which runs
`slopweaver talk file read --words` on the page's address, which reads the page out of the store, never its folder
(`src/talk/heldPage.ts`): the page becomes its words FIRST and the credential mask runs over the words
(`src/talk/pageWordsRead.ts`), since an entity or tag inside a token hides it from a mask run over markup, and a read
answering any path but that address is refused (`site/lib/briefingRead.ts`). The
answer's `briefings` holds each as `read: true` with its `text`; `"partial"` when it was cut to fit the page's 24 KiB
tool cap (fitted under 20 KiB, every briefing an equal share); `"partial"` with empty `text` and `rest.from` 0 when
that read failed — the Queue tool's own deadline included — for a briefing whose `file://` address the card carries
(`briefingFilesOf`, `site/lib/openCard.ts`); or `false` with `why`, only for a failed one the card names no file for,
which carries `say`, the sentence the voice says word for word before anything else from it. MEASURED: the deadline
ran out on a 12,941-byte briefing, the voice told the owner it could not read it, then read it whole in two
`file_read` windows seconds later. A `"partial"` one carries `rest`, `{ path, from }`,
and is not finished: before saying a word on it the voice reads on with `file_read`, `words: true`, from `rest.from`,
passing each `nextFrom` back until it is null, and says the partial's own `say` only when one of those reads fails.
The owner wants an entire briefing read even when it takes several reads; saying the first-part sentence and then
guessing a raw-markup `from` that skips part of the page is the failure this closes.
`rest.from` counts bytes of the page's WORDS: the cut prefix's UTF-8 bytes when no mask changed them, else 0, a reread
that repeats and never skips; a page the verb itself stopped at keeps the verb's own `nextFrom`. Only a card linking more than even a bare entry
each can carry names the first that fit and counts the rest in `briefingsLeftOut`, with its own `say`. Each one not
read whole is a `partialFailures` entry with part `briefing` too. The thread is still read with `slack_open`.

**A briefing the owner already has open is read the same way, at every `read_page`.** The console's viewer
(`site/app/(console)/view/page.tsx`) once registered only a title, so `read_page` on a briefing answered that the page
registers no reading; on one call the thinking model read the page once through `file_read` and answered the owner's
questions for most of an hour from that memory, once deferring to "the next cut" what the page already covered. The
viewer now registers a reference, `{ kind: "published-page", slug }`, never the words; it crosses to the desktop
shell's voice window as any reading does, and the runner resolves it on EVERY `read_page`, a read on included, through
this same masked briefing read (`site/lib/publishedPageVoice.ts`). A page republished after the tab loaded is read as
it now stands, and a republish between two windows refuses the read on rather than splicing two cuts. The residue:
the reading is the briefing read's one window, so on a page whose words pass `BRIEFING_READ_BUDGET` (512 KiB, which no
briefing reaches) a republish that changes only words past it is not seen by the read on. The answer's
`shows.publishedPage` has the briefing shape above. Resolved in the voice's window, its words read on through
`read_page`'s own windows, unlike a reading the console window cut ([read on past a cut](voice-reads-on-past-a-cut.md)).
The tab cannot say which cut it painted: when the read differs from what the owner says is on screen, the thinking
model says the page changed since (`src/talk/cardFidelityLines.ts`).

`read_card`'s runner reaches the rows and the briefing read and nothing else (`runReadCard`,
`site/components/voice/openCardRun.ts`): no seam that moves the console or presents a page is in its signature.

**Opening the next card takes the last one off.** Each card either tool resolves on a
call joins the page's walk (`site/lib/cardWalk.ts`). An `open_card` that really opens a different card while one of
those is still open writes a `card-move` line, and `talk transcript` takes the card the owner left off their Queue. The
owner does not have to answer it. `come_back_to_previous` defers it instead, for when the owner said to come back to
it. The whole rule is
in [card landing](card-landing.md#the-queue-walk-moving-on-takes-the-card-off).

**What `open_card` opens, in order** (`runOpenCard`, the same file):

1. The card's panel: the console moves to `/queue?open=<key>`, keeping the owner's work context, sidebar and tags
   and dropping the rest. It resolves across BOTH work contexts on purpose: a card the owner's current context hides is
   the
   Queue's own deep-link case, whose panel switches to the card's context (`SwitchingPanel`).
2. The card's first published page, by slug, through `browser_open`'s own verb (`browser present`).
3. The card's Slack thread, by its link, the same way — unless this call already put that thread in front
   of the owner, when it is `skipped` with why and opens nothing
   ([once per call](voice-reads-a-slack-thread.md#a-thread-is-put-in-front-of-the-owner-once-per-call-and-a-read-of-another-one-says-so)).

Each opening is independent: a refused page leaves the thread to open, and every outcome comes back named. A
refused opening also comes back in `partialFailures` (`refusedOpenings`, the same file), so even an `open_card`
that opened something raises a [failure toast](voice-failure-toast.md) naming the part
that did not open. Each refusal is its own toast, five in a row five toasts, and each carries the resolved card's key
so its "Open in new tab" opens that card as a new desktop-app tab on the owner's click, never the owner's browser. A key that matched no card is refused
whole and its toast has no button.

**In the desktop app** the call runs in the voice window, so the console window is moved for it: the voice window
sends `slopweaver:present-console-card`, and main takes it only from that window and only as a `/queue?` or
`/alignment?` path with one `open` and nothing past the Queue's own parameters (`consoleCardPathFromMessage`,
`desktop/src/consoleCardAddress.ts`). A shell built before this refuses by name, and the page and thread still open;
one built before Alignment cards opens a Queue card and refuses an Alignment one by name
(`presentCardOnShell`, `site/lib/desktopCardPresent.ts`). Main then takes the context, sidebar
and tags from the LIVE address of the pinned Queue tab rather than the voice's, which was published a moment ago and
can miss a sidebar just collapsed (`consoleCardPathOnConsole`), moves that tab there in place and shows it in the
strip, without bringing the window forward (`showInPinnedTab`, `desktop/src/tabRouting.ts`).

**The Queue has one tab, and the voice never makes a second.** Asked to be taken to the Queue, the voice's
`browser_open` hands the app a `slopweaver://open?path=/queue…` deep link; the app opens a Queue address in the
pinned tab and shows it, and every other page (a briefing, a published page, Alignment) in a new tab in front
(`deepLinkTarget`, `desktop/src/deepLink.ts`). The answer the voice is handed says which (`desktopOpenNote`,
`src/browser/presentDesktop.ts`).

**The owner's opt-out.** "Open cards and links" sits with the other stage switches and is on by default
(`site/lib/voiceStage.ts`), so the card the call turns to opens on its own; "don't open the cards" or "stop opening
cards" turns it off through `set_stage_setting`, and "don't open that one" skips just that card.
Off, `open_card` opens nothing, not even on the owner's ask, and still answers with the card and its links, and the voice
never opens them itself. The switch is kept in the browser, so it stays off across calls until it is turned back on.

It gates `open_card` and the triage pass's `triage_next`, which opens through the same presenter: off, the pass walks
the card unopened and answers `onOwnerScreen: false`, and the voice reads it to the owner and says once that "open
cards" puts each one in front of the owner ([the triage pass](voice-triage-pass.md)). A complaint that tabs keep opening while the voice reads a card's links is the `browser`
reads, so it stops reading that card's links and leaves the switch alone: flipping the switch for that complaint does not stop the
reads, and leaves cards shut for the calls after it. Turning it on replays nothing that was skipped, so `set_stage_setting`'s answer
says nothing has opened yet and the card the call is on goes through `open_card`'s usual rules at once, and the voice says nothing opened until
`open_card` answers that it did
(`site/components/voice/openCardsSettingNote.ts`).

**A card that just left the owner's Queue is still read.** A key no card on the Queue answers to is looked for among the
cards that left it in the last day, and comes back marked `removed` with when and why; `open_card` on one opens
nothing, since no Queue panel draws it ([why and what is listed](voice-finds-a-card-that-left.md)).

**A key that matches nothing moves nothing.** While a register is still loading the refusal names what is
unread rather than saying no such card exists.
