/**
 * One fresh read of the record a Queue tool answers from: every source in `./voiceRecordSources.ts`, in ONE request to
 * `/api/voice-record`, which reruns each source's live verb on the server, in four processes at once, two of them
 * `console batch`, and never hands back an older flight (`../../lib/voiceRecordRead.ts` measures why it is one
 * request, and four processes). The page's held copy is never consulted — through a
 * call its polls are held quiet and `board` is not polled at all, so that copy can be hours old and out of sync with the Queue.
 *
 * Every answer reads the record, never the page's loaded copy, at the cost of a fresh read on each call.
 *
 * **Bounded as one read.** The request holds one live-read slot at foreground priority and has
 * {@link RECORD_READ_DEADLINE_MS} from the ask, its slot wait included; past it the fetch is aborted and every source is
 * `not-measured`, named unread in the answer — never the held copy. The parallel calls one model turn makes share one
 * read begun in their own instant, within {@link SHARED_READ_WINDOW_MS}, rather than doubling 15 verbs' load; a call
 * later than that starts its own, so no answer stands on a read begun before the owner's last words.
 *
 * **Not one instant.** The verbs answer across the read, as the page's own polls do; each reading's `observedAtIso`
 * says when it was true.
 */
import { TOOL_TIMEOUT_MS } from "../../lib/talkToolsList";
import { QUEUE_SCREEN_RESERVE_MS } from "../../lib/voiceRecordQueue";
import { withLiveSlot } from "../live/liveSlot";
import { type Arrival, stateOf, wireOf } from "../live/useLiveWire";
import { VOICE_RECORD_SOURCES, type VoiceRecord } from "./voiceRecordSources";

/**
 * How long the whole read may take, from the ask: the twenty seconds every read tool gets, past which the model has
 * already talked over the call (`../../lib/talkToolsList.ts`), less what the screen asks after it keep, so the Queue
 * tool's whole answer lands inside those twenty (`QUEUE_SCREEN_RESERVE_MS`).
 */
export const RECORD_READ_DEADLINE_MS = TOOL_TIMEOUT_MS - QUEUE_SCREEN_RESERVE_MS;

/** What one fetch of the record came to: its parsed body, or why there is none. */
export type RecordArrival =
  { readonly kind: "body"; readonly body: unknown } | { readonly kind: "failed"; readonly why: string };

/**
 * Whether a key `Object.keys` read off the source table is one of the record's own sources.
 *
 * @param key one key of `VOICE_RECORD_SOURCES`, typed only as a string
 * @returns whether it names a source
 */
function isRecordSource(key: string): key is keyof VoiceRecord {
  return Object.hasOwn(VOICE_RECORD_SOURCES, key);
}

/**
 * The record one fetch carried, each source turned into its state through its own reader and never provisional. A
 * source the body does not carry, or a fetch that failed, is `not-measured` with why.
 *
 * @param arrival what the fetch came to
 * @returns the record, one state per source
 */
