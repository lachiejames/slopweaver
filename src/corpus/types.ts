/**
 * The corpus contract — one source-agnostic atom every connector produces and every downstream stage
 * (dedup, graph, retrieval) consumes. Normalising all activity to ONE shape is what lets the engine
 * stay connector-count-limited rather than connector-shaped: add a source, emit `CorpusRecord`s, and
 * every later stage works unchanged.
 *
 * `CorpusSource` and the source lists are derived from the integration registry in
 * `src/integrations/corpusSources.ts`; this module re-exports the TYPE only, erased at runtime, so a record shape
 * never loads the registry. A list's value is imported from there.
 *
 * PR4.5 adds ONE additive privacy axis — {@link CorpusVisibility} — carried on the OPTIONAL `visibility`
 * field. It stays a "you world model" lens, not a second store: the corpus is one broad set, and a
 * per-record `public`/`private` mark (default public; absent ⇒ public) lets a query-time scope filter
 * withhold private-lane records (Slack private channels / DMs / mpim) from a non-owner while the owner
 * still sees everything. Only {@link CorpusRecord.visibility} `=== "private"` is restrictive; a legacy
 * record written before this field reads back as public, so no fail-closed on an unparseable tag.
 */

import type { CorpusSource } from "../integrations/corpusSources.js";

export type { CorpusSource } from "../integrations/corpusSources.js";

/**
 * A record's read scope. `public` (the default, and the read-back of any unmarked legacy record) is
 * visible to everyone; `private` is the owner-only lane — private Slack channels, DMs, and mpim group
 * DMs. Stamped at a SINGLE choke-point ({@link ../corpus/visibility.stampVisibility}) so nothing reaches
 * disk unstamped. The store carries the stamp as a `visibility` column.
 */
export type CorpusVisibility = "public" | "private";

/**
 * Sources with NO resume cursor, for which a watermark must never be written.
 *
 * This is a property of the SOURCE rather than of a run, and it is deliberately not the same statement as
 * "absent from `CORPUS_SOURCES`" (`src/integrations/corpusSources.ts`). Absence from the fetch list means refresh does not iterate it; it does
 * not stop anything from writing a cursor for it, because `advanceWatermark` and `SourceIngestJob` are both
 * generic over `CorpusSource` and widening the union widened them too.
 *
 * A review pass found exactly that hole and it is worth keeping the reason visible: the first version made
 * cursorlessness a flag on the job, so a future call site that built a `self` job and forgot the flag would
 * persist `watermarks/self.json` — and a cursor nothing reads today is one a later refresh might, which is how a
 * lane that should always re-scan quietly starts skipping. Derived from the source, an omission cannot do it.
 *
 * `chatgpt` is the second member for the same reason: each run projects one whole export archive, and the
 * conversation-update and message-create clocks inside it disagree, so any cursor drawn from either would step
 * over an edited title or a regenerated branch. `refresh` plans it a whole-history window and refuses a flag
 * that would narrow one.
 */
export const CURSORLESS_SOURCES: readonly CorpusSource[] = ["self", "chatgpt"];

/**
 * The unit a record represents, kept source-neutral so downstream stages never branch per source:
 * GitHub → `pr`/`issue`/`comment`/`review`; Slack → `message`/`comment`/`file`; Linear →
 * `issue`/`comment`/`project`/`status`; Notion → `page`/`database`/`comment`; `finding` is a gold section.
 *
 * The curated-knowledge layer (PR4.3) adds the deliberately-authored artefact kinds — `initiative`,
 * `document`, `update` (Linear); `canvas`, `bookmark`, `pin` (Slack); `discussion`, `release`,
 * `milestone`, `codeowners` (GitHub). Purely additive: pre-PR4.3 bronze never carries them.
 */
