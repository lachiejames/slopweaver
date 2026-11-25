/**
 * One folder's delta round: page by page, each page projected and COMMITTED before the next is asked for, so a
 * mailbox is never held in memory whole and a round that dies on page forty keeps the thirty-nine before it.
 *
 * A round CLAIMS its delta link only when Graph returned it on the round's last page and every page before it
 * committed. Anything else — a failed page, a failed write, a cap — ends the round with no link, and
 * `./ingest.ts` leaves that folder's stored link where it was. Re-reading committed pages costs nothing:
 * bronze dedups them.
 *
 * A stored link Graph no longer honours (`DELTA_STATE_EXPIRED`) restarts THIS folder once from an initial
 * round, and says so. A tombstone (`@removed`) means removed from this folder or moved out of it, never
 * necessarily deleted, so it is counted and never written: bronze is append-only, and a moved message
 * arrives again in the folder it moved to under the same immutable id. The residue that follows, stated
 * rather than discovered: a message DELETED after a pass read it keeps its record in the corpus, because a
 * delta tombstone cannot tell a deletion from a move and bronze has no retirement record.
 */
import type { OutlookApi, PageStart } from "../../live/outlook/apiCore.js";
import { MAX_DELTA_PAGE_SIZE } from "../../live/outlook/apiDelta.js";
import type { GraphMessage } from "../../live/outlook/graphWire.js";
import type { BronzeCommitter } from "../corpusWriter.js";
import { newestTs } from "../newestTs.js";
import type { OutlookMailReadCap } from "./fetch.js";
import { projectOutlookMessages } from "./project.js";

/** What one folder's round did. */
export interface FolderRound {
  readonly committed: number;
  readonly projected: number;
  readonly tombstones: number;
  /** The newest `tsIso` among records this round committed, for the pooled cursor. */
  readonly newestTsIso: string | undefined;
  /** The link the next round resumes from — set ONLY when this round completed and every page committed. */
  readonly deltaLink: string | undefined;
  /** Whether a cap stopped the round before Graph's last page. */
  readonly capped: boolean;
  /** Why the round stopped short, when it failed; a failed round claims no link. */
  readonly failure: string | undefined;
  readonly notes: readonly string[];
  readonly warnings: readonly string[];
}

/** The running totals of one round. */
interface Tally {
  committed: number;
  projected: number;
  tombstones: number;
  newestTsIso: string | undefined;
  readonly notes: string[];
  readonly warnings: string[];
}

/**
 * How many items the next page may ask for: the page ceiling, or what the cap leaves, whichever is less. Pure.
 *
 * @param cap the per-folder cap, when one was given
 * @param projected how many records this round has already taken
 * @returns the page size to request, at least one
 */
export function nextPageSize({ cap, projected }: { cap: OutlookMailReadCap | undefined; projected: number }): number {
  if (cap === undefined) {
    return MAX_DELTA_PAGE_SIZE;
  }
  return Math.max(1, Math.min(MAX_DELTA_PAGE_SIZE, cap.maxMessages - projected));
}

/**
 * The later of two optional ISO instants. Pure.
 *
 * @param a one instant, when there is one
 * @param b the other, when there is one
 * @returns the later, or whichever is present
 */
export function laterIso({ a, b }: { a: string | undefined; b: string | undefined }): string | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** How a round stopped: with the link it may claim, short of a cap, or on a failure. */
interface RoundEnding {
  readonly deltaLink?: string | undefined;
  readonly capped?: boolean;
  readonly failure?: string;
}

/**
 * Where a committed page leaves the round: the ending it reached, or the link to read next. Pure.
 *
 * A spent cap on the round's LAST page still read the round whole, but a capped run claims no link: the cap
 * may have dropped records off that very page.
 *
 * @param nextLink the page's link to the next page, when the round has more
 * @param deltaLink the page's link to the next round, when this was the last page
 * @param spent whether the cap is now spent
 * @returns the ending, or the link the round reads next
 */
export function afterPage({
  nextLink,
  deltaLink,
  spent,
}: {
  nextLink: string | undefined;
  deltaLink: string | undefined;
  spent: boolean;
}): { readonly ending: RoundEnding } | { readonly link: string } {
  if (spent) {
    return { ending: { capped: true } };
  }
  if (nextLink === undefined) {
    return { ending: { deltaLink } };
  }
  return { link: nextLink };
}

