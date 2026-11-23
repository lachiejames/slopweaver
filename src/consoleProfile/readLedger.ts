/**
 * Every `/api/*` read a page starts, followed from the driver's side, and the wait that says when a measured window's
 * own reads have all answered and gone quiet. What "fully loaded" means is decided here (`waitQuiet`).
 */
import type { Page, Request } from "playwright-core";

import { nowEpoch, POLL_MS, pause } from "./pageProbe.js";
import { type ApiRead, lastWindowChange, liveReadFailure, readsOwedSince } from "./report.js";

/**
 * The network has to stay this quiet, with nothing in flight, before the walk stops waiting. It only decides when
 * the walk stops LOOKING — "fully loaded" is the instant the last read answered, never this — so it is sized to
 * outlast the gap between a page drawing and its first read leaving, rather than to be tight. MEASURED:
 * at 600 ms anchored on the walk's own start, `/queue` reported fully loaded at 230 ms because no read had left yet.
 */
const QUIET_MS = 1500;

/**
 * The longest the walk waits for a page to finish loading. A read still running at this point is reported as
 * unanswered — a tile still saying "loading" — rather than waited out. Sized past the slowest read measured on
 * the baseline (`slopweaver perf console`), where a fleet load of 34 on 15 cores held single reads past
 * 30 s, so a slow page is timed and only a stuck one is cut off.
 */
export const SETTLE_CAP_MS = 60_000;

/**
 * A streaming route the voice holds open for the length of a call: it never "answers", so it is not a read.
 * Everything else under `/api/` is.
 */
const STREAMING = /\/api\/talk\/call\/[^/]+\/events$/u;

/**
 * Whether a request is one of the console's reads: anything under `/api/` but a stream the voice holds open, which
 * never answers. Pure, so the line between a read and a stream is a test.
 *
 * @param path the request's path
 * @param resourceType what the browser says the request is
 * @returns true for a read the walk waits on and times
 */
export function isMeasuredRead({ path, resourceType }: { path: string; resourceType: string }): boolean {
  return path.startsWith("/api/") && !STREAMING.test(path) && resourceType !== "eventsource";
}

/** Every `/api/*` read one page started, as they start and answer. */
export interface ReadLedger {
  readonly reads: ApiRead[];
  /**
   * When each read was seen sent — the one clock every window boundary uses, in flight and settled alike. Never `timing().startTime`: Playwright fills it from the response, so a read that failed with none
   * carries 0 and would be judged sent before every window.
   */
  readonly starts: number[];
  /** When each read stopped holding the network, answered or not — what the quiet window waits on. */
  readonly ends: number[];
  /** When each read was classified — after its end, since a body is read and judged first. */
  readonly classified: number[];
  /**
   * Each read not yet settled, with the instant the driver saw it sent — so a window judges only the reads it started.
   * The event lands a moment after the page sent it, so a read sent just before an action can count as the action's:
   * that only ever lengthens a measured time, never shortens one.
   */
  readonly inflight: Map<Request, { readonly path: string; readonly sentAt: number }>;
  /** Paths the router prefetched, with the instant each answered. */
  readonly prefetched: Map<string, number>;
}

/**
 * Whether a request that finished answered: a status under 400, and for a live read a body that is a reading.
 *
 * @param request the finished request
 * @param path its route path
 * @returns true when it answered, false for an error status, a body that is not a reading, or no response at all
 */
async function answeredRead({ request, path }: { request: Request; path: string }): Promise<boolean> {
  try {
    const response = await request.response();
    if (response === null) {
      return false;
    }
    if (!path.startsWith("/api/live/")) {
      return response.status() < 400;
    }
    // A body that cannot be read throws to the catch below: no reading, so not answered.
    return liveReadFailure({ status: response.status(), text: await response.text() }) === undefined;
  } catch {
    return false;
  }
}

/**
 * Classify a read, then take it off the in-flight set and record it — in that order, so a read is never seen
 * finished before it is known to have answered: {@link waitQuiet} waits on the in-flight
 * set, and a read still being classified at the cap is unanswered rather than recorded with a time. A read that
 * FAILED is recorded as not a measurement rather than as a duration: a fast failure timed as a fast read is the one
 * lie this walk exists not to tell. A read the page ABORTED itself is a failure too, since it was a read the measured
 * page or click asked for and never got; one a new document cancelled is never recorded here, because the
 * document's response took it off the in-flight set first ({@link followReads}).
 */
