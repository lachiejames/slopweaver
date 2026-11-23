/**
 * The ACTIVITY-HISTORY store's contract — the full event stream behind the corpus, kept deliberately OUT of
 * the record pipeline.
 *
 * ## Why a sibling store rather than `CorpusRecord`s
 *
 * A history event is one line: "Seth moved this from In Progress to Done". Emitting those as records would be
 * the obvious thing and it would break retrieval. The ranker this store was designed against scored by BM25
 * times a recency decay (retired with the lane, but the shape of the problem survives:
 * Postgres full text still matches a short event on one term as readily as its parent). A one-line event is short,
 * so a single matching term accounts for a large share of it — which means an event can outrank the issue it
 * belongs to, even when the issue is newer. No choice of timestamp fixes that; the only real fix is
 * parent-closure in the ranker (every selected event drags its parent in, ranked above), and that lives under
 * `src/retrieval/**`, which is out of scope for the connector work.
 *
 * So `corpus/history/` is a sibling of `bronze/`, exactly as `members/` and `structures/` are, and for exactly
 * the same reason: `readCorpusDir` recurses `bronze/` only, so nothing here can reach the ranker by accident.
 * What retrieval DOES get is a bounded per-issue summary folded into the issue's own searchable `text`.
 *
 * ## What that does and does NOT guarantee — an adversarial pass found the gap
 *
 * It guarantees the two things the store is for: no event is a `CorpusRecord`, and retrieval cannot read this
 * directory. It does NOT guarantee that event CONTENT can never be ranked apart from its issue, and an earlier
 * version of this comment claimed it did.
 *
 * The remaining path runs through GOLD, and it is pre-existing rather than introduced here: `distil` reads a
 * record's `text`, the gold renderer writes distilled points into standalone markdown sections, and
 * `readGoldRecords` turns every such section back into an independent `kind: "finding"` record stamped with the
 * QUERY time — so a distilled point is short, freshly stamped, and separately rankable. That is exactly the
 * profile the argument above warns about, and it applies to any bronze text at all: an issue description or a
 * Slack message can already become one. What this change adds is a new KIND of input to that channel.
 *
 * The freshness stamp is a known defect with an owner (the gold-freshness work), and `src/gold/**` is out of
 * scope here, so this is recorded rather than fixed. The digest is deliberately prefixed `Activity:` so that
 * work can identify and exclude derived text if it chooses to.
 *
 * ## What is captured, and what it can and cannot answer
 *
 * The stream is EVENT-LOGGED, not bitemporal. It records that a description was edited; it does not retain the
 * old description. So no amount of history ingest lets the corpus reconstruct a past state, and anything that
 * needs one should say so rather than quietly approximating. `state` spans are the exception in a narrow way:
 * they give valid-time intervals for the workflow state, and therefore real time-in-state durations.
 *
 * Measured over a complete census of all 24,033 issues: pooled mean 7.99 events/issue (~191,900 events
 * workspace-wide), true maximum 478 on one issue, only 6 issues over 100 events, none over 500. 71.2% of the
 * raw bytes were explicit `null`s from the 80-field `from*`/`to*` shape — ~98 MB raw, ~27.9 MB with nulls
 * stripped at the parse edge, a 3.5× reduction. They are stripped.
 */
import type { CorpusSource } from "../types.js";

/**
 * Which event stream a row came from.
 *
 *  - `history` — an `IssueHistory` event: WHO changed WHAT, from what, to what. Has an actor.
 *  - `state` — an `IssueStateSpan`: an interval the issue spent in one workflow state. Rides the issue page
 *    free and yields duration directly, but carries NO actor, so it cannot say who moved anything. Additive
 *    to `history`, never a substitute for it.
 */
export type HistoryStream = "history" | "state";

/** Runtime mirror of {@link HistoryStream}, for round-trip validation on read. */
export const HISTORY_STREAMS: readonly HistoryStream[] = ["history", "state"];

/**
 * One durable activity event.
 *
 * There is deliberately NO `fetchedAtIso`. An event is immutable once it happened, so the row is fully
 * determined by its own content and re-ingesting is idempotent by IDENTITY
 * (`source` + `stream` + `subjectId` + `eventId`) rather than by a content fingerprint — which also means the
 * dedup pass over ~192,000 rows is a set of short keys rather than a canonical re-serialisation of each row.
 */
export interface HistoryEventRow {
  /** Origin system. */
  readonly source: CorpusSource;
  /** Which stream (see {@link HistoryStream}). */
  readonly stream: HistoryStream;
  /** The entity the event is about — a Linear issue identifier (`TEAM-123`). */
  readonly subjectId: string;
  /** Low-cardinality grouping, matching the subject record's container (`linear/<TEAM>`). */
  readonly container: string;
  /** The event's own stable id, as the source assigns it. */
  readonly eventId: string;
  /** When the event happened — `createdAt` for `history`, `startedAt` for a `state` span. */
  readonly tsIso: string;
  /** Who did it, when the stream carries an actor. Absent on every `state` span, by construction. */
  readonly actor?: string;
  /**
   * The event payload, recursively null-stripped and canonically key-ordered. Untyped on purpose: the
   * `IssueHistory` shape has 78 fields and typing it would be a second schema to keep in sync with Linear's.
   */
  readonly changes: Readonly<Record<string, unknown>>;
  /** Row-format version. Bump only with a reader migration. */
  readonly version: 1;
}
