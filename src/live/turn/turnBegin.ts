/**
 * Opening a turn: name the thread, then post the working message.
 *
 * **Orderings 0 and 1** of the list in {@link ./run}, together in one module because they are adjacent
 * steps of a single act rather than two concerns sharing a file. {@link beginTurn} names the thread and
 * then posts, in that order.
 *
 * Naming is also the one effect here whose refusal is SURVIVABLE. A DM has an agent-container side panel
 * with a row to name, a channel thread has no title row at all, and a title arriving after the answer has
 * already been read is a title nobody needed. So a failure to set one is reported in the outcome and the
 * turn carries on.
 */

import { isAlreadyGoneThrowable } from "../../corpus/slack/writeApi.js";
import { threadTitleFor } from "../../outbound/assistant/title.js";
import type { Mention } from "../listen/mention.js";
import { CARD_LINE_CAP, clampVisible, turnChecklist } from "./answer.js";
import { questionForPlainField } from "./quotedQuestion.js";
import type { PostedRef, TurnPoster, TurnStep } from "./runContract.js";
import { strippedAddressing, turnTaskLabel } from "./taskLabel.js";
import type { Cursor } from "./turnCursor.js";

/**
 * Name the thread, when there is a thread worth naming.
 *
 * Only a DM gets a title, and that is a decision rather than a caution. `assistant.threads.setTitle` names a
 * row in the agent container's side panel, and a channel thread has no such row — calling it there would earn
 * a refusal on every single channel turn, which would train a reader to ignore the one line that is supposed
 * to be worth reading.
 *
 * @returns the refusal reason, or `undefined` when the title was set or was never owed
 */
async function nameThread({ mention, poster }: { mention: Mention; poster: TurnPoster }): Promise<string | undefined> {
  if (mention.surface !== "dm") {
    return undefined;
  }
  const outcome = await poster.setTitle({ title: threadTitleFor({ question: mention.text }) });
  return outcome.isOk() ? undefined : outcome.error;
}

/**
 * The cursor a turn opens on: step 0 done, its detail the question quoted back.
 *
 * Step 0 is already done by the time anything is posted — the question has been read — so a checklist whose
 * first line is still pending would be a frame that was never true. The three helpers are the same seam
 * `progressChecklistSteps` and the capture-time checklist both go through, in the same order: a long
 * question is capped here too, not quoted whole, and the markup is resolved before the cap measures it.
 *
 * Both rewrites run even though `beginTurn`'s own comment says `../listen/mention.ts` normalised every tag.
 * `TAG_TOKEN` there consumes `<@…>` and `<!…>` only, so a `<#C…|general>` or a `<https://…|label>` reaches
 * here untouched — and `unescapeSlackEntities` runs AFTER that strip, so a message quoting `&lt;@U1&gt;`
 * arrives carrying a literal `<@U1>` the strip never saw. `detail` is a field Slack PARSES, so either one is
 * a live link or a live mention on a card that meant only to quote the question.
 *
 * @param question the ask's text, as the transport handed it over
 * @returns the cursor, its one detail already clamped
 */
function stepZeroCursor({ question }: { question: string }): Cursor {
  return {
    completed: 1,
    details: [
      clampVisible({
        cap: CARD_LINE_CAP,
        text: `"${questionForPlainField({ question: strippedAddressing({ question }) })}"`,
      }),
    ],
  };
}

/**
 * Everything before the query starts: name the thread, seed the checklist, post the working message.
 *
 * Split out of {@link runTurn} to keep that function's own body to the ordering it is actually about — the
 * query, the two ways it can end, and the status indicator bracketing it. The three orderings THIS function
 * encodes are real, not incidental: the title goes out before anything is posted into the thread; the
 * checklist's step 0 is marked done before the first post, because the question HAS already been read by
 * the time anything renders; and the working message goes out before the caller ever sees a `posted` ref.
 *
 * ## `started`: the message may already exist
 *
 * `src/cli/commands/listen/run.ts` can post this same checklist at CAPTURE, right after the reaction —
 * see `./poster.ts`'s header for why that is accepted rather than a defect. When it did, `started` names
 * the message it posted and this function RECONSTRUCTS the reference instead of calling `postWorking`
 * again: a second call here is exactly the two-checklists-per-tag regression this feature exists to
 * remove. `started` absent — the ordinary case for a hand-driven `turn brief` — behaves exactly as before.
 *
 * ## The reconstructed message ALSO gets corrected to this turn's real steps
 *
 * Capture posted `PENDING_ROUTE_STEPS` — a neutral placeholder, because routing had not run yet. `steps`
 * here is `turnStepsForTier({tier})`, resolved by the time this function runs — `turn dispatch` decided
 * the tier before this call ever happens. Reconstructing the reference without correcting its content would
 * leave the neutral placeholder standing for the query's whole span and rely on the first `onPhase` call to
 * fix it, which a `read-only-subagent`/`fresh-visible-session` tier may fire only once, right before the
 * answer replaces the message anyway. So this edits the frame immediately, at the same cursor position
 * capture already reached (step 0 done, nothing else started) — a correction of WHAT the pending step is
 * called, not of how much progress has been made.
 *
 * @returns the posted working message, the turn's cursor over its checklist, and the one survivable refusal a DM title may have produced
 */
export async function beginTurn({
  mention,
  poster,
  started,
  steps,
}: {
  mention: Mention;
  poster: TurnPoster;
  started: { readonly turnId: string; readonly workingTs: string } | undefined;
  steps: readonly TurnStep[];
}): Promise<{
  readonly question: string;
  readonly task: string;
  readonly cursor: Cursor;
  readonly posted: PostedRef;
  readonly titleFailure: string | undefined;
}> {
  // `mention.text` arrives with every `<@…>`/`<!…>` tag already removed and trimmed — that is the transport's
  // job and it is done in `../listen/mention.ts`, so there is nothing to re-strip here. Worth stating because
  // the obvious instinct is to normalise defensively, and a second stripper would be a second place for the
  // rule to drift.
  const question = mention.text;
  const task = turnTaskLabel({ question });
  const titleFailure = await nameThread({ mention, poster });
  const cursor = stepZeroCursor({ question });
  const frame = turnChecklist({ progress: { completed: cursor.completed, details: cursor.details }, steps });
  if (started === undefined) {
    return { cursor, posted: await poster.postWorking({ steps: frame, task }), question, task, titleFailure };
  }
  const posted: PostedRef = { channel: mention.channel, ts: started.workingTs };
  // Correct capture's neutral placeholder to this route's real steps NOW — see this function's own doc for
  // why waiting on the query's first `onPhase` is not soon enough.
  const advanced = await poster.advanceWorking({ posted, steps: frame, task }).then(
    () => true,
    (error: unknown) => {
      if (isAlreadyGoneThrowable({ thrown: error })) {
        return false;
      }
      throw error;
    },
  );
  if (advanced) {
    return { cursor, posted, question, task, titleFailure };
  }
  // The remembered message is GONE: an earlier turn on this same ask already answered and its reply
  // replaced the capture-time checklist, so the ask log's `started` ref names nothing. Posting fresh here
  // is not the two-checklists regression the reconstruction exists to prevent — there is no first one —
  // and it is the only way a re-answer (a follow-up the owner asked for) ever reaches the thread. Measured
  // live: `advance` hit `message_not_found`, the turn died before `postAnswer`, and the
  // terminal path then failed the same way on the same absent message.
  return { cursor, posted: await poster.postWorking({ steps: frame, task }), question, task, titleFailure };
}
