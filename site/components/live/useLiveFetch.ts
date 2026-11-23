/**
 * The effectful live and saved reads: one channel's fetch and the delivery of its arrival, the re-read a server failure
 * owes, the poll timer, the hold a call takes with the catch-up it owes on release, and the one request for the
 * readings an earlier console process saved.
 */
import { stillOwesFresh } from "../../lib/liveFresh";
import { holdQuiet, tickRuns } from "../../lib/liveQuiet";
import { fetchFailureRetries, retryDelayMs } from "../../lib/liveRetry";
import { type LiveReadCause, type LiveReadPriority, liveReadPriority } from "../../lib/liveSlots";
import { withLiveSlot } from "./liveSlot";
import {
  admitSaved,
  answeredPress,
  answeredPressOf,
  type Channel,
  channels,
  deliveries,
  freshOwed,
  liveDeliveries,
  markPressed,
  outliveSaved,
  pressesOf,
  quiet,
} from "./useLiveChannels";
import { type Arrival, keyOf, urlOfKey, type WireResult, wireOf } from "./useLiveWire";

/** How many reads this page has started — an order, not a clock, so two in one millisecond still differ. */
let readSeq = 0;

/**
 * Hold every channel's ticks, and catch each held channel up once on release.
 *
 * @param spacingMs how far apart the catch-up reads start; each asks the gate again when it fires, so a hold taken
 *   inside the spacing keeps the rest for its own release
 * @returns the release
 */
export function holdTicks({ spacingMs }: { spacingMs: number }): () => void {
  const release = holdQuiet({ gate: quiet });
  const heldAfterSeq = readSeq;
  return () => {
    release().forEach((key, index) => {
      window.setTimeout(() => {
        if (tickRuns({ gate: quiet, key })) {
          catchUp({ heldAfterSeq, key });
        }
      }, index * spacingMs);
    });
  };
}

/**
 * The one read a held channel owes when the hold ends, if the channel still has anyone reading it.
 *
 * @param key the channel's key
 * @param heldAfterSeq the last read started before the hold began
 */
function catchUp({ key, heldAfterSeq }: { key: string; heldAfterSeq: number }): void {
  const channel = channels.get(key);
  if (channel === undefined) {
    return;
  }
  // Any read started since the hold (a press, a first read, a tick after hang-up) is fresher than this one and
  // satisfies it, finished or not. Otherwise a read still in flight from before the call owes this one.
  if (channel.startedSeq > heldAfterSeq) {
    return;
  }
  if (channel.inflight) {
    channel.owed = true;
    return;
  }
  void fetchInto({ cause: "catch-up", channel, url: urlOfKey({ key }) });
}

/**
 * Fetch one verb for a channel and hand the arrival to every subscriber.
 *
 * A second call while the first is in flight does not start a second process. A timer tick that overlaps is
 * simply skipped — the answer in flight is as fresh as one it would have started. A PRESS that overlaps
 * (`supersede`) marks the channel instead, so the read runs again when the first lands and the in-flight
 * answer, which may predate what the press wrote, is never shown. Only a press supersedes: a tick that did
 * would discard every answer slower than the interval, and nobody would ever receive one.
 *
 * A press's read, and every read after it until one of them lands an answer, go out `fresh`: the route lets a plain
 * read ride a read of the same verb another tab already has in flight, and `fresh` is what keeps a press from riding
 * one that left before its write (`site/lib/liveFlights.ts`).
 *
 * Every caller names why it reads, and that with whether the channel has a reading drawn picks the line the read
 * waits in for a slot (`liveReadPriority`): a channel drawing nothing current yet ("loading", or a reading kept or saved from before), or a press, goes ahead of this tab's
 * poll ticks, and one a page's primary content reads goes ahead of the rest of those. The line decides only when the
 * read leaves, never whether or how its answer is delivered.
 *
 * @param cause why this read was asked for
 * @param channel the channel to fetch for
 * @param url the live route for it
 */
