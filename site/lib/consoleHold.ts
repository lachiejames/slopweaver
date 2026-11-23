/**
 * A console rebuild never drops a live voice call — the pure half, so the lease and the navigation hold are unit
 * tests.
 *
 * When the console rebuilds as main moves, the owner's next sidebar click would become a full reload under the new
 * build, and the call would drop. So the swap, or the reload it forces, waits until no call is live. The voice itself
 * says nothing about a waiting build: the sidebar's build chip names it (`buildStanding.ts`), and the voice UI shows
 * no note over the transcript.
 *
 * Two holds, because there are two ways a rebuild reaches a live call:
 *
 * - **The swap waits.** While a call is live the widget beats a LEASE into the hold directory the production
 *   server was started with (`/api/console/call`); `scripts/docs-site.sh`'s refresh round builds the new slot as
 *   before and then holds the restart while any lease is unexpired, writing `waiting.json` so the sidebar can say
 *   a build is waiting. No clock ends the hold, however long the call: a 30-minute cap fired during a
 *   live plan call and the restart ended it. A call that is really gone — a crashed tab,
 *   a lost server — stops beating, so its last lease lapses within {@link CALL_LEASE_MS}. A call being MINTED has
 *   no live page to beat for it, so `/api/talk/offer` holds its own lease for the mint ({@link mintLeaseOf}).
 * - **The reload waits.** After a swap every client navigation on an older page is a document navigation:
 *   Next 16's router compares the flight response's build id with the page's and falls back to
 *   `location.assign` (`next/dist/client/components/router-reducer/fetch-server-response.js`). That navigation
 *   fires `pagehide`, which ends the call. So while a call is live the provider holds any cross-document
 *   navigation on the Navigation API's `navigate` event — the one point a link click, a `router.push` and
 *   Next's own fallback all pass — and opens it when the call ends. It covers a call started on a page that was
 *   already stale, and needs no build id to do it.
 */

import { type Bag, isBag, num, str } from "./bag";

/** How long one beat keeps a call counted as live. Four beats' worth, so one slow request never drops the hold. */
export const CALL_LEASE_MS = 60_000;

/** How often a live call beats. */
export const CALL_BEAT_EVERY_MS = 15_000;

/** The route a beat is posted to. */
export const CALL_BEAT_ROUTE = "/api/console/call";

/** A call id is the widget's own `crypto.randomUUID()`, and it names a file, so nothing else is accepted. */
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The instant format `scripts/docs-site.sh` writes (`date -u +%Y-%m-%dT%H:%M:%SZ`). */
const SCRIPT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/;

/** One beat, as the widget posts it. */
export interface CallBeat {
  readonly callId: string;
  /** `true` while the call is up; `false` is the hang-up, which ends the lease at once. */
  readonly live: boolean;
}

/** One lease, as the route writes it and the refresh round reads it (`jq .untilMs`). */
export interface CallLease {
  readonly callId: string;
  readonly untilMs: number;
}

/** A rebuild that is built and held for a live call, as `scripts/docs-site.sh` writes `waiting.json`. */
export interface WaitingBuild {
  /** The commit the held build was built from. */
  readonly sha: string;
  /** The refresh round holding it; the route trusts the file only while this pid is alive. */
  readonly pid: number;
  readonly sinceIso: string;
}

/** What the route answers a beat with. */
export interface CallBeatAnswer {
  /** Whether a lease was written or removed — `false` on a server started without a hold directory. */
  readonly recorded: boolean;
  /** Why nothing was recorded, when nothing was. */
  readonly why: string | undefined;
  readonly waiting: WaitingBuild | undefined;
}

/**
 * Read a beat's body.
 *
 * @param raw the request body as text
 * @returns the beat, or the sentence the refusal prints
 */
export function parseCallBeat({
  raw,
}: {
  raw: string;
}): { kind: "beat"; beat: CallBeat } | { kind: "refused"; why: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { kind: "refused", why: "the body is not JSON" };
  }
  if (!isBag(body)) {
    return { kind: "refused", why: "the body is not a JSON object" };
  }
  const callId = str({ bag: body, key: "callId" });
  if (callId === undefined || !CALL_ID.test(callId)) {
    return { kind: "refused", why: "callId must be the widget's own lowercase UUID" };
  }
  const live = body["live"];
  if (typeof live !== "boolean") {
    return { kind: "refused", why: "live must be true or false" };
  }
  return { beat: { callId, live }, kind: "beat" };
}

/**
 * The lease one live beat writes.
 *
 * @param nowMs the route's clock when the beat arrived
 * @returns the lease, expiring {@link CALL_LEASE_MS} later
 */
export function leaseOf({ callId, nowMs }: { callId: string; nowMs: number }): CallLease {
  return { callId, untilMs: nowMs + CALL_LEASE_MS };
}

