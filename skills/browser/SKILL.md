---
name: browser
description: >-
  Drive the owner's own Chrome through Slopweaver's Playwright verbs — take a session on a page, read what is on it, and perform one interaction at a time (click, fill, type, select, check, hover, press, drag, upload, download, navigate) with a screenshot of its own result as evidence. Use whenever a task needs a real browser: a console no verb reaches, a form to fill, a file to upload or fetch, a page to photograph. Phrases like "click that", "fill in the form", "upload the policy",
  "download the export", "what does that page say", "drive my browser".
---

# Driving the owner's browser

**The fleet is completely OFF Claude in Chrome.** Every
`mcp__claude-in-chrome__*` call is refused categorically, with no override. Everything a hand can do on a page is a `slopweaver browser` verb, and if an interaction
has no verb, **the build is not finished** and that is a row, not a workaround. **A raw launch is refused too**
(rule 3): `open -a <browser>` or `open <url>`, a Playwright CLI (`npx @playwright/cli`, `playwright open`, `--extension`,
`--cdp`), a browser binary run directly, debugging flags included, and `osascript` telling a browser — exit 2 from
the PreToolUse hook (`src/admit/browserLaunchCommand.ts`), and neither `SLOPWEAVER_ALLOW_RAW` nor `SLOPWEAVER_ALLOW_BASH`
opens it; its own hatch, `SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1`, is for proving the refusal.

## The loop

```bash
slopweaver browser open --url <url>              # take a session; its id, a picture of the viewport, the first look
slopweaver browser read --session <id>           # a picture of the viewport, and an OUTLINE of its elements with the refs you aim by
slopweaver browser read --session <id> --find Merge   # only the lines holding "Merge", under their ancestors — no new look
slopweaver browser read --session <id> --under f1e9   # open one part the outline left shut — no new look
slopweaver browser scroll --session <id> [--pages 2] [--up]   # a screen at a time, photographed, then a fresh read
slopweaver browser aim  --session <id> --target <ref>   # OPTIONAL: frame that element, mark it, photograph, act on nothing
slopweaver browser act --session <id> --do <kind> --target <ref> --observation <obs> --out $SLOPWEAVER_HOME/proof/<slug>/after.png
slopweaver browser close --session <id>          # closes the tab, leaves the owner's Chrome running
slopweaver browser inspect --url <url>           # the voice's one look: open, read, close, naming any cut; registered hosts only
slopweaver browser present --destination datadog # the voice taking the owner there: tab LEFT open; or --url on the register (a Slack permalink: the owner's desktop app, `openedIn`)
slopweaver browser present --page <slug>         # one of the owner's published pages as a new desktop-app tab (Chrome only with no app installed); `page find <words>` names the slug
slopweaver browser present --url http://localhost:3000/queue#settings/appearance # a console page as a desktop-app tab; never the console's /api/
slopweaver browser sign-in --provider datadog|github   # signed in? exit 0. A wall: exit 3 and the one button the FLEET presses
slopweaver browser annotate --form ./annotate.json   # boxes and notes onto a picture you have; records nothing — look, then image-record
slopweaver browser terminal-shot --form ./terminal.json   # terminal text drawn to a PNG, with a capture receipt carrying its exact text
slopweaver browser console-shot --walk automations-context --out $SLOPWEAVER_HOME/proof/<slug>/a.png   # a console click-through over a THROWAWAY fixture store
slopweaver browser redact --form ./redact.json   # opaque rectangles burned into a captured PNG, written as a NEW file with a child receipt
```

**Every picture is the VIEWPORT — what you would be seeing.** A browser works well because every move shows
its result at once, and every act shows the result of that act. So the loop is look, move, look again, and
what is not on the screen is reached with `scroll`, not photographed from a whole-page stitch. `--full-page` on `aim`/`act`
still takes one when the shape of a tall page is genuinely the question.

The page stays exactly as you left it between commands — a session is named and persistent, so a `fill` and
the `click` that submits it are two commands on one page. `slopweaver browser sessions` lists what is open:
who opened each (pid, cmux workspace, run), whether that opener is live, the page, the age, and what the next
`machine reap` will do with it. **Ownership at open, liveness at reap, idle expiry as the bound**: every sweep tick's `machine reap` closes a session whose opener is gone, AND a background one
idle past its 15-minute expiry whoever opened it — no command can act through that one any more. A session in
use is kept however long ago it opened. `browser close` is still the polite path — take it when you are done,
and read a page you will not act on with `browser inspect`, which closes its own tab.

