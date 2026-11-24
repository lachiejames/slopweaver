/**
 * `chatgpt live-sync`'s listing and reading legs, run under the verb's lock (`liveSyncRun.ts`): list what moved since
 * the carried walk (`liveSyncCarry.ts`), or the whole account, lay it over the carry, then read whole each chat the
 * plan (`liveSyncPlan.ts`) names, newest first (`liveSyncRead.ts`).
 *
 * The one retry anywhere in the run lives here: a LISTING page answered with a 5xx Cloudflare did not mark a
 * challenge, three times after a growing wait ({@link LISTING_BACKOFF_MS}), because a gateway timeout there cost a
 * whole listing's requests to repeat. Every other refusal stops the run.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import type { ChatgptSnapshotError } from "../../../corpus/chatgpt/liveSnapshotStore.errors.js";
import type { LiveSnapshotManifest } from "../../../corpus/chatgpt/liveSnapshotStore.js";
import type { ChatgptError } from "./errors.js";
import type { ChatgptInventory, ListingPage, listChatgptInventory } from "./listing.js";
import {
  carryBoundaryIso,
  type ListingCarry,
  mergeListing,
  readListingCarry,
  writeListingCarry,
} from "./liveSyncCarry.js";
import { planLiveSync } from "./liveSyncPlan.js";
import { readPlannedConversations } from "./liveSyncRead.js";
import type { ChatgptPacer } from "./pacer.js";

/** The edges the listing and reading legs read through. */
export interface LiveSyncFetchDeps {
  readonly pacer: ChatgptPacer;
  readonly nowIso: () => string;
  /** The account listing walk — `listChatgptInventory` in production. */
  readonly listInventory: typeof listChatgptInventory;
  /** Waits before a listing page's retry after a 5xx — a timer in production. */
  readonly backoff: (args: { ms: number }) => Promise<void>;
  /** The owner's protect list each snapshot write is judged against — the home's own registry when absent. */
  readonly protection?: OwnerProtectionResolver | undefined;
}

/** The options the listing and reading legs take. */
export interface LiveSyncFetchOptions {
  readonly maxPages: number;
  /** The most chats to read this run; `undefined` reads every one the plan names. */
  readonly maxConversations: number | undefined;
  /** List the whole account again, ignoring the listing the last walk carried. */
  readonly relist: boolean;
}

/** What the listing and reading legs did, before the refresh leg. */
export interface FetchLegOutcome {
  readonly inventory: ChatgptInventory | undefined;
  /** The listing's GETs this run, retries included; 0 when none was made. */
  readonly listingRequests: number;
  /** The instant a carried listing let the walk stop at, `undefined` when the whole account was listed. */
  readonly listedSinceIso: string | undefined;
  /** Where a stopped listing was, `undefined` when it did not stop. */
  readonly listingStoppedAt: ListingPage | undefined;
  readonly planned: number;
  readonly current: number;
  /** Planned chats ChatGPT answered "not found" for: deleted on the account, so dropped from the carry. */
  readonly gone: number;
  readonly read: number;
  readonly behind: number;
  readonly stoppedBy: ChatgptError | ChatgptSnapshotError | undefined;
}

/**
 * The waits before each retry of a listing page ChatGPT answered with a 5xx: 30, 60 then 120 seconds. A choice, in the
 * way of the pacer's floor: a server error is the backend struggling, so the next ask comes later than the pace alone.
 */
const LISTING_BACKOFF_MS: readonly number[] = [30_000, 60_000, 120_000];

/** What the listing leg hands the reading leg. */
type ListingLegOutcome = Pick<FetchLegOutcome, "listedSinceIso" | "listingRequests" | "listingStoppedAt"> & {
  readonly result: Result<ChatgptInventory, ChatgptError>;
  /** What was written for the next run, `undefined` when the walk did not complete. */
  readonly written: ListingCarry | undefined;
};