export async function fetchInto({
  cause,
  channel,
  url,
  supersede = false,
}: {
  cause: LiveReadCause;
  channel: Channel;
  url: string;
  supersede?: boolean;
}): Promise<void> {
  if (supersede) {
    markPressed({ key: channel.key });
  }
  if (channel.inflight) {
    if (supersede) {
      channel.pending = true;
    }
    return;
  }
  channel.inflight = true;
  readSeq += 1;
  channel.startedSeq = readSeq;
  // Whether the channel had a current reading as the read was asked for, and whether the page's primary content reads
  // it as the slot comes back: a channel the page joins as primary while the shell's read of it waits moves that read up.
  const hasCurrentReading = channel.drewCurrent;
  const line = (): LiveReadPriority =>
    liveReadPriority({ cause, hasCurrentReading, primary: channel.primaryReaders.size > 0 });
  const { arrival, fresh, pressesAtStart } = await arrivalFrom({ key: channel.key, line, url });
  channel.inflight = false;
  const owes = stillOwesFresh({
    landed: arrival.kind === "wire",
    owed: freshOwed.has(channel.key),
    pressedSince: pressesOf({ key: channel.key }) !== pressesAtStart,
    sentFresh: fresh,
  });
  if (!owes) {
    freshOwed.delete(channel.key);
  }
  // A read that was still waiting for a slot when the press came, and left after it AND fresh, cannot carry an answer
  // from before the write: it is delivered rather than dropped, and on a channel torn down meanwhile it still answers
  // the press for a settling row. One that rode another tab's flight is still dropped.
  const leftAfterEveryPress = fresh && pressesAtStart === pressesOf({ key: channel.key });
  if (channel.pending && leftAfterEveryPress) {
    channel.pending = false;
  }
  if (channel.pending) {
    // A press asked for a read while this one was in flight, so this answer may predate what the press
    // wrote. It is dropped rather than shown: delivering it would put a settled row back on the page for
    // the seconds until the re-read lands, and the re-read is what every subscriber is about to get.
    channel.pending = false;
    channel.owed = false;
    if (channel.subscribers.size > 0) {
      void fetchInto({ cause: "press", channel, supersede: true, url });
    }
    return;
  }
  channel.last = arrival;
  channel.answeredAtMs = performance.now();
  deliveries.set(channel.key, liveDeliveries({ key: channel.key }) + 1);
  outliveSaved({ arrival, on: channel });
  if (arrival.kind === "wire") {
    answeredPress.set(channel.key, Math.max(answeredPressOf({ key: channel.key }), pressesAtStart));
  }
  for (const deliver of channel.subscribers) {
    deliver({ arrival, provisional: false });
  }
  owe({ arrival, channel, url });
  if (channel.owed) {
    channel.owed = false;
    if (channel.subscribers.size > 0 && tickRuns({ gate: quiet, key: channel.key })) {
      void fetchInto({ cause: "catch-up", channel, url });
    }
  }
}

/**
 * The live route asked for a read that starts at or after now (`fresh=1`) when a press needs one.
 *
 * @param fresh whether the read answers a press
 * @returns the URL to fetch
 */
function freshWhen({ url, fresh }: { url: string; fresh: boolean }): string {
  if (!fresh) {
    return url;
  }
  if (url.includes("?")) {
    return `${url}&fresh=1`;
  }
  return `${url}?fresh=1`;
}

/**
 * Fetch one live route while holding one of the origin's live-read slots (`site/lib/liveSlots.ts`), so a poll never
 * takes the connection a click's navigation needs. Whether it goes out `fresh` is decided when it LEAVES, inside the
 * slot, never when it queued for one: a press made while it waited is owed `fresh=1` too.
 *
 * @param key the channel's key, whose fresh debt and press count are read as the fetch leaves
 * @param line which line of this tab's slot queue it waits in, asked each time a slot comes back
 * @param url the live route
 * @returns the arrival, whether it went out fresh, and the press count when it left
 */
async function arrivalFrom({
  key,
  line,
  url,
}: {
  key: string;
  line: () => LiveReadPriority;
  url: string;
}): Promise<{ arrival: Arrival; fresh: boolean; pressesAtStart: number }> {
  return withLiveSlot({
    line,
    run: async () => {
      const fresh = freshOwed.has(key);
      const pressesAtStart = pressesOf({ key });
      return { arrival: await fetchArrival({ url: freshWhen({ fresh, url }) }), fresh, pressesAtStart };
    },
  });
}

/**
 * Fetch one live route and say what came back, never throwing.
 *
 * The body is parsed before the status is judged: a LiveResult is the verb's answer at any status. Only when there
 * is none does the status decide whether the server — a swap's restart, a server that is gone — is why, in which case
 * the read is owed again (`site/lib/liveRetry.ts`).
 *
 * @param url the live route
 * @returns the arrival
 */
