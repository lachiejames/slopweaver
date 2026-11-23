/**
 * The page-visit snippet — the one operation every atlas walk runs, and the whole of what it may do.
 *
 * ## Why it is its own module
 *
 * It used to live beside the transport that ran it, and that cost a real defect. When the
 * relay's plumbing moved into `relaySession.ts` to make room for a second, governed operation, this builder
 * stayed behind and was passed IN as a callback — so `runRelayOperation` took a function returning snippet
 * source, and a caller could hand it any source at all. A Codex review pass found it in one read: a caller
 * could have returned `async (page) => page.locator('[contenteditable=true]').first().fill('…')` and typed
 * into a page with no door in front of it, which is exactly the capability the closed operation union
 * exists to deny.
 *
 * The fix is structural rather than a rule: the snippet lives here, `relaySession.ts` imports it, and
 * `runRelayOperation` takes an OPERATION and nothing else. There is now no parameter anywhere on that path
 * whose value becomes code.
 *
 * ## What the snippet may do, and the measurement behind it
 *
 * Install a response hook, navigate, settle, collect same-origin hrefs, photograph. No click, no typed
 * text, no page script, no request replay — which is the sentence every walking atlas's safety argument
 * rests on, and which `pageTransport.ts` states as a property of its seam.
 *
 * Every STATEMENT is fixed here; the only things that vary are three values — the URL, the settle time and
 * the screenshot path — baked in as JSON literals. That is deliberately weaker than a constant and the
 * difference matters: the `run-code` context has no `require`, so there is no input file a selector or a
 * keystroke could arrive through. Reproduce with `run-code --filename` over any snippet calling `require`.
 *
 * Measured against a live console: one page costs about 7.7 seconds end to end, of which
 * roughly 4 is client start-up, and a Host Management visit captured 21 first-party responses and a 16.8 KB
 * screenshot.
 */

/**
 * How long ONE screenshot attempt may take, and why a walk takes two of them.
 *
 * Chrome answers `Page.captureScreenshot` only once its compositor produces a frame for the target, and it
 * produces none for a tab that is not the ACTIVE tab in its window. The walk drives one shared relay tab in
 * the owner's own Chrome, so anything that takes activation away from that tab mid-walk — a page opening
 * one, another session, the owner's own click — wedges every capture from that moment on. Nothing re-activates it,
 * so the wedge LATCHES: the walk keeps reaching pages and stops photographing them, which is the shape the
 * defect was reported in.
 *
 * MEASURED over repeated `slopweaver atlas inngest walk` runs against the signed-in dashboard.
 * A capture of an active tab lands in 63-760ms. A capture of a deactivated one never returns at all: three
 * consecutive 8s attempts on the same page each ran to the full bound, and every one of the twenty pages
 * after it did the same. `page.bringToFront()` between two attempts turned that into a 656ms capture, and
 * the pages after it went back to ~80ms — so activation is both the cause and the remedy, and one
 * re-activation heals the rest of the walk. Reproduce with `slopweaver atlas inngest walk --limit 14` and
 * click another tab in the owner's Chrome while it runs.
 *
 * Eight seconds is an order of magnitude above the slowest capture in that measurement, and it is a BOUND
 * rather than a budget: before it there was none, so Playwright's own 30s default applied and a latched
 * walk spent thirty seconds per remaining page discovering the same thing. Re-measure before moving it —
 * the headroom is against ONE day's timings on one machine, not a standing property of the transport.
 *
 * @internal
 */
export const SCREENSHOT_TIMEOUT_MS = 8_000;

/**
 * The largest response body kept per call.
 *
 * One megabyte rather than something tighter because the console's own sitemap — the walk's whole
 * denominator — is a 250 KB document, and a cap that dropped it would silently cost the walk its list. The
 * body is reduced to field NAMES before anything is stored, so this bounds memory during a visit and
 * nothing else.
 *
 * @internal
 */
export const MAX_BODY_BYTES = 1_048_576;

