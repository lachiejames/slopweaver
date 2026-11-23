/**
 * Posting one accepted relay: the post with its one words-alone retry, the line its posts came to, and the replay of a
 * discuss-first question's relay that did not certainly land. Split from `relayAttempt.ts` to keep it under the line
 * cap.
 */
import { postLeftTurnUnclaimed, wordsAloneWire } from "../../lib/relayRetry";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";
import type { postRelay } from "./talkToolCalls";
import type { RelayLine, RelayReplay } from "./voiceContext";

/** What one post to `/api/talk/relay` came to. */
export type RelayPosted = Awaited<ReturnType<typeof postRelay>>;

/**
 * Posts one accepted relay, and retries it once with the owner's words alone when the first post was refused before the
 * turn was claimed. A turn is one accepted relay's, so nothing else can have claimed it.
 *
 * @param wire the relay the gate formed
 * @param hooks the post itself, and what the page shows when it retries
 * @returns the post that decides the outcome, and why the first was refused when a retry was taken
 */
export async function attemptRelay({
  wire,
  hooks,
}: {
  wire: TalkRelayWire;
  hooks: {
    readonly post: (wire: TalkRelayWire) => Promise<RelayPosted>;
    readonly retrying: (retry: { why: string }) => void;
  };
}): Promise<{ readonly posted: RelayPosted; readonly firstWhy: string | undefined }> {
  const first = await hooks.post(wire);
  if (!postLeftTurnUnclaimed({ post: first })) {
    return { firstWhy: undefined, posted: first };
  }
  hooks.retrying({ why: first.detail });
  const posted = await hooks.post(wordsAloneWire({ wire }));
  return { firstWhy: first.detail, posted };
}

/** What a replayed discuss-first post is called on the line it rides. */
const REPLAYED = "the question's relay posted again first";

/** What the line says once the words-alone retry was taken, the first refusal carried apart (`RelayLine.firstRefusal`). */
export const RETRIED_CLAUSE = "in the owner's words alone after the first was refused";

/** The line a relay shows while its words-alone retry runs, the first refusal carried apart. */
export const RETRYING_DETAIL = "refused; retrying with the owner's words alone";

/**
 * The line one relay's posts came to. A first refusal the words-alone retry followed is carried apart as
 * `firstRefusal`, never inside a sentence the line otherwise says as itself, so the session viewer can fold its raw
 * message; the call file journals the two joined (`relayJournalDetail`). Nothing here reaches the
 * model, which was answered before the post ran.
 *
 * @param posted the post that decided the outcome
 * @param firstWhy why the first post was refused, when a words-alone retry was taken
 * @returns the line's detail, outcome and the first refusal carried apart
 */
export function relayOutcomeLine({ posted, firstWhy }: { posted: RelayPosted; firstWhy: string | undefined }): {
  readonly detail: string;
  readonly lineOutcome: RelayLine["outcome"];
  readonly firstRefusal: string | undefined;
} {
  let lineOutcome: RelayLine["outcome"] = posted.outcome;
  if (posted.shownOutcome !== undefined) {
    lineOutcome = posted.shownOutcome;
  }
  if (firstWhy === undefined) {
    return { detail: posted.detail, firstRefusal: undefined, lineOutcome };
  }
  // Two refusals: the line is the second, and the first rides apart, each folded on its own.
  if (posted.outcome === "refused") {
    return { detail: posted.detail, firstRefusal: firstWhy, lineOutcome };
  }
  return { detail: `${posted.detail}, ${RETRIED_CLAUSE}`, firstRefusal: firstWhy, lineOutcome };
}

/**
 * What the call file journals for one relay line: its detail, the first refusal a retry followed and what a replayed
 * discuss-first post came to, so the record keeps every reason however the viewer draws it. Two refusals read as
 * they always have, first then second, and a replay as its clause on the end.
 *
 * @param line the relay line
 * @returns the journalled detail
 */
export function relayJournalDetail({
  line,
}: {
  line: {
    readonly detail: string;
    readonly firstRefusal?: string | undefined;
    readonly outcome: RelayLine["outcome"];
    readonly replay?: RelayReplay | undefined;
  };
}): string {
  let journalled = line.detail;
  if (line.firstRefusal !== undefined && line.outcome === "refused") {
    journalled = `refused twice: ${line.firstRefusal}; then ${line.detail}`;
  } else if (line.firstRefusal !== undefined) {
    journalled = `${line.detail}: ${line.firstRefusal}`;
  }
  const { replay } = line;
  if (replay === undefined) {
    return journalled;
  }
  if (replay.why === undefined) {
    return `${journalled} (${replay.said})`;
  }
  return `${journalled} (${REPLAYED}: ${replay.why})`;
}

/**
 * Post the relay that put the discuss-first question again, before the owner's answer to it, when its own post did not
 * certainly land (a thrown put leaves the answer naming a turn not on record, so `talk relay` holds the owner's
 * go-ahead). The same wire under the same turn is the verb's own replay — it resumes or reports the turn
 * already registered, and never writes a second row. Taken once: a put that fails again leaves the answer on the hold
 * that says why, and the chair asks the owner itself.
 *
 * @param replay the put's last wire, or `undefined` when it landed
 * @param post the page's post
 * @returns what the replay came to for the answer's line, its caught message carried apart, or
 * `undefined` when nothing was replayed
 */
export async function replayPut({
  replay,
  post,
}: {
  replay: TalkRelayWire | undefined;
  post: (wire: TalkRelayWire) => Promise<RelayPosted>;
}): Promise<RelayReplay | undefined> {
  if (replay === undefined) {
    return undefined;
  }
  try {
    const posted = await post(replay);
    return { said: `${REPLAYED}: ${posted.outcome}`, why: undefined };
  } catch (cause) {
    return { said: `${REPLAYED}, and that post failed`, why: cause instanceof Error ? cause.message : String(cause) };
  }
}
