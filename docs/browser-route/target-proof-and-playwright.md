# Show the target before firing at it

Part of [The browser route: the owner's real Chrome, and nothing else](../browser-route.md).

The third option off the same page, and the one the owner picked on the merits rather than on cost: a screenshot
with the target highlighted is one of the best ways an agent can assert that it is looking at the right place,
that its selector is the right selector, and that whatever action it takes touches that one element.

**The picture is the VIEWPORT.** The owner, walking Datadog APM by hand across seven screenshots, set the
model: a screenshot is what the owner would see operating the browser. A browser works because every movement
and every action shows its result at once, and nobody reads a very long page whole — screens are not infinitely
tall because a page is meant to be scrolled and viewed through the viewport.

So every **write-capable** interaction scrolls its target into the viewport, photographs that viewport
unmarked, highlights the target, photographs the same viewport again, puts the mark away, acts, and
photographs the viewport the action left behind. Three pictures — `before:`, `aimed:`, `after:` — fused into
`act`, which the owner accepted. `slopweaver browser aim` is the split form, the same pictures and no action.
`--full-page` takes a whole-page picture, beside the viewport ones and never instead of them.

**Why the SCROLL, not a close-up.** MEASURED: a whole-page shot of a 10,419-pixel page renders a
highlight an unreadable speck, and `highlight` does not scroll, so a viewport shot of an element further down
holds no highlight at all. Bring the target into the viewport first and one viewport picture holds the mark,
in its own surroundings, which is what tells a reader it is the right element at all. The `before`/`aimed` pair is the same viewport twice, so the only difference between
them is the mark.

**Focus is the default, on the owner's own idea**: focusing the element simulates a human click more closely
than a highlight does. It is better evidence —
the page draws its own focus ring, so the picture shows the page agreeing the element is reachable — and it
is a real interaction rather than an overlay: `focus` fires, and `blur` on whatever held the cursor fires with
it, which can validate a form, close a menu or dismiss a popover. So it is the DEFAULT, the owner's pick, `--no-focus` is the opt-out, it is
never taken on a page the register refuses writes on unless a break-glass waiver names that page, and the
receipt says out loud when it was dropped. The owner's own seven screenshots only ever highlight.

**Scrolling is a verb.** `slopweaver browser scroll --session <id> --pages <n>` moves one screen at a time, photographs
each, says where in the document it is, stops when the page stops moving, and ends with a fresh read. The owner's own
narration of scrolling a page by hand is the specification: scroll one page's worth, look for the thing, notice
it somewhere unexpected. There is deliberately no `--until <text>`: the client's `find`
searches the whole document, so such a flag would promise viewport semantics and deliver document ones.

**The register's posture prints beside the picture, and that is the second half of the ruling.** The owner's
reasoning: with the right information in front of it — the picture, which platforms the register calls read-only
and which read-write — and good judgement, a session has everything it needs to act the way the owner wants. So
the receipt and the
aim both carry a `this page:` line — the platform the register names, or `unregistered host`, and the effective
policy after any page rule. `BrowserAdmission` carries `provider` and `policy` for exactly that.

**What it closes: nothing, on its own, and no line it prints says otherwise.** The pictures are taken before
the dispatch and read after it, so they make a wrong aim reconstructable rather than impossible — the
determinism is [the two rails above](retirement-and-aim.md). What it does buy outright is that the scroll and the highlight both
resolve the ref against the current snapshot, so a stale or wrong ref fails ahead of the interaction rather
than during it. That narrows a `download` and an `upload`, the two whose failure leaves residue. Having no
element close-up costs that guard nothing, because the guard is a ref that will not resolve.

**The highlight fires no page handler; the scroll and the focus are real.** `playwright-core`'s
`lib/tools/skills/playwright-cli/references/video-recording.md` says its overlays are `pointer-events: none`
and do not interfere with page interactions, so no event reaches the page — that is the question
`src/browser/action.ts` actually asks when it calls a `hover` write-capable. The scroll is the same scroll the
interaction performs a moment later (Playwright's own actionability scrolls into view before it clicks, fills,
hovers or drags), so an action that goes ahead gains no page effect; a REFUSED one ends with the page scrolled
and nothing done. Cosmetic, non-destructive, and named. `behavior: "instant"` is deliberate, so a page with
CSS smooth scrolling is not photographed mid-slide. The other residue is an overlay left up by a process that
died between the highlight and its hide; `browser close` sweeps a session's own with a targetless `highlight
--hide`. `src/browser/aimShot.ts` carries the whole decision and the repros.

**One window none of it closes, stated rather than discovered.** The aim shot runs BEFORE the admission,
because `actionExecutor.ts`'s measured ordering rule forbids putting three round trips between the admission
and the dispatch. So a page that moved between the caller's cited read and the act is scrolled — and, unless
`--no-focus`, focused — before the staleness refusal fires. Same non-atomicity as the page rail, narrowed the
same way, closed no better.

**What was NOT taken, and why it is recorded rather than forgotten.** A reviewer session per risky operation —
the owner's own suggestion, option D — is **rejected** as overkill that would produce worse outcomes. Option E,
per-page read-only rows, stays rejected; the mechanism exists in the register with no row using it, and the
owner allows dogfooding one on Slack's client if a session wants it. Everything above is the standing
boundary, not an interim one waiting on a fix somewhere else.

## Playwright IS the transport, and it reaches the owner's real Chrome

The owner's requirement: Playwright, kept deterministic in a single command, covering the WHOLE browser surface
— no subset. A `slopweaver` command drives the owner's browser.

The route is `playwright-core`'s own extension relay. Read it in
`coreBundle.js`'s `extensionContextFactory.ts` rather than taking it on trust:

```js
const userDataDir = defaultUserDataDirForChannel(channel); // THE OWNER'S default profile
if (!(await isPlaywrightExtensionInstalled(userDataDir)))
  throw new Error(`Playwright Extension not found in "${userDataDir}". ...`);
const relay = new CDPRelayServer(httpServer, channel, executablePath);
await relay.establishExtensionConnection(clientName);
return await playwright.chromium.connectOverCDP(relay.cdpEndpoint(), { isLocal: true, timeout: 0 });
```

Three properties follow, and each is why this is the answer rather than a workaround. It resolves to the owner's
**default** user-data directory by design, and refuses with an install URL rather than falling back to a
fresh profile. It returns an ordinary Playwright `Browser`, so `page.screenshot({ path })` writes a FILE and
`page.on("response")` gives bodies. And it lives in `playwright-core`, not in `@playwright/mcp`, so a
`slopweaver` verb calls it directly and never speaks MCP — which is the deterministic single command.

The one prerequisite is the owner's: the **Playwright Extension** installed in the owner's Chrome, by the owner.