/**
 * The most first-party responses kept per page, above the 21 a busy console page was measured making.
 *
 * @internal
 */
export const MAX_RESPONSES_PER_PAGE = 200;

/**
 * How long one navigation may take. Generous: a cold console module can take twenty seconds to render.
 *
 * @internal
 */
export const NAVIGATION_TIMEOUT_MS = 45_000;

/**
 * The most same-origin links kept per page.
 *
 * A settings page's sidebar is tens of links; a repository page's file list can be hundreds, and a walk
 * that read every one of them would grow its own denominator without learning anything about the admin
 * surface. The cap bounds the payload; the walk filters to the paths it actually cares about.
 *
 * @internal
 */
export const MAX_LINKS_PER_PAGE = 500;

/**
 * The response hook half of the visit snippet — fixed, and installed BEFORE navigation.
 *
 * Split from the rest only because it is the half a reviewer cares about: it decides which responses are
 * eligible at all (same-page JSON, plus the turbo-stream a React Router application answers its own data
 * requests with) and it counts what it could not read, so a lost body is a number rather than a silence.
 *
 * ## Why `text/x-script` is eligible, and comes back as a STRING
 *
 * MEASURED on the Nx Cloud console: a JSON-only filter dropped every one of that platform's own
 * data calls, so a walk of twenty pages observed exactly two first-party operations — the route manifest and
 * the web app manifest — and the atlas's corroboration output was empty for a reason that had nothing to do
 * with the platform. Such a body is kept as raw TEXT rather than parsed here, because the snippet runs in
 * the page with no decoder available; a walk that wants the values decodes them itself
 * (`atlas/nxCloud/dataRoute.ts`). Every JSON response still arrives parsed, which is every response the
 * other walks encounter.
 *
 * ## Every eligible body is accounted for, including the ones the cap refuses
 *
 * A JSON response counts as `eligible` the moment it is seen. If the page has already offered
 * `MAX_RESPONSES_PER_PAGE` of them, or the body is over `MAX_BODY_BYTES`, or reading it throws, it counts
 * as `bodyFailed` — three different reasons, one honest total, and `eligible === bodySucceeded +
 * bodyFailed` always holds. An earlier shape returned BEFORE incrementing `eligible` when the cap was hit,
 * so a page that offered more bodies than the cap allows reported itself completely captured while silently
 * dropping the excess.
 *
 * ## The body reads are AWAITED, not merely started
 *
 * `page.on("response", …)` does not track what its handler returns, so an `async` handler is fire-and-forget:
 * the snippet could return its result while `response.text()` was still in flight, losing bodies that had
 * already been counted as eligible. Each read is pushed onto `pending` instead, and the visit awaits all of
 * them after the page settles.
 *
 * ## It keeps the REQUEST body too, under the same size cap
 *
 * That is what lets a GraphQL consumer read the document the client actually SENT rather than infer one
 * from the response's keys, which are the document's aliases — see {@link CapturedResponse.requestBody}.
 * Nothing here persists it; the caller reduces it to field names and discards it.
 *
 * Exported so `responseHook.test.ts` can run it against a fake `page`: the hook is a string because it
 * executes in the owner's browser, so there is no other way to exercise its accounting without one.
 *
 * @internal
 */
export const RESPONSE_HOOK = `  const responses = [];
  const pending = [];
  let seen = 0;
  let eligible = 0;
  let bodyFailed = 0;
  page.on("response", (response) => {
    seen += 1;
    const type = (response.headers()["content-type"] || "").toLowerCase();
    const json = type.includes("json");
    if (!json && !type.includes("x-script")) {
      return;
    }
    eligible += 1;
    if (responses.length + pending.length >= maxResponses) {
      bodyFailed += 1;
      return;
    }
    pending.push(
      response
        .text()
        .then((text) => {
          if (text.length > maxBodyBytes) {
            bodyFailed += 1;
            return;
          }
          const request = response.request();
          // Read defensively: \`postData\` is optional on the Playwright request and absent entirely on a
          // GET, so a throw here must cost the request body and never the response body beside it.
          let posted;
          try {
            posted = request.postData();
          } catch {
            posted = undefined;
          }
          responses.push({
            body: json ? JSON.parse(text) : text,
            method: request.method(),
            requestBody: typeof posted === "string" && posted.length <= maxBodyBytes ? posted : undefined,
            statusCode: response.status(),
            url: response.url(),
          });
        })
        .catch(() => {
          bodyFailed += 1;
        }),
    );
  });
`;

