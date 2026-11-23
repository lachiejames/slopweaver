/**
 * The two Datadog console snippets: read the left nav's fly-outs, and open the command palette.
 *
 * ## Why either exists beside the page-visit snippet
 *
 * The Datadog console declares its own page list nowhere a `page-visit` can read it. The left nav renders
 * its section links in the DOM and each section's PAGES only while that section is hovered, so a walk that
 * wants the console's own word on what it offers has to hover — once per section, reading `a[href]` and
 * nothing else. And the command palette, whose `POST /api/ui/search/suggestions/entities` is the one
 * provider-owned list of this organisation's resources the console has, opens on a keystroke and on
 * nothing a URL can express. Neither is a widening of `BrowserPageTransport`: both live behind
 * `datadogConsole.ts`, a different interface with `atlas datadog walk` as the only verb allowed to ask.
 *
 * ## Both are READ-ONLY, and that is a property of the snippets rather than an intention
 *
 * The nav arm hovers and reads hrefs; it clicks nothing. The palette arm presses ONE fixed key chord,
 * reads the dialog's accessible structure, photographs it and presses Escape; it types nothing into the
 * search field and selects no option. Every selector and the key chord are string constants here, and the
 * only values a caller supplies — the URL, the settle time, the screenshot path — arrive as JSON literals.
 * A hover fires the page's own handlers, which the read-only rail refuses on a page it fences
 * (`docs/browser-route/retirement-and-aim.md`); the Datadog console is not such a page, and the fence is not
 * this module's to decide (`docs/browser-route/provider-arms.md`).
 *
 * ## The palette response hook is the page-visit hook, verbatim
 *
 * `RESPONSE_HOOK` is imported rather than restated so the two arms count what they lost the same way; a
 * body the palette arm could not read is `bodyFailed`, and the walk reports the palette incomplete rather
 * than silently short.
 */
import { MAX_BODY_BYTES, MAX_RESPONSES_PER_PAGE, RESPONSE_HOOK } from "./pageVisitSnippet.js";
import { gotoFragment, photographFragment } from "./snippetParts.js";

/**
 * The lists the left nav renders its top-level entries in, by their own accessible labels, in nav order.
 * The help menu is a single link outside both lists and is hovered on its own.
 *
 * @internal
 */
export const DATADOG_NAV_LIST_LABELS: readonly string[] = ["Datadog products", "Useful links and tools"];

/**
 * How long a hovered section is given to paint its fly-out before its links are read.
 *
 * MEASURED on this install's site through `slopweaver browser act --do hover` followed by `read`: every
 * fly-out was present on the read that followed, which lands well over a second later; the bound here is
 * what a single arm can afford twenty times inside the relay's 120 s operation budget.
 *
 * @internal
 */
export const DATADOG_NAV_HOVER_SETTLE_MS = 700;

/**
 * The key chord that opens the command palette. A page-level shortcut with no element under focus, which
 * is exactly the class `SLOPWEAVER_ALLOW_BLIND_KEYSTROKE` exists for on the interaction verb; here it is a
 * constant, so no caller chooses it.
 *
 * @internal
 */
export const DATADOG_PALETTE_KEY = "Meta+k";

/**
 * How long a body read may be waited on before the arm moves on without it.
 *
 * MEASURED on this install's site: the first palette arm awaited every pending body read unbounded, exactly as
 * the page-visit snippet does, and the client hit the relay's 120 s operation budget (`spawnSync … ETIMEDOUT`)
 * — a console page keeps long-poll JSON connections open, so a `response.text()` on one never settles. A
 * page visit gets away with it because navigation disposes those responses; this arm stays on the page.
 * A body still pending at the bound is neither read nor failed, which the accounting identity
 * `eligible === bodySucceeded + bodyFailed` exposes as an incomplete capture rather than hiding.
 *
 * @internal
 */
export const DATADOG_PALETTE_BODY_WAIT_MS = 5_000;

/**
 * How long the palette is given to issue and answer its own calls after the chord.
 *
 * @internal
 */
export const DATADOG_PALETTE_SETTLE_MS = 4_000;

/** The fixed page-side function that reads one hovered section's fly-out. Runs inside `page.$$eval`. */
const READ_FLYOUT = `(items, arg) => {
  const matched = items[arg.index];
  if (!matched) { return null; }
  const item = matched.tagName === "A" ? matched.parentElement : matched;
  const first = item.querySelector("a[href]");
  const section = arg.section !== null ? arg.section : (first ? (first.textContent || "").trim() : "");
  const links = [];
  for (const anchor of item.querySelectorAll("a[href]")) {
    links.push({ href: anchor.getAttribute("href") || "", label: (anchor.textContent || "").trim().slice(0, 120) });
  }
  return { section, links };
}`;

