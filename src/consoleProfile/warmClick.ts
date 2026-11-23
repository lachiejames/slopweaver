/**
 * One warm click: stand on its page, press inside the page, and time the response, the drawn destination and the
 * last read the press started. The press is dispatched INSIDE the page (`element.click()`) after the probe has
 * stamped it, so the driver's own round trip is never counted as the console's latency.
 */
import type { Page } from "playwright-core";
import { z } from "zod";

import {
  blockingBetween,
  LAND_CAP_MS,
  loadedAt,
  measured,
  nowEpoch,
  type ProbeState,
  probeUntil,
  readProbe,
} from "./pageProbe.js";
import type { ConsoleClick } from "./plan.js";
import { type ReadLedger, waitQuiet } from "./readLedger.js";
import type { ClickSample } from "./report.js";

/**
 * Put the warm page on a path, drawn and settled, without timing it.
 *
 * @param page the warm page
 * @param ledger its reads
 * @param base the console's origin
 * @param path where it has to be
 * @returns once it is there and quiet
 */
export async function standOn({
  page,
  ledger,
  base,
  path,
}: {
  page: Page;
  ledger: ReadLedger;
  base: string;
  path: string;
}): Promise<void> {
  if (new URL(page.url()).pathname === path) {
    return;
  }
  // Taken before the navigation, so every read the page sends while it draws is one this waits on.
  const since = nowEpoch();
  await page.goto(`${base}${path}`, { waitUntil: "commit" });
  await probeUntil({ capMs: LAND_CAP_MS, from: since, page, until: (state) => state.landedAt !== null });
  await waitQuiet({ ledger, quietFrom: await loadedAt({ page }), since });
}

/**
 * When a press was first visibly answered and when its destination drew, read off the probe. A press that ended in
 * a new document carries the instant the old page first showed a response (`carried`), else that document's first
 * paint, and the new document's own drawn instant; a press inside one document reads both off the press itself.
 *
 * @param drawn the probe's state after the press, or `undefined` when no read of it answered
 * @param documentLoad whether the press ended in a new document
 * @returns both instants on the epoch, each `undefined` when the page never reached it
 */
export function clickInstants({
  drawn,
  documentLoad,
}: {
  drawn: Pick<ProbeState, "carried" | "click" | "fcp" | "landedAt" | "origin"> | undefined;
  documentLoad: boolean;
}): { shownAt: number | undefined; landedAt: number | undefined } {
  if (drawn === undefined) {
    return { landedAt: undefined, shownAt: undefined };
  }
  if (documentLoad) {
    return documentInstants({ drawn });
  }
  return pressInstants({ click: drawn.click });
}

/** A press that ended in a new document: the old page's carried response, else first paint, and its drawn instant. */
function documentInstants({ drawn }: { drawn: Pick<ProbeState, "carried" | "fcp" | "landedAt" | "origin"> }): {
  shownAt: number | undefined;
  landedAt: number | undefined;
} {
  const landedAt = measured({ value: drawn.landedAt });
  if (drawn.carried !== null && drawn.carried.shownAt !== null) {
    return { landedAt, shownAt: drawn.carried.shownAt };
  }
  return { landedAt, shownAt: drawn.fcp === null ? undefined : drawn.origin + drawn.fcp };
}

/** A press inside one document: both instants read off the press the probe stamped. */
function pressInstants({ click }: { click: ProbeState["click"] }): {
  shownAt: number | undefined;
  landedAt: number | undefined;
} {
  if (click === null) {
    return { landedAt: undefined, shownAt: undefined };
  }
  return { landedAt: measured({ value: click.landedAt }), shownAt: measured({ value: click.shownAt }) };
}

/** The parsed answer of a press dispatched in the page. */
const Pressed = z.object({ at: z.number(), href: z.string().nullable() }).nullable();

/** Stamp the press on the probe and dispatch it inside the page: when it was pressed, or `null` when nothing matched. */
async function pressInPage({ page, click }: { page: Page; click: ConsoleClick }): Promise<z.output<typeof Pressed>> {
  const press = {
    from: click.from,
    landed: click.landed,
    opens: click.opens,
    pending: click.pending,
    target: click.target,
    to: pressedTo({ to: click.to }),
  };
  return Pressed.parse(
    await page.evaluate(`((p) => {
      const el = document.querySelector(p.target);
      if (el === null) return null;
      const href = el.getAttribute("href");
      const to = p.to === null && href !== null ? new URL(href, location.href).pathname : p.to;
      const at = performance.timeOrigin + performance.now();
      window.__swp.click = { ...p, to, at, shownAt: null, landedAt: null };
      el.click();
      return { at, href };
    })(${JSON.stringify(press)})`),
  );
}

/** The sample of a press whose target the page never drew. */
function skippedSample({ click }: { click: ConsoleClick }): ClickSample {
  return {
    blockingMs: undefined,
    documentLoad: false,
    from: click.from,
    landedMs: undefined,
    name: click.name,
    prefetched: undefined,
    reads: [],
    settledMs: undefined,
    shownMs: undefined,
    skipped: `${click.from} drew nothing matching ${click.target}`,
    to: destinationText({ to: click.to }),
    unanswered: [],
  };
}

