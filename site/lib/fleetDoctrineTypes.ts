/**
 * The shapes the Fleet page's doctrine panel is drawn from (`./fleetDoctrine.ts`). Every sentence and every item is
 * written by the projection; the panel only lays them out.
 */

import type { Board, BoardRow } from "../components/live/read";
import type { Landing, LandingRow } from "../components/live/readLanding";
import type { Reconcile } from "../components/live/readWorkstreamsTypes";
import type { QuotedReason } from "./quotedReason";

/** The fields of one board row the panel reads. */
export type DoctrineBoardRow = Pick<
  BoardRow,
  "slug" | "ownerWait" | "prUrls" | "prUrlsPartial" | "prUrlsAbsent" | "parkedCheckpoint"
>;

/**
 * The board as the panel reads it: its rows, and what the scan could not finish — a doc it could not read, or one the
 * sweep's deadline cut — since a row in either is unknown here, not absent.
 */
export interface DoctrineBoard {
  readonly rows: readonly DoctrineBoardRow[];
  readonly unreadable: Board["unreadable"];
  readonly unresolved: Board["unresolved"];
}

/** The fields of the reconcile the panel reads. */
export type DoctrineReconcile = Pick<
  Reconcile,
  "aligned" | "misaligned" | "unprioritised" | "ready" | "held" | "holds" | "fleet" | "top" | "starving" | "staleAsks"
>;

/** The fields of the landing reading the panel reads. */
export interface DoctrineLanding {
  readonly census: Landing["census"];
  readonly rows: readonly Pick<LandingRow, "url" | "ci" | "boardRowKind" | "boardRowSlug">[];
}

/**
 * Why something the panel stands on is not in hand: the console's own words, or its words quoting a read's reason, the
 * two kept apart so the panel says the reason plainly and folds the raw message (`./quotedReason.ts`, steer 7).
 */
export type DoctrineReason = string | QuotedReason;

/**
 * One input reading as the projection takes it: in hand, or why not. A stale read and a handed-over one are not in
 * hand for a doctrine count. `pending` marks only an unread input with no value at all, its first read still loading,
 * and it alone lets the panel say it is busy rather than settled.
 */
export type DoctrineInput<T> =
  | { readonly kind: "read"; readonly value: T }
  | { readonly kind: "unread"; readonly why: DoctrineReason; readonly pending?: true };

/**
 * How a line reads at a glance: `ok` is the doctrine kept, `attention` work left on the table, `danger` a breach the owner
 * named (two supervisors), `unread` a reading the line stands on did not arrive — never drawn as a zero.
 */
export type DoctrineTone = "ok" | "attention" | "danger" | "unread";

/** One thing a line counts: a row, a seat, a pull request, a plan. */
export interface DoctrineItem {
  /** Unique within its group. */
  readonly key: string;
  readonly text: string;
  /** Where it lives, when it has an address. */
  readonly href: string | undefined;
  /** The read's reason `text` quotes, exactly as it arrived, when it quotes one: said plainly, the raw folded. */
  readonly why?: string;
}

/** The items one reason covers, under the reason's own words. */
export interface DoctrineGroup {
  readonly label: string;
  readonly items: readonly DoctrineItem[];
}

/** The five lines, in the order the owner reads them. */
export type DoctrineLineKey = "seats" | "unseatable" | "pull-requests" | "supervisors" | "headroom";

/** One line of the panel: its tone, its one sentence, and every item it counts behind a fold. */
export interface DoctrineLine {
  readonly key: DoctrineLineKey;
  readonly tone: DoctrineTone;
  readonly sentence: string;
  /**
   * {@link DoctrineLine.sentence} as the panel draws a line that is not read: the short lead, and the console's own
   * reasons folded shut beneath it. The same reason, "session watch reported 11 problems…", once stood inline on three
   * of the five lines. Absent when the line names no reason of its own.
   */
  readonly notRead?: { readonly lead: string; readonly reasons: readonly string[] };
  /** Every read's reason the line stands on, each its own plain line and fold beneath the sentence, never inside it. */
  readonly quoted: readonly QuotedReason[];
  /** Empty when the line counts nothing nameable. */
  readonly groups: readonly DoctrineGroup[];
}

/** The whole panel. */
export interface FleetDoctrine {
  readonly lines: readonly DoctrineLine[];
}
