# A surface with no address: what the Notion settings arms cost and bought

Part of [The browser route: the owner's real Chrome, and nothing else](../browser-route.md).

**MEASURED.** Notion's settings and admin surface has no URL at all — 0 of 32 declared routes
reached — because it is a modal. `src/browser/notionSettings.ts` is the closed read-only contract that reaches
it, and three facts about it are worth having here rather than only in its own header, because each cost a
relay round-trip to learn and none is guessable:

- **The modal carries no `role="dialog"`.** The whole role census after it opens reads
  `button=344 tablist=2 tab=11 … menu=1 menuitem=1` and never the word `dialog`. An arm waiting for one
  reports an open modal as closed. What the arms wait for instead is what the click BROUGHT INTO EXISTENCE:
  every `role="tab"` present beforehand is marked, and the settings rail is exactly the set that is not.
- **Neither a sidebar `Settings` control nor `Meta+Comma` opens it.** The first matches the database VIEW
  settings button on whatever page the client happens to be showing; the second is not bound on the web
  client. The route that works is the workspace switcher — the first `aria-haspopup="dialog"` control in the
  document — and then the `Settings` item **inside the menu that opened**, because matched document-wide two
  controls answer to that name.
- **One rail selection marks two tabs.** Selecting `Members` leaves the client marking both the rail's `Members` tab and the
  panel's own count-bearing `Members` tab, so the witness a capture is graded on is a LIST, never one value.

What it cost: `admit/coverage.ts` could not inherit `playwrightCli.ts`'s classification, whose justification is
the sentence "no click, no form submission and no request replay". Its row there carries a different argument —
the destructive controls are BUTTONS on a panel and a tab selection draws only from tabs, so they are outside
the candidate set structurally rather than by promise. Read that row before adding a third clicking arm.

## A page list with no document: what the Datadog console arms cost and bought

**MEASURED.** The Datadog console declares its page list nowhere a page visit can read it: the
left nav renders its 20 top-level entries as `a[href]` and each entry's pages only while it is HOVERED, and
the command palette's `POST /api/ui/search/suggestions/entities` — the one provider-owned list of this
organisation's resources — opens on a key chord and answers 401 to API keys. `src/browser/datadogConsole.ts`
is the closed read-only contract that reaches both, two arms on `RelayOperation`, and `atlas datadog walk`
is the only verb allowed to ask (`src/atlas/datadog/consoleWalk.ts`):

- **`datadog-nav-observe` hovers and reads hrefs; it clicks nothing.** The lists it hovers are matched by
  their own accessible labels, fixed in `datadogConsoleSnippet.ts`, and what comes back is `{section, href,
label}` per fly-out link — no page text. It exists so the declared route table (`consolePages.ts`, itself
  a hand-carried read of this nav on one date) is CHECKED against the console on every walk and its drift
  raised as a gap in both directions, rather than trusted.
- **`datadog-palette-observe` presses one constant chord (`Meta+k`), reads the dialog's structure, photographs
  it, presses Escape.** It types nothing into the search field and chooses no option. Its response hook is
  the page-visit hook verbatim, so a lost body is `bodyFailed` and the walk reports the palette incomplete.
  The body it captures is reduced to field names like any console call, and what it lists to a count per
  entity kind — a name of a dashboard, a monitor or a user never reaches disk on this path.
- **A hover fires the page's own handlers**, which is exactly why the per-page read-only rail refuses `hover`
  on a page it fences. The Datadog console is not such a page, and the arm does not decide that; the rail
  does, before any client starts.

## A shared call with no API: what the Fathom share arm reads

**MEASURED.** A Fathom call somebody else recorded reaches the owner only as
`https://fathom.video/share/<token>`, and an anonymous GET of it redirects to `/users/sign_in`. The owner's Chrome is
signed in, so `fathom-share-transcript` (`src/browser/fathomShareSnippet.ts`) is one more closed arm on
`RelayOperation`, and `fathom share` is the only verb that asks for it:

- **It clicks nothing.** The page's `page-call-detail` element carries the whole transcript as a property,
  `transcriptCues`, before any tab is chosen, so the arm is a navigation and a property read — the capability
  `page-visit` already has. Not the Transcript tab, not `Copy Summary`, not an action item's checkbox.
- **Every cue names its own speaker and offset.** The rendered transcript interleaves Fathom's ACTION ITEM
  blocks with speech that carries no speaker label, and a hand-read of these pages once attributed that
  speech to the wrong person. The property does not have that ambiguity.
- **Provider-written text never leaves the page.** Fathom's notes are dropped in the page and only their
  count comes back; the summary is a different property the snippet does not read.

## A proof with no endpoint: what the Datadog monitor backtest arm clicks

The evidence a monitor pull request is asked for is a picture of the console's own "Monitor behavior with this
threshold" panel over seven days, and no API returns one. `datadog-monitor-backtest`
(`src/browser/datadogMonitorBacktestSnippet.ts`) is the closed arm that takes it, and `datadog shot monitor` is
the only verb that asks for it:

- **It clicks two things, both on the backtest's own time control:** the `Time range picker` input, and the
  `Past 1 Week` preset matched by its exact text. Nothing in the monitor form — no field, no Save — and no key
  is pressed. Changing the window changes what the console EVALUATES the draft over in the relay's own tab,
  which is closed afterwards; it changes no field of the monitor.
- **It is its own arm rather than an evidence adapter**, because `page-evidence-capture`'s read-only row in
  `admit/sanctionedSeams.ts` rests on that arm clicking nothing, and its readiness contract (canvas ink, a summary
  sentence, a query editor) does not describe an SVG panel. Read this arm's own row before adding a third
  clicking arm.
- **Readiness is three conditions at once:** two consecutive identical marking passes, the region marked with
  its Alert count boxed, and no `evaluation_preview` call in flight. The panel reads `0 times` while it is
  still evaluating, so any one alone can photograph a monitor that "never fires".
- **The window is proved off the network.** The arm keeps each `evaluation_preview` URL and status, never a
  body, and `datadog/shot/proof.ts` refuses a capture whose console evaluated anything but seven days.
- **The picture is the viewport, cropped in Node.** An element screenshot in the owner's Chrome, which runs
  Datadog at 75% zoom, came back the right size with the panel shifted half its width off the frame, and
  passed every grade. So the arm scrolls the panel into view, photographs the viewport, reports the panel's
  rectangle and `devicePixelRatio` either side of the shutter, and `datadog/shot/monitorShot.ts` cuts it
  through `visualEvidence/crop.ts`, refusing a panel that moved or left the frame.

## What this did NOT change

**The browser-door guard stands** (`src/admit/chromeRetirement.ts`, doctrine rule 3). That guard exists for a
different failure — a session aiming a click at Slack's search box, missing, and posting its
search string into the channel composer under the owner's identity. The owner's ruling calling the boundary
theatre was about PROFILE ISOLATION, which never guarded against a missed
click, so reading it as licence to drop this guard removes a rail the owner never asked to remove. When a ruling collides with a rail, extend the rail the way its own
canon already points, and say so.

**Every refusal is journalled** — `ledgers/browser-verdicts.jsonl`, one `chrome-retired` line per refused
Claude in Chrome call, read back with `slopweaver browser verdicts`.

Rule 3's own resolution is what makes both hold: _a `slopweaver` verb that drives a browser IS the door_. Its
reads pass, and **no write-capable action runs blind** — one runs only when it cites a look at the page in
front of it, which is [the two categories below](doored-provider-writes.md).
