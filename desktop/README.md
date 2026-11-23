# Slopweaver for macOS

The console in a native window, the voice over your whole desktop, a sessions page that brings the fleet back
after a restart, and a menu bar icon that says how it stands. It is a shell around the console your checkout
already serves (`scripts/docs-site.sh`): it loads `http://localhost:<port>` and its own fleet pages and nothing
else, starts no model out of your sight — every seat recovery resumes runs in a cmux tab — and sends nothing off
this machine. Electron, for fast feedback loops in the TypeScript this repository
already is; another architecture only if performance is measured to be a problem.

## Install it

```bash
bin/slopweaver desktop install
```

From inside a declared clone ([getting started](../docs/getting-started.md#3--create-the-home-declare-the-clone-and-write-the-organisation)), it builds a locally signed, unnotarised app for Apple silicon signed with the app's one local identity, quits any running copy, replaces
`/Applications/Slopweaver.app` in one swap, unregisters every other Slopweaver build from LaunchServices so
Spotlight, Launchpad and Raycast list one app, and opens it on the main checkout's console. The bundle name and
identifier (`ai.slopweaver.desktop`) are the same on every rebuild, so there is only ever one copy, and the checkout is remembered, so later opens are a Dock click. [The skill](../skills/desktop/SKILL.md) has what
each refusal asks of you. While working on the shell itself, `cd desktop && yarn install && yarn start` (its own Yarn
project) builds and runs it from source against the checkout it sits in. A run from source is a **dev build** and says so (below); quit it when you are done, so it is never left on your screen. Without a build of your own, [download a release](docs/download-a-release.md): it asks for your clone on first open, and its notes say whether it is notarised.

## The icons are one file

The Dock and Finder icon and the menu bar icon are both the Slopweaver logo, read from `assets/logo.png` — a square, 8-bit RGB or RGBA, non-interlaced PNG at least
1024px a side, which is what every exporter writes by default (anything else is refused by name at build time). Swapping the logo is
replacing that one file: the app icon draws it full bleed at every size macOS asks for (macOS masks it to its
own shape), and the menu bar draws the mark that stands out from the logo's plate as a template image.

## What it does

- **Every window says it is Slopweaver, and a dev build says it is one** (a window wearing Electron's atom,
  called "Electron" in the Dock and showing a failure, leaves you guessing what it is).
  Every window's title names Slopweaver — the console page's own title is only its first part — and a run from
  source reads `Slopweaver (dev build · <checkout folder>)` in every title, the menu bar's tooltip and Quit item,
  with `Dev build of <checkout>` first in its menu. A dev run wears the logo in the Dock with a `dev` badge, and
  keeps its own state in `~/Library/Application Support/Slopweaver Dev/`, so it never writes a worktree into the
  checkout the installed app reopens nor quits silently into the installed app's single-instance lock. Residue,
  named: a dev run's Dock hover name and app-menu name come from Electron's own bundle and still read "Electron".
- **A fresh Mac is walked through its permissions** (`permissionGuide*.ts`; a first install otherwise meets
  Screen Recording and the microphone with no guide): the microphone, System Audio Recording, then Screen Recording,
  each with an animated System Settings, numbered steps and one button. System Audio Recording is asked there, up
  front, because macOS otherwise asks it mid-call and every app's audio waits on the answer. What it
  raises on, what each step says, and the native helper that reads System Audio Recording: [permissions](docs/permissions.md).
- **The window and the menu bar, as Docker Desktop's are.** The red X hides the window and the app stays in
  the menu bar; Quit Slopweaver is the last item there (⌘Q); a quit you chose raises nothing afterwards. Open
  Queue, Reopen the page you were on, and the voice item sit above it. The app-name menu has Check for Updates… too.
  Under the fleet's line, each plan's recorded usage, reset and sign-in, asking no model host: [plan usage](docs/plan-usage.md).
- **The icon is quiet unless something needs you.** The logo dimmed while the console comes up or recovers by itself,
  the plain logo while it serves, a ring badge in its corner while your screen is shared, and a solid badge only
  once a recovery has FAILED past the restart hold — then Retry appears. How a console is checked and brought back,
  why a slow one is not a dead one, and the floating note a failed one raises: [console recovery](docs/console-recovery.md).
  A normal update's console restart is held quiet as "updating" and never raises it: [restart hold](docs/console-restart-hold.md).
- **A call survives the voice's renderer dying under it** (`overlayRecovery.ts`), logged to `~/Library/Logs/Slopweaver/desktop-events.jsonl`: [call reconnect](../docs/console/call-reconnect.md#the-voice-window-crashed).
- **Bringing it back to the front never reloads the page** (reloading the whole UI because the window was put back in focus is a defect). An activation only shows a window already on the console (`loadsOnShow`),
  and a recovery — the fifteen-second check missing twice in a row, or the console swapped to a new build on a
  landing — loads the window only when it is not already on that console (`loadsAfterRecovery`). Your scroll, the
  card you have open and the viewer stay put; the page's own reads retry until the console answers, and a page whose
  build was replaced is loaded whole by Next on your next click.
- **Moving the window to another page never reloads it either** (a card the voice opened, loaded as a whole
  document, would throw you out of the briefing you were reading and onto an unrelated queue card). A window on a console page is asked
  to go there itself (`moveOnShow`): the preload hands `slopweaver:navigate` to the page's own navigator
  (`useShellNavigation`, `router.push`) and answers for that document whether it took it, so the sidebar and
  everything the page holds survive, as on a click. "Taken" only starts the move: it stays open until the page's
  next commit settles it, wherever your clicks or a redirect took it (`askedMoveOnCommit`). Only a window with no console page committed, a page from before this that
  answers no, no answer in `NAVIGATION_ACK_MS` (a heuristic for a request lost with its document), or a new document
  committing elsewhere mid-move loads the window whole, and always onto the asked page. Whether the voice opens a card at all is the voice's call, not the shell's.
- **The sidebar says one thing — up to date, or an update with every change it brings in one list — and one click
  updates it**: Update now, whatever it takes underneath, under the update line, as the menu bar's first item and
  in the app-name menu; on a call it ends the call, updates and restarts the call, and a failed update leaves the
  previous app open with the call restarted so the voice can say what happened. Every move of main already built
  and signed the new app in the background, so the press swaps it in rather than building. The stamps, the
  comparison, the prebuild and the update's whole flow: [builds and updates](docs/builds-and-updates.md).
- **Tabs, the Queue pinned first** (the Queue lives in one tab, with ad hoc briefings in a few others; a card's
  pull request or board link must never replace the Queue being read). The window is a strip of tabs over one page per tab, each with its
  own history, modelled on Chrome's: every tab wears its page's icon and its page's title truncated to the width the
  tabs share, a link opened in a new window opens a new tab after the one it came from, the + after the last tab opens
  one on a sidebar page, and the keys are a Mac browser's. The Queue's tab is first, has no close and never moves;
  the strip's ‹ goes back in the tab, then to the tab that opened it (`backTarget`). Where a tab opens, its title,
  the keys, the strip's look and its residues: [tabs](docs/tabs.md). A launcher's `slopweaver://open` and
  `slopweaver://voice` open the app and start the voice: [launcher commands](docs/launcher-commands.md).
- **⌘F finds in the page, as a browser does** (a page you cannot search is a defect). Electron ships no find bar — Chromium's
  belongs to the Chrome browser — only `findInPage`, so ⌘F reached the page and nothing answered it. The shell draws
  one (`findBar.ts`, `findShell.ts`): a bar at the top right of the tab showing, under the strip, with the count
  (`3 of 12`, `No results`), previous, next and close. ⌘F opens it with its text selected; Enter and ⌘G go to the
  next match, ⇧Enter and ⌘⇧G the previous; Esc closes it and clears the highlights, keeping the text for the next
  ⌘F. It searches whatever the tab renders — a console page, the viewer, a holding page — and with the bar open, a
  tab switch or a navigation searches the new page for the same text. A console page fills in after it loads, so a
  search run as it loaded can read `No results` for text that is there a moment later; Enter or ⌘G from `No results`
  searches the page afresh (measured switching to the Board with the bar open: `No results`, then Enter, `1 of 44`). The bar is its own script-free view with a
  sandboxed preload (`findPreload.ts`), so a search never matches the bar's own field; what it sends is parsed
  (`parseFindCommand`) and taken only from it, and after every search it takes the keyboard back, because
  `findInPage` can move it to the page searched (an upstream Electron behaviour).
- **The voice is an overlay** (it overlays your entire desktop and expands and collapses at will). One transparent window loads the
  console's `/voice` page and owns the ONE call: the orb floats over every app, clicks pass through to whatever is
  underneath except over the voice's own controls, and the stage expands over the desktop with the native glass
  behind it. The window stays hidden until its page first reports itself; a page that finishes loading and never
  reports (the organisation refusal on a failed `org show`, a hydration that never ran) is reloaded after 20s,
  doubling to every 5 minutes until one does, so it is never hidden until a restart (`overlayReportWatch.ts`).
  **It is in one of three states you keep** — the orb alone, the middle (the call card over the orb) or
  full screen — opening in the middle and never moved by a call (`site/lib/voiceWindow.ts`). The
  tray menu's collapse and expand are your moves to the middle and to full screen. A press that opens the card asks
  main to focus the window (`focusOverlay`), so a click elsewhere is the overlay's blur. Main reads where focus settled
  (`overlayBlurShell.ts`) and `overlayCommandOnBlur` turns a move into another app into a transient `fold`, the stage
  included, while a move into a Slopweaver window sends nothing. On a call only the stage folds,
  never the messenger; a screen grab's hide is not you leaving, and the corner takes the keyboard back after the grab when it had it. The press that opens the card also grows the corner to the card under a pointer that has not moved, so the preload HOLDS a pointer already over a
  control through every resize, asks main where the pointer now sits (`pointerInOverlay`), and tests there two frames
  on: released at once, the second press passed through to the wallpaper and macOS revealed the desktop.
  **The window covers the whole display only while what it draws spans it** (the stage,
  a screen focus's dim, the orb landing); the orb, the open messenger and a call keep to the corner, so ⌘⇧5's window
  picker finds the app beneath. The call's edge glow and a share's amber frame are four screen-edge strip windows
  (`edgeGlowShell.ts`), and every one of these windows sits at the menu bar's own level (`main-menu`), under ⌘⇧5's
  veil, never content-protected. The corner, the strips, the level and the floor
  line: [overlay placement](docs/overlay-placement.md). The stage takes every click only while it has your focus:
  switching to another app (⌘Tab, the Dock, a click in the console window) moves it to the corner, so whatever you
  bring forward is usable. The console window draws no orb; a start pressed in it starts
  the call in the overlay, and the overlay's status is forwarded to it, so while that call is up its controls say
  so rather than offering a start — while a reload of it still ends nothing. The menu bar's voice item reads Start voice, Expand voice or Move voice to corner, or Show voice once **the X on the hovered corner orb** has taken the overlay off your screen, the call running on: [hiding the voice](docs/hiding-the-voice.md).
- **The voice opens the card it is about to talk about, and any card you ask for**. Then the overlay asks main to bring the Queue's pinned tab to `/queue?open=<key>`, or `/alignment?open=<key>` for an
  Alignment card; main takes that only from the overlay and only as a `/queue?` or `/alignment?` path with one `open` and the Queue's own context, sidebar and tags, never a `view`
  (`consoleCardPathFromMessage`, `src/consoleCardAddress.ts`), then keeps the context, sidebar and tags of that tab's live address
  (`consoleCardPathOnConsole`). It goes there in place, never by a reload (above), the strip moving to it, and **never brings the window forward** (`showInPinnedTab`): a window behind another app
  or minimised is on the card when you switch to it, a closed one opens on it, and under the full-screen stage the
  card waits behind it. A shell built before this refuses by name, and the page and thread still open.
- **A failure the voice hits shows as a toast in the console window, never over another app**. The overlay sends the one-line notice (`reportVoiceFailure`); main takes
  it only from the overlay, bounded, as exactly a summary and a reason plus a card key when a card did not open
  (`parseVoiceFailureNotice`), and forwards it to the console's active tab (`onVoiceFailure`) only while that window
  is open, shown and not minimized. It never raises the window and never holds a notice for later. The toast's "Open
  in new tab" sends only the card key (`openQueueCardInNewTab`, `slopweaver:open-queue-card-in-new-tab`); main takes
  it only from the console window, builds the path itself (`queueCardTabPath`) and opens it as a new tab in front,
  never your browser. Placement and why: [the failure toast](../docs/console/voice-failure-toast.md).
- **What you say lands on the card open in the console window** ([card landing](../docs/console/card-landing.md)).
  The page identity each tab sends carries that tab's open card key beside its path and title
  (`parsePageIdentity`), kept per tab and re-sent with the page on a tab switch, so every segment and relay the
  overlay records names the card. The preload says `carriesOpenCard`, and the console sends the key only then: a shell built before it
  drops an identity with a third key, so under one the voice keeps the page, names no card, and lands nothing until
  the app is rebuilt. Residue, named: with the console window hidden, the card last open in it is still the one
  named, exactly as its page is.
- **The voice's Queue tools read the console tab's Queue, asked for at the tool** (the
  overlay's own held registers could list cards the Queue had stopped drawing). The overlay invokes
  `slopweaver:voice-queue`; main takes it only from the overlay, asks only the active tab, takes only that tab's reply to
  that request id, asks once more if the tab changed or navigated under the ask, and otherwise answers why within 2s
  (`voiceQueueShell.ts`, `voiceQueueWire.ts`). The snapshot crosses opaque, under 8 MiB.
- **The voice sees your screen natively, so nothing is shared.** macOS lets one app share your screen at a time,
  and the floating voice is the app you have open. A `read_screen`, or a look you ask for in words, asks main for ONE still
  (`slopweaver:capture-screen`, taken only from the overlay, and only while it reports a call and holds a live
  microphone track of its own, or for a typed message that asked while the messenger is open — `lookRefusal`, asked
  before the look and after it): main reads the display the
  overlay sits on through `desktopCapturer` exactly as you see it, the orb, the widget and the transcript included
  (what you see is what the voice sees), and answers PNG bytes capped
  at a 2048 long edge — never a data URL through one string. The first look raises macOS's Screen Recording
  prompt; until you grant it the voice says the one line `SCREEN_RECORDING_OFF` carries — the exact switch, and
  what to do when it already shows on — and the launch check and the menu bar show the same line, so the look that
  succeeds clears it. **The grant survives a rebuild** (otherwise Settings shows Slopweaver on while
  macOS keeps asking): an ad-hoc build's designated requirement is its cdhash, which every rebuild changes, and
  macOS pins a grant to the requirement it was made to. So `desktop install` signs every build with one
  self-signed identity kept in its own keychain file, `~/Library/Application Support/Slopweaver/signing.keychain-db`,
  whose requirement never changes, and clears the app's macOS grants before the new build opens whenever the
  requirement differs from the one `granted-requirement.txt` beside it records, or the build it replaces
  carries another — the record written only once a clear succeeded and the new build is kept with no backup left, so
  a failed clear, or one a rollback followed, is owed by the next install; a rollback or recovery that puts back a
  build signed differently from the one it displaced clears them too ([why](../src/desktop/signing.ts)). Residues, named:
  Electron reads every display's picture to find the overlay's; the separate [window-picker bypass prompt](docs/permissions.md#the-window-picker-bypass-prompt-comes-back-every-30-days) returns on its own 30-day clock; a lost keychain mints a new identity, and
  the certificate lapses after ten years, each costing one more ask per permission; the keychain has no password,
  so a process running as you could sign another bundle as the app and inherit its grants, where an ad-hoc build's
  per-build hash allowed none; and a dev build (`yarn start`) runs as Electron's own bundle with its own grants. The capture handler lives in
  `screenShell.ts`, beside the lift below, because the lift points into the display it last captured.
- **On your ask, the voice lifts one region of your screen and dims the rest** (only when you
  ask it to show you). After a `read_screen` on that same ask, `focus_screen` sends fractions of that still
  (`slopweaver:focus-region`, overlay only, call up — `noCallRefusal`). Main places them on the display it
  last captured, refuses if that display changed or is not the primary, clips to the display the whole window
  covers (a box in the menu bar or the Dock is lifted like any other; only a sliver is refused), divides by the page's zoom
  and answers a CSS-pixel rect (`screenFocus.ts`). The page draws four dim panels round a hole (the window is
  transparent and cannot blur the apps under it): a click in the hole lands in your app, and a tap on the dim
  drops it. So does your next word, a newer lift, the call ending or dropping, or 20 seconds. Residues, named: a tap on the
  dim makes the voice's panel window key until you click your app, as a tap on the orb does; a click inside the
  region is invisible to the voice, hence the timeout; the primary display only. The page's gate is
  `site/lib/screenFocus.ts`; an older shell has no `focusRegion`, and the voice says where in words.
- **Every in-app view has a way back** (a card's local page must never leave you stuck with no way back to
  the Queue). A link to a bare document — a local page at `/api/page/<slug>/index.html`, any other file the console
  serves, a docs page — never replaces the page you are on: `showWindow` sends it to the console's `/view` page, which
  frames it inside the console's sidebar under a bar whose first control is "Back to the card" (`inAppViewPath`).
  A page linked from that page keeps the same way back, and a remembered last page that was a bare document reopens
  in the viewer too. A new tab's first page has the strip's ‹ back (above); the Board says in its head that only a
  card reaches it; in a browser such a link opens a new tab. On a local page the bar's Reveal in Finder copies it out of
  the store as one file and selects that, to drag into Slack, by slug only: [reveal in Finder](docs/reveal-in-finder.md).
- **A framed briefing's link goes where its ⌘-click would** (a plain click on
  a briefing's external links must open something). A briefing in the preview modal or viewer following its OWN link
  opens your browser off the console, a new tab for a console page, and stays framed for a bare document
  (`frameNavigationDecision`). A frame loading what its page gave it is untouched; a server redirect is not seen.
- **It remembers.** The window's size, position, maximised and full-screen state, the page you were on, and every
  open tab in order, in `~/Library/Application Support/Slopweaver/`. A relaunch lands on the Queue's tab with the
  rest behind it, each loading the first time it is shown. A call open when you quit is shown as interrupted and is NEVER
  restarted (it waits for you to press start call); its conversation is
  already on this machine, where `slopweaver talk calls` and the next call read it. Each session the app hosts is
  journalled beside them in `session-harness.jsonl` (owner-only): its vendor transcript id, its launch and its
  process group, so a later run knows what it could resume ([the recovery journal](../docs/session-harness.md#the-app-implementation)).
  A `cmux spawn --harness app` that resumes the run continues that same transcript in a new card, after ending
  the old run's leftover processes ([resuming an app session](../docs/session-harness.md#resuming-an-app-session)).
- **The fleet comes back by itself** (resuming operations takes as
  little effort and thinking as possible). Every half minute it reads `bin/slopweaver fleet health --json` from
  outside cmux, so it sees the fleet down with the console and the supervisor both gone, and types ONE `fleet
resume` into a new cmux tab, once per episode, remembered across a restart of the app — continuing an attempt
  that deferred with work left, a bounded few times, and never retrying one that failed. It does this quietly
  (you are never on the hook for dealing with it): Open Sessions in the menu bar shows
  a capacity line, every seat red, flashing yellow or green with its priority band and the row it runs, the reason
  in plain words, the original text under a fold — and neither the page nor cmux is ever raised: the automatic
  launch opens cmux with `open -g` and types its tab without `activate`, while your own press brings cmux to the
  front (an automatic resume must never pull cmux over the pull request you are reading). Only a step you alone can take
  reaches you, as the page's one button and a floating note: an Anthropic sign-in naming the account, an override,
  Automation consent, opening cmux — or "Start recovery again" once recovery has stalled on something it can
  move, never while the supervisor is live (its own process running with no login wall read, whatever its colour
  and however the episode's attempts ended), whose note waits until the fleet has read down for two minutes, names what it READS as down and when it first read the fleet down, says only what the journal shows recovery did, and folds why. A seat that keeps falling over after being brought back is held and handed to
  the supervisor to investigate, never respawned again. No priority control and no reseat button: those go to the
  supervisor. The first launch asks macOS to let it control cmux. The verbs: [skills/fleet](../skills/fleet/SKILL.md).
- **The console's glass contract**: every load the shell starts carries
  `?sw-surface=native` (`src/surface.ts`), `<html data-shell="main|overlay">` names the window, and the console's
  light or dark choice drives the native appearance, never the system's. The console window is OPAQUE, with no
  vibrancy, and every surface in it too (every surface is solid, a hundred percent
  opacity); the overlay is the one transparent window, so your desktop
  shows around the orb and its panels, never through them.
- **No title bar, the tab strip in its place**: on macOS the console window hides its title bar
  and keeps the window buttons inset at the left of the tab strip, which holds them room and whose blank space drags
  the window; every page is told `data-window-controls="none"`, the strip being above it. The strip is the ONLY drag
  region: a tab's view keeps the last region any page in it reported, so a page in a tab — the holding page
  included — never declares one, or the next console page is a title bar end to end, every click dead (`holdingPage` in `src/surface.ts`). In full screen the buttons go and so does the room.

## Where the code is

Pure decisions are tested in `__tests__/unit/` (the unit lane collects them, the root `tsconfig.json` typechecks them):

| Module                     | Decides                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `shellState.ts`            | the menu bar icon, its lines and its items, from what has happened                      |
| `desktopBridge*.ts`        | every message between the windows and the main process, parsed rather than trusted      |
| `overlayWindow.ts`         | the overlay's bounds, its glass, when it takes the pointer, and when the stage yields   |
| `nativeCapture.ts`         | the native look's size, which display's picture it is, and when Screen Recording is off |
| `persistedState.ts`        | what is remembered across a restart, and what a corrupt or off-screen record becomes    |
| `consoleEndpoint.ts`       | the console's address, read off what `docs-site.sh` printed                             |
| `consoleHealth.ts`         | when the fifteen-second check recovers: two failed reads in a row, never one            |
| `windowRole.ts`            | which window a message came from, the voice's judged against its page's loaded origin   |
| `surface.ts`               | the addresses the shell loads and remembers, and which ones open inside the viewer      |
| `deepLink.ts`              | what a `slopweaver:` address asks — a page and its tab, the app, the voice — or nothing |
| `windowChrome.ts`          | the console window's title bar, where its buttons sit, and when the strip makes room    |
| `tabStrip*.ts`             | the tabs: where one opens, which shows on a close, the keys, back, the strip, a restore |
| `tabPages.ts`              | each tab's icon, its page's sidebar glyph, and the pages the new-tab button offers      |
| `findBar.ts`               | find in page: its keys, what the bar may send, its count, where it sits, its page       |
| `mediaCounts.ts`           | whether a call or a share is live, from the capture tracks each window reports          |
| `logo*.ts`                 | the logo asset read as pixels, and the mark the menu bar draws from it                  |
| `trayIcon.ts`              | the menu bar icons: the logo's mark, dimmed or badged per state                         |
| `trayPresentation.ts`      | the icon's title, tooltip, first line and Quit; a test instance's read Slopweaver Test  |
| `trayMenu.ts`              | the icon's menu in order, less the fleet, guide and triage a test instance never starts |
| `appIcon.ts`               | the Dock and Finder icon: the logo at every size, packed to `.icns`                     |
| `fleetHealth.ts`           | the fleet's health off `fleet health --json`, an alias refused unless a plain name      |
| `fleetAutomation*.ts`      | one automatic recovery per down episode, a deferral continued, every line it types      |
| `fleetPage.ts`             | the sessions page and the floating note, as script-free HTML                            |
| `buildIdentity.ts`         | which Slopweaver this is — packaged or a dev build of which checkout — and every title  |
| `consoleNote.ts`           | the failed console's floating note: what failed, what to do, its links and its place    |
| `consoleRestartHold.ts`    | how long a console not answering is waited out as an update's restart before the note   |
| `shellBuild.ts`            | the commit the running and the installed app were built from, off their `Info.plist`s   |
| `permissionGuide*.ts`      | which permissions are off, when the guide raises, its step, page and animation          |
| `inputControlConsent.ts`   | the optional mouse and keyboard control step: offered, declined, Settings or granted    |
| `systemAudioPermission.ts` | where the System Audio Recording helper is, and which of its answers are a status       |
| `updatePlan.ts`            | the one-click update: the menu bar's item, the launch, its record, the call's restart   |
| `triageClock.ts`           | rapid triage's countdown, menu items and note files; `triageShell.ts` applies them      |
| `voiceQueueWire.ts`        | the voice's ask for the console tab's Queue: the reply, its bound, when to ask again    |

`fleetProcess.ts` runs `fleet health`, `open [-g] -a cmux` and the AppleScript that types into a new cmux tab;
`fleetShell.ts` applies the fleet's half to Electron — the timer, both windows, and the one button.
`nativeCaptureShell.ts` takes the voice's native look through Electron, under the lease `main.ts` holds.
`navigationShell.ts` asks the showing tab's page to move in place and loads the asked page whole only when the move
will not land. `tabsShell.ts` applies `tabStrip.ts` to Electron — one page per tab under the strip, created the first
time it is shown — and `stripPreload.ts` turns the strip's clicks, drops and closes into its commands;
`stripPaletteShell.ts` keeps the look a tab's page reports, and `newTabShell.ts` pops the + button's menu. `findShell.ts`
applies `findBar.ts` — the bar's view over the tab showing, `findInPage` on that tab's page — and `findPreload.ts`
turns the bar's typing and keys into its commands. `tabRouting.ts` decides which tab a page opens in (`showWindow`) and guards each tab's page on the console (`guardConsoleNavigation`).
`brandingShell.ts` holds every window to its title and gives a dev run its Dock icon; `consoleNoteShell.ts` raises,
moves and takes down the console's note; `permissionsShell.ts` lets only the console have the microphone and screen;
`permissionGuideShell.ts` raises the permissions guide, re-reads macOS while it is up and carries out its presses,
`permissionAskShell.ts` raises macOS's prompt or opens a Settings page for a press, and `inputControlShell.ts` reads
Accessibility trust with no prompt and carries out the optional mouse and keyboard step;
`systemAudioPermissionShell.ts` runs the System Audio Recording helper, and `makeSystemAudioPermission.ts` builds it.
`trayImage.ts` reads the logo asset once and turns each `trayIcon.ts` variant into the menu bar's template image.
`updateShell.ts` applies `updatePlan.ts` (launch, record wait, reload, swap deadline); `updateCallShell.ts` the hang-up and restart.
`consoleRecoveryShell.ts` runs the console's check, its one `--serve` and a held restart's reads; `eventLogShell.ts` appends to `desktop-events.jsonl`.
`startupReads.ts` holds the two reads `main.ts` makes as it starts: the checkout to serve, and a bundle's `Info.plist`; `checkoutSelectionShell.ts` owns that checkout (`servedCheckout`) and opens the note's clone picker, whose answer the pure `checkoutSelection.ts` reads.

`main.ts` applies them to Electron and `preload.ts` is the only thing either page can reach. The console's half
of the bridge is `site/lib/desktopShell.ts`, with the overlay page at `site/app/(overlay)/voice/`.