**A fleet browser stays in the background.** No verb asks for focus but one
recovery — a screenshot that times out on a tab Chrome stopped drawing activates that tab and tries once more
(`src/browser/viewportCapture.ts`) — and every attach, activation and close gives the foreground straight back
and raises the owner's Chrome window back over the agent's (`src/browser/keepForeground.ts`). Chrome and the Playwright extension
still bring the window forward for under a second on each ATTACH, which nothing here can switch off — so attach
once and keep working through that session; never reach for a raw `playwright-cli`, which gives nothing back.
A background session, from `browser open` on, also refuses the page's own full-screen request (a video or replay player's "Enter
fullscreen"), which would otherwise move Chrome to its own macOS Space and take the owner's whole screen; the receipt
says so (`src/browser/fullscreenGuard.ts`, with what it does not close). **To SHOW the owner a run** — on a call, say — prefix the command: `SLOPWEAVER_BROWSER_FOREGROUND=1 slopweaver browser
open --url …` keeps that session's window in front until `close`; the same prefix on a resync or walk verb
reaches every walk it drives. `browser present` is always foreground.

**A Datadog or GitHub sign-in wall is yours to press, never the owner's to be carded** (the owner's ruling). Take
`browser sign-in` first, press the button it names, then look again with its `--session <id>`. A card asking the owner to sign in to either is refused unless that
look found the step genuinely the owner's ([fleet sign-in](../../docs/browser-route/fleet-sign-in.md)).

**`--do` takes one of:** `click`, `double-click`, `fill`, `type`, `select`, `check`, `uncheck`, `hover`,
`press`, `scroll`, `drag`, `upload`, `download`, `navigate`, `back`, `forward`, `reload`, `dialog-accept`,
`dialog-dismiss`. One command is one interaction plus the evidence of what it did.

## Eight rules you will meet

- **Anything that can change a page must cite a `read`.** Pass `--observation <id>` from the read you
  actually looked at. A read that is not this session's latest, or that was of a different page, is refused —
  the page moved underneath the decision, so take a fresh one.
