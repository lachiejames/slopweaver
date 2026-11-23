# What a brief can and cannot ask for, MEASURED

Part of [The browser route: the owner's real Chrome, and nothing else](../browser-route.md).

Each limit below was measured rather than inferred, so read this section before writing a brief, not after.

**Every bullet caps the BRIEF, never this repository.** [The relay](target-proof-and-playwright.md#playwright-is-the-transport-and-it-reaches-the-owners-real-chrome)
writes files and collects bodies, and the owner ruled for exactly that — the WHOLE browser surface, never a
subset. A lane that needs more than a brief gives is MOVED onto the relay,
never shrunk to a URL-and-method census.

- **A page with no screenshot is "reached but not photographed", not a failure.** A walk document's
  `screenshotPath` is nullable because a route that answers an image to the MODEL cannot write a file a verb
  then reads (MEASURED on the Claude-in-Chrome extension, which is refused today). The relay
  writes files — `page.screenshot({ path })` in `src/browser/playwrightCli.ts` — and 502 such PNGs stand on
  this install.
- **A network log without bodies shows a CALL, not a response.** MEASURED on a live console page:
  72 captured requests, each exactly `url`, `method`, `statusCode`. `CapturedCall` in
  `src/atlas/slackApi/harObservations.ts` has no source from such a log. The relay's `RESPONSE_HOOK` collects
  bodies, so the Slack atlas's `driven-browser` half stands at its last Playwright-filled generation until it
  is rerun there.
- **An endpoint visible in the network log is not necessarily callable.** Measured alongside it: a
  console's internal API answered `403 Invalid session` to a `credentials: "include"` fetch, because the
  page holds a bearer in memory rather than in a cookie. Lifting an in-memory token out of a page is a design
  decision that needs the owner's word, not something a brief quietly does.
- **No brief step runs a page script or reads the network.** A caller picks a declared relay operation,
  never code; such a step rides `no-verb-yet` and names the operation that would close it (`src/browser/brief.ts`).

## The profile is PINNED, not inherited

**MEASURED.** The relay chooses no profile at all. Handed a fake Chrome that logged its argv and
launched nothing, `playwright-core` 1.61.1's `attach --extension=chrome` spawned it with exactly one
argument — the connect URL. No `--profile-directory`, no `--user-data-dir`. Chrome then places the page in
the profile it was last used in, which is why the owner's connect page opened in the owner's PERSONAL profile
while the owner was reading something there. The owner's requirement: whatever the owner has open in the
personal profile in front, the agents' Playwright always goes to the work profile.

A newer `@playwright/mcp` does pass `--profile-directory`, and follows the owner anyway: it derives the value from
Chrome's `Local State` `profile.last_used` and tries that profile first. Same behaviour, one layer down.
Reproduce either with `grep -n "_openConnectPageInBrowser" node_modules/playwright-core/lib/coreBundle.js`.

**Disabling the extension in the other profiles is NOT a pin**, and this is the trap worth stating: the
newer relay's eligibility test is `Extensions/<id>/` existing on disk or a non-empty
`extensions.settings[<id>]` record in `Preferences`/`Secure Preferences`, and both survive a disable. Only
REMOVING the extension changes that answer, and that is the owner's own hand — no session drives a profile
that is not the work one.

So the launch goes through a pin: a short shell script (`$SLOPWEAVER_HOME/chrome-pin.sh`, `0700`) that
execs the same Chrome with `--profile-directory` and `--new-window` already in front, handed to both relays
through `PLAYWRIGHT_MCP_EXECUTABLE_PATH`. It is written from the recorded profile on every attach, so a profile the owner
moves off stops being steered at, and `slopweaver browser pin` writes and reports it by hand.

```bash
slopweaver browser pin            # write it, and say which profile it opens
cat "$SLOPWEAVER_HOME/chrome-pin.sh"
```

Two properties are deliberate. `chromePinPath` is a REQUIRED field of `PlaywrightCliDeps`, so no shape of
the transport can forget it. And nothing here writes down where Chrome is: `src/browser/profilePin.ts`
resolves the binary through `playwright-core`'s own registry, which is what lets
`no-private-browser-profile` ban a browser-executable literal outright rather than keep an allowlist.

## The connect page gets its own window, and its tab closes on every ending

Two properties, because the owner photographed four stacked `Playwright · Claude` tabs beside the briefing the
owner was trying to read.

**The window.** Handed a URL with no window flag, Chrome puts the page in whichever window of the pinned
profile was last focused — the owner's, while the owner is reading. `--new-window` gives every walk a window it
owns, so agent tabs never join the owner's and the owner can keep that window minimised. The flag rides the same direct `exec` as
`--profile-directory`, so it is monotonic: if Chrome ignores it, nothing else changes. `open -g -a <app> --args …` would ALSO have suppressed activation and
was rejected for the opposite property — macOS `open` drops `--args` for an already-running app, so that pin
would silently stop passing `--profile-directory`.

**The tab.** `src/browser/tabGuard.ts` closes the connect tab on `exit`, `SIGINT` and `SIGTERM`, so no
`transport.release()` call site has to sit in a `finally` to clean up. The two
compose: a Chrome window whose last tab closes goes with it, so an agent window does not accumulate.

**The foreground is given back, not never taken.** Chrome ACTIVATES itself when handed a URL, the extension
focuses the window it connects, and `page.bringToFront()` before a second screenshot attempt raises it again
mid-walk; no Chrome flag suppresses any of the three. So `src/browser/foreground.ts` reads what was in front
before every attach and every operation, and — only when the walk's own window is in front afterwards —
raises the owner's Chrome window (`osascript`, Chrome's own dictionary) or re-activates the other app (`open -b`).
MEASURED on the owner's live Chrome: ~5 seconds in front per shot before, under a second after, and the
page still photographed byte-for-byte the same from behind the owner's window. The owner's own shape: in the
foreground for about half a second, then straight back behind. It is best-effort by
construction — a refused Apple Event or a locked screen leaves the foreground exactly where it was. `SIGKILL`
and a power cut are uncatchable and can still strand a tab.

**Background by default; one option shows a run** (the owner's ruling). After the restore, every
launch path also raises the window just behind the agent's back over it in Chrome's own order, so coming back
to Chrome lands the owner in the owner's window, not the agent's. `SLOPWEAVER_BROWSER_FOREGROUND=1` on a command — a resync, a
walk verb, `browser open`/`inspect` — skips both and leaves the window in front for the owner to watch; an interactive
session records the choice at `open` and keeps it until `close`. `browser present` is always foreground, and the
hand step's sign-in page never runs through either lane. Two traps, MEASURED, each of which silently
kills the restore: Darwin 27 changed `lsappinfo`'s output, and Chrome ignores `set index of window … to 1`
while a screen-share bar holds index 1, so a raise hides and re-shows the window instead. When the owner is in another app the agent's window is named as the new top of Chrome's
own order across the attach, since the front app's window is not Chrome's. Sending to the back, off-screen
parking and minimising were measured too and rejected — `src/browser/foreground.ts` carries why.

**What is NOT covered.** A `playwright-mcp --extension` MCP server started outside this repository gets the
pin only if its own launch config carries `PLAYWRIGHT_MCP_EXECUTABLE_PATH=$SLOPWEAVER_HOME/chrome-pin.sh`.
Nothing here can set that for it.

## One walk at a time, and each bound to its own origins

MEASURED, within three minutes: four walks, github, linear and notion among them, started at once against
the owner's real Chrome. The relay's shared context is ONE tab and nothing serialised access to it. The Notion walk's
pages landed on `linear.app`, its own report saying _"the client sent this address to https://linear.app,
which is not where it was asked to go"_, and it KEPT 36 of 37 and 107 of 114 response bodies from the wrong
site, filed under Notion. Three of the four died. A crashed walk still published: `github`'s
`/settings/profile` went from landed, photographed and nine endpoints to `outcome: failed` with no
screenshots, over the top of a good record.

The owner's ruling: make this structurally impossible to get wrong — two atlas runs on the same integration
cannot run at once, and one integration's atlas cannot land in another's. So
what follows is a mechanism, not a warning:

**The relay lease** (`src/browser/relayLease.ts`). `createPlaywrightCliTransport` cannot visit a page without
holding it, and there is ONE key for the whole machine rather than one per platform — the contended resource
is the single relay tab, so a per-platform key would have refused nothing that actually happened. A live
holder is never stolen from, whatever its age, because a walk of thirty pages runs for minutes; a holder the
kernel no longer knows is taken over at once, so an abandoned lease heals itself. A contender WAITS for a live
holder rather than losing at once — up to `RELAY_LEASE_WAIT_SECONDS` (540 s), printing who holds it — because
a scheduled resync refused the instant a bot turn held the tab lost three atlases in one pass. A
wait that ends without the lease stops the walk, and a lease this process already holds is refused at once.
The page transport, `browser shot`'s evidence capture and the Notion settings walk wait; the other console
transports (Datadog console, Vanta policy editor, Fathom share) still refuse at once.

**The origin binding.** The same lease names the origins its walk may touch, and `platform` and `origins` are
REQUIRED dependencies of the transport, so no walk can decline to say where it is allowed to go. Three
consequences, and each is a refusal rather than a note: an address off those origins is refused before the
client runs; a page that SETTLES off them returns `OFF_LEASE_ORIGIN` instead of a capture, and stops the walk
rather than letting one confused relay produce thirty more wrong pages; and a response body whose own URL is
off them is dropped, because the in-page hook filters by content type alone and "first-party" was an
intention the code did not hold. The invariant a consumer may rely on is total: a `PageCapture`'s `finalUrl`
and every response URL in it are on the lease's origins, or there is no capture.

**A run that failed may not publish less than the store holds** (`src/atlas/kit/evidenceLoss.ts`), checked
inside `publishAtlas` so no atlas can route around it. A succeeding pass may still shrink a kind — a record
the provider genuinely lost is a fact. A failing one may not, counted in entities AND in distinct artifacts,
because the measured case republished every declared page and lost only the screenshots.

## Which profile

Nothing here names one: a profile is per-install state, and state lives outside the codebase. Which of the owner's
Chrome profiles is the work one — and the account behind it — is recorded at runtime as the store's
`browser-profile` row and never committed. A read finding no row imports a retired `$SLOPWEAVER_HOME/browser.json`
once; a store that cannot be reached is a typed refusal, never a guess:

```bash
slopweaver browser profile --list                # every profile Chrome knows, with its account
slopweaver browser profile --set Default         # record the one you work in
slopweaver browser cookies --origin https://github.com   # is it signed in there, and until when
```

Nothing guesses. A guess that landed on a personal profile would drive the owner's own browsing as if it were work.
