/**
 * Whether anyone has given a demand-gated atlas a reason to walk since its last read — the pure half.
 *
 * The owner is asked to sign in only when a sync is going to be useful: after more pen-testing, or when someone
 * mentions they did something in the app recently. A pen-test platform's findings arrive in engagements, so a
 * scheduled attempt between engagements reads nothing new while still being able to ask for the owner's sign-in.
 *
 * So an atlas may declare `resyncDemand` on its descriptor (`../../atlas/kit/contract.ts`), and its scheduled
 * resync walks only when a PERSON has named one of its terms in the corpus after the atlas last read successfully.
 * Its schedule still fires on its cadence; a slot with no demand is a store search that exits
 * `EXIT_EXPECTED_EMPTY`, so it is stamped, reads healthy, opens no browser, meets no sign-in page and raises no card.
 *
 * ## Why last SUCCESS, not the last attempt
 *
 * A demand walk that meets a sign-in page leaves the demand standing, so the seat holds the row on the owner's card
 * (`../../cli/commands/automation/seatRefusals.ts`) and walks again once the owner presses Done. Judged against the
 * last attempt, that walled attempt would postdate the demand and the owner's Done would re-walk nothing.
 *
 * ## Who counts as a person
 *
 * The store's own `author_is_bot` already drops provider-flagged bots; the fleet's own Slack users are NOT flagged
 * (`slopweaver store hits --term dvuln --shape exact --json` lists `U0SYN000005`'s posts), so the caller hands
 * their ids in. Sources are an ALLOWLIST of where people talk: `github` holds the fleet's own pull requests, which
 * name every atlas they touch, and `self` is a scan of this repository.
 */
import { RESYNC_DEMAND_SOURCES } from "../../integrations/corpusSources.js";

// `RESYNC_DEMAND_SOURCES`: the corpus sources a person's mention can come from — every integration whose manifest says
// `resyncDemand`, derived rather than kept here. Re-exported because `./demandRead.ts` imports it beside the judgement.
export { RESYNC_DEMAND_SOURCES };

/** The record that gave an atlas a reason to walk, as the attempt and its sign-in card carry it. */
export interface ResyncDemandRecord {
  readonly source: string;
  readonly url: string;
  /** Who wrote it: their display name, else their native id, else `null` when the store holds neither. */
  readonly author: string | null;
  readonly occurredAt: string;
}

/** One search hit, as much of `store/probe/head.ts`'s `RecordHead` as the judgement reads. */
export interface ResyncDemandHit {
  readonly source: string;
  readonly url: string;
  readonly author: string | null;
  readonly authorNativeId: string | null;
  readonly occurredAt: string;
}

/** What the demand check found for one target. */
export type ResyncDemandRead =
  /** The target declares no demand gate, so it walks on its cadence exactly as before. */
  | { readonly kind: "ungated" }
  | { readonly kind: "wanted"; readonly record: ResyncDemandRecord }
  | { readonly kind: "unwanted"; readonly terms: readonly string[]; readonly sinceIso: string | null }
  /** The check could not run — a store or profile that would not read — so nothing may be decided yet. */
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The newest hit a person wrote after the atlas's last successful read, or `null` when there is none.
 *
 * @param hits every search hit across the gate's terms and sources, in any order
 * @param sinceIso the atlas's last successful read, or `null` when it has never read — then any hit counts
 * @param excludedAuthorIds the fleet's own SLACK user ids, whose Slack posts are never a person's demand — Slack ids
 *   are not namespaced, so they exclude nothing in another source
 * @returns the demand record, or `null`
 */