/**
 * The lease a call holds while it is being MINTED, before the page has a live call to beat for.
 *
 * The page beats only once its call is live, so the press itself held nothing. A call that ended at the console's
 * 90-minute limit, followed at once by a press for the follow-on call, let the next refresh round find no lease and
 * signal the server's whole tree — `talk offer` mid-composition with it (the refresh log read "8 process(es)
 * signalled"). So `/api/talk/offer` writes this before
 * it spawns anything: the route's own longest answer, plus one lease's worth for the page's first live beat.
 *
 * @param boundMs the longest the offer route can take to answer
 * @param nowMs the route's clock as the press arrived
 * @returns the lease, expiring a {@link CALL_LEASE_MS} past the route's bound
 */
export function mintLeaseOf({ callId, nowMs, boundMs }: { callId: string; nowMs: number; boundMs: number }): CallLease {
  return { callId, untilMs: nowMs + boundMs + CALL_LEASE_MS };
}

/**
 * Read `waiting.json` as the refresh round wrote it.
 *
 * @param raw the file's text
 * @returns the waiting build, or `undefined` for anything that is not exactly that shape
 */
export function parseWaiting({ raw }: { raw: string }): WaitingBuild | undefined {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isBag(body)) {
    return undefined;
  }
  return waitingOfBag({ bag: body });
}

/**
 * Whether a process's argument line is a refresh round of `scripts/docs-site.sh`, which is exactly
 * `bash <script> --refresh-round` (`locked_round`), and the argv must be exactly those three. The recycled-pid guard
 * for `waiting.json`: a pid reused by anything else — even a process that mentions the script, or passes it as an
 * argument — holds no build, so no note may say one is waiting.
 * `isRefreshRound` in `src/checkouts/consoleBuild.ts` is the same test for
 * the verb's reading; `site/` is its own project and cannot import it.
 *
 * @param args `ps -o args= -p <pid>`'s output, `undefined` when the pid is gone
 * @returns true when it is still a refresh round
 */
export function isRefreshRoundArgs({ args }: { args: string | undefined }): boolean {
  if (args === undefined) {
    return false;
  }
  const words = args.trim().split(/\s+/u);
  if (words.length !== 3) {
    return false;
  }
  const [shell, script, flag] = words;
  return (
    (shell === "bash" || shell.endsWith("/bash")) &&
    (script === "docs-site.sh" || script.endsWith("/docs-site.sh")) &&
    flag === "--refresh-round"
  );
}

/**
 * A waiting build out of an already-parsed object — the route's answer, read back by the widget.
 *
 * @param bag the object carrying the three fields
 * @returns the waiting build, or `undefined` when any field is missing or malformed
 */
export function waitingOfBag({ bag }: { bag: Bag }): WaitingBuild | undefined {
  const sha = str({ bag, key: "sha" });
  const pid = num({ bag, key: "pid" });
  const sinceIso = str({ bag, key: "sinceIso" });
  if (sha === undefined || !SHA.test(sha)) {
    return undefined;
  }
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  if (sinceIso === undefined || !SCRIPT_ISO.test(sinceIso)) {
    return undefined;
  }
  return { pid, sha, sinceIso };
}

/**
 * Read the route's answer to a beat.
 *
 * @param body the parsed response body
 * @returns the answer, or `undefined` when the body is not one
 */
export function parseBeatAnswer({ body }: { body: unknown }): CallBeatAnswer | undefined {
  if (!isBag(body) || typeof body["recorded"] !== "boolean") {
    return undefined;
  }
  let waiting: WaitingBuild | undefined;
  if (isBag(body["waiting"])) {
    waiting = waitingOfBag({ bag: body["waiting"] });
  }
  return { recorded: body["recorded"], waiting, why: str({ bag: body, key: "why" }) };
}

/**
 * The widget's line for a navigation held until the call ends.
 *
 * @param href the held destination
 * @param origin the console's own origin, so the line names a path rather than a whole URL
 * @returns one sentence saying what opening it would do, and when it will open
 */
export function heldNote({ href, origin }: { href: string; origin: string }): string {
  let shown = href;
  try {
    const url = new URL(href);
    if (url.origin === origin) {
      shown = `${url.pathname}${url.search}`;
    }
  } catch {
    // Not a URL: the raw text is still the truest thing to show.
  }
  return `Opening ${shown} reloads the console, which would end this call; it opens when you hang up.`;
}

/**
 * Whether a `navigate` event during a live call is one to hold. Only a navigation that would unload THIS
 * document is: a same-document one (every client route change that worked) never ends the call, a reload or a
 * back/forward is the owner's own browser act, and a download leaves the page where it is.
 *
 * @param cancelable the event's own `cancelable` — a navigation the browser will not let a page stop is let go
 * @param sameDocument `destination.sameDocument`
 * @param navigationType `push`, `replace`, `reload` or `traverse`
 * @param download whether the event carries a `downloadRequest`
 * @returns true to `preventDefault()` and hold the destination — wherever it leads, because a page on another
 *   origin unloads this one exactly as a newer build of it does
 */
export function holdsNavigation({
  cancelable,
  sameDocument,
  navigationType,
  download,
}: {
  cancelable: boolean;
  sameDocument: boolean;
  navigationType: string;
  download: boolean;
}): boolean {
  if (!cancelable || sameDocument || download) {
    return false;
  }
  return navigationType === "push" || navigationType === "replace";
}
