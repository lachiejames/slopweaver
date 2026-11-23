/**
 * The colour each source-freshness state is drawn in, and each colour's class — the one place either is defined. The
 * words themselves are `./sourceFreshness.ts`. `site/app/console-tw.css` scans this file for its classes.
 */

import type { SourceFreshnessState } from "./sourceFreshnessReport";

/** The three colours a freshness line is drawn in, named by what each asks of the owner. */
export type FreshnessTone = "fresh" | "unchecked" | "attention";

/** Each colour's class. */
export const FRESHNESS_TONES: Readonly<Record<FreshnessTone, { readonly className: string }>> = {
  attention: { className: "text-primary" },
  fresh: { className: "text-muted-foreground" },
  unchecked: { className: "text-warning" },
};

/**
 * Every state's colour, keyed by the state the line is drawn in after the page's clock has aged it. `unverified` is
 * the one quiet colour that is not fresh: a quiet source (a mailbox with nothing new, a recorder with no calls) reads
 * unverified by construction, measured on Gmail and Fathom at once.
 */
export const STATE_TONE: Readonly<Record<SourceFreshnessState, FreshnessTone>> = {
  blocked: "attention",
  current: "fresh",
  failing: "attention",
  late: "attention",
  "never-synced": "attention",
  paused: "attention",
  unreadable: "attention",
  unscheduled: "attention",
  unverified: "unchecked",
};

/** How a source's freshness reads in a panel line. */
export interface FreshnessWords {
  /** One plain sentence, in the console's own words only. */
  readonly sentence: string;
  /**
   * The failed sync's own reason, exactly as the verb recorded it, drawn UNDER the sentence through `PlainWhy` and
   * never set inside it (steer 7); `undefined` when the sentence quotes no reason.
   */
  readonly failure: string | undefined;
  /** The colour it is drawn in. */
  readonly tone: FreshnessTone;
}