/**
 * One listing walk, back to `knownThroughIso` when a carry gives one, remembering the last page it asked for so a
 * stop can say where it was.
 *
 * @returns the walk's answer and the last page asked, `undefined` when it asked none
 */
async function walkListing({
  deps,
  fetchText,
  knownThroughIso,
  maxPages,
}: {
  deps: LiveSyncFetchDeps;
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
  knownThroughIso: string | undefined;
  maxPages: number;
}): Promise<{ readonly walked: Result<ChatgptInventory, ChatgptError>; readonly lastPage: ListingPage | undefined }> {
  let lastPage: ListingPage | undefined;
  const walked = await deps.listInventory({
    deps: {
      backoff: ({ attempt }) =>
        deps.backoff({ ms: LISTING_BACKOFF_MS[Math.min(attempt, LISTING_BACKOFF_MS.length - 1)]! }),
      fetchText,
      onPage: (page) => {
        lastPage = page;
      },
      pacer: deps.pacer,
    },
    knownThroughIso,
    maxPages,
  });
  return { lastPage, walked };
}

/**
 * Lay a completed walk over the carry it was bounded by, and hold the result for the next run.
 *
 * @param carry what the last completed walk left, if anything
 * @param listedSinceIso the boundary the walk stopped at, `undefined` when it listed the whole account
 * @param walked what this walk listed
 * @returns the merged inventory and the carry written, or why the carry could not be written
 */
function carryWalk({
  carry,
  listedSinceIso,
  listStartedIso,
  root,
  walked,
}: {
  carry: ListingCarry | undefined;
  listedSinceIso: string | undefined;
  listStartedIso: string;
  root: string;
  walked: ChatgptInventory;
}): Result<{ readonly inventory: ChatgptInventory; readonly written: ListingCarry }, ChatgptError> {
  const carried = listedSinceIso === undefined || carry === undefined ? [] : carry.conversations;
  const merged = mergeListing({ carried, fresh: walked.conversations });
  // A carried walk keeps the last whole walk's instant, so the carry's age runs from it and the carry does expire.
  const wholeWalkStartedIso =
    listedSinceIso === undefined || carry === undefined ? listStartedIso : carry.wholeWalkStartedIso;
  const written: ListingCarry = { conversations: merged, walkStartedIso: listStartedIso, wholeWalkStartedIso };
  return writeListingCarry({ carry: written, root }).map(() => ({
    inventory: { ...walked, conversations: merged },
    written,
  }));
}

/**
 * The listing leg: list what moved since the carried walk (or the whole account), lay it over the carry, and hold the
 * result for the next run. The carry is written only once the walk completed, so a stopped walk leaves the last one.
 */
async function listingLeg({
  deps,
  fetchText,
  options,
  root,
  listStartedIso,
}: {
  deps: LiveSyncFetchDeps;
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
  options: LiveSyncFetchOptions;
  root: string;
  listStartedIso: string;
}): Promise<ListingLegOutcome> {
  const carry = options.relist ? ok(undefined) : readListingCarry({ root });
  if (carry.isErr()) {
    const ended = { listedSinceIso: undefined, listingRequests: 0, listingStoppedAt: undefined };
    return { ...ended, result: err(carry.error), written: undefined };
  }
  const listedSinceIso = carryBoundaryIso({ carry: carry.value, nowIso: listStartedIso, relist: options.relist });
  const { walked, lastPage } = await walkListing({
    deps,
    fetchText,
    knownThroughIso: listedSinceIso,
    maxPages: options.maxPages,
  });
  if (walked.isErr()) {
    return {
      listedSinceIso,
      listingRequests: 0,
      listingStoppedAt: lastPage,
      result: err(walked.error),
      written: undefined,
    };
  }
  const listingRequests = walked.value.requests;
  const held = carryWalk({ carry: carry.value, listedSinceIso, listStartedIso, root, walked: walked.value });
  if (held.isErr()) {
    return {
      listedSinceIso,
      listingRequests,
      listingStoppedAt: undefined,
      result: err(held.error),
      written: undefined,
    };
  }
  const { inventory, written } = held.value;
  return { listedSinceIso, listingRequests, listingStoppedAt: undefined, result: ok(inventory), written };
}

