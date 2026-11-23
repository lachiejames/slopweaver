/**
 * The native THINKING indicator — the whole `assistant.threads.setStatus` contract, in one file.
 *
 * The orchestration doc asks for "the thin effectful edge … with the *entire* API detail confined to it so
 * the recon's answer is swappable in one file". Two of this repo's standing rules bear on how that is
 * spelled, and together they decide the shape:
 *
 *  - `../../corpus/slack/writeApi.ts` is "the one and only place in this codebase that mutates a Slack
 *    workspace", and the boundary-residue gate checks every raw client call sits inside the paced door.
 *  - A unit test may not mock. `.claude/rules/testing.md` is law.
 *
 * So the API DETAIL lives here — the method name, the argument names and their limits, and the reading of
 * a refusal — while the socket stays behind an injected {@link AssistantStatusTransport}, which is a plain
 * function seam and not a mock. Swapping in a different status mechanism is a change to this file; wiring
 * it to a real `WebClient` is one adapter in the write seam.
 *
 * ## Measured — this needs NO manifest change
 *
 * An earlier recorded question told the owner that the agent surface required an irreversible
 * `agent_view` manifest change plus `assistant:write`, and gated everything behind the owner's click. Calling
 * all four assistant methods with the bot token this repo already holds refutes half of that:
 *
 *     assistant.threads.setStatus              → ok:true,  acceptedScopes: ["chat:write"]
 *     chat.startStream                         → ok:true,  acceptedScopes: ["chat:write"]
 *     assistant.threads.setTitle               → missing_scope, needed "assistant:write"
 *     assistant.threads.setSuggestedPrompts    → missing_scope, needed "assistant:write"
 *
 * **Superseded in part.** The app is installed with the Agents feature enabled, which adds
 * `assistant:write` automatically. `assistant.threads.setTitle` re-probed against the live workspace answers
 * `channel_not_found` rather than `missing_scope` — it is callable, and `./title.ts` calls it. The two lines
 * above are kept because they are why the earlier gate existed; only `setSuggestedPrompts` remains
 * unexercised.
 *
 * The thinking indicator is available NOW. Only thread titles and suggested prompts are behind the gate.
 * The docs agree and say so more precisely than the predecessor's summary did: setStatus "currently accepts
 * either `assistant:write` or `chat:write`, but will transition to `chat:write` only".
 *
 * ## Why a refusal must be loud
 *
 * The doc's non-negotiable: "Never silently fall back to the old post/update path … the owner would ship
 * the fallback for months without knowing." A missing scope is therefore a REFUSAL carrying the scope
 * Slack named, not a boolean. `missing_scope` responses carry `needed`, which is the exact string the
 * owner would have to add — throwing that away and reporting "status unavailable" is the failure mode
 * that this repo's own silent-failure ledger keeps recording.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { assistantRefusalCode } from "./refusalCode.js";

/** The method this module owns. One string, one place, so the recon's answer is swappable. */
export const ASSISTANT_STATUS_METHOD = "assistant.threads.setStatus";

/**
 * The scope the call is accepted under TODAY.
 *
 * Documented as accepting either `assistant:write` or `chat:write` and transitioning to `chat:write` only;
 * measured accepting `chat:write` (`acceptedScopes: ["chat:write"]`). Named as the narrower of the two
 * because that is the one this repo holds and the one Slack is moving to.
 */
export const ASSISTANT_STATUS_SCOPE = "chat:write";

/**
 * How long Slack keeps a set status before clearing it, per its reference page ("2-minute timeout").
 *
 * A turn longer than this must re-assert its status. That is a real lifecycle obligation and not a
 * detail — an indicator that vanishes mid-work looks exactly like a turn that died.
 */
export const ASSISTANT_STATUS_TIMEOUT_MS = 120_000;

/** Slack's documented ceiling on the rotating loading messages. */
export const ASSISTANT_STATUS_MAX_LOADING_MESSAGES = 10;

/**
 * The exact `assistant.threads.setStatus` argument object, snake_cased as the wire wants it.
 *
 * `username` and `icon_emoji` are on this method as well as on `chat.postMessage`, which is what lets the
 * indicator carry the same per-task identity as the messages around it.
 */
export interface AssistantStatusArgs {
  readonly channel_id: string;
  readonly thread_ts: string;
  readonly status: string;
  readonly loading_messages?: readonly string[] | undefined;
  readonly username?: string | undefined;
  readonly icon_emoji?: string | undefined;
}

