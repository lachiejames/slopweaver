/**
 * The shared shapes crossing the Linear fetch seam: the injected {@link LinearApi} contract, its per-lane
 * page types, and the whole-crawl {@link LinearActivity} result. Split out from `fetch.ts` so the consumer
 * side ({@link ./fetchCollect}, {@link ./fetchLanes}, {@link ./fetchMembers}) and the producer side ({@link ./fetchApi}) can both
 * depend on these types without depending on each other.
 */
import type { HistoryEventRow } from "../history/types.js";
import type { LinearDocumentItem, LinearInitiativeItem, LinearIssueItem, LinearProjectItem } from "./items.js";

/** A page of shaped issues from the seam, plus the activity events those issues carry. */
export interface LinearIssuesPage {
  readonly issues: readonly LinearIssueItem[];
  /** The page's activity events, bound for the sibling history store — never for bronze. */
  readonly historyRows: readonly HistoryEventRow[];
  readonly nextCursor?: string;
  /**
   * Warnings raised while completing this page's NESTED connections. Optional and additive so an injected
   * test seam needs no synthetic field; the lane folds it into its own list, which is the only route by which
   * an incompletely-paged nested walk reaches the caller.
   */
  readonly warnings?: readonly string[];
}

/** A page of shaped projects from the seam. */
export interface LinearProjectsPage {
  readonly projects: readonly LinearProjectItem[];
  readonly nextCursor?: string;
  /** Warnings from this page's nested connection walks — see {@link LinearIssuesPage.warnings}. */
  readonly warnings?: readonly string[];
}

/** A page of raw Linear user nodes from the seam (projected to member rows by `fetchLinearMembers`). */
interface LinearUsersPage {
  readonly nodes: readonly unknown[];
  readonly nextCursor?: string;
  /** Warnings from this page's nested connection walks — see {@link LinearIssuesPage.warnings}. */
  readonly warnings?: readonly string[];
}

/** A page of shaped initiatives from the seam. */
interface LinearInitiativesPage {
  readonly initiatives: readonly LinearInitiativeItem[];
  readonly nextCursor?: string;
  /** Warnings from this page's nested connection walks — see {@link LinearIssuesPage.warnings}. */
  readonly warnings?: readonly string[];
}

/** A page of shaped documents from the seam. */
export interface LinearDocumentsPage {
  readonly documents: readonly LinearDocumentItem[];
  readonly nextCursor?: string;
}

/**
 * A best-effort BULK-ENTITY lane: raw nodes plus a cursor.
 *
 * Raw nodes rather than shaped items, deliberately: these seven lanes route to three different destinations
 * (records, the structure store, the member store) and shaping them here would put three unrelated projections
 * behind one type. The projections live in {@link ./entities}, pure and separately tested.
 */
export type LinearEntityLane = (args: {
  cursor?: string;
  pageSize?: number | undefined;
}) => Promise<{ nodes: readonly unknown[]; nextCursor?: string }>;

/**
 * Injected Linear seam — returns fully-resolved shaped items so `fetchLinearActivity` needs no live SDK.
 * `initiatives`/`documents` are OPTIONAL: an ABSENT lane is simply not walked. A lane that is present and
 * fails never aborts the crawl, but it is not a warning either — it lands in {@link LinearActivity.incomplete}
 * and fails the source with its cursor held, so Linear is never stamped fresh without it.
 */
export interface LinearApi {
  issues: (args: { since: string; cursor?: string; pageSize?: number | undefined }) => Promise<LinearIssuesPage>;
  projects: (args: { since: string; cursor?: string; pageSize?: number | undefined }) => Promise<LinearProjectsPage>;
  users: (args: { cursor?: string; pageSize?: number | undefined }) => Promise<LinearUsersPage>;
  initiatives?: (args: { cursor?: string; pageSize?: number | undefined }) => Promise<LinearInitiativesPage>;
  documents?: (args: { cursor?: string; pageSize?: number | undefined }) => Promise<LinearDocumentsPage>;
  /**
   * The bulk-entity lanes, each OPTIONAL for the same reason `initiatives`/`documents` are. A lane the token
   * cannot read by design is LEFT OUT of the seam rather than walked and failed: `auditEntries` is present in
   * the schema and HTTP 403 for this token, so `makeLinearApi` never offers it. A lane offered and failing
   * lands in {@link LinearActivity.incomplete}.
   */
  customerNeeds?: LinearEntityLane;
  projectMilestones?: LinearEntityLane;
  initiativeUpdates?: LinearEntityLane;
  /** Templates are `[Template]`, not a connection: NO arguments, so NO paging is possible. */
  templates?: () => Promise<{ nodes: readonly unknown[] }>;
  issueLabels?: LinearEntityLane;
  customViews?: LinearEntityLane;
  externalUsers?: LinearEntityLane;
}

/** Everything one Linear activity crawl produced. */
export interface LinearActivity {
  readonly issues: readonly LinearIssueItem[];
  readonly projects: readonly LinearProjectItem[];
  readonly initiatives: readonly LinearInitiativeItem[];
  readonly documents: readonly LinearDocumentItem[];
  /** Activity events for the sibling history store. Deliberately NOT projected into records. */
  readonly historyRows: readonly HistoryEventRow[];
  /** Raw nodes for the four bulk entities that become searchable records (projected in `project.ts`). */
  readonly customerNeeds: readonly unknown[];
  readonly projectMilestones: readonly unknown[];
  readonly initiativeUpdates: readonly unknown[];
  readonly templates: readonly unknown[];
  /** Advisory only — a nested connection's overflow, a page commit the closing write still carries. */
  readonly warnings: readonly string[];
  /**
   * Every lane that did NOT arrive whole: one that threw, or a walk that stopped short of its end (a repeated
   * cursor, the page ceiling, a missing cursor). Each is a coverage gap to the caller, which fails the source
   * and holds its cursor — a lane's absence must be refusable by a consumer, and a warning is not.
   */
  readonly incomplete: readonly string[];
}
