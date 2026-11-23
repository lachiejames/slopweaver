/**
 * The voice record: every live verb the console voice's Queue answer projects from, read fresh in ONE request on the
 * server (`../app/api/voice-record/route.ts`), as four processes, two of them `slopweaver console batch`
 * (`./voiceRecordBatch.ts` `VOICE_RECORD_GROUPS`).
 * The browser half and each source's reader are `../components/voice/freshVoiceRecord.ts` and
 * `../components/voice/voiceRecordSources.ts`.
 *
 * Every answer reads the record, never the page's loaded copy, at the cost of a fresh read on each call.
 *
 * **One request, because fifteen do not fit.** MEASURED on the owner's machine: the fifteen verbs run three at a time —
 * what the browser's three live-read slots allow (`./liveSlots.ts`) — took 36.3 s for the whole read; run all at once
 * they took 13.0 s. A tool call past twenty seconds has already been talked over (`./talkToolsList.ts`), so the read is
 * one request holding one slot.
 *
 * **Four processes, because fifteen boots did not fit either.** Fifteen children at once timed every source out on a
 * call at machine load 28 to 66, and lost `board` alone on the next. MEASURED at load 14.7 on 10 cores: the fifteen
 * children cost 20.7 s of CPU between them though most print under 110 bytes, nearly all of it each child's own Node
 * boot and module graph; the same fifteen verbs in one process cost 4.95 s. Every runnable process gets a share of the
 * cores, so the groups are balanced to keep the heaviest no costlier than the heaviest child was
 * (`VOICE_RECORD_GROUPS`). Reproduce: `/usr/bin/time -p slopweaver <argv>` for each slug's `argv` in
 * `./liveVerbs.ts`, all at once, summing user + sys; then each batch's argv list piped to
 * `/usr/bin/time -p slopweaver console batch`.
 */
import type { LiveResult } from "./liveVerbRun";
import type { LiveVerb } from "./liveVerbs";

/** Each source's live slug, keyed as the Queue answer's readings key it (`steers` is `talk steers`, not the overlay). */
export const VOICE_RECORD_SLUGS = {
  acts: "autonomy",
  board: "board",
  currency: "currency-reading",
  deferrals: "queue-deferred",
  drafts: "drafts",
  hands: "hands",
  imports: "import-questions",
  landing: "landing-reading",
  posts: "slack-drafts",
  reviewers: "reviewers",
  reviews: "review-drafts",
  spoken: "talk-cards",
  standing: "standing-asks",
  steers: "talk-steers",
  workstreams: "workstreams",
} as const;

/**
 * How long the server lets the read's processes run before it kills them: two seconds inside the browser's own
 * seventeen (`../components/voice/freshVoiceRecord.ts` `RECORD_READ_DEADLINE_MS`, the tool's twenty less the screen
 * asks' three). A batch killed here is still read for the lines it printed before the kill, which `spawnVerb` hands back
 * after at most its one-second pipe drain (`spawnSettleBoundMs`), so the answer is back by sixteen, inside the
 * browser's seventeen. A judgement over the 13.0 s measured above, and never the fix for a read that is slow.
 */
export const VOICE_RECORD_SERVER_DEADLINE_MS = 15_000;

/**
 * How long a batch launching now may run: what is LEFT of the read's deadline, never a fresh fifteen seconds from its
 * own spawn, so every batch is killed at the one instant the route answers and none outlives it.
 *
 * The residue is the few milliseconds between this reading of the clock and `spawnVerb` arming its timer — a binary
 * resolution and a `spawn` call, both synchronous — plus `spawnVerb`'s one-second drain cap for its pipes.
 *
 * @param deadlineAtMs the monotonic instant (`performance.now()`) the route's batches are killed at
 * @param nowMs the monotonic instant the batch is about to launch at, on the same clock
 * @returns the bound in milliseconds, or `undefined` when the deadline has already passed and nothing launches
 */
export function voiceRecordTimeLeftMs({
  deadlineAtMs,
  nowMs,
}: {
  deadlineAtMs: number;
  nowMs: number;
}): number | undefined {
  const left = deadlineAtMs - nowMs;
  if (left <= 0) {
    return undefined;
  }
  return left;
}

/**
 * A live verb as the voice record runs it on its own: killed at the read's deadline INSTANT, never left running to its
 * page-read bound. A board child bounded at 90 s would otherwise outlive the answer, and repeated Queue calls would pile
 * up children working for nobody. It rides no page flight and no page read rides it, so a page keeps its own bound.
 *
 * @param verb the live verb, with the bound the page reads it under
 * @param deadlineAtMs the monotonic instant (`performance.now()`) the route's processes are killed at
 * @param nowMs the monotonic instant this child is about to launch at, on the same clock
 * @returns the verb bounded at the time left, or `undefined` when the deadline has already passed and nothing launches
 */
export function voiceRecordVerb({
  verb,
  deadlineAtMs,
  nowMs,
}: {
  verb: LiveVerb;
  deadlineAtMs: number;
  nowMs: number;
}): LiveVerb | undefined {
  const left = voiceRecordTimeLeftMs({ deadlineAtMs, nowMs });
  if (left === undefined) {
    return undefined;
  }
  if (verb.timeoutMs <= left) {
    return verb;
  }
  return { ...verb, timeoutMs: left };
}

/** What the route answers: one live reading per slug, each the shape `/api/live/<slug>` answers with. */
export interface VoiceRecordBody {
  readonly readings: Readonly<Record<string, LiveResult>>;
}
