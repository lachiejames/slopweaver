/**
 * `gmail measure` — how big is this mailbox, how far back does it go, and roughly how many bytes is it.
 *
 * ## Why a verb rather than a note in the refresh output
 *
 * A full-history backfill of a mailbox is the one crawl in this repository whose cost the operator cannot
 * guess. Every other source is bounded by a window the operator chose; `refresh --source gmail --all` is bounded by
 * how much mail a person has ever received, and the honest answer to "how long will that take" is one
 * `messages.get` per message. So the size is established BEFORE the pull, by a read that walks ids only,
 * and is reported in the three units the decision actually turns on: how many messages, how far back, and
 * how many bytes.
 *
 * ## What each of the three numbers is, and what it is not
 *
 * - **The count is EXACT and it is a count of what a crawl would read**, not Gmail's `resultSizeEstimate`.
 *   It is obtained by walking `messages.list` to its last cursor, which costs one call per hundred
 *   messages and nothing per message. Gmail's own `messagesTotal` is reported beside it and is a DIFFERENT
 *   number — it counts Spam and Trash, which a listing does not — so both appear rather than one being
 *   quietly preferred.
 * - **The oldest and newest dates are exact**, read from the last and first ids the walk returned. Gmail
 *   returns `messages.list` newest-first, so the tail of the walk IS the oldest message; nothing here
 *   sorts, and nothing here guesses from a header.
 * - **The byte figure is an ESTIMATE and says so in every rendering.** Reading `sizeEstimate` for every
 *   message would cost exactly the fetch the measurement exists to price, so a bounded, evenly-spread
 *   sample is read and multiplied by the exact count. The sample size travels with the number, because a
 *   projected total whose sample size is invisible is the `probeScopeDetail` failure in a new place.
 *
 * Effectful only through the injected {@link GmailApi}, so every shaping decision is exercised against
 * plain object fakes.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import type { GmailApi } from "./api.js";
import type { GmailError } from "./errors.js";
import { type GmailMessage, sentAtIso } from "./parse.js";

/** How many message ids one `messages.list` page asks for. Gmail's own maximum. */
const MEASURE_PAGE_SIZE = 100;

/**
 * The hard ceiling on `messages.list` pages one measurement walks.
 *
 * Deliberately the same shape of bound as the crawl's own, and deliberately its own constant: a
 * measurement walks ids and a crawl reads bodies, so the two have different costs per page and no reason
 * to move together. At {@link MEASURE_PAGE_SIZE} ids a page this covers a million-message mailbox, and a
 * walk that reaches it reports itself INCOMPLETE rather than presenting a partial count as a total.
 */
export const MEASURE_MAX_PAGES = 10_000;

/** How many messages are sampled for their byte size when the caller names no other number. */
export const DEFAULT_BYTE_SAMPLE = 40;

/** The largest byte sample this verb will take — the bound that keeps a measurement cheap. */
export const MAX_BYTE_SAMPLE = 500;

/** What one measurement establishes about a mailbox. */
export interface GmailMailboxMeasurement {
  /** The mailbox the grant bound to. */
  readonly account: string;
  /** The Gmail search expression the measurement was bounded by, when the caller named one. */
  readonly query: string | undefined;
  /** How many messages the listing walk actually enumerated. Exact, unless {@link complete} is false. */
  readonly messagesCounted: number;
  /** Gmail's own `messagesTotal`, which counts Spam and Trash a listing never returns. */
  readonly messagesTotalReported: number | undefined;
  /** Whether the walk reached Gmail's last cursor rather than this module's page ceiling. */
  readonly complete: boolean;
  /** The send time of the OLDEST message the walk saw, absent when the mailbox is empty. */
  readonly oldestSentAtIso: string | undefined;
  /** The send time of the NEWEST message the walk saw, absent when the mailbox is empty. */
  readonly newestSentAtIso: string | undefined;
  /** How many messages were read for their size. */
  readonly bytesSampled: number;
  /** The mean `sizeEstimate` across the sample, rounded, absent when nothing could be sampled. */
  readonly meanMessageBytes: number | undefined;
  /** {@link meanMessageBytes} × {@link messagesCounted}. An ESTIMATE, and named as one everywhere. */
  readonly estimatedBytes: number | undefined;
  /** How many `messages.list` calls the walk cost — the price of the measurement itself. */
  readonly listCalls: number;
}

