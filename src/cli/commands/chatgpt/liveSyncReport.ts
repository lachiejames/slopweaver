/**
 * What `chatgpt live-sync` prints once its listing and reading legs are done (`liveSyncFetch.ts`): counts and instants
 * on stdout, and on a stop the refusal, where a stopped listing was and the web caveats on stderr. A chat's title is
 * the owner's own words, so nothing here ever prints one.
 */
import { logger } from "#lib/logger.js";

import type { ListingPage } from "./listing.js";
import type { FetchLegOutcome } from "./liveSyncFetch.js";
import { CHATGPT_WEB_CAVEATS } from "./usage.js";

/**
 * The line naming where a stopped listing was: the lane, then its offset or, for a cursor lane, its page. Pure.
 *
 * @param stoppedAt the last page the walk asked for before it stopped
 * @returns the line, printed on stderr after the stop itself
 *
 * @internal
 */
export function listingStopLine({ stoppedAt }: { stoppedAt: ListingPage }): string {
  const where =
    stoppedAt.kind === "offset" ? `at offset ${String(stoppedAt.offset)}` : `on page ${String(stoppedAt.page)}`;
  return `chatgpt live-sync: the listing stopped in the ${stoppedAt.lane} lane ${where}; the last completed listing, if any, stays the one carried`;
}

/**
 * The run's summary: counts and instants, never a title. Pure.
 *
 * @param listed how many distinct chats the listing named
 * @param current how many of those the live copy already held at their listed update
 * @param planned how many the plan named to read, before any bound
 * @param read how many were read and held this run
 * @param behind how many of those ChatGPT answered older than it listed them, held to be read again next run
 * @param bearerExpiresIso the session's own expiry, when its token states one
 * @param listingRequests how many GETs the listing made this run, retries included
 * @param listedSinceIso the instant a carried listing let the walk stop at; `undefined` when the whole account was listed
 * @param gone how many planned chats ChatGPT answered not found for, deleted on the account
 * @returns the lines to print, caveats last
 *
 * @internal
 */
export function liveSyncSummaryLines({
  listed,
  current,
  planned,
  read,
  behind,
  bearerExpiresIso,
  listingRequests,
  listedSinceIso,
  gone,
}: {
  listed: number;
  current: number;
  planned: number;
  read: number;
  gone: number;
  behind: number;
  bearerExpiresIso: string | null;
  listingRequests: number;
  listedSinceIso: string | undefined;
}): readonly string[] {
  const lines = [
    `chatgpt live-sync: listed ${String(listed)} conversation(s); ${String(current)} already held at their listed update`,
    listedSinceIso === undefined
      ? `  listing: the whole account, ${String(listingRequests)} request(s)`
      : `  listing: only what moved since ${listedSinceIso}, laid over the carried one, ${String(listingRequests)} request(s)`,
    `  read and held ${String(read)} of the ${String(planned)} new or changed, newest first`,
  ];
  if (behind > 0) {
    lines.push(
      `  ${String(behind)} answered older than the listing said; held as answered, read again next run, nothing certified`,
    );
  }
  if (gone > 0) {
    lines.push(
      `  ${String(gone)} no longer on the account (ChatGPT answered not found); dropped from the carried listing`,
    );
  }
  if (read + gone < planned) {
    lines.push(
      `  ${String(planned - read - gone)} left for the next run, which picks up exactly where this one stopped`,
    );
  }
  lines.push(
    bearerExpiresIso === null
      ? "  the session's bearer states no expiry"
      : `  the session's bearer expires ${bearerExpiresIso}`,
  );
  lines.push(...CHATGPT_WEB_CAVEATS.map((caveat) => `  ${caveat}`));
  return lines;
}

/**
 * The summary on stdout once the listing read, then the stop and both caveats on stderr when a refusal stopped it.
 *
 * @param outcome what the listing and reading legs did
 * @param bearerExpiresIso the session's own expiry, when its token states one
 */
export function reportFetchLeg({
  outcome,
  bearerExpiresIso,
}: {
  outcome: FetchLegOutcome;
  bearerExpiresIso: string | null;
}): void {
  if (outcome.inventory !== undefined) {
    for (const line of liveSyncSummaryLines({
      behind: outcome.behind,
      bearerExpiresIso,
      current: outcome.current,
      gone: outcome.gone,
      listed: outcome.inventory.conversations.length,
      listedSinceIso: outcome.listedSinceIso,
      listingRequests: outcome.listingRequests,
      planned: outcome.planned,
      read: outcome.read,
    })) {
      logger.out({ line });
    }
  }
  if (outcome.stoppedBy !== undefined) {
    logger.error({ msg: `chatgpt live-sync: stopped, sending no further request: ${outcome.stoppedBy.message}` });
    if (outcome.listingStoppedAt !== undefined) {
      logger.error({ msg: listingStopLine({ stoppedAt: outcome.listingStoppedAt }) });
    }
    for (const caveat of CHATGPT_WEB_CAVEATS) {
      logger.error({ msg: caveat });
    }
  }
}