/**
 * Whether a failed page restarts the folder from an initial round: only when Graph dropped the state of a
 * STORED link, and only once a round. Pure.
 *
 * @param code the failure's code
 * @param next what the failed request asked for
 * @param restarted whether this round already restarted once
 * @returns true when the folder should be read again from an initial round
 */
export function restartsOnExpiry({
  code,
  next,
  restarted,
}: {
  code: string;
  next: PageStart<{ readonly folderId: string }>;
  restarted: boolean;
}): boolean {
  if (restarted || !("link" in next)) {
    return false;
  }
  return code === "DELTA_STATE_EXPIRED";
}

/** The round's result from its tally, with the ending it reached. */
function ended({ tally, ending }: { tally: Tally; ending: RoundEnding }): FolderRound {
  return {
    capped: ending.capped === true,
    committed: tally.committed,
    deltaLink: ending.deltaLink,
    failure: ending.failure,
    newestTsIso: tally.newestTsIso,
    notes: tally.notes,
    projected: tally.projected,
    tombstones: tally.tombstones,
    warnings: tally.warnings,
  };
}

/**
 * Project and commit one page's changed messages, up to what the cap leaves. Mutates the tally.
 *
 * @returns whether the cap is now spent, or the write failure
 */
function commitPage({
  account,
  cap,
  committer,
  messages,
  tally,
}: {
  account: string;
  cap: OutlookMailReadCap | undefined;
  committer: BronzeCommitter;
  messages: readonly GraphMessage[];
  tally: Tally;
}): { spent: boolean; failure: string | undefined } {
  const projected = projectOutlookMessages({ account, messages });
  tally.warnings.push(...projected.warnings);
  const room = cap === undefined ? projected.records.length : cap.maxMessages - tally.projected;
  const records = projected.records.slice(0, Math.max(0, room));
  const written = committer.commit({ records });
  if (written.isErr()) {
    return { failure: `the bronze write failed: ${written.error.join("; ")}`, spent: false };
  }
  tally.projected += records.length;
  tally.committed += written.value.written;
  tally.newestTsIso = laterIso({ a: tally.newestTsIso, b: newestTs({ records }) });
  const spent = cap !== undefined && (tally.projected >= cap.maxMessages || projected.records.length > records.length);
  return { failure: undefined, spent };
}

/**
 * Read one folder's round to its end, committing each page before the next.
 *
 * @param api the Outlook seam
 * @param account the connected account's address, which decides each record's container
 * @param committer the pass's one bronze committer
 * @param folderId the folder being read
 * @param start the stored link, or an initial round
 * @param cap the per-folder cap, when `--sample`/`--fetch-cap` set one
 * @returns what the round did, and the link it may claim
 */
export async function readFolderRound({
  api,
  account,
  committer,
  folderId,
  start,
  cap,
}: {
  api: OutlookApi;
  account: string;
  committer: BronzeCommitter;
  folderId: string;
  start: PageStart<{ readonly folderId: string }>;
  cap: OutlookMailReadCap | undefined;
}): Promise<FolderRound> {
  const tally: Tally = { committed: 0, newestTsIso: undefined, notes: [], projected: 0, tombstones: 0, warnings: [] };
  let next = start;
  let restarted = false;
  for (;;) {
    const page = await api.messageDelta({
      maxPageSize: nextPageSize({ cap, projected: tally.projected }),
      start: next,
    });
    if (page.isErr()) {
      if (restartsOnExpiry({ code: page.error.code, next, restarted })) {
        restarted = true;
        next = { first: { folderId } };
        tally.notes.push(`folder ${folderId}: Graph had dropped its delta state, so it was read whole again`);
        continue;
      }
      return ended({ ending: { failure: page.error.message }, tally });
    }
    const changed = page.value.items.filter((item) => item["@removed"] === undefined);
    tally.tombstones += page.value.items.length - changed.length;
    const committed = commitPage({ account, cap, committer, messages: changed, tally });
    if (committed.failure !== undefined) {
      return ended({ ending: { failure: committed.failure }, tally });
    }
    const after = afterPage({ deltaLink: page.value.deltaLink, nextLink: page.value.nextLink, spent: committed.spent });
    if ("ending" in after) {
      return ended({ ending: after.ending, tally });
    }
    next = { link: after.link };
  }
}
