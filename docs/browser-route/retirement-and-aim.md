# Claude in Chrome is RETIRED

Part of [The browser route: the owner's real Chrome, and nothing else](../browser-route.md).

The owner wants the owner and the fleet completely off Claude in Chrome: the extension deleted from the owner's
browser, and every browser task done through the Playwright verbs built in Slopweaver. If there is no verb for an
interaction a page might need, the build is not finished: full read, write, download and upload capability lives
in Slopweaver's own verbs, one command per action, and each action takes a screenshot afterwards as evidence of
what it did.

**What follows is mechanism, not prose.**

- **Every `mcp__claude-in-chrome__*` call is refused categorically**, reads included, and the refusal is
  decided BEFORE either break-glass escape is consulted (`retiredChromeCall` in `src/admit/chromeRetirement.ts`,
  returned early by `src/admit/browserDoorGuardRunner.ts`). There is no override, and the refusal says so: a
  waiver would re-open the exact lane the owner asked to have deleted. What replaces it is named in the refusal
  itself.
- **A raw browser LAUNCH from a session's shell is refused too**, by a different kind of refusal: a
  `PreToolUse` walk (`src/admit/browserLaunchCommand.ts`) over `open` into a browser, the Playwright CLIs, a browser
  binary and `osascript` telling a browser, which names these verbs and carries its own ambient hatch,
  `SLOPWEAVER_ALLOW_BROWSER_LAUNCH` — a launch is a policy with legitimate exceptions (proving the refusal), where
  the extension is a lane the owner deleted. Measured before it existed: each shape exited 0.
- **`slopweaver browser inspect --url <url>` is the console voice's one look**: open, read and close in a single
  call under one budget, only on a platform the register names and never its customer-published hosts
  (`notion.site`, `githubusercontent.com`, `slack-edge.com`), withholding a page that redirected off the register,
  with no action vocabulary (`src/browser/inspect.ts`). A close that reports a problem keeps its session row for
  `browser close`. It is what the voice's `browser` tool runs; a seat drives the loop below.
- **`slopweaver browser present` is the console voice TAKING the owner to a page**, and the one voice path that leaves
  a tab open: `--destination datadog|linear|github-pulls` resolved on this install on every call (Datadog's
  console from `DD_SITE`, never a guessed US1 host), or a `--url` held to exactly `inspect`'s address rules — and, on a Datadog domain, to this install's own console
  or a subdomain of it (a custom console subdomain on another site passes the shared guard, not this). A `--url`
  on the Slopweaver console itself, or a `--page`, opens as a desktop-app tab instead, bounded to the console's
  pages (`src/browser/presentConsole.ts`). The
  tab is taken through `browser open`'s own `openTab`, recorded BEFORE the attach so a killed run still leaves a
  row `browser sessions` lists and `browser close` lets go of; a page that redirected off the register or onto
  another Datadog site's console is closed again, and so is the tab of a present that failed partway — tried
  once, since a timed-out close may have landed and a second would close the owner's current tab, and detached only once
  closed, so a close that fails leaves a record `browser close` can finish. Once the page was navigated, a failure
  never repeats the client's own words, which can carry the page's text.
  Where a page lands is only known once it has, so a refused landing was on screen until that close, the limit
  `inspect` shares. It answers where the page landed and its title, never its elements (`src/browser/present.ts`). The owner
  asked for the voice to be able to take them to Datadog. **A Slack message link
  is the one exception to "leaves a tab open"**: it opens straight in the owner's Slack desktop app at the message, through
  Slack's `slack://channel?team=…&id=…&message=…` deep link with the team off ONE bounded, unretried `auth.test` on
  the read token (`slackAppCommand`, `slackWorkspaceLookupOnce`); a reply's link lands at its thread's root message,
  and the owner's Chrome is never touched, answered `openedIn: "slack-desktop-app"` — through Chrome, one
  open reached the owner as Chrome, Slack, Chrome, Slack, and the https permalink handed to the app moved nothing.
  Only when that cannot run (no Slack token, a permalink on another workspace, no Slack app, not macOS) does it
  take the browser, where Slack's permalink page
  hands the thread to the desktop app and the client's `goto` throws: a failed open still on the requested permalink
  under Slack's `Redirecting...` title is that handoff — the tab is closed once and the answer is the same, never a
  refusal (`slackDesktopHandoff`; measured: five of five threads the owner saw open read as failed).
- **The interaction verbs are `slopweaver browser open | read | act | close | sessions`.** `act --do <kind>`
  performs ONE interaction — click, double-click, fill, type, select, check, uncheck, hover, press, scroll,
  drag, upload, download, navigate, back, forward, reload, dialog-accept, dialog-dismiss — and photographs
  its own result in the same command. `skills/browser/SKILL.md` is how to drive them.
- **A step for the owner, which no code can take:** open Chrome's extension manager in the recorded work profile
  and remove **Claude in Chrome**. Keep **Playwright Extension** — that is the relay these verbs run on, and
  removing it would take the whole browser route with it.

**The per-page read-only rail**, from the same ruling: the owner names certain pages as read-only, and a write
attempted on one — a click on the JumpCloud console, say — fails hard, with an escape hatch. `console.jumpcloud.com`
is the first such page and is named explicitly in `WRITE_POLICY_REGISTER`; a write-capable interaction there exits 1 with
the four-line refusal, and `slopweaver browser break-glass --page <url> --reason "<why>"` records a
thirty-minute waiver for that ONE page. The session-wide waiver beside it waives nothing on this rail.

**Vanta is NOT on that list.** The owner rules that the fleet writes in Vanta: Vanta stays `read-before-write`, and
policy uploads through the browser are expected traffic.

## The aim is a rail too

The read-only rail judges WHERE you are. It says nothing about WHAT you are pointing at, and the Slack
missed-click incident was entirely the second thing: a click that missed the search field, then a blind `type` and a
`Return` that posted a message under the owner's name in a channel. The owner rejected blocking clicks and typing
on doored providers as too heavy-handed — it blocks the atlas work and therefore a chunk of ISO — and asked
instead for a middle ground: the principles that already make it virtually impossible for the bot to post an
incorrect claim, applied to the browser.
The risk of an unintended write is ACCEPTED, and the owner still counts one against trust — so the
answer is always a guard on the aim, never a fence that removes clicking or typing in a console.

The owner's ruling on the options page (`browser-write-accidents`) took the two cheapest; the third —
showing the target before firing at it — is [its own section](target-proof-and-playwright.md).

- **Refs only.** `--target` refuses a CSS selector. The client itself splits on `/^(f\d+)?e\d+$/`, and only
  the ref side has the fail-closed property — a stale ref refuses before anything is touched (and one a
  replaced page re-issued to another element is refused as `REF_NAMES_ANOTHER_ELEMENT`), while a selector
  matching two elements picks one silently. This makes that property total rather than opt-in, and
  it costs no capability: a write-capable action already has to cite a `read`, which is where refs come from.
- **A keystroke says where the cursor is.** `--do type` and `--do press` carry no element at all, so they
  require `--expect-focus <ref>` and the page is ASKED, immediately before dispatch, whether that element is
  `document.activeElement`. This is the owner's own worked example made deterministic — a reviewer session
  would have asked for a screenshot after focusing the cursor in the text field, a loop the owner judged too
  slow and too heavy-handed. It is one client command instead.

Both fail closed, both carry a hatch (`SLOPWEAVER_ALLOW_BROWSER_RAW_SELECTOR`, `SLOPWEAVER_ALLOW_BLIND_KEYSTROKE`),
and neither refuses an errand — only an ambiguously aimed one. `src/browser/aim.ts` is the whole decision;
`skills/browser/reference/interactions.md` § How an interaction is AIMED is how to drive it.
