/**
 * The Slack READ-BACK write calls — `chat.delete`'s already-gone check, reading a message back for its
 * ownership metadata and file count, and `auth.test` — split out of
 * `./writeApi.ts` purely to keep that file under `file-size-ratchet`'s 800-code-line cap. This is still part
 * of the one seam that mutates a workspace: every function here is wired into the SAME `SlackWriteTransport`
 * `writeApi.ts` builds, follows its exact `safeProviderCall`/`orThrow`/`scopeId` pattern, and carries no
 * policy of its own — the decisions about when a message may be mutated live in the caller, exactly as
 * `writeApi.ts`'s own header describes for every other method here.
 */
import type { WebClient } from "@slack/web-api";

import { type IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../outbound/slack/lifecycleGuards.js";
import type { AtMostOnceClient } from "./atMostOnceClient.js";
import { optStr } from "./shape.js";
import type { DeleteMessageOutcome, PostedMessage } from "./writeTransport.js";

/**
 * Slack platform error codes meaning "the message you asked me to remove is not there".
 *
 * This is SUCCESS for a delete, because the caller's goal is a STATE ("that message is gone"), not an event
 * ("I performed a deletion"). Kept as a set rather than one comparison so a second equivalent code can be
 * added without changing the logic around it.
 */
const ALREADY_GONE_CODES: ReadonlySet<string> = new Set(["message_not_found"]);

/**
 * Whether a failed `chat.delete` failed because the message was ALREADY GONE.
 *
 * This distinction is load-bearing rather than cosmetic, and a review caught its absence: a run that
 * crashed after Slack accepted the delete but before the phase was persisted would, on every later
 * attempt, delete an absent message, read that as a hard failure, and refuse to post the final card — so
 * the finished artifact became permanently unrecoverable. Treating "already gone" as the desired state
 * makes the delete idempotent and the resume correct.
 *
 * The code is read by {@link platformCodeOf}, which trusts a body only when it is Slack ANSWERING, since `slack
 * delete` journals a deletion on it. Pure.
 *
 * @param error the typed boundary failure from a delete attempt
 * @returns true when the message is already absent, so the delete's goal is met
 */
export function isAlreadyGone({ error }: { error: IngestError }): boolean {
  const code = platformCodeOf({ error });
  return code !== undefined && ALREADY_GONE_CODES.has(code);
}

/** The code `@slack/web-api` stamps on the error it throws for a platform error, with Slack's own code under `data.error`. */
const SDK_PLATFORM_ERROR = "slack_webapi_platform_error";

/**
 * Slack's own platform code for a failure, when the failure IS Slack answering rather than the request failing.
 *
 * A platform error rides an HTTP 200 and classifies as a plain `http` failure, so a dead transport, a rate limit with or
 * without a 429 (Slack's carries no status) and a 4xx or 5xx status answer nothing whatever their body says. Past that,
 * the body is trusted only on the SDK's own platform error, whose code `safeProviderCall` keeps, and otherwise the typed
 * code is the Slack code itself, stamped by `ingestErrorToThrowable`. Any other wrapper, a 500 whose status was lost
 * in normalisation included, answers nothing. Pure.
 *
 * @param error the typed boundary failure
 * @returns Slack's platform code, or undefined when the failure is not Slack's answer
 */
function platformCodeOf({ error }: { error: IngestError }): string | undefined {
  if (error.kind !== "http" || (error.status !== undefined && error.status >= 400)) {
    return undefined;
  }
  if (error.code !== SDK_PLATFORM_ERROR) {
    return error.code;
  }
  const data = isRecord(error.cause) ? error.cause["data"] : undefined;
  const code = isRecord(data) ? data["error"] : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * The same question asked of a THROWN value — the SDK error `ingestErrorToThrowable` re-surfaces verbatim
 * from a `chat.update`/`chat.delete` seam that throws rather than returns a `Result`. One owner of
 * {@link ALREADY_GONE_CODES}, so the two shapes can never disagree about what "gone" means. Pure.
 *
 * @param thrown whatever the throwing seam raised
 * @returns true when Slack said the target message is not there
 */
export function isAlreadyGoneThrowable({ thrown }: { thrown: unknown }): boolean {
  const data = isRecord(thrown) ? thrown["data"] : undefined;
  const code = isRecord(data) ? data["error"] : undefined;
  if (typeof code === "string" && ALREADY_GONE_CODES.has(code)) {
    return true;
  }
  // `ingestErrorToThrowable` stamps the typed `code` onto the Error it synthesises for a non-Error cause.
  const direct = isRecord(thrown) ? thrown["code"] : undefined;
  return typeof direct === "string" && ALREADY_GONE_CODES.has(direct);
}

/**
 * Whether a failed `conversations.replies` read failed because no message or thread stands at that ts. Read off the
 * platform code {@link platformCodeOf} trusts, the same read {@link isAlreadyGone} makes. Pure.
 *
 * @param error the typed boundary failure from the replies read
 * @returns true when Slack answered `thread_not_found` and the request itself did not fail
 */
export function isThreadNotFound({ error }: { error: IngestError }): boolean {
  return platformCodeOf({ error }) === "thread_not_found";
}

/**
 * `chat.delete`. Reports whether the message is GONE — which includes "it already was".
 *
 * Best effort in the sense that it never throws; a real failure (no permission, a network fault) reports
 * `false` so the caller can refuse to proceed.
 *
 * @param client the repeatable-call write client
 * @param posted the message's identity
 * @param scopeId the shared-429-block key for this token
 * @returns true once the message is gone, including when it already was
 */
export async function deleteMessageCall({
  client,
  posted,
  scopeId,
}: {
  client: WebClient;
  posted: PostedMessage;
  scopeId: string;
}): Promise<boolean> {
  const result = await safeProviderCall({
    execute: () => client.chat.delete({ channel: posted.channel, ts: posted.ts }),
    operation: "slack.chat.delete",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isOk()) {
    return true;
  }
  return isAlreadyGone({ error: result.error });
}

/**
 * `chat.delete`, AT MOST ONCE, reporting which of the three things actually happened.
 *
 * A second delete call is not the harmless repeat {@link deleteMessageCall}'s retries assume. Slack's own
 * `ts` is stable across `chat.update`, so a first attempt that fails transiently, a concurrent session that
 * repairs the message during the retry delay, and a second attempt that succeeds together remove a message
 * nobody ever judged — the eligibility and ownership decision was made before the first attempt and is
 * never re-taken. So this call gets the NON-retrying client and `retryMode: "never"`, the same at-most-once
 * construction `postingClient` already gives an irreversible post, and the cost is the same one: a
 * transient 429 fails the delete rather than quietly recovering from it.
 *
 * Which client arrives here is held by the TYPE rather than by this paragraph. `AtMostOnceClient` is
 * mintable only by `postingClient`, so handing this call the repeatable client does not compile — see
 * `./atMostOnceClient.ts` for the one-word mutant that made that necessary.
 *
 * It also reports what {@link deleteMessageCall}'s boolean cannot. `gone` and `already-gone` are different
 * facts to a journal — the second says the message was not there to remove — and `failed` carries the
 * provider's own words instead of collapsing every cause into `false`.
 *
 * @param client the at-most-once write client — the brand is what stops the repeatable one reaching here
 * @param posted the message's identity
 * @param scopeId the shared-429-block key for this token
 * @returns which of the three outcomes happened, never a throw
 */
export async function deleteMessageOnceCall({
  client,
  posted,
  scopeId,
}: {
  client: AtMostOnceClient;
  posted: PostedMessage;
  scopeId: string;
}): Promise<DeleteMessageOutcome> {
  const result = await safeProviderCall({
    execute: () => client.chat.delete({ channel: posted.channel, ts: posted.ts }),
    operation: "slack.chat.delete",
    provider: "slack",
    retryMode: "never",
    scopeId,
  });
  if (result.isOk()) {
    return { kind: "gone" };
  }
  if (isAlreadyGone({ error: result.error })) {
    return { kind: "already-gone" };
  }
  return { kind: "failed", reason: result.error.message };
}

/**
 * How many files a read-back message carries, with an unreadable message counting as none.
 *
 * Collapsing "could not read it" into zero is deliberate and it is what makes the media guard fail CLOSED:
 * the caller deletes on zero, so a message nobody can confirm carries its files is removed rather than left
 * looking complete. Stated as its own function because the previous inline expression made that decision
 * invisible.
 *
 * @param message the normalised read-back, or `undefined` when no read found it
 * @returns the file count, and 0 when the message could not be read at all
 */
export function fileCountOf({ message }: { message: ReadSlackMessage | undefined }): number {
  if (message === undefined) {
    return 0;
  }
  return message.fileIds.length;
}

/**
 * Read the message back and count its files. The only real proof media attached.
 *
 * Delegates to {@link readMessageCall} instead of reading history itself. `conversations.history` does not
 * return thread replies, so a threaded card's file count was ALWAYS zero and the guard deleted a message
 * whose upload had in fact attached — `--media` with `slack reply --thread-ts` could not succeed. That
 * fallback, and the exact-ts match that stops a neighbouring message being counted, already live in
 * `readMessageCall` and `pickReadMessage`; a second, thread-blind read here only diverged from them.
 *
 * @param client the repeatable-call write client
 * @param posted the message's identity
 * @param scopeId the shared-429-block key for this token
 * @returns the message's file count, and 0 when it could not be read at all
 */
export async function readBackFileCountCall({
  client,
  posted,
  scopeId,
}: {
  client: WebClient;
  posted: PostedMessage;
  scopeId: string;
}): Promise<number> {
  return fileCountOf({ message: await readMessageCall({ client, posted, scopeId }) });
}

/** The `metadata` fields off a raw history message, structurally narrowed. Pure. */
function metadataOf({ message }: { message: unknown }): {
  eventType?: string;
  renderer?: string;
  runId?: string;
  askIdentity?: unknown;
  turnId?: string;
  pollId?: string;
} {
  const metadata = isRecord(message) ? message["metadata"] : undefined;
  if (!isRecord(metadata)) {
    return {};
  }
  const payload = isRecord(metadata["event_payload"]) ? metadata["event_payload"] : {};
  return {
    // Carried as `unknown` and validated by whoever needs it. An answer card records WHICH ask it answers,
    // and an EDIT of one must reuse that identity rather than mint a fresh one: the message is still the
    // answer to the same question, and a re-render that invented a new identity would detach it from the
    // ask ledger that records what has been answered.
    ...(payload["askIdentity"] === undefined ? {} : { askIdentity: payload["askIdentity"] }),
    ...optionalField({ key: "eventType", value: metadata["event_type"] }),
    ...optionalField({ key: "renderer", value: payload["renderer"] }),
    ...optionalField({ key: "runId", value: payload["runId"] }),
    // The same inheritance for a turn checklist and a poll: an edit re-renders under the id the message carries.
    ...optionalField({ key: "turnId", value: payload["turnId"] }),
    ...optionalField({ key: "pollId", value: payload["pollId"] }),
  };
}

/** A conditional-spread optional string field off an unknown value. Pure. */
function optionalField({ key, value }: { key: string; value: unknown }): Record<string, string> {
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

/**
 * The sentinel an `edited` block that cannot be read is reported as.
 *
 * Deliberately not a timestamp: `slackTsToEpochMs` cannot place it, and every caller of `editedAtOrAfter`
 * already treats an unplaceable edit as one that HAPPENED. So an unreadable field refuses a delete instead
 * of being indistinguishable from a message nobody ever touched.
 */
const EDITED_UNREADABLE = "unreadable";

/**
 * `edited.ts`, where "present but unreadable" is reported rather than dropped.
 *
 * {@link optionalField} keeps a non-empty string and discards everything else, which is right for an id and
 * WRONG here: this is the one field whose absence a caller reads as a positive claim — "this message was
 * never edited" — so silently dropping `edited: { ts: 1790056013 }`, a number instead of a string, turns a
 * message somebody repaired into one that looks untouched. A review executed exactly that
 * against the real wiring and deleted the edited answer. Slack documents `ts` as a string; this is what
 * happens when it is not one.
 *
 * @param message the whole raw message, because the KEY's presence is the question rather than its value
 * @returns the `editedTs` fragment to spread, empty only when the message carries no `edited` key at all
 */
function editedTsField({ message }: { message: Record<string, unknown> }): Record<string, string> {
  // ABSENCE of the KEY is the only thing that reports "never edited", and both halves of that are load
  // bearing. Anything present this code cannot read — an array, a string, a null, a missing or non-string
  // `ts` — is a message announcing it was rewritten in a shape we do not understand, which is not the same
  // fact at all; `edited: [{ ts: "…" }]` walked straight through an `isRecord` test that answered "no edit"
  // to everything else. And the key is tested with `in` rather than against `undefined` so that the one
  // value a JSON response can never carry cannot be the hole either.
  if (!("edited" in message)) {
    return {};
  }
  const edited = message["edited"];
  if (isRecord(edited)) {
    const ts = edited["ts"];
    if (typeof ts === "string" && ts.length > 0) {
      return { editedTs: ts };
    }
  }
  return { editedTs: EDITED_UNREADABLE };
}

/**
 * Normalise ONE raw Slack message into the ownership-check shape, but only if its `ts` is the one asked for.
 *
 * The ts comparison is the safety property and it is why this is a function rather than an inline branch: a
 * history read anchored at a `ts` returns the NEAREST message when that exact one is gone, so a caller that
 * trusted the response would read back a NEIGHBOUR's ownership and go on to delete the wrong thing.
 *
 * @param candidates the raw messages a Slack read returned, in any order
 * @param ts the exact timestamp the caller asked for
 * @returns the normalised message, or `undefined` when no candidate carries that exact `ts`
 */
export function pickReadMessage({
  candidates,
  ts,
}: {
  candidates: readonly unknown[];
  ts: string;
}): ReadSlackMessage | undefined {
  const found = candidates.find((entry) => isRecord(entry) && optStr({ value: entry["ts"] }) === ts);
  if (!isRecord(found)) {
    return undefined;
  }
  const meta = metadataOf({ message: found });
  const files = Array.isArray(found["files"]) ? found["files"] : [];
  return {
    fileIds: files.flatMap((file) => {
      const id = isRecord(file) ? optStr({ value: file["id"] }) : undefined;
      return id === undefined ? [] : [id];
    }),
    imageFileIds: files.flatMap((file) => {
      const id = isRecord(file) ? optStr({ value: file["id"] }) : undefined;
      const mimetype = isRecord(file) ? optStr({ value: file["mimetype"] }) : undefined;
      return id !== undefined && mimetype?.startsWith("image/") === true ? [id] : [];
    }),
    ts,
    // Carried rather than dropped so the send path can check how Slack PARSED what it posted. This
    // normaliser used to keep only the ownership fields, which is why the as-me lane could publish a
    // mention that rendered as plain text and never know.
    ...(Array.isArray(found["blocks"]) ? { blocks: found["blocks"] } : {}),
    // The rest of the stored content, for `slack correct`'s in-place strike (`outbound/slack/claimCorrection.ts`).
    stored: {
      ...(typeof found["text"] === "string" ? { text: found["text"] } : {}),
      ...(Array.isArray(found["attachments"]) ? { attachments: found["attachments"] } : {}),
      ...(isRecord(found["metadata"]) ? { metadata: found["metadata"] } : {}),
    },
    ...optionalField({ key: "botId", value: found["bot_id"] }),
    ...optionalField({ key: "userId", value: found["user"] }),
    // Slack's OWN account of where this message hangs and whether it has been rewritten since it was
    // posted. Both are observations rather than assertions, which is the whole reason a supersession
    // decision reads them instead of trusting a local record — see `ReadSlackMessage`'s own fields.
    ...optionalField({ key: "threadTs", value: found["thread_ts"] }),
    ...editedTsField({ message: found }),
    ...(meta.eventType !== undefined ? { metadataEventType: meta.eventType } : {}),
    ...(meta.renderer !== undefined ? { renderer: meta.renderer } : {}),
    ...(meta.askIdentity === undefined ? {} : { askIdentity: meta.askIdentity }),
    ...(meta.turnId === undefined ? {} : { turnId: meta.turnId }),
    ...(meta.pollId === undefined ? {} : { pollId: meta.pollId }),
  };
}

/**
 * Read ONE message back, normalised for the ownership check — from history, else from its thread.
 *
 * The second read is not a retry, it is a DIFFERENT question. `conversations.history` does not return thread
 * replies at all, so every message posted inside a thread was invisible here: `slack delete` refused with
 * "no message at <ts>" on a message that was plainly there, and nothing could clean up a threaded progress
 * message. Measured live.
 *
 * `conversations.replies` anchored at a reply's OWN ts returns just that message, so it needs no thread id
 * from the caller — which is what makes this a drop-in fallback rather than a new CLI flag.
 *
 * @param client the repeatable-call write client
 * @param posted the message's identity
 * @param scopeId the shared-429-block key for this token
 * @returns the normalised message, or `undefined` when neither read found it
 */
export async function readMessageCall({
  client,
  posted,
  scopeId,
}: {
  client: WebClient;
  posted: PostedMessage;
  scopeId: string;
}): Promise<ReadSlackMessage | undefined> {
  const history = orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.conversations.history({
          channel: posted.channel,
          include_all_metadata: true,
          inclusive: true,
          latest: posted.ts,
          limit: 1,
        }),
      operation: "slack.conversations.history",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const fromHistory = pickReadMessage({
    candidates: Array.isArray(history.messages) ? history.messages : [],
    ts: posted.ts,
  });
  if (fromHistory !== undefined) {
    return fromHistory;
  }
  const replies = await safeProviderCall({
    execute: () =>
      client.conversations.replies({
        channel: posted.channel,
        include_all_metadata: true,
        inclusive: true,
        limit: 1,
        ts: posted.ts,
      }),
    operation: "slack.conversations.replies",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  // History has already missed, so a replies read answering "no thread at that ts" is the second read agreeing the
  // message is not there — a deleted top-level message answers exactly this, and reading it as a failed read left
  // `slack delete` unable to say the message was gone. MEASURED:
  // `slopweaver slack delete --channel C0SYN000001 --ts 1791764888.080129 --dry-run` printed "the read-message read
  // failed: An API error occurred: thread_not_found" for a message deleted earlier.
  if (replies.isErr() && isThreadNotFound({ error: replies.error })) {
    return undefined;
  }
  const thread = orThrow({ result: replies });
  return pickReadMessage({
    candidates: Array.isArray(thread.messages) ? thread.messages : [],
    ts: posted.ts,
  });
}

/**
 * `auth.test` — who this token is.
 *
 * @param client the repeatable-call write client
 * @param scopeId the shared-429-block key for this token
 * @returns this token's own bot/user/team identity
 */
export async function whoAmICall({
  client,
  scopeId,
}: {
  client: WebClient;
  scopeId: string;
}): Promise<SlackSelfIdentity> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.auth.test(),
      operation: "slack.auth.test",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  return {
    ...optionalField({ key: "botId", value: res.bot_id }),
    ...optionalField({ key: "userId", value: res.user_id }),
    ...optionalField({ key: "teamId", value: res.team_id }),
    ...optionalField({ key: "workspaceUrl", value: res.url }),
  };
}