export type CorpusKind =
  | "pr"
  | "issue"
  | "comment"
  | "review"
  | "finding"
  | "message"
  | "file"
  | "page"
  | "database"
  | "status"
  | "project"
  | "initiative"
  | "document"
  | "update"
  | "canvas"
  | "bookmark"
  | "pin"
  | "discussion"
  | "release"
  | "milestone"
  | "codeowners"
  /**
   * A CUSTOMER need (Linear `CustomerNeed`) — the only entity in the corpus carrying verbatim customer prose
   * rather than internal discussion. Purely additive: no bronze written before this carries it.
   */
  | "need"
  /**
   * A Slack HUDDLE — its auto-generated notes canvas, a pointer to the transcript file that canvas names,
   * and the transcript's WORDS when the refresh could read them (a long call chunks into several records,
   * as a long Notion page does). Its own kind rather than a `canvas`, because a huddle is a recorded
   * CONVERSATION between named people and a canvas is a document somebody chose to write; folding the first
   * into the second put a private call into the same bucket as a team's strategy doc and gave a reader no
   * way to tell them apart. That separation is also what lets
   * {@link ../corpus/visibility.isAlwaysPrivateKind} treat it as private whatever lane it was found in.
   * Purely additive: no bronze written before this carries it.
   */
  | "huddle"
  /**
   * A MEETING — the notes and transcript Google Meet mails the owner after a call, projected from the
   * Gemini notes email plus the Google Doc it links.
   *
   * Its own kind rather than a `message` for the same reason `huddle` is not a `canvas`: a meeting is a
   * recorded conversation between named people, and the email that carries it is a notification. Folded
   * into `message` the record's title is `Notes: '…'`, its author is "Gemini", and a question about what
   * was decided in a meeting retrieves the notification instead of the meeting. Kept separate it carries
   * the meeting's own title, its attendees and the transcript text, and
   * {@link ../corpus/visibility.isAlwaysPrivateKind} can treat a recorded call as private whatever lane it
   * arrived through. Purely additive: no bronze written before this carries it.
   */
  | "transcript"
  /**
   * A CALENDAR EVENT — a meeting, an all-day marker, or a recurring series' master, as Google holds it.
   *
   * Its own kind rather than a `message` for the reason `huddle` is not a `canvas`: an event is a
   * commitment between named people at a stated time, and folding it into a generic kind would lose the
   * one thing a reader of the diary is asking about. A recurring series is stored as its MASTER carrying
   * its rule, never expanded into instances — bronze is the lossless capture and expansion is a lossy
   * projection, and an unbounded expansion of a daily standup is thousands of near-identical records for
   * one commitment. Purely additive: no bronze written before this carries it.
   */
  | "event";

/**
 * Runtime mirror of {@link CorpusKind} for round-trip validation when reading records back.
 *
 * A `const` TUPLE rather than a plain array, so a consumer that needs a non-empty literal list can take
 * this one instead of restating it. The store's `content_kind` Postgres enum is built from exactly this
 * value (`src/store/schema/enums.ts`), which is what makes a kind the corpus can write and the database
 * cannot store unrepresentable rather than merely tested for.
 */
export const CORPUS_KINDS = [
  "pr",
  "issue",
  "comment",
  "review",
  "finding",
  "message",
  "file",
  "page",
  "database",
  "status",
  "project",
  "initiative",
  "document",
  "update",
  "canvas",
  "bookmark",
  "pin",
  "discussion",
  "release",
  "milestone",
  "codeowners",
  "need",
  "huddle",
  "transcript",
  "event",
] as const satisfies readonly CorpusKind[];

/**
 * One durable unit of activity, normalised. Every field is `readonly` — records are values, never
 * mutated in place. `sourceId` is the identity key (dedup + watermark); `tsIso` drives windowing and
 * the watermark cursor; `refs` carries the cross-references that later build the graph.
 */