/** A measurement read: the shared document AND the typed payload, so a caller never re-narrows `data`. */
export interface GmailMeasureResult {
  readonly document: ProviderReadDocument;
  readonly measurement: GmailMailboxMeasurement;
}

/**
 * Clamp a requested byte sample into the range this verb will actually take. Pure.
 *
 * @param requested the caller's `--sample-bytes`, when they named one
 * @returns the sample size to use
 */
export function boundedByteSample({ requested }: { requested: number | undefined }): number {
  if (requested === undefined) {
    return DEFAULT_BYTE_SAMPLE;
  }
  return Math.max(0, Math.min(MAX_BYTE_SAMPLE, Math.trunc(requested)));
}

/**
 * Pick an EVENLY SPREAD subset of ids, rather than the first N.
 *
 * The ids arrive newest-first, so the first N are the most recent N — and a mailbox's recent mail is not
 * representative of its whole history (a run of newsletters, a week of calendar invites). Striding across
 * the whole list costs the same number of fetches and samples the same span the estimate is projected over.
 * Pure.
 *
 * @param ids every id the walk enumerated, newest-first
 * @param sampleSize how many to take
 * @returns the sampled ids, in the order they appear in `ids`
 */
export function spreadSample({ ids, sampleSize }: { ids: readonly string[]; sampleSize: number }): readonly string[] {
  if (sampleSize <= 0 || ids.length === 0) {
    return [];
  }
  if (sampleSize >= ids.length) {
    return ids;
  }
  const stride = ids.length / sampleSize;
  const picked: string[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    picked.push(ids[Math.floor(index * stride)]!);
  }
  return picked;
}

/**
 * The residue lines a measurement carries — every claim it did NOT establish.
 *
 * @param measurement the completed measurement
 * @returns the residue lines, in reading order
 */
export function measurementResidue({ measurement }: { measurement: GmailMailboxMeasurement }): readonly string[] {
  const lines: string[] = [];
  if (!measurement.complete) {
    lines.push(
      `the listing walk stopped at its ${String(MEASURE_MAX_PAGES)}-page ceiling, so the count is a FLOOR ` +
        "rather than a total and the oldest date is the oldest message it reached, not the oldest in the mailbox",
    );
  }
  lines.push(
    measurement.estimatedBytes === undefined
      ? "no message could be read for its size, so no byte estimate was projected"
      : `the byte figure is an ESTIMATE — the mean of ${String(measurement.bytesSampled)} sampled message(s) ` +
          `multiplied by the ${String(measurement.messagesCounted)} counted, not a sum of every message`,
  );
  if (measurement.messagesTotalReported !== undefined) {
    lines.push(
      `Gmail's own messagesTotal is ${String(measurement.messagesTotalReported)}, which counts Spam and Trash ` +
        "that a listing never returns — the two numbers answer different questions and neither is wrong",
    );
  }
  lines.push("a measurement reads no bodies and no attachments; it establishes size and span, never content");
  return lines;
}

/** Walk `messages.list` to the end, gathering ids only. */
async function walkAllIds({
  api,
  query,
}: {
  api: GmailApi;
  query: string | undefined;
}): Promise<Result<{ ids: readonly string[]; complete: boolean; listCalls: number }, GmailError>> {
  const ids: string[] = [];
  let pageToken: string | undefined = undefined;
  for (let page = 0; page < MEASURE_MAX_PAGES; page += 1) {
    const listed = await api.listMessageIds({ labelIds: [], limit: MEASURE_PAGE_SIZE, pageToken, query });
    if (listed.isErr()) {
      return err(listed.error);
    }
    ids.push(...listed.value.ids);
    pageToken = listed.value.nextPageToken;
    if (pageToken === undefined) {
      return ok({ complete: true, ids, listCalls: page + 1 });
    }
  }
  return ok({ complete: false, ids, listCalls: MEASURE_MAX_PAGES });
}