- **Find a ref with `--find` and `--under`, never by Reading the elements file whole.** Every look prints an
  outline, opened breadth-first to about 6 KiB, each part left shut one line naming the ref that opens it, and
  the whole file's size beside it — a session handed a massive dump of junk in its context
  window does worse work ([seeing](reference/seeing.md#the-elements-are-an-outline-you-open)).
- **Aim by `ref`, and only by ref.** Every element in a look carries one, written `[ref=f1e4]`.
  A ref from a superseded snapshot fails closed rather than clicking something else — and where the replaced
  page has re-issued that number to another element, `act` refuses it as `REF_NAMES_ANOTHER_ELEMENT`; a CSS
  selector has no such property, so `--target` **refuses one** (`SLOPWEAVER_ALLOW_BROWSER_RAW_SELECTOR=1` is
  the way past). On a single-page app, `browser read` before aiming: `open`'s first look can be taken before
  the page renders, and its refs die with that render (measured on claude.ai's login).
- **A keystroke must say where the cursor is.** `--do type` and `--do press` carry no element — the
  characters go wherever focus happens to be — so both need `--expect-focus <ref>`, and the page is **asked**
  where focus actually is before anything is typed. A mismatch is refused and names what really holds it.
  Focus a field with `--do click` or `--do fill` first. A page-level key (Escape, a shortcut) is
  `SLOPWEAVER_ALLOW_BLIND_KEYSTROKE=1`.
- **Every write-capable `act` shows you its target first, in the viewport.** The element is scrolled into
  view, the viewport is photographed unmarked (`before:`), the element is highlighted, and the SAME viewport
  is photographed again (`aimed:`) — so the difference between two otherwise identical pictures is the
  element. The receipt names both, says where in the document that screen is (`framed at: y 2611 of 10419`),
  and prints what the register says the page may be driven to do (`Slack — read-before-write`,
  `unregistered host — refuse-every-write`). Then the action runs and the viewport is photographed once more
  (`after:`). The target is also given the page's own FOCUS by default — a human about to
  click, and on a page that reveals an affordance only on hover it is the only way the picture shows the
  thing about to be clicked. It is a REAL interaction, so it is never taken on a page the register refuses
  writes on; `--no-focus` marks with the highlight alone. On `browser aim` it stays `--focus` opt-in, because an aim is undoored on the grounds that it performs no write. **A target the pictures do not actually contain is REFUSED**, with a declared escape hatch and the
  judgement left to you. Otherwise it refuses nothing. **It proves nothing
  on its own** — the pictures make a wrong aim reconstructable, not impossible. When an interaction is worth
  looking at first, `browser aim --target <ref>` takes the same pictures and acts on nothing; it is a look,
  and it grants nothing `act` would not have allowed anyway.
- **When what you want is below the fold, `scroll` and look again.** `browser scroll --session <id> --pages <n>` moves one
  screen at a time — the delta read off the live viewport, with an overlap so nothing falls on the seam —
  photographs each screen, says where in the document it is, and stops early when the page does not move.
  It ends with a fresh read, so the next `act` has refs and an observation to cite. The owner's own walk is the
  shape: land, look, highlight the tab, click, look, scroll a screen, look, highlight the facet, click, look.
- **Some pages refuse every write.** `console.jumpcloud.com` is the first. The refusal names the page, the
  interaction and the hatch; it exits 1. Reads and screenshots on those pages are never refused.
- **A Datadog console is only ever this install's site** (`profile.json`'s `datadog.site`, `DD_SITE` winning). `open`,
  `inspect`, `present`, `shot` and `act --do navigate` refuse `app.datadoghq.com` (or any other site's console) when the
  site is another (`us3.datadoghq.com`, say), and a regional site's dead `app.` host (`app.us3.datadoghq.com` for one) on every site, naming the console to retry on — build the address from the site, never from a doc example (`src/datadog/siteGuard.ts`) — or let `present
--destination datadog` build it.

**Why the first four exist, as the owner explained them.** The incident behind them was a click that missed Slack's
search field followed by a blind `type` and a `Return`, which posted a message under the owner's name. The owner
had described the fix personally — take a screenshot and show it back to the owner after focusing a cursor in that
text field, so the owner should be able to tell that the cursor is in the correct text field — and both halves of
that sentence are verbs. The focus assertion and the ref-only aim landed on the owner's ruling; the picture landed
the same evening, where the owner chose it over a reviewer session per operation, as way overkill that would
actually result in worse outcomes, because the screenshot and the highlight is probably one of the best ways the
agent could assert that it is definitely looking at the right place. **The pictures are the
viewport**: a whole-page shot is not what a person sees, and a
highlight on a 10,419-pixel page is an unreadable speck. **The register's
posture prints next to the picture on the owner's instruction** — with the picture and that list in front of it, your
own judgement is the rest.

## Judgement is the rail, not the list

The owner was explicit that a closed inventory of permitted steps is the wrong shape, and that the protection
is information plus judgement: if you rely on dumb heuristics there is a good chance that one day it will blow
up, whereas the owner feels that with the good information in front of you and good judgment you are a lot less
likely to blow up. The owner's own example is the one to hold: the owner is an admin in Datadog, so **you can**
reach organisation settings and click delete organisation, and you obviously must not.

**When the call is genuinely the owner's, card it — never guess and never stall.** Take no action, and put it on
the console Queue with `slopweaver handover ask`: what you were about to do, what you read, what it would
cost, and your lean. A thing you did because nobody told you not to is the failure mode this whole lane exists to
avoid.

## Detail

- The interactions, their arguments, what each proves and the capability gaps that remain:
  [interactions](reference/interactions.md).
- What each act photographs, before and after, and how to walk a page a screen at a time:
  [seeing](reference/seeing.md).
- The ruling, the retirement and the read-only rail: [docs/browser-route.md](../../docs/browser-route.md) and
  [docs/browser-route/retirement-and-aim.md](../../docs/browser-route/retirement-and-aim.md).
- One page photographed and nothing else: `slopweaver browser shot --url <url> --out <file.png>` is the
  cheapest thing when all you need is a picture.
- A picture bound for GitHub needs a capture receipt naming its bytes, frame text included: `browser shot`,
  `terminal-shot`, `console-shot`, `redact` and `proof cassette` write one, and `--raw`, `annotate` and the provider
  `shot` verbs do not ([attachments](../github/reference/attachments.md#only-a-file-a-capture-verb-wrote-is-sent)).
- A console change's click-through is `browser console-shot --walk <name>`: it builds this checkout, stands the
  console up headless over a fresh database on the selected store's own local server, seeded with the `acme`
  fixture, never this installation's home, store or credentials; it runs one registered walk
  (`src/visualEvidence/consoleWalks.ts`, its steps in `src/__tests__/e2e/capture/consoleWalks.capture.ts`) and photographs
  the walk's region. A new walk is a row in both. `SLOPWEAVER_CONSOLE_SHOT_DIR` names the throwaway directory the
  spec writes its raw shot and observation into: the verb sets it in the capture child's environment alone and
  removes the directory when the shot ends, so never set it yourself.
