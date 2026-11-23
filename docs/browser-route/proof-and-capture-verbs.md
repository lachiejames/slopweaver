# What is still unproven, stated rather than assumed

Part of [The browser route: the owner's real Chrome, and nothing else](../browser-route.md).

- **A response hook holds across a whole walk — MEASURED, for one page and then for many.** One
  page: the relay attached to the owner's own Chrome and a single Datadog console
  page returned **393,420 bytes of PNG to a FILE** and **70 of 71 eligible response bodies**, out of 866
  responses seen. The one body that did not
  arrive was disposed by navigation, which is exactly what `ResponseAccounting.bodyFailed` exists to count —
  so the failure mode is a NUMBER rather than a silence. Reproduce with a page visit through
  `createPlaywrightCliTransport` and read `responseAccounting`. **Many pages: MEASURED on one
  CrowdStrike walk**, which held **556 console-page
  entities** and **351 console-request entities** from one relay session: **285 of the pages carry a filed
  `page-png` artifact** with its own sha256 and byte length, and **351 of 351 requests carry
  `responseFieldPaths` derived from real response bodies**. The artifact store holds 502 PNGs across
  generations. Reproduce, on the store rather than through a verb, so the count is the file's own:

  `cd ~/.slopweaver/atlas/crowdstrike && tail -n +2 console-pages.jsonl | grep -c '"kind":"page-png"' && tail -n +2 console-requests.jsonl | grep -c '"responseFieldPaths":\["' && ls artifacts/console/*.png | wc -l`

- **A relay held across a LONG walk is not one of those measurements, and it does not hold.** MEASURED
  on one seat, two independent attempts at the 251-page Linear settings walk: one reached
  `137/251` under a 900 s cap, the other `147/251` under a 2700 s cap, exiting on `Error: Session closed`
  raised in `playwright-core/lib/tools/cli-client/session.js`'s `_rejectCallbacks` off `_connection.onclose`.
  A xero walk in the same sweep died on `Target page, context or browser has been closed`. So the relay drops
  somewhere past a hundred-odd pages and raising the cap is what produced the second attempt.

  **The answer is a RECONNECT, not a longer cap.** Every page is already its own child process and the relay
  lease is untouched by an attach, so the only thing a drop loses is the attach itself.
  `browser/relayRun.ts`'s `runRelayOperation` rebuilds it and re-addresses the page that dropped — for the
  four `CLIENT_PHRASES` rows a fresh attach can clear, never for a version-skewed client, and never twice
  without a successful page between. It sits BELOW `withWalkStopNoted`, so a recovered drop is reported
  (`takeRelayRecoveries`) rather than failing the resync that owns the walk.

  **Which of page count, elapsed time and memory is the ceiling is still OPEN.** Both attempts landed in the
  137-147 band AND both at about fourteen minutes, so the three are confounded and nothing here is designed to
  a number. Every walk's progress line carries all three (`atlas/kit/walkProgress.ts`'s
  `walkProgressLine`), so the next drop says which it was.

- **Whether `--remote-debugging-port` is refused on the owner's default profile.** Chrome 136 restricts it there;
  that is [documented](https://developer.chrome.com/blog/remote-debugging-port), not run here. MEASURED: the flag works on a NON-default directory (Chrome 152, a temp
  profile, a live DevTools endpoint). Testing the owner's own needs the owner's browser closed, and nothing depends on it —
  the relay is the route.

## Two mechanisms replaced four private-profile lanes

**1 · Read the owner's jar.** A leg that needs a signed-in COOKIE and no rendered page reads the owner's real
Chrome's own cookie database, decrypted with the OS keyring key (`src/browser/cookieJar.ts`). The owner is signed in to those
sites all day, so the cookie is a read rather than a login: no login step, no session to keep alive, no
credential at rest. `github attach` and the nx Cloud and Trelica atlas sessions read this way.