export function voiceRecordOf({ arrival }: { arrival: RecordArrival }): VoiceRecord {
  let readings: Record<string, unknown> | undefined;
  if (arrival.kind === "body" && isRecord(arrival.body) && isRecord(arrival.body["readings"])) {
    readings = arrival.body["readings"];
  }
  const states: Partial<Record<keyof VoiceRecord, unknown>> = {};
  for (const key of Object.keys(VOICE_RECORD_SOURCES)) {
    if (!isRecordSource(key)) {
      continue;
    }
    const { read, slug } = VOICE_RECORD_SOURCES[key];
    states[key] = stateOf<unknown>({
      arrival: sourceArrival({ arrival, readings, slug }),
      provisional: false,
      read,
      slug,
    });
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- every key of VOICE_RECORD_SOURCES was written above through that source's own reader
  return states as VoiceRecord;
}

/**
 * One source's arrival out of the record's body.
 *
 * @param arrival what the whole fetch came to
 * @param readings the body's readings by slug, `undefined` when the body carried none
 * @param slug the source's live slug
 * @returns the arrival
 */
function sourceArrival({
  arrival,
  readings,
  slug,
}: {
  arrival: RecordArrival;
  readings: Record<string, unknown> | undefined;
  slug: string;
}): Arrival {
  if (arrival.kind === "failed") {
    return { kind: "failed", retry: false, why: arrival.why };
  }
  if (readings === undefined) {
    return { kind: "failed", retry: false, why: "the voice record read answered with something that is not one" };
  }
  const wire = wireOf({ body: readings[slug] });
  if (wire === undefined) {
    return { kind: "failed", retry: false, why: `the voice record read carried no reading of ${slug}` };
  }
  return { kind: "wire", wire };
}

/**
 * How recently a read must have started for a Queue tool to share it rather than start its own: the parallel calls one
 * model turn makes arrive inside milliseconds of each other, so they share one read made at their own instant. A call
 * later than this is a call the owner's words since may have prompted, and a read begun before it could miss a card
 * added in between, so it reads again. A judgement over that gap.
 */
export const SHARED_READ_WINDOW_MS = 1000;

/**
 * Whether a Queue tool asked now shares the read under way, rather than starting one at its own instant.
 *
 * @param startedAtMs when the read under way began, `undefined` when none is
 * @param nowMs the instant the tool asked
 * @returns true only for a read begun inside {@link SHARED_READ_WINDOW_MS} of the ask
 */
export function sharesReadUnderWay({
  startedAtMs,
  nowMs,
}: {
  startedAtMs: number | undefined;
  nowMs: number;
}): boolean {
  return startedAtMs !== undefined && nowMs - startedAtMs <= SHARED_READ_WINDOW_MS;
}

/** The read under way in this window, and when it began, which a Queue tool asked in the same instant shares. */
let inFlight: { readonly read: Promise<VoiceRecord>; readonly startedAtMs: number } | undefined;

/**
 * The record, read fresh now — or the read begun in the same instant, which the parallel calls of one model turn share.
 *
 * @returns the record
 */
export async function freshVoiceRecord(): Promise<VoiceRecord> {
  // The monotonic clock: a wall clock set back must never make an old read look begun a moment ago.
  const nowMs = performance.now();
  if (inFlight !== undefined && sharesReadUnderWay({ nowMs, startedAtMs: inFlight.startedAtMs })) {
    return inFlight.read;
  }
  const read = fetchRecord().then((arrival) => voiceRecordOf({ arrival }));
  const held = read.finally(() => {
    // Only its own: a later read begun while this one was out is still the one a call in its instant shares.
    if (inFlight?.read === held) {
      inFlight = undefined;
    }
  });
  inFlight = { read: held, startedAtMs: nowMs };
  return held;
}

/**
 * Fetch the record once, in a live-read slot, under {@link RECORD_READ_DEADLINE_MS} from the ask; a read whose time
 * is up before its slot came gives the slot back without fetching. Never throws.
 *
 * @returns the arrival
 */
async function fetchRecord(): Promise<RecordArrival> {
  const abort = new AbortController();
  const late: RecordArrival = {
    kind: "failed",
    why: `the voice record read did not answer within ${String(RECORD_READ_DEADLINE_MS / 1000)} s`,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The deadline answers for the read, so a slot wait cannot hold the tool past it; the read still takes its slot
  // when one comes and gives it straight back.
  const deadline = new Promise<RecordArrival>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve(late);
    }, RECORD_READ_DEADLINE_MS);
  });
  try {
    return await Promise.race([deadline, slotted({ abort, late })]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The fetch, inside a live-read slot.
 *
 * @param abort aborted when the read's time is up
 * @param late what a read past its time comes to
 * @returns the arrival
 */
async function slotted({ abort, late }: { abort: AbortController; late: RecordArrival }): Promise<RecordArrival> {
  // Read through a call each time: the signal is aborted from outside while the fetch awaits, which narrowing on the
  // first check cannot see.
  const timeUp = (): boolean => abort.signal.aborted;
  return withLiveSlot({
    line: () => "foreground",
    run: async (): Promise<RecordArrival> => {
      if (timeUp()) {
        return late;
      }
      try {
        const response = await fetch("/api/voice-record", { cache: "no-store", signal: abort.signal });
        const body: unknown = await response.json();
        return { body, kind: "body" };
      } catch (cause) {
        if (timeUp()) {
          return late;
        }
        const why = cause instanceof Error ? cause.message : String(cause);
        return { kind: "failed", why: `the voice record read failed: ${why}` };
      }
    },
  });
}

/**
 * Whether a value is a plain object.
 *
 * @returns true for one
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
