/**
 * What the page itself says, read by a probe installed before any of its own script runs (`PROBE`): paint and
 * largest-paint entries, long tasks, whether anything said "loading", and the first frame the destination was drawn.
 *
 * **One clock.** Every instant here is milliseconds since the Unix epoch at sub-millisecond resolution:
 * `performance.timeOrigin + performance.now()` on both sides of the wire. The page's probe and the driver share this
 * machine's clock, so a press timed in the page and a read timed by the driver subtract cleanly (`./drive.ts`'s header
 * says what a step of that clock does to a run).
 */
import type { Browser, BrowserContext, Page } from "playwright-core";
import { z } from "zod";

import { LOADING_SHOWN, PAGE_LANDED, PAGE_PENDING } from "./plan.js";

/** A desktop window the console is laid out for. */
const VIEWPORT = { height: 900, width: 1440 } as const;

/**
 * How long the walk waits, from the action, for a destination to draw before it moves on to the next wait — and
 * separately how long it waits for the document's `load`. It bounds the WAIT, never the action: a click handler
 * that holds the main thread holds the press itself, which returns only when the handler does, so a 30 s handler
 * is waited out whole and lands in the blocking column. Neither is a verdict: the drawn time
 * printed is the page's own instant, read after every wait, so a page that drew at 30 s while the walk waited on its
 * load or its reads is printed at 30 s, and only one that never drew is printed as not drawn.
 */
export const LAND_CAP_MS = 20_000;

/** How often the driver looks at the page while waiting. The instants it reports are the page's own, not this. */
export const POLL_MS = 25;

/** A main-thread task longer than this blocks input; the excess is total blocking time. */
const LONG_TASK_MS = 50;

/**
 * Installed before any of the page's own script runs. `window.__swp` is the probe's whole state; a press in flight
 * is mirrored to `sessionStorage` so a click that ends in a full document load (the docs are their own root
 * layout) still carries the instant it was first shown — and, written once more as the old document is hidden,
 * every long task it ran since the press, the click handler's own included, which the new document's list starts
 * from. Only a press that has not landed is carried: one that drew in its own document is
 * not what a later navigation is answering.
 *
 * **One blind spot, by construction.** The task that dispatches `pagehide` is still
 * running when this writes, and its long-task entry exists only once every listener has returned — by which time the
 * old document can write nothing. So a page's OWN unload handlers are never counted. On this console they are two:
 * `useLastLooked` stamps an instant, and `VoiceProvider` ends a call, which the walk never places.
 */