/**
 * The socket, injected.
 *
 * The contract is deliberately narrow and one clause of it is load-bearing: the transport RESOLVES with
 * the raw response body even when Slack said `ok:false`. The SDK throws on an API-level error and buries
 * the body on `error.data`, so an adapter that forgot to unwrap it would lose the `needed` field — the one
 * piece of a refusal worth having. Making resolution the contract puts that unwrapping in the adapter,
 * where it is visible, rather than in a catch block here.
 */
export interface AssistantStatusTransport {
  readonly call: (input: { method: string; args: AssistantStatusArgs }) => Promise<unknown>;
}

/** A set status, or a refusal that names what would fix it. */
export type AssistantStatusOutcome = Result<
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
 * Build the wire arguments, refusing an over-long loading list here rather than finding out later.
 *
 * Slack documents `loading_messages` as "max 10". What it does with an eleventh was NOT measured — it may
 * error, it may drop it silently — and that uncertainty is the reason to refuse locally rather than to send
 * and hope: one of the two possibilities is a silent loss, and the call site is the only place that can
 * still fix it. This is a local guard against a documented limit, not a measured behaviour.
 *
 * @param channelId the channel or DM holding the thread
 * @param threadTs the thread's parent message timestamp
 * @param status the present-tense status text, e.g. `is measuring the reference thread…`
 * @param loadingMessages up to ten messages Slack rotates through while the status stands
 * @param username the per-task display name to show alongside the indicator
 * @param iconEmoji the `:shortcode:` icon to show alongside it
 * @returns the exact argument object for {@link ASSISTANT_STATUS_METHOD}
 */
export function assistantStatusArgs({
  channelId,
  threadTs,
  status,
  loadingMessages,
  username,
  iconEmoji,
}: {
  channelId: string;
  threadTs: string;
  status: string;
  loadingMessages?: readonly string[] | undefined;
  username?: string | undefined;
  iconEmoji?: string | undefined;
}): AssistantStatusArgs {
  if (loadingMessages !== undefined && loadingMessages.length > ASSISTANT_STATUS_MAX_LOADING_MESSAGES) {
    throw new Error(
      `${ASSISTANT_STATUS_METHOD}: ${String(loadingMessages.length)} loading messages exceeds Slack's ceiling of ` +
        `${String(ASSISTANT_STATUS_MAX_LOADING_MESSAGES)} — trim the list rather than let Slack decide`,
    );
  }
  return {
    channel_id: channelId,
    status,
    thread_ts: threadTs,
    ...(loadingMessages === undefined ? {} : { loading_messages: loadingMessages }),
    ...(username === undefined ? {} : { username }),
    ...(iconEmoji === undefined ? {} : { icon_emoji: iconEmoji }),
  };
}

/**
 * Read a raw response body as an outcome. Pure, and total — an unrecognisable body is a refusal, never a
 * success, because "I could not tell" and "it worked" must not collapse into the same value.
 *
 * A `missing_scope` body carries `needed`; it is surfaced as `neededScope` and named in the reason, so the
 * refusal a turn logs already contains the fix.
 *
 * @param body the raw response body from {@link AssistantStatusTransport}
 * @returns the outcome
 */
export function readAssistantStatusResponse({ body }: { body: unknown }): AssistantStatusOutcome {
  // `=== true` rather than a truthiness test: a body carrying `ok: "false"` is not a success, and the one
  // failure mode this whole module exists to prevent is a refusal that reads as a set status.
  if (isRecord(body) && body["ok"] === true) {
    return ok(undefined);
  }
  const error = assistantRefusalCode({ body });
  const needed = rawString({ body, key: "needed" });
  const scopeClause = needed === undefined ? "" : ` — add the \`${needed}\` scope and reinstall the app`;
  return err({
    error,
    reason: `${ASSISTANT_STATUS_METHOD} refused: ${error}${scopeClause}`,
    ...(needed === undefined ? {} : { neededScope: needed }),
  });
}

/**
 * Set the native thinking indicator.
 *
 * The one effectful function here, and it is three lines because everything decidable was decided in the
 * pure pair above. It does not fall back, retry or swallow: it returns the outcome and the caller refuses
 * the turn with the reason.
 *
 * @param transport the injected socket
 * @param args the wire arguments, from {@link assistantStatusArgs}
 * @returns the outcome — set, or a refusal naming the scope that would fix it
 */
export async function setAssistantStatus({
  transport,
  args,
}: {
  transport: AssistantStatusTransport;
  args: AssistantStatusArgs;
}): Promise<AssistantStatusOutcome> {
  const body = await transport.call({ args, method: ASSISTANT_STATUS_METHOD });
  return readAssistantStatusResponse({ body });
}