/**
 * Drop the chats ChatGPT answered "not found" for from the carry, so a chat deleted on chatgpt.com is asked for once and
 * never again. The carry's instants are unchanged: only the list shrinks.
 *
 * @returns the refusal when the carry could not be rewritten, otherwise nothing
 */
function dropGoneFromCarry({
  carry,
  gone,
  root,
}: {
  carry: ListingCarry | undefined;
  gone: readonly string[];
  root: string;
}): ChatgptError | undefined {
  if (carry === undefined || gone.length === 0) {
    return undefined;
  }
  const dropped = new Set(gone);
  const rewritten = writeListingCarry({
    carry: { ...carry, conversations: carry.conversations.filter((one) => !dropped.has(one.id)) },
    root,
  });
  return rewritten.isErr() ? rewritten.error : undefined;
}

/**
 * The refusal a run reports: the reading leg's when it stopped, since it came first, else the carry rewrite's.
 *
 * @param readingStop the refusal that stopped the reading leg, if one did
 * @param dropFailed why dropping deleted chats from the carry failed, if it did
 * @returns the refusal to report, `undefined` when neither happened
 */
function firstStop({
  readingStop,
  dropFailed,
}: {
  readingStop: ChatgptError | ChatgptSnapshotError | undefined;
  dropFailed: ChatgptError | undefined;
}): ChatgptError | ChatgptSnapshotError | undefined {
  if (readingStop !== undefined) {
    return readingStop;
  }
  return dropFailed;
}

/**
 * The listing and reading legs, run under the verb's lock.
 *
 * @param fetchText one GET of a chatgpt.com path with the stored session already applied
 * @param held the live copy's manifests as the run found them
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @param listStartedIso the instant the listing began, the only one the run can certify
 * @returns what both legs did, with the refusal that stopped them when one did
 */
export async function fetchLeg({
  deps,
  fetchText,
  held,
  home,
  options,
  root,
  listStartedIso,
}: {
  deps: LiveSyncFetchDeps;
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
  held: ReadonlyMap<string, LiveSnapshotManifest>;
  home: string;
  options: LiveSyncFetchOptions;
  root: string;
  listStartedIso: string;
}): Promise<FetchLegOutcome> {
  const listing = await listingLeg({ deps, fetchText, listStartedIso, options, root });
  const { listedSinceIso, listingRequests, listingStoppedAt } = listing;
  if (listing.result.isErr()) {
    const nothingRead = { behind: 0, current: 0, gone: 0, inventory: undefined, planned: 0, read: 0 };
    return { ...nothingRead, listedSinceIso, listingRequests, listingStoppedAt, stoppedBy: listing.result.error };
  }
  const inventory = listing.result;
  const plan = planLiveSync({ held, listed: inventory.value.conversations });
  const bound = options.maxConversations;
  const toRead = bound === undefined ? plan.toFetch : plan.toFetch.slice(0, bound);
  const outcome = await readPlannedConversations({
    fetchText,
    home,
    nowIso: deps.nowIso,
    onProgress: ({ read, of }) => {
      logger.info({ msg: `chatgpt live-sync: held ${String(read)} of ${String(of)} this run` });
    },
    pacer: deps.pacer,
    protection: deps.protection,
    root,
    toRead,
  });
  // The carry drops a deleted chat even when the reading stopped; a reading refusal is the one reported, since it came first.
  const dropFailed = dropGoneFromCarry({ carry: listing.written, gone: outcome.gone, root });
  const stoppedBy = firstStop({ dropFailed, readingStop: outcome.stoppedBy });
  return {
    behind: outcome.behind,
    current: plan.current,
    gone: outcome.gone.length,
    inventory: inventory.value,
    listedSinceIso,
    listingRequests,
    listingStoppedAt,
    planned: plan.toFetch.length,
    read: outcome.read,
    stoppedBy,
  };
}
