/**
 * The reads an investigation asks Knock: does the key work, which notifications went out (environment-wide or to
 * one user), what one message is, and what happened to it — its events and the provider calls Knock made.
 *
 * Every read goes through an injected {@link KnockGet}, so the paging, the bounds and every refusal are testable
 * with canned bodies and no network. Nothing is written anywhere: a read answers views, and the verb prints them.
 * How a list pages, and the two bounds on it, is `./paging.ts`.
 */
import { boundaryRefusalWords } from "#lib/boundaryWords.js";

import { err, ok, type Result } from "../../lib/result.js";
import {
  GET_KNOCK_MESSAGE,
  type KnockDeliveryLogWire,
  type KnockMessageEventWire,
  type KnockMessageWire,
  LIST_KNOCK_DELIVERY_LOGS,
  LIST_KNOCK_MESSAGE_EVENTS,
  LIST_KNOCK_MESSAGES,
  LIST_KNOCK_USER_MESSAGES,
} from "./boundaries.js";
import { type KnockReadError, KnockReadErrors } from "./errors.js";
import { type KnockList, readPaged } from "./paging.js";
import {
  type KnockDeliveryLogView,
  type KnockEventView,
  type KnockMessageView,
  projectKnockDeliveryLog,
  projectKnockEvent,
  projectKnockMessage,
} from "./projection.js";
import { buildKnockUrl, type KnockGet, type KnockOperation, type KnockQueryKey } from "./transport.js";

/** What a message list filters on — the investigation filters Knock's list declares. */
export interface KnockMessageFilter {
  readonly channelId: string | null;
  /** Repeated as `status=…&status=…`, never `status[]`. Empty for no status filter. */
  readonly statuses: readonly string[];
  readonly source: string | null;
  readonly tenant: string | null;
  readonly workflowRunId: string | null;
  readonly workflowRecipientRunId: string | null;
  /** `inserted_at.gte` — inclusive. */
  readonly insertedAfter: string | null;
  /** `inserted_at.lte` — inclusive. */
  readonly insertedBefore: string | null;
}

/**
 * The query pairs a filter becomes.
 *
 * @param filter what the caller narrowed by
 * @returns the pairs, absent filters omitted, statuses repeated
 */
function filterPairs({ filter }: { filter: KnockMessageFilter }): (readonly [KnockQueryKey, string])[] {
  const pairs: (readonly [KnockQueryKey, string])[] = [];
  const single: readonly (readonly [KnockQueryKey, string | null])[] = [
    ["channel_id", filter.channelId],
    ["source", filter.source],
    ["tenant", filter.tenant],
    ["workflow_run_id", filter.workflowRunId],
    ["workflow_recipient_run_id", filter.workflowRecipientRunId],
    ["inserted_at.gte", filter.insertedAfter],
    ["inserted_at.lte", filter.insertedBefore],
  ];
  for (const [key, value] of single) {
    if (value !== null) {
      pairs.push([key, value]);
    }
  }
  for (const status of filter.statuses) {
    pairs.push(["status", status]);
  }
  return pairs;
}

/** What `knock verify` proved beyond the key working — never a record, an id or a cursor. */
export interface KnockAccessVerification {
  /**
   * `exercised` when the first message a list returned was read through the strict boundary; `unexercised` when the
   * environment returned none, so no item shape was tested at all.
   */
  readonly messageShape: "exercised" | "unexercised";
}

/**
 * Read exactly ONE `GET /v1/messages` page through the strict boundary, never following its cursor, and keep only
 * how many items it held — no wire message or projection leaves this function.
 *
 * @param get the read seam
 * @param query the page's query pairs
 * @returns the page's item count, or why it could not be read
 */
async function readVerificationPage({
  get,
  query,
}: {
  get: KnockGet;
  query: readonly (readonly [KnockQueryKey, string])[];
}): Promise<Result<number, KnockReadError>> {
  const operation: KnockOperation = "knock.messages.list";
  const url = buildKnockUrl({ request: { messageId: null, operation, query, userId: null } });
  if (url.isErr()) {
    return err(url.error);
  }
  const text = await get({ operation, url: url.value });
  if (text.isErr()) {
    return err(text.error);
  }
  const page = LIST_KNOCK_MESSAGES.parseJson({ text: text.value });
  if (page.isErr()) {
    return err(
      KnockReadErrors.responseRefused({
        endpoint: LIST_KNOCK_MESSAGES.endpoint,
        why: boundaryRefusalWords({ refusal: page.error }),
      }),
    );
  }
  return ok(page.value.items.length);
}

/**
 * Prove the key reads messages, and that this door can still read one. Two pages of size one, in order: the first
 * asks for messages inserted after a far-future instant, so a working key is shown with a read designed to fetch
 * nothing; the second asks with no filter, so the first message Knock returns is parsed through the strict list
 * boundary. That second read is the point: a key check alone passed while every real list body was
 * refused for two keys Knock had added. The message read is held in memory and dropped — only its count leaves.
 *
 * @param get the read seam
 * @returns whether a message's shape was exercised, or why either read failed
 */