/**
 * The screenshot half of the visit snippet: bounded, taken twice, never silent, and WHOLE.
 *
 * ## `fullPage: true` is load-bearing, and its absence was a canon claim that was false
 *
 * Playwright's default photographs the VIEWPORT. A call passing only `path` and
 * `timeout` would make every proof screenshot every walking atlas holds the top of a page — while an atlas
 * is meant to store full page screenshots locally. A Codex review pass found that gap by reading this line
 * against that rule. A picture of the first
 * screenful of a policy list is not evidence about the list, and the gap between what the code did and what
 * canon said it did is exactly the class the `atlas-content-coverage` gate exists for, one layer down.
 *
 * Two attempts rather than three, because the second one carries the actual remedy — activating the tab —
 * and a third would only add {@link SCREENSHOT_TIMEOUT_MS} of latency to a page nothing can photograph.
 * `bringToFront` acts on the tab the walk is already navigating in the owner's own Chrome: it opens no tab, which
 * is why it is admissible here. It DOES raise the walk's window over whatever the owner is reading — through
 * `chrome.debugger`, CDP `Page.bringToFront` activates the tab and its window — and `relaySession.ts`
 * gives that foreground back once the visit returns (`./foreground.ts`).
 *
 * @param photograph whether this page may be photographed; `false` emits no screenshot call whatsoever
 * @returns the source of the screenshot block, spliced into the snippet
 */
function screenshotBlock({ photograph }: { photograph: boolean }): string {
  if (!photograph) {
    return "  // This page may not be photographed, so no screenshot is requested and no bytes are produced.";
  }
  return `  for (let attempt = 1; attempt <= 2 && !screenshotWritten; attempt += 1) {
    if (attempt === 2) {
      // Chrome renders no frame for an inactive tab, so the capture above waited for one that was never
      // coming. This activates the tab the walk is ALREADY navigating.
      try {
        await page.bringToFront();
      } catch (error) {
        screenshotError = "the walk's own tab could not be activated: " + String(error);
      }
    }
    try {
      await page.screenshot({ fullPage: true, path: screenshotPath, timeout: ${String(SCREENSHOT_TIMEOUT_MS)} });
      screenshotWritten = true;
      screenshotError = null;
    } catch (error) {
      screenshotError = String(error);
    }
  }`;
}