/**
 * The press's named destination as the page script reads it: JSON carries no `undefined`, so an unnamed one is
 * `null`, which the script resolves from the pressed link's own `href`.
 */
function pressedTo({ to }: { to: string | undefined }): string | null {
  if (to === undefined) {
    return null;
  }
  return to;
}

/** A sample's destination: the empty string for a press that named none and pressed no link (a panel). */
function destinationText({ to }: { to: string | undefined }): string {
  if (to === undefined) {
    return "";
  }
  return to;
}

/** Whether the probe's state belongs to a document other than the one the press was made in. */
function isNewDocument({ origin, state }: { origin: number | undefined; state: ProbeState }): boolean {
  return origin !== undefined && state.origin !== origin;
}

/** Whether a press has drawn its destination: the new document's drawn instant, else the press's own. */
function hasLanded({ origin, state }: { origin: number | undefined; state: ProbeState }): boolean {
  if (isNewDocument({ origin, state })) {
    return state.landedAt !== null;
  }
  return state.click !== null && state.click.landedAt !== null;
}

/** Whether the destination was prefetched before the press; `undefined` for a press that opens a panel. */
function prefetchedOf({
  click,
  destination,
  ledger,
  pressedAt,
}: {
  click: ConsoleClick;
  destination: string | undefined;
  ledger: ReadLedger;
  pressedAt: number;
}): boolean | undefined {
  if (click.opens === "panel") {
    return undefined;
  }
  if (destination === undefined) {
    return false;
  }
  const prefetchedAt = ledger.prefetched.get(destination);
  return prefetchedAt !== undefined && prefetchedAt < pressedAt;
}

/** An instant as milliseconds after the press, `undefined` when the page never reached it. */
function sincePress({ at, pressedAt }: { at: number | undefined; pressedAt: number }): number | undefined {
  return at === undefined ? undefined : at - pressedAt;
}

/** A pressed click's sample from what the probe and the quiet wait saw after it. */
function clickSampleOf({
  click,
  destination,
  drawn,
  origin,
  prefetched,
  pressedAt,
  quiet,
  state,
}: {
  click: ConsoleClick;
  destination: string | undefined;
  drawn: ProbeState | undefined;
  origin: number | undefined;
  prefetched: boolean | undefined;
  pressedAt: number;
  quiet: Awaited<ReturnType<typeof waitQuiet>>;
  state: ProbeState | undefined;
}): ClickSample {
  const documentLoad = drawn !== undefined && isNewDocument({ origin, state: drawn });
  const { shownAt, landedAt } = clickInstants({ documentLoad, drawn });
  const settledAt = landedAt === undefined ? undefined : Math.max(landedAt, quiet.lastAnswer);
  let blockingMs: number | undefined;
  if (state !== undefined && settledAt !== undefined) {
    blockingMs = blockingBetween({ from: pressedAt, long: state.long, to: settledAt });
  }
  return {
    blockingMs,
    documentLoad,
    from: click.from,
    landedMs: sincePress({ at: landedAt, pressedAt }),
    name: click.name,
    prefetched,
    reads: quiet.reads,
    settledMs: quiet.unanswered.length > 0 ? undefined : sincePress({ at: settledAt, pressedAt }),
    shownMs: sincePress({ at: shownAt, pressedAt }),
    skipped: undefined,
    to: destinationText({ to: destination }),
    unanswered: quiet.unanswered,
  };
}

/**
 * One warm click: stand on its page, press inside the page, and time the response, the drawn destination and the
 * last read the press started.
 *
 * @param page the warm page
 * @param ledger its reads
 * @param base the console's origin
 * @param click what to press
 * @returns the sample
 */
export async function warmClick({
  page,
  ledger,
  base,
  click,
}: {
  page: Page;
  ledger: ReadLedger;
  base: string;
  click: ConsoleClick;
}): Promise<ClickSample> {
  await standOn({ base, ledger, page, path: click.from });
  const before = await readProbe({ page });
  const pressed = await pressInPage({ click, page });
  if (pressed === null) {
    return skippedSample({ click });
  }
  const origin = before === undefined ? undefined : before.origin;
  const landed = await probeUntil({
    capMs: LAND_CAP_MS,
    from: pressed.at,
    page,
    until: (state) => hasLanded({ origin, state }),
  });
  if (click.opens === "panel") {
    // Close what the press opened, so the next press starts from the page and not from under a slide-over.
    await page.keyboard.press("Escape");
  }
  const quiet = await waitQuiet({ ledger, quietFrom: await loadedAt({ page }), since: pressed.at });
  const state = await readProbe({ page });
  const destination = pressed.href === null ? click.to : new URL(pressed.href, base).pathname;
  // The instants come from the LAST read, taken after the quiet wait, not from the capped landing wait: the
  // page stamps each one once and never clears it, so a page that drew after LAND_CAP_MS but before the reads
  // went quiet is still printed at the instant it drew. The landing read stands in only when the last one failed.
  const read = {
    click,
    destination,
    origin,
    prefetched: prefetchedOf({ click, destination, ledger, pressedAt: pressed.at }),
    pressedAt: pressed.at,
    quiet,
    state,
  };
  if (state === undefined) {
    return clickSampleOf({ ...read, drawn: landed.state });
  }
  return clickSampleOf({ ...read, drawn: state });
}
