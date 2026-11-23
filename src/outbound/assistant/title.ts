/**
 * The agent thread TITLE — the whole `assistant.threads.setTitle` contract, in one file.
 *
 * It is the sibling of `./status.ts` and deliberately built to the same shape, for the same reason: the API
 * detail (the method name, the argument names, the scope, the reading of a refusal) lives in one file so the
 * whole thing is swappable, while the socket stays behind the caller's own seam and a unit test needs no mock.
 *
 * ## Measured — the scope that used to block this is now granted
 *
 * `./status.ts` records a measurement where this method refused with `missing_scope`, `needed:
 * "assistant:write"`. The app has since been reinstalled with the Agents feature enabled, which adds that
 * scope automatically. Re-measured against the live workspace with the bot token this repo holds, on a
 * deliberately non-existent channel so nothing was mutated:
 *
 *     assistant.threads.setTitle  →  ok:false, error:"channel_not_found"
 *
 * `channel_not_found` rather than `missing_scope` is the whole finding: the call got past authorisation and
 * failed on the argument, so the scope IS granted and the method IS callable. Nothing in this repo called it
 * before this file.
 *
 * ## Why the title is set at all
 *
 * An agent-container thread with no title is a row of identical entries in the agent's side panel. Slack's
 * own reference agents title a thread with the user's question, which is what makes the container navigable
 * rather than a stack of anonymous conversations. It is cosmetic in the sense that no answer depends on it,
 * and load-bearing in the sense that the container is unusable without it.
 *
 * ## Why a refusal is reported rather than swallowed
 *
 * Same rule as the status indicator: a `missing_scope` body carries `needed`, which is the exact string that
 * would fix it, and discarding that to report "title unavailable" is the silent-failure shape this repo's
 * ledger keeps recording. What is DIFFERENT here is the caller's obligation — a turn whose title refused must
 * still answer, because a missing title is a worse container and a missing answer is a broken bot. So this
 * module returns an outcome and the turn narrates it; it never throws.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { assistantRefusalCode } from "./refusalCode.js";

/** The method this module owns. One string, one place. */
export const ASSISTANT_TITLE_METHOD = "assistant.threads.setTitle";

/**
 * The scope Slack requires, and which the live install now grants.
 *
 * Added automatically when the Agents feature is enabled on the app — it is not a scope anyone ticks by hand.
 */
export const ASSISTANT_TITLE_SCOPE = "assistant:write";

/**
 * How long a title may be before this module clamps it.
 *
 * A LOCAL clamp against an UNDOCUMENTED limit, and the distinction matters. Slack publishes no maximum for
 * `title`, so this number is not a measured ceiling — it is the length past which a side-panel row stops
 * being scannable, which is the entire purpose of the title. Clamping rather than refusing is right for a
 * label (unlike `./status.ts`'s over-long loading list, where the alternative to refusing was a SILENT loss
 * of a message the caller wrote); a clamped title still names its thread, and the untruncated question is
 * already in the thread's first message.
 */
export const ASSISTANT_TITLE_MAX_CHARS = 80;

/** The title given to a thread whose opening message carried no words at all — a bare tag, or an empty DM. */
export const ASSISTANT_TITLE_FALLBACK = "a question with no words";

/** The exact `assistant.threads.setTitle` argument object, snake_cased as the wire wants it. */
export interface AssistantTitleArgs {
  readonly channel_id: string;
  readonly thread_ts: string;
  readonly title: string;
}

/** A set title, or a refusal that names what would fix it. */
export type AssistantTitleOutcome = Result<
  void,
  { readonly error: string; readonly neededScope?: string | undefined; readonly reason: string }
>;

/** A non-empty string field off a raw response body, or undefined. Pure. */
function rawString({ body, key }: { body: unknown; key: string }): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const value = body[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The thread title for a question.
 *
 * The first LINE only, because a pasted multi-line question would otherwise put newlines into a side-panel
 * row, and clamped to {@link ASSISTANT_TITLE_MAX_CHARS} with an ellipsis so a long one still reads as
 * truncated rather than as having simply stopped.
 *
 * @param question the human's question, already stripped of its tags
 * @returns the title to set, never empty
 */
export function threadTitleFor({ question }: { question: string }): string {
  // `split` always yields at least one element, so the assertion is honest rather than a coalesce to "".
  const head = question.trim().split("\n")[0]!.trim();
  if (head.length === 0) {
    return ASSISTANT_TITLE_FALLBACK;
  }
  return head.length <= ASSISTANT_TITLE_MAX_CHARS ? head : `${head.slice(0, ASSISTANT_TITLE_MAX_CHARS - 1)}…`;
}

/**
 * Build the wire arguments for a thread title.
 *
 * @param channelId the channel or DM holding the thread
 * @param threadTs the thread's parent message timestamp
 * @param title the title text, already shaped by {@link threadTitleFor}
 * @returns the exact argument object for {@link ASSISTANT_TITLE_METHOD}
 */
export function assistantTitleArgs({
  channelId,
  threadTs,
  title,
}: {
  channelId: string;
  threadTs: string;
  title: string;
}): AssistantTitleArgs {
  return { channel_id: channelId, thread_ts: threadTs, title };
}

/**
 * Read a raw response body as an outcome. Pure, and total — an unrecognisable body is a refusal, never a
 * success, because "I could not tell" and "it worked" must not collapse into the same value.
 *
 * @param body the raw response body, as the write seam resolved it
 * @returns the outcome
 */
export function readAssistantTitleResponse({ body }: { body: unknown }): AssistantTitleOutcome {
  // `=== true` rather than a truthiness test, for the same reason as the status reader: a body carrying
  // `ok: "false"` is not a success.
  if (isRecord(body) && body["ok"] === true) {
    return ok(undefined);
  }
  const error = assistantRefusalCode({ body });
  const needed = rawString({ body, key: "needed" });
  const scopeClause = needed === undefined ? "" : ` — add the \`${needed}\` scope and reinstall the app`;
  return err({
    error,
    reason: `${ASSISTANT_TITLE_METHOD} refused: ${error}${scopeClause}`,
    ...(needed === undefined ? {} : { neededScope: needed }),
  });
}