export function judgeResyncDemand({
  hits,
  sinceIso,
  excludedAuthorIds,
}: {
  readonly hits: readonly ResyncDemandHit[];
  readonly sinceIso: string | null;
  readonly excludedAuthorIds: readonly string[];
}): ResyncDemandRecord | null {
  const sources: readonly string[] = RESYNC_DEMAND_SOURCES;
  const sinceMs = sinceSecondMs({ sinceIso });
  const newest = hits
    .filter((hit) => sources.includes(hit.source))
    // A record naming nobody (a Notion database row an automation wrote) is no evidence a PERSON asked, and a
    // walk on it would re-create the ask the gate ends.
    .filter((hit) => authorOf({ hit }) !== null)
    // Either field may carry the fleet id: the store resolves `author` from the person row, else the native id, and
    // a row with no native id is still the fleet's when its resolved author is.
    .filter(
      (hit) =>
        hit.source !== "slack" ||
        ![hit.authorNativeId, hit.author].some((id) => id !== null && excludedAuthorIds.includes(id)),
    )
    .filter((hit) => Date.parse(hit.occurredAt) >= sinceMs)
    .toSorted((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .at(0);
  if (newest === undefined) {
    return null;
  }
  return { author: authorOf({ hit: newest }), occurredAt: newest.occurredAt, source: newest.source, url: newest.url };
}

/**
 * Whether one term's search in one source has read far enough back, given its newest-first page just read.
 *
 * A page full of the fleet's own posts says nothing about what is behind it: twenty bot mentions after a person's
 * would otherwise hide the person, and the slot would read as nobody asking. So paging
 * stops only when the page holds a demand, comes back short, or reaches back to the last successful read.
 *
 * @param page the page just read, newest first, as `store/probe/hits.ts` orders it
 * @param pageSize the limit the page was asked for — a shorter page is the end of the results
 * @param sinceIso the atlas's last successful read, or `null` when it never read — then only a demand or the end stops
 * @param excludedAuthorIds the fleet's own Slack user ids
 * @returns `true` when no older page could change the judgement
 */
export function demandPagingDone({
  page,
  pageSize,
  sinceIso,
  excludedAuthorIds,
}: {
  readonly page: readonly ResyncDemandHit[];
  readonly pageSize: number;
  readonly sinceIso: string | null;
  readonly excludedAuthorIds: readonly string[];
}): boolean {
  if (judgeResyncDemand({ excludedAuthorIds, hits: page, sinceIso }) !== null || page.length < pageSize) {
    return true;
  }
  if (sinceIso === null) {
    return false;
  }
  const sinceMs = sinceSecondMs({ sinceIso });
  return page.some((hit) => Date.parse(hit.occurredAt) < sinceMs);
}

/**
 * The last success, truncated to the whole second the store reports a hit's time in. `store/probe/head.ts` renders
 * `occurred_at` to the second, so a mention later in the same second as the read would otherwise read as older
 * than it. A mention in that second counts: one extra ask beats a silenced one.
 */
function sinceSecondMs({ sinceIso }: { readonly sinceIso: string | null }): number {
  if (sinceIso === null) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.floor(Date.parse(sinceIso) / 1000) * 1000;
}

/**
 * Whether a time the gate compares is one at all. `null` is the never-read boundary and passes; any other string
 * must parse, because `Date.parse` answers `NaN` and every comparison against `NaN` is false — a hit would vanish, and
 * a boundary would hide every hit, both reading as nobody asking.
 *
 * @param iso the boundary or hit time, as the state file or `store/probe/head.ts` holds it
 * @returns `true` when the gate may compare it
 */
export function isInstant({ iso }: { readonly iso: string | null }): boolean {
  return iso === null || !Number.isNaN(Date.parse(iso));
}

/**
 * Why a page of hits cannot be judged, or `null` when every hit can. A hit whose time does not parse would vanish
 * from the judgement, and one with no link would walk on a demand the state file then refuses to hold, so the
 * sign-in card could not carry it. Either defers the slot rather than deciding on a guess.
 *
 * @param hits one page, as `store/probe/hits.ts` returned it
 * @returns the reason, or `null`
 */
export function unusableHit({ hits }: { readonly hits: readonly ResyncDemandHit[] }): string | null {
  const untimed = hits.find((hit) => !isInstant({ iso: hit.occurredAt }));
  if (untimed !== undefined) {
    return `the corpus store returned ${untimed.url} with a time that does not parse (${untimed.occurredAt})`;
  }
  const unlinked = hits.find((hit) => hit.url.trim() === "");
  if (unlinked !== undefined) {
    return `the corpus store returned a ${unlinked.source} record of ${unlinked.occurredAt} with no link`;
  }
  return null;
}

/** A hit's author as a reader names them: the display name, else the native id. A blank one names nobody. */
function authorOf({ hit }: { readonly hit: ResyncDemandHit }): string | null {
  if (hit.author !== null && hit.author.trim() !== "") {
    return hit.author;
  }
  if (hit.authorNativeId !== null && hit.authorNativeId.trim() !== "") {
    return hit.authorNativeId;
  }
  return null;
}

/**
 * The words one demand record reads as on a line or a card — who, where and when.
 *
 * @param record the demand
 * @returns e.g. `Tobias Wren in slack at <iso-instant>`
 */
export function demandWords({ record }: { readonly record: ResyncDemandRecord }): string {
  if (record.author === null) {
    return `an unattributed record in ${record.source} at ${record.occurredAt}`;
  }
  return `${record.author} in ${record.source} at ${record.occurredAt}`;
}

/**
 * The line the verb prints for a gated target that found no demand, naming what it searched since when.
 *
 * @param terms the gate's declared terms
 * @param sinceIso the last successful read the search was bounded by, or `null` when it never read
 * @returns the words after the target label
 */
export function unwantedLine({
  terms,
  sinceIso,
}: {
  readonly terms: readonly string[];
  readonly sinceIso: string | null;
}): string {
  const since = sinceIso === null ? "ever" : `since its last read at ${sinceIso}`;
  return (
    `NOTHING TO DO · no person has named ${terms.join(" or ")} in ${RESYNC_DEMAND_SOURCES.join(", ")} ${since}, ` +
    "so nothing walked and no sign-in was asked for"
  );
}