**2 · Brief the session.** A leg that needs a RENDERED page prints a brief (`src/browser/brief.ts`) — the
address, the steps, what to bring back — the visible session carries it out in the owner's own Chrome through
[the relay](target-proof-and-playwright.md#playwright-is-the-transport-and-it-reaches-the-owners-real-chrome), and
the verb judges what it hands back. This is doctrine rule 2's own shape applied to browsers. Every step names
a `slopweaver browser` verb (`BriefStep`'s `tool` is a closed union, so `tsc` refuses anything else); a step
no verb covers rides a `no-verb-yet` arm that must name what would close it. The judgement never moves,
because a grade that ran in the same place the picture came from is a grade nobody can check.

## `slopweaver browser shot` is the screenshot route

```bash
slopweaver browser shot --url <address> --out <file.png> [--target <adapter:target>] [--readiness-timeout <ms>] [--caption <text>] [--json]
slopweaver browser shot --url <address> --out <file.png> --raw [--settle <ms>] [--json]
```

`--out` is never inside a git checkout: every capture verb refuses one before it opens anything, reporting
`output-in-checkout`, so a picture cannot be committed into a pull request, the owner's rule. Write under
`$SLOPWEAVER_HOME/proof/<slug>/` or a scratchpad. The override is `SLOPWEAVER_ALLOW_PROOF_OUTPUT_IN_TREE=1`.

The default profile, the owner's pick, waits for a closed, source-owned target to render,
photographs the viewport, crops to the target and its context, frames and captions it, and writes a capture
record; `--raw` is a flat-settle whole-page shape, kept for diagnosis and never attachable.
`skills/loop-bot/reference/visual-evidence.md` carries the whole account, including why the picture is never
full-page.

Slopweaver's Playwright verbs replace Claude in Chrome for everything, so no screenshot leg waits on an
extension. Any session can photograph any address through
[the relay](target-proof-and-playwright.md#playwright-is-the-transport-and-it-reaches-the-owners-real-chrome), so a
screenshot leg is never BLOCKED on a browser extension being connected.

Four properties are the contract rather than a description:

- **It is the relay**, the same `createPlaywrightCliTransport` an atlas walk uses, unbound from any atlas's
  declared pages.
- **Navigate and photograph, and nothing else** — the closed call set of `src/browser/pageTransport.ts`. No
  click, no typed text, no page script, no network read, so the Slack missed-click incident's shape is
  not available to it at any price. **That is a property of `browser shot`'s own transport, never of the
  lane** — [the retirement](retirement-and-aim.md#claude-in-chrome-is-retired)
  gave the interaction verbs a picker to move.
- **The address's own origin is the whole lease.** A page that settles anywhere else returns
  `off-lease-origin` rather than a photograph of somebody's sign-in form.
- **It refuses a provider registered `refuse-every-write`, and never one merely for having a door** —
  reading `WRITE_POLICY_REGISTER` in `src/admit/browserSurface.ts` and naming its door. The owner's point, about Vanta: visiting a
  page and taking a screenshot is a read. The owner is right, and the register already carried the
  distinction: a platform's write policy answers _"do we intend to write here"_, and refusing to photograph
  a `read-before-write` platform was refusing a READ on the strength of a WRITE ruling. Every doored
  platform in the register is `read-before-write` today, so in practice the refusing arm is uninhabited and
  `shotRefusalFor` in `shotCore.ts` is the witness that can still fire. **This is wider than the question the owner
  asked** — a Slack channel and a GitHub pull request are photographable too, deliberately, because a
  Vanta-shaped exception would have been a hostname special case. The evidence-quality argument is
  untouched: `github read` beats a picture of the same page, and that is where it belongs.

## `slopweaver slack shot` — the one doored provider with a capture verb of its own

```bash
slopweaver slack shot <message-permalink> --out <file.png> [--settle <ms>] [--json]
```

A session reaching for a picture of Slack's web client to READ a thread, instead of `slack read-thread`, is
reaching past the door. This verb is the other half of rule 3 — _a
`slopweaver` verb driving the owner's browser IS the door_ — and it exists for the one question no Slack API can
answer at all, because the answer is not in the payload:

> does this message RENDER with a "Show more" fold in the owner's client?

`conversations.history` returns the blocks we sent. The fold is drawn by the CLIENT, so the only instrument
that can answer is a photograph. MEASURED: the fold is not a function of block count alone — a
THREE-block attachment in the owner's own DM folds.

It is NARROWER than `browser shot`, not wider. The target must be a Slack MESSAGE permalink, parsed by the
same parser `slack read-thread` trusts, so a settings or admin page is refused by name. The lease is two
origins and no more — the workspace's own, and `app.slack.com`. The call set is `browser/pageTransport.ts`'s
closed navigate-and-photograph, so no click, no typed text and no page script is available to it at any
price, which is the whole reason a picture of Slack is safe to take this way.

Two traps MEASURED while building it, both encoded in the verb:

- **An `/archives/` permalink is an interstitial**, not a page. Its job is to hand the conversation to the
  desktop app, and through the relay it closed the tab mid-navigation — `page.goto: Target page, context or
browser has been closed`, reported as `session-lost`. The verb opens the CLIENT route instead.
- **On an enterprise grid the client route carries the ENTERPRISE id.** Handed the team id it redirected to
  `/activity-inbox` and photographed that — a successful capture of the wrong thing, which is the failure a
  screenshot proof can least afford. Both ids resolve at runtime from the Slack `org` structure row.

Its honest limit, printed on every successful capture: the picture is of the conversation's NEWEST messages
at the width of the window the relay opened. It takes no scroll, so photograph a message just after posting
it, and quote the result as one layout's answer rather than every client's.

**It names the state it hit rather than reporting a silence** — `photographed`, `reached-not-photographed`,
`navigation-failed`, `relay-unavailable`, `session-lost`, `off-lease-origin`, `not-a-message-permalink`,
`output-in-checkout` (`SlackShotOutcome`, `src/cli/commands/slack/shotCore.ts`) — so a composer can tell the
reader whether no browser was connected, another walk held the relay, or a capture wedged.

## `slopweaver slack saved` — a read the client makes, kept rather than replayed

```bash
slopweaver slack saved [--json] [--settle <ms>]
```

The owner's Later list has no published API (`stars.list` returns starred channels only, measured), so
this verb opens `/later` through the same closed transport, `photograph: false`, and keeps the `saved.list`
body the owner's client fetched for itself. It replays nothing and follows no cursor. On a grid the lease names the
ENTERPRISE host, where the client's `/api/` calls land. One unrelated body is lost on each load, so the verb
reads a kept `saved.list` as `read` and states the loss. The rest: [saved](../../skills/slack/reference/saved.md).