export async function verifyKnockAccess({
  get,
}: {
  get: KnockGet;
}): Promise<Result<KnockAccessVerification, KnockReadError>> {
  const access = await readVerificationPage({
    get,
    query: [
      ["inserted_at.gte", "2999-01-01T00:00:00Z"],
      ["page_size", "1"],
    ],
  });
  if (access.isErr()) {
    return err(access.error);
  }
  const shape = await readVerificationPage({ get, query: [["page_size", "1"]] });
  if (shape.isErr()) {
    return err(shape.error);
  }
  return ok({ messageShape: shape.value === 0 ? "unexercised" : "exercised" });
}

/**
 * List the environment's messages matching a filter, newest first as Knock orders them.
 *
 * @param get the read seam
 * @param filter what to narrow by
 * @param limit the most messages to return
 * @returns the views and whether more remain, or why the read stopped
 */
export async function listKnockMessages({
  get,
  filter,
  limit,
}: {
  get: KnockGet;
  filter: KnockMessageFilter;
  limit: number;
}): Promise<Result<KnockList<KnockMessageView>, KnockReadError>> {
  return readPaged<KnockMessageWire, KnockMessageView>({
    limit,
    project: (message) => projectKnockMessage({ message }),
    read: {
      boundary: LIST_KNOCK_MESSAGES,
      get,
      ids: { messageId: null, userId: null },
      operation: "knock.messages.list",
      pairs: filterPairs({ filter }),
    },
  });
}

/**
 * List one Knock user's messages matching a filter — where an investigation that starts from one user begins.
 *
 * @param get the read seam
 * @param userId the application's own user id, as Knock was told it; sent, never printed
 * @param filter what to narrow by
 * @param limit the most messages to return
 * @returns the views and whether more remain, or why the read stopped
 */
export async function listKnockUserMessages({
  get,
  userId,
  filter,
  limit,
}: {
  get: KnockGet;
  userId: string;
  filter: KnockMessageFilter;
  limit: number;
}): Promise<Result<KnockList<KnockMessageView>, KnockReadError>> {
  return readPaged<KnockMessageWire, KnockMessageView>({
    limit,
    project: (message) => projectKnockMessage({ message }),
    read: {
      boundary: LIST_KNOCK_USER_MESSAGES,
      get,
      ids: { messageId: null, userId },
      operation: "knock.users.messages.list",
      pairs: filterPairs({ filter }),
    },
  });
}

/**
 * Read one message.
 *
 * @param get the read seam
 * @param messageId Knock's message id
 * @returns the view, or why it could not be read
 */
export async function readKnockMessage({
  get,
  messageId,
}: {
  get: KnockGet;
  messageId: string;
}): Promise<Result<KnockMessageView, KnockReadError>> {
  const operation: KnockOperation = "knock.message.read";
  const url = buildKnockUrl({ request: { messageId, operation, query: [], userId: null } });
  if (url.isErr()) {
    return err(url.error);
  }
  const text = await get({ operation, url: url.value });
  if (text.isErr()) {
    return err(text.error);
  }
  const message = GET_KNOCK_MESSAGE.parseJson({ text: text.value });
  if (message.isErr()) {
    return err(
      KnockReadErrors.responseRefused({
        endpoint: GET_KNOCK_MESSAGE.endpoint,
        why: boundaryRefusalWords({ refusal: message.error }),
      }),
    );
  }
  return ok(projectKnockMessage({ message: message.value }));
}

/**
 * List one message's events — queued, sent, delivered, undelivered, bounced.
 *
 * @param get the read seam
 * @param messageId Knock's message id
 * @param limit the most events to return
 * @returns the views and whether more remain, or why the read stopped
 */
export async function listKnockMessageEvents({
  get,
  messageId,
  limit,
}: {
  get: KnockGet;
  messageId: string;
  limit: number;
}): Promise<Result<KnockList<KnockEventView>, KnockReadError>> {
  return readPaged<KnockMessageEventWire, KnockEventView>({
    limit,
    project: (event) => projectKnockEvent({ event }),
    read: {
      boundary: LIST_KNOCK_MESSAGE_EVENTS,
      get,
      ids: { messageId, userId: null },
      operation: "knock.message.events.list",
      pairs: [],
    },
  });
}

/**
 * List one message's delivery logs — each call Knock made to the provider, and the status it answered.
 *
 * @param get the read seam
 * @param messageId Knock's message id
 * @param limit the most logs to return
 * @returns the views and whether more remain, or why the read stopped
 */
export async function listKnockDeliveryLogs({
  get,
  messageId,
  limit,
}: {
  get: KnockGet;
  messageId: string;
  limit: number;
}): Promise<Result<KnockList<KnockDeliveryLogView>, KnockReadError>> {
  return readPaged<KnockDeliveryLogWire, KnockDeliveryLogView>({
    limit,
    project: (log) => projectKnockDeliveryLog({ log }),
    read: {
      boundary: LIST_KNOCK_DELIVERY_LOGS,
      get,
      ids: { messageId, userId: null },
      operation: "knock.message.deliveryLogs.list",
      pairs: [],
    },
  });
}