export interface CorpusRecord {
  /** Origin system. */
  readonly source: CorpusSource;
  /**
   * Stable per-source id — the dedup + watermark key. GitHub uses `#<number>` for the atom and
   * structured child suffixes (`#<n>:review:<i>`, `#<n>:comment:<i>`, `#<n>:state`) so a re-fetch
   * collapses onto the same ids.
   */
  readonly sourceId: string;
  /** Permalink, for citations. */
  readonly url: string;
  /** ISO-8601 timestamp of when the unit happened. Drives the export window + the per-source watermark. */
  readonly tsIso: string;
  /** What kind of unit this is. */
  readonly kind: CorpusKind;
  /** Low-cardinality grouping: for GitHub the `owner/repo`. */
  readonly container: string;
  /** Resolved author handle, when known. */
  readonly author?: string;
  /** Title, when the unit has one (PRs/issues do; comments/reviews usually don't). */
  readonly title?: string;
  /** The content. */
  readonly text: string;
  /** Cross-refs extracted from the content (`#<number>`, `@mentions`, URLs) — the raw material for the graph. */
  readonly refs: readonly string[];
  /**
   * Read scope (PR4.5). OPTIONAL + additive: absent ⇒ `public`, so pre-PR4.5 bronze reads back as public
   * and public records serialise byte-identically (no fingerprint churn). Only ever set to `"private"` by
   * the single {@link ../corpus/visibility.stampVisibility} choke-point (Slack private-lane records).
   */
  readonly visibility?: CorpusVisibility;
  /**
   * Rich structured metadata pulled generously from the source SDK (state, labels, reactions, assignee,
   * parent, chunk index, …) — the curated, typed, queryable subset. Deliberately NOT embedded (the vector
   * text stays title+text only) and entirely OPTIONAL: bronze written before this field parses back
   * unchanged, so it never invalidates an existing corpus. For the FULL untyped payload, see `raw`.
   */
  readonly attrs?: Readonly<Record<string, CorpusAttributeValue>>;
  /**
   * The FULL raw source payload this record was projected from (the SDK object, redacted string-leaves).
   * Stored verbatim so a future feature needing ANY source field never forces a whole-corpus re-fetch —
   * bronze is the durable capture; silver/`attrs`/`text` are the lossy projections. Opaque (never typed
   * against, never embedded, excluded from the dedup fingerprint so a volatile raw field can't churn
   * bronze). OPTIONAL + additive: pre-`raw` bronze parses back unchanged.
   */
  readonly raw?: Readonly<Record<string, unknown>>;
  /**
   * Whether this record's own words read as UNRESOLVED work, precomputed at parse time.
   *
   * Present only under the `derive` projection, and it exists because that projection drops `text` — 43.8%
   * of bronze's bytes, measured over 43,380 records across all six sources. Exactly one derive
   * consumer reads `text` at all (`../silver/opportunity.readsUnresolved`, a regex over title+text), so the
   * projection computes that ONE boolean while the text is still in hand and drops the text itself.
   *
   * Absent under every other projection, and `readsUnresolved` falls back to the regex when it is — so the
   * bronze path is byte-for-byte unchanged and this field can never make a derive disagree with a full read.
   * That fallback is the integrity guarantee, not an optimisation: a projection that silently answered
   * `false` because it had thrown the text away would quietly change what silver reports.
   */
  readonly unresolved?: boolean;
}

/**
 * A rich-bronze attribute value: a scalar or a list of strings. Kept deliberately narrow (no nested
 * objects) so the payload stays cheap to serialise, redact, and reason about.
 */
export type CorpusAttributeValue = string | number | boolean | readonly string[];

/**
 * The attrs key on which a connector DECLARES that a record's capture is incomplete, and the one value it
 * carries. A complete capture writes no attr at all, so an unmarked row is either complete or older than
 * the marker (`corpus/notion/captureCoverage.ts` is what tells those two apart).
 *
 * Corpus-wide rather than Notion-local because two readers outside any one connector depend on it:
 * {@link ./latestRecords.supersedes}, which must not let a row that says it is incomplete outrank the
 * repaired row beside it, and anything else that later needs to ask "is this capture whole". Only the
 * Notion connector writes it today; the meaning is not Notion's.
 */
export const CAPTURE_ATTR = "capture";

/** The {@link CAPTURE_ATTR} value marking a capture the connector knows was cut short. */
export const CAPTURE_PARTIAL = "partial";

/**
 * The attrs key on which a connector names the PARSED BODY it stored for this object, as `sha256:<digest>`.
 *
 * The body itself is a content-addressed sidecar rather than a field, because a page fans out into one
 * record per chunk and a tree on the record would be written once per chunk
 * (`corpus/notion/bodyStore.ts` carries the whole argument). Like the curated attrs, it is written on the
 * page's REPRESENTATIVE record — chunk 0 — because it describes the page rather than the chunk.
 *
 * Corpus-wide rather than Notion-local for the same reason as {@link CAPTURE_ATTR}: the meaning — "this
 * record's structure is on disk and re-deriving its text needs no provider call" — is not Notion's, even
 * though the Notion connector is the only thing that writes it today.
 */
export const BODY_ATTR = "body";

/** An inclusive ISO window `[since, until]` for an export. */
export interface ExportWindow {
  readonly since: string;
  readonly until: string;
}

/** Per-source incremental cursor: the max observed `tsIso`, so the next refresh resumes from there. */
export interface SourceWatermark {
  readonly source: CorpusSource;
  readonly cursor: string;
}