/**
 * The send time of one message id, or undefined when it could not be read.
 *
 * A measurement tolerates a message it cannot read: the span is a nice-to-have next to the count, and
 * failing the whole measurement over one unreadable message would make the verb less reliable than the
 * crawl it is pricing.
 */
async function sentAtOf({ api, id }: { api: GmailApi; id: string }): Promise<string | undefined> {
  const fetched = await api.getMessage({ format: "metadata", id });
  return fetched.isOk() ? sentAtIso({ internalDate: fetched.value.internalDate }) : undefined;
}

/** The mean `sizeEstimate` across a sample, and how many of the sample actually reported one. */
async function sampleBytes({
  api,
  ids,
}: {
  api: GmailApi;
  ids: readonly string[];
}): Promise<{ sampled: number; mean: number | undefined }> {
  let total = 0;
  let sampled = 0;
  for (const id of ids) {
    const fetched = await api.getMessage({ format: "metadata", id });
    if (fetched.isErr()) {
      continue;
    }
    const size = sizeEstimateOf({ message: fetched.value });
    if (size === undefined) {
      continue;
    }
    total += size;
    sampled += 1;
  }
  return { mean: sampled === 0 ? undefined : Math.round(total / sampled), sampled };
}

/**
 * Gmail's own byte estimate for one message, when it reported one.
 *
 * @param message the message as the API returned it
 * @returns the size in bytes, or undefined when the field was absent
 */
export function sizeEstimateOf({ message }: { message: GmailMessage }): number | undefined {
  return typeof message.sizeEstimate === "number" ? message.sizeEstimate : undefined;
}

/**
 * Measure a mailbox: walk every id, date the two ends, and project a byte total from a bounded sample.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param nowIso the injected clock
 * @param query a Gmail search expression to measure within, when the caller bounded it
 * @param byteSample how many messages to read for their size
 * @returns the measurement and its document, or the failure that stopped the walk
 */
export async function measureGmailMailbox({
  api,
  account,
  nowIso,
  query,
  byteSample,
}: {
  api: GmailApi;
  account: string;
  nowIso: () => string;
  query: string | undefined;
  byteSample: number;
}): Promise<Result<GmailMeasureResult, GmailError>> {
  const profile = await api.getProfile();
  const walked = await walkAllIds({ api, query });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const { ids, complete, listCalls } = walked.value;
  const newest = ids[0];
  const oldest = ids[ids.length - 1];
  const bytes = await sampleBytes({ api, ids: spreadSample({ ids, sampleSize: byteSample }) });
  const measurement: GmailMailboxMeasurement = {
    account,
    bytesSampled: bytes.sampled,
    complete,
    estimatedBytes: bytes.mean === undefined ? undefined : bytes.mean * ids.length,
    listCalls,
    meanMessageBytes: bytes.mean,
    messagesCounted: ids.length,
    messagesTotalReported: profile.isOk() ? profile.value.messagesTotal : undefined,
    newestSentAtIso: newest === undefined ? undefined : await sentAtOf({ api, id: newest }),
    oldestSentAtIso: oldest === undefined ? undefined : await sentAtOf({ api, id: oldest }),
    query,
  };
  return ok({
    document: {
      coverage: {
        detail:
          `${String(measurement.messagesCounted)} message(s) enumerated in ${String(listCalls)} listing call(s); ` +
          `${String(measurement.bytesSampled)} read for size`,
        kind: "bounded",
        residue: measurementResidue({ measurement }),
      },
      data: measurement,
      readAtIso: nowIso(),
      source: "gmail",
      target: { address: account, identity: account, kind: "mailbox" },
    },
    measurement,
  });
}