/**
 * Hover every top-level entry of the left nav in turn and collect each fly-out's links.
 *
 * @param url the console page to open — the origin root, which lands on the default page
 * @param settleMs how long the console is given to paint before the first hover
 * @returns the snippet source
 */
export function datadogNavObserveSnippet({ url, settleMs }: { url: string; settleMs: number }): string {
  return `async (page) => {
${gotoFragment({ settleMs, url })}
  const listLabels = ${JSON.stringify(DATADOG_NAV_LIST_LABELS)};
  const hoverSettleMs = ${String(DATADOG_NAV_HOVER_SETTLE_MS)};
  const sections = [];
  const hoverErrors = [];
  const selectors = listLabels.map((label) => 'nav[aria-label="Main"] ul[aria-label="' + label + '"] > li');
  selectors.push('nav[aria-label="Main"] a[href="/help"]');
  for (const selector of selectors) {
    let count = 0;
    try {
      count = await page.$$eval(selector, (nodes) => nodes.length);
    } catch (error) {
      hoverErrors.push(selector + ": " + String(error));
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      const target = selector.endsWith("> li") ? selector + ":nth-child(" + String(index + 1) + ") > a[href]" : selector;
      try {
        await page.hover(target, { timeout: 5000 });
        await page.waitForTimeout(hoverSettleMs);
        const read = await page.$$eval(selector, ${READ_FLYOUT}, selector.endsWith("> li") ? { index, section: null } : { index: 0, section: "Help" });
        if (read !== null) { sections.push(read); }
      } catch (error) {
        hoverErrors.push(target + ": " + String(error));
      }
    }
  }
  return JSON.stringify({ finalUrl: page.url(), hoverErrors, sections, title: await page.title().catch(() => "") });
}`;
}

/** The fixed page-side function that describes the open palette. Runs inside `page.evaluate`. */
const READ_PALETTE = `() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) { return { dialogOpen: false, filterNames: [], optionCount: 0 }; }
  const filterNames = [];
  for (const button of dialog.querySelectorAll('button')) {
    const name = (button.textContent || "").trim();
    if (name && name.length <= 40 && !/^(Close|Clear)$/.test(name)) { filterNames.push(name); }
  }
  return {
    dialogOpen: true,
    filterNames,
    optionCount: dialog.querySelectorAll('[role="option"]').length,
  };
}`;

/**
 * Open the command palette with its own shortcut, capture what it calls, describe it, photograph it, and
 * close it again with Escape.
 *
 * @param url the console page to open first — the origin root
 * @param settleMs how long the console is given to paint before the chord is pressed
 * @param screenshotPath where the PNG of the open palette is written
 * @returns the snippet source
 */
export function datadogPaletteObserveSnippet({
  url,
  settleMs,
  screenshotPath,
}: {
  url: string;
  settleMs: number;
  screenshotPath: string;
}): string {
  return `async (page) => {
  const maxBodyBytes = ${String(MAX_BODY_BYTES)};
  const maxResponses = ${String(MAX_RESPONSES_PER_PAGE)};
  const bodyWaitMs = ${String(DATADOG_PALETTE_BODY_WAIT_MS)};
${RESPONSE_HOOK}${gotoFragment({ settleMs, url })}
  // The page's own load traffic is not the palette's: drain it, then count from zero. Bounded, because a
  // console page holds long-poll JSON connections open and a body read on one never settles.
  const bounded = (promises) => Promise.race([Promise.all(promises), page.waitForTimeout(bodyWaitMs)]);
  await bounded(pending.splice(0, pending.length));
  responses.splice(0, responses.length);
  seen = 0; eligible = 0; bodyFailed = 0;
  let keyError = null;
  try {
    await page.keyboard.press(${JSON.stringify(DATADOG_PALETTE_KEY)});
  } catch (error) {
    keyError = String(error);
  }
  await page.waitForTimeout(${String(DATADOG_PALETTE_SETTLE_MS)});
  await bounded(pending.splice(0, pending.length));
  const palette = await page.evaluate(${READ_PALETTE}).catch((error) => ({ dialogOpen: false, filterNames: [], optionCount: 0, readError: String(error) }));
${photographFragment({ screenshotPath })}
  await page.keyboard.press("Escape").catch(() => {});
  return JSON.stringify({
    finalUrl: page.url(),
    keyError,
    palette,
    accounting: { bodyFailed, bodySucceeded: responses.length, eligible, seen },
    responses,
    screenshotError,
    screenshotWritten,
    title: await page.title().catch(() => ""),
  });
}`;
}
