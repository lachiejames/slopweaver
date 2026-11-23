/**
 * What a row knows beyond its addresses, what a sentence resolves into, and what a reference resolves against — the
 * shapes `./inlineCitations.ts` and its siblings share, split out so none of them imports the original.
 */

import { NO_RECORD_REFERENCES, type RecordReferences } from "../components/live/readRecords";
import { type CardPeople, NO_CARD_PEOPLE } from "./personMentions";

/**
 * What a card's ROW knows beyond the addresses it carries — so a number or key its sentences name with no address
 * anywhere still links (`./cardReferences.ts` builds it).
 */
export interface CardReferences {
  /** The repository the row's pull requests belong to, `owner/repo` — absent when the row names none, or two. */
  readonly home: string | undefined;
  /**
   * The largest pull-request number any queue row carries an address for, per repository (`owner/repo`,
   * lowercased): how many digits that repository's numbers run to, and so whether a number could be one of them.
   */
  readonly attested: ReadonlyMap<string, number>;
  /** The install's Linear workspace slug, when `derive` recorded one. */
  readonly linearWorkspace: string | undefined;
  /** Every Linear team key the install knows, so `UTC-5` and `ISO-8601` stay words. */
  readonly linearTeamKeys: readonly string[];
  /**
   * Every attested repository the row's own words name, `owner/repo` — where a number the home cannot hold may
   * belong instead ({@link numberUrl}).
   */
  readonly named: readonly string[];
  /**
   * Every repository a board row CHECKS OUT (`repoSlug`, a git origin, never prose), lowercased: all a number the row
   * names no repository for may fall back to ({@link numberUrl}), so another row's quoted `acme/widgets` never is.
   */
  readonly checkouts: ReadonlySet<string>;
  /**
   * Every slug the board holds a row for, so a sentence naming `iso-compliance-violations-bigtask` keeps that slug
   * whole as the row's words: a board row has no page of its own to open. Membership is the whole test: a
   * hyphenated word the board has no row for is still searched for a reference inside it.
   */
  readonly boardSlugs: ReadonlySet<string>;
  /** Every person the queue's rosters name, so a `<@U…>` or a bare member id reads as that person's identity chip. */
  readonly people: CardPeople;
  /**
   * Every Datadog monitor, Vanta control and Vanta risk the board resolved an address for, so `monitor 50001`,
   * `HRS-29` and `TTX-2` cite the record, so the owner never has to formulate each URL by hand.
   */
  readonly records: RecordReferences;
}

/** A row that knows nothing beyond its addresses — what every caller that passes no references gets. */
export const NO_CARD_REFERENCES: CardReferences = {
  attested: new Map(),
  boardSlugs: new Set(),
  checkouts: new Set(),
  people: NO_CARD_PEOPLE,
  home: undefined,
  linearTeamKeys: [],
  linearWorkspace: undefined,
  named: [],
  records: NO_RECORD_REFERENCES,
};

/**
 * One piece of a sentence: words as written, a pull request or ticket drawn as the link it is, or a person the card
 * names, drawn by name as their identity chip (`./personMentions.ts`).
 */
export type InlineSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "cite";
      readonly label: string;
      readonly url: string;
      /** What the cited record is called — a monitor's name, a control's — for the chip's hover card. */
      readonly title?: string;
    }
  | { readonly kind: "person"; readonly label: string; readonly id: string };

/** What the row's addresses resolve a bare reference against. */
export interface Resolvable {
  /** Pull-request number to its one address — numbers exactly ONE pull request claims. */
  readonly numbers: ReadonlyMap<string, string>;
  /**
   * The same, pull requests only: `PR N` says it is a pull request, so a carried `/issues/N` never answers it.
   */
  readonly pulls: ReadonlyMap<string, string>;
  /** Every number a carried pull-request address names, one address or several. */
  readonly pullClaimed: ReadonlySet<string>;
  /** Every distinct pull-request address, without tab or fragment. */
  readonly bases: readonly string[];
  /**
   * Every distinct GitHub issue address. `owner/repo#N` or `acme-admin N` beside `…/acme-admin/issues/N` is that issue,
   * never a `/pull/N` the spelling would otherwise build.
   */
  readonly issues: readonly string[];
  /** Linear key to its one address. */
  readonly keys: ReadonlyMap<string, string>;
  /**
   * Every pull-request number and Linear key ANY carried address names, one address or several. One the carried
   * addresses claim but disagree on stays words: inferring home for it would override them, as with `#N` beside acme-admin and another repository's N.
   */
  readonly claimed: ReadonlySet<string>;
  /** What the row knows beyond its addresses. */
  readonly references: CardReferences;
}