async function fetchArrival({ url }: { url: string }): Promise<Arrival> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { kind: "failed", retry: fetchFailureRetries({ status: undefined, threw: true }), why };
  }
  const body: unknown = await response.json().catch(() => undefined);
  const wire = wireOf({ body });
  if (wire !== undefined) {
    return { kind: "wire", wire };
  }
  return {
    kind: "failed",
    retry: fetchFailureRetries({ status: response.status, threw: false }),
    why: `${url} answered ${String(response.status)} with something that is not a LiveResult`,
  };
}

/**
 * Schedule the re-read a server-side failure owes, or settle the channel's backoff once a wire answer lands.
 *
 * Not held by the quiet gate: a read that never reached its verb is a first read still owed, and liveQuiet never
 * holds a first read. One timer per channel, replaced rather than stacked, and it re-reads only while the channel is
 * still the live one for its key — a torn-down channel's timer is cleared at teardown, and this is the second lock.
 *
 * @param arrival what the read that just landed came to
 * @param channel the channel it landed on
 * @param url the channel's live route
 */
function owe({ arrival, channel, url }: { arrival: Arrival; channel: Channel; url: string }): void {
  if (channel.retryTimer !== undefined) {
    clearTimeout(channel.retryTimer);
    channel.retryTimer = undefined;
  }
  if (arrival.kind === "wire") {
    channel.retryAttempts = 0;
    return;
  }
  if (!arrival.retry || channel.subscribers.size === 0) {
    return;
  }
  const wait = retryDelayMs({ attempt: channel.retryAttempts });
  channel.retryAttempts += 1;
  channel.retryTimer = setTimeout(() => {
    channel.retryTimer = undefined;
    if (channels.get(channel.key) === channel) {
      void fetchInto({ cause: "retry", channel, url });
    }
  }, wait);
}

/**
 * Re-arm a channel's timer on the shortest interval its live subscribers want, or clear it.
 *
 * @param channel the channel whose subscribers changed
 * @param wanted every interval currently asked for, `undefined` for a read-once subscriber
 */
export function rearm({
  channel,
  wanted,
  url,
}: {
  channel: Channel;
  wanted: readonly (number | undefined)[];
  url: string;
}): void {
  const live = wanted.filter((ms): ms is number => ms !== undefined);
  const shortest = live.length === 0 ? undefined : Math.min(...live);
  if (shortest === channel.everyMs) {
    return;
  }
  channel.everyMs = shortest;
  if (channel.timer !== undefined) {
    clearInterval(channel.timer);
    channel.timer = undefined;
  }
  if (shortest !== undefined) {
    channel.timer = setInterval(() => {
      if (tickRuns({ gate: quiet, key: channel.key })) {
        void fetchInto({ cause: "poll", channel, url });
      }
    }, shortest);
  }
}

/** Whether this page has asked for the readings an earlier console process saved; asked once, never again. */
let savedRequested = false;

/**
 * Ask once for every reading the console server saved (`app/api/live-saved/route.ts`), so the first load after an
 * app restart draws them marked refreshing instead of "loading" for a whole read. "I think you
 * could show saved data marked as refreshing."
 *
 * Outside the live-read slots on purpose: it is one disk read, and queued behind the reads it exists to cover it
 * would land after them. A failed fetch or a body of another shape is no saved readings, and the live reads go on.
 */
export function requestSaved(): void {
  if (savedRequested) {
    return;
  }
  savedRequested = true;
  void admitAllSaved();
}

/**
 * Fetch the saved readings and admit each, never throwing: a failure here only means no head start.
 */
async function admitAllSaved(): Promise<void> {
  let body: unknown;
  try {
    const response = await fetch("/api/live-saved", { cache: "no-store" });
    body = await response.json();
  } catch {
    return;
  }
  for (const [slug, wire] of savedWiresOf({ body })) {
    admitSaved({ key: keyOf({ fixture: undefined, slug }), wire });
  }
}

/**
 * Narrow the saved-readings body to its successful machine readings, by slug, dropping every other member.
 *
 * @param body whatever the route's JSON parsed to
 * @returns each slug's saved wire
 */
function savedWiresOf({ body }: { body: unknown }): readonly (readonly [string, WireResult])[] {
  if (typeof body !== "object" || body === null || !("readings" in body)) {
    return [];
  }
  const readings = body.readings;
  if (typeof readings !== "object" || readings === null) {
    return [];
  }
  const wires: (readonly [string, WireResult])[] = [];
  for (const [slug, member] of Object.entries(readings)) {
    const wire = wireOf({ body: member });
    if (wire !== undefined && wire.ok && wire.fixture === undefined) {
      wires.push([slug, wire]);
    }
  }
  return wires;
}