const PROBE = `(() => {
  const LOADING = ${JSON.stringify(LOADING_SHOWN)};
  const epoch = () => performance.timeOrigin + performance.now();
  let carried = null;
  try { carried = JSON.parse(sessionStorage.getItem("__swp_click") || "null"); sessionStorage.removeItem("__swp_click"); } catch {}
  const long = carried !== null && Array.isArray(carried.long) ? carried.long.slice() : [];
  const s = { fcp: null, lcp: null, long, indicator: false, landedAt: null, landed: ${JSON.stringify(PAGE_LANDED)},
    pending: ${JSON.stringify(PAGE_PENDING)}, click: null, carried, stop: false };
  window.__swp = s;
  const observe = (type, take) => {
    try {
      const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) take(entry); });
      observer.observe({ type, buffered: true });
      return () => { for (const entry of observer.takeRecords()) take(entry); };
    } catch { return () => {}; }
  };
  observe("paint", (entry) => { if (entry.name === "first-contentful-paint") s.fcp = entry.startTime; });
  observe("largest-contentful-paint", (entry) => { s.lcp = entry.startTime; });
  const flushLong = observe("longtask", (entry) => { s.long.push([performance.timeOrigin + entry.startTime, entry.duration]); });
  addEventListener("pagehide", () => {
    const c = s.click;
    if (c === null || c.landedAt !== null) return;
    flushLong();
    const since = s.long.filter(([start, duration]) => start + duration > c.at);
    try { sessionStorage.setItem("__swp_click", JSON.stringify({ ...c, long: since })); } catch {}
  });
  const drawn = (landed, pending) => document.querySelector(landed) !== null && document.querySelector(pending) === null;
  const tick = () => {
    if (s.stop) return;
    const loading = document.querySelector(LOADING) !== null;
    if (loading) s.indicator = true;
    if (s.landedAt === null && drawn(s.landed, s.pending)) s.landedAt = epoch();
    const c = s.click;
    if (c !== null && c.landedAt === null) {
      const moved = location.pathname !== c.from;
      const opened = c.opens === "panel" && document.querySelector(c.landed) !== null;
      if (c.shownAt === null && (moved || loading || opened)) {
        c.shownAt = epoch();
        try { sessionStorage.setItem("__swp_click", JSON.stringify(c)); } catch {}
      }
      const arrived = c.opens === "panel" || (moved && (c.to === null || location.pathname.startsWith(c.to)));
      if (arrived && drawn(c.landed, c.pending)) c.landedAt = epoch();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

/**
 * A probe reading as the report spells it: the page writes `null` for one it never took, and the report says not
 * measured with `undefined`. An early return rather than a ternary or `??`, the one spelling both
 * `prefer-nullish-coalescing` and `no-silent-fallback` accept (`docs/doctrine-rationale/no-silent-fallback.md`).
 *
 * @param value the reading as the probe wrote it
 * @returns the reading, or `undefined` when the page never took it — never a substituted number
 */
export function measured({ value }: { value: number | null }): number | undefined {
  if (value === null) {
    return undefined;
  }
  return value;
}

/**
 * The current instant, on the same epoch the page's own clock reports.
 *
 * @returns milliseconds since the Unix epoch
 */
export function nowEpoch(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * Wait without holding the event loop.
 *
 * @param ms how long
 * @returns once that long has passed
 */
export async function pause({ ms }: { ms: number }): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wait for the document's `load` — every script it shipped has run, so a read its effects will send has been sent
 * or is about to be — and say when that was. A client-side navigation is already loaded and answers at once.
 *
 * @returns the instant the wait ended
 */
export async function loadedAt({ page }: { page: Page }): Promise<number> {
  try {
    await page.waitForLoadState("load", { timeout: LAND_CAP_MS });
  } catch {
    // A document that never fires `load` inside the cap is timed from here; its reads are still followed.
  }
  return nowEpoch();
}

/** What the probe reports, read back off the page. */
export const ProbeState = z.object({
  carried: z.object({ shownAt: z.number().nullable() }).nullable(),
  click: z.object({ at: z.number(), landedAt: z.number().nullable(), shownAt: z.number().nullable() }).nullable(),
  domNodes: z.number(),
  fcp: z.number().nullable(),
  indicator: z.boolean(),
  landedAt: z.number().nullable(),
  lcp: z.number().nullable(),
  long: z.array(z.tuple([z.number(), z.number()])),
  origin: z.number(),
  path: z.string(),
  scriptBytes: z.number(),
  ttfb: z.number().nullable(),
});
export type ProbeState = z.infer<typeof ProbeState>;

const READ_PROBE = `(() => {
  const s = window.__swp;
  const nav = performance.getEntriesByType("navigation")[0];
  const scripts = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"));
  return {
    carried: s ? s.carried : null,
    click: s && s.click ? { at: s.click.at, landedAt: s.click.landedAt, shownAt: s.click.shownAt } : null,
    domNodes: document.getElementsByTagName("*").length,
    fcp: s ? s.fcp : null,
    indicator: s ? s.indicator : false,
    landedAt: s ? s.landedAt : null,
    lcp: s ? s.lcp : null,
    long: s ? s.long : [],
    origin: performance.timeOrigin,
    path: location.pathname,
    scriptBytes: scripts.reduce((n, r) => n + r.transferSize, 0),
    ttfb: nav ? nav.responseStart : null,
  };
})()`;

/**
 * Read the probe, tolerating the instant a document is being replaced (the read is retried by the caller's loop).
 *
 * @returns the probe's state, or `undefined` while no document is there to answer
 */
export async function readProbe({ page }: { page: Page }): Promise<ProbeState | undefined> {
  try {
    const parsed = ProbeState.safeParse(await page.evaluate(READ_PROBE));
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

/**
 * Poll the probe until a condition holds or the cap passes.
 *
 * @param until the condition, over the probe's state
 * @param capMs how long after `from` to stop waiting
 * @param from the instant the measured action began, which the cap counts from — never when the driver started
 *   looking, which a page busy inside its own click handler can hold back
 * @returns the state that satisfied it, or the last state read when the cap passed first
 */
export async function probeUntil({
  page,
  until,
  capMs,
  from,
}: {
  page: Page;
  until: (state: ProbeState) => boolean;
  capMs: number;
  from: number;
}): Promise<{ state: ProbeState | undefined; met: boolean }> {
  const deadline = from + capMs;
  let state: ProbeState | undefined;
  while (nowEpoch() < deadline) {
    state = await readProbe({ page });
    if (state !== undefined && until(state)) {
      return { met: true, state };
    }
    await pause({ ms: POLL_MS });
  }
  return { met: false, state };
}

/**
 * Total blocking time between two instants: each long task's excess over {@link LONG_TASK_MS}, for every task that
 * OVERLAPS the window. A warm click is stamped inside the very task that dispatches it, so that task starts a moment
 * before `from` — filtering on its start would drop the click handler's own blocking. The
 * main thread runs one task at a time, so the only task running at `from` is the one doing the stamping.
 *
 * @param long the probe's long tasks as `[start, duration]` on the epoch
 * @param from the window's start
 * @param to the window's end
 * @returns the blocking milliseconds
 */
export function blockingBetween({
  long,
  from,
  to,
}: {
  long: readonly (readonly [number, number])[];
  from: number;
  to: number;
}): number {
  if (to <= from) {
    // An empty window overlaps nothing.
    return 0;
  }
  return long
    .filter(([start, duration]) => start + duration > from && start < to)
    .reduce((sum, [, duration]) => sum + Math.max(0, duration - LONG_TASK_MS), 0);
}

/**
 * The JS heap after a forced collection, through the page's own DevTools session.
 *
 * @param context the page's context
 * @returns the heap in bytes, or `undefined` when the browser would not say
 */
export async function heapAfterGc({
  context,
  page,
}: {
  context: BrowserContext;
  page: Page;
}): Promise<number | undefined> {
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    await cdp.detach();
    return metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
  } catch {
    return undefined;
  }
}

/**
 * The heap and DOM of a page, after a forced collection.
 *
 * @param context the page's context
 * @returns both readings, each `undefined` when the browser would not say
 */
export async function memoryNow({
  context,
  page,
}: {
  context: BrowserContext;
  page: Page;
}): Promise<{ heap: number | undefined; dom: number | undefined }> {
  const heap = await heapAfterGc({ context, page });
  const state = await readProbe({ page });
  return { dom: state === undefined ? undefined : state.domNodes, heap };
}

/**
 * A fresh context: nothing cached, the probe installed, and a desktop window.
 *
 * @param browser the launched browser
 * @returns the context
 */
export async function freshContext({ browser }: { browser: Browser }): Promise<BrowserContext> {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: VIEWPORT });
  await context.addInitScript({ content: PROBE });
  return context;
}