async function settleRead({
  ledger,
  request,
  failed,
}: {
  ledger: ReadLedger;
  request: Request;
  failed: boolean;
}): Promise<void> {
  const url = new URL(request.url());
  if (!failed && request.headers()["next-router-prefetch"] !== undefined) {
    ledger.prefetched.set(url.pathname, nowEpoch());
  }
  const held = ledger.inflight.get(request);
  if (held === undefined) {
    return;
  }
  const { path } = held;
  const timing = request.timing();
  let end = nowEpoch();
  if (timing.responseEnd >= 0) {
    end = timing.startTime + timing.responseEnd;
  }
  let answered = !failed;
  if (answered) {
    // A request that FINISHED can still have failed: an error status, or a live read whose body is not a reading.
    answered = await answeredRead({ path, request });
  }
  let read: ApiRead = { ms: undefined, notMeasured: true, path };
  if (answered) {
    read = { ms: end - timing.startTime, notMeasured: false, path };
  }
  ledger.starts.push(held.sentAt);
  ledger.ends.push(end);
  ledger.classified.push(nowEpoch());
  ledger.reads.push(read);
  ledger.inflight.delete(request);
}

/**
 * Follow every request a page makes: each `/api/*` read with its own start and end, and each router prefetch.
 *
 * @returns the ledger, filled in as the page runs
 */
export function followReads({ page }: { page: Page }): ReadLedger {
  const ledger: ReadLedger = {
    classified: [],
    ends: [],
    inflight: new Map(),
    prefetched: new Map(),
    reads: [],
    starts: [],
  };
  page.on("request", (request) => {
    if (isMeasuredRead({ path: new URL(request.url()).pathname, resourceType: request.resourceType() })) {
      ledger.inflight.set(request, { path: new URL(request.url()).pathname, sentAt: nowEpoch() });
    }
  });
  // A new document answering for the main frame ends the old one, and with it every read the old one still had in
  // flight: no page is left to answer them, and the browser does not always report them failed. The new document
  // cannot have sent a read before its own response arrived, so every read in flight here is the old one's — one
  // sent after the press included, which is not the destination's to wait on. MEASURED, the `:3100` walk:
  // "open a pull request" held three shell reads unanswered to the settle cap on two runs of three, while the
  // destination's own copies of the same reads answered — repro: that walk's `report.json`, `clicks[].unanswered`.
  page.on("response", (response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      ledger.inflight.clear();
    }
  });
  page.on("requestfinished", (request) => {
    void settleRead({ failed: false, ledger, request });
  });
  page.on("requestfailed", (request) => {
    void settleRead({ failed: true, ledger, request });
  });
  return ledger;
}

/**
 * Wait until nothing the page asked for is still in flight and the network has been quiet for {@link QUIET_MS}.
 *
 * The measured window is from the action to that quiet of the page's `/api` reads — the console's data — and no
 * further: a read that starts after it is the page's next poll, not part of the
 * load or click, and a live page starts one every few seconds for as long as it is open. Waiting on those would never
 * settle; judging them would judge the poll. A page holding some other request open does not move the window, since
 * the console starts none that a tile waits on. A read is the window's by WHEN it was sent, never by what sent it:
 * the browser does not say which code issued a fetch, so a poll that happens to fire inside the window is counted as
 * one of its reads — which can only lengthen the measured time, never shorten it.
 *
 * @param ledger the page's reads
 * @param since the instant the measured action began; reads before it belong to something else
 * @param quietFrom the earliest instant the quiet window may start — the page's `load`, so a read its effects
 *   have not sent yet is not mistaken for no read at all
 * @returns the instant the last read since then answered (or `since` when there were none), and what was still
 *   unanswered at the cap
 */
export async function waitQuiet({
  ledger,
  since,
  quietFrom,
}: {
  ledger: ReadLedger;
  since: number;
  quietFrom: number;
}): Promise<{ lastAnswer: number; unanswered: readonly string[]; reads: readonly ApiRead[] }> {
  const deadline = since + SETTLE_CAP_MS;
  // Only reads this window sent: one sent earlier belongs to the page before it (`readsOwedSince`).
  const owed = (): readonly string[] => readsOwedSince({ inflight: ledger.inflight.values(), since });
  const lastMoved = (): number =>
    lastWindowChange({
      inflight: ledger.inflight.values(),
      settled: ledger.starts.map((start, index) => ({ classified: ledger.classified[index]!, start })),
      since,
    });
  while (nowEpoch() < deadline) {
    if (owed().length === 0 && nowEpoch() - Math.max(lastMoved(), quietFrom) >= QUIET_MS) {
      break;
    }
    await pause({ ms: POLL_MS });
  }
  const reads: ApiRead[] = [];
  const unanswered = [...owed()];
  let lastAnswer = since;
  ledger.reads.forEach((read, index) => {
    const start = ledger.starts[index]!;
    const end = ledger.ends[index]!;
    if (start < since) {
      return;
    }
    // One that landed, or was classified, after the cap — while the last poll slept — was as unanswered at the cap as
    // one still in flight; its time is never printed as a duration.
    if (end > deadline || ledger.classified[index]! > deadline) {
      unanswered.push(read.path);
      return;
    }
    reads.push(read);
    lastAnswer = Math.max(lastAnswer, end);
  });
  return { lastAnswer, reads, unanswered };
}