/**
 * The snippet `run-code` executes, built per visit.
 *
 * ## It returns its result rather than writing one, because it has no filesystem
 *
 * MEASURED, reproduce with `run-code --filename` over any snippet calling `require`: the
 * evaluation context has no `require`, so `node:fs` is unreachable and a snippet that tried to write its
 * output produced `ReferenceError: require is not defined` — which reaches the caller looking exactly like
 * a lost browser session. So the visit hands its result back as the function's RETURN VALUE, which the
 * client prints, and the one thing that does touch disk is `page.screenshot({ path })`, which Playwright
 * itself performs outside the sandbox.
 *
 * ## The parameters are interpolated as JSON literals
 *
 * A `run-code` argument is a shell argument and a console URL is not something to put on a command line, so
 * the URL, the settle time and the screenshot path are baked into the snippet source through
 * `JSON.stringify`. Everything else about the snippet is fixed, so what runs in the owner's browser is a thing a
 * reviewer reads once here rather than a string assembled from a page.
 *
 * ## The response hook is installed BEFORE `goto`
 *
 * That is the only moment that catches the calls a page makes while it renders. A hook added afterwards
 * records the page's idle traffic and misses the point of the walk entirely.
 *
 * ## The link collection is a fixed `$$eval`, not an escape hatch
 *
 * It reads `a[href]` and returns HREFS ONLY, capped. The selector and the mapping are both baked in here
 * rather than passed by a caller, so what runs in the owner's browser stays a thing a reviewer reads once — the
 * same property the response hook has. A page's own navigation is what a walk needs when the platform
 * publishes no sitemap; its content is not, and this cannot return it.
 *
 * ## The snippet does NO url parsing, and that is a measured constraint rather than a style choice
 *
 * MEASURED against a real page: filtering the hrefs to same-origin inside the snippet returned
 * `ReferenceError: URL is not defined`. The evaluation context has no Web globals — the same class as the
 * missing `require` documented above — and because the snippet caught its own failure, every page came back
 * with an empty link list and no reason. So the snippet collects and Node filters, in
 * {@link capturedLinksOf}, where the logic is ordinary TypeScript a test can reach. The `linksError` it now
 * returns is the other half: an empty list that cannot say why is a silence a coverage claim would inherit.
 *
 * ## The screenshot is bounded, retried once, and says why when it still fails
 *
 * See {@link SCREENSHOT_TIMEOUT_MS} for the measurement. A capture of a tab that is not its window's active
 * tab never returns, so the second attempt ACTIVATES the tab first — the same tab the walk is already
 * navigating in the owner's own Chrome, never a new one and never another window. The reason a capture failed is
 * returned rather than swallowed: an unwritten PNG that cannot say why is the silence
 * `pageTransport.ts` refused to inherit for {@link PageCapture.links}.
 *
 * @param url the console page to visit
 * @param settleMs how long to keep observing after load
 * @param screenshotPath where Playwright should write the PNG
 * @param photograph whether to ask for one at all — `false` emits no screenshot call, so no bytes exist
 * @returns the snippet source
 * @internal exported for the test that asserts the capture is bounded and retried — the client path itself
 * cannot be reached from a unit test, because running it means running the real terminal client against the owner's
 * Chrome.
 */
export function pageVisitSnippet({
  url,
  settleMs,
  screenshotPath,
  photograph,
}: {
  url: string;
  settleMs: number;
  screenshotPath: string;
  photograph: boolean;
}): string {
  return `async (page) => {
  const url = ${JSON.stringify(url)};
  const settleMs = ${JSON.stringify(settleMs)};
  const screenshotPath = ${JSON.stringify(screenshotPath)};
  const maxBodyBytes = ${String(MAX_BODY_BYTES)};
  const maxResponses = ${String(MAX_RESPONSES_PER_PAGE)};
  const maxLinks = ${String(MAX_LINKS_PER_PAGE)};
${RESPONSE_HOOK}  let statusCode = null;
  try {
    const navigation = await page.goto(url, { timeout: ${String(NAVIGATION_TIMEOUT_MS)}, waitUntil: "load" });
    statusCode = navigation === null ? null : navigation.status();
  } catch (error) {
    return JSON.stringify({ failure: String(error) });
  }
  await page.waitForTimeout(settleMs);
  await Promise.all(pending.splice(0, pending.length));
  let links = [];
  let linksError = null;
  try {
    const hrefs = await page.$$eval("a[href]", (nodes) => nodes.map((node) => node.href));
    links = hrefs.slice(0, maxLinks);
  } catch (error) {
    links = [];
    linksError = String(error);
  }
  let screenshotWritten = false;
  let screenshotError = null;
${screenshotBlock({ photograph })}
  return JSON.stringify({
    accounting: { bodyFailed, bodySucceeded: responses.length, eligible, seen },
    finalUrl: page.url(),
    links,
    linksError,
    responses,
    screenshotError,
    screenshotWritten,
    statusCode,
    title: await page.title().catch(() => ""),
  });
}`;
}
