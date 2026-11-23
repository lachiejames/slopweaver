/**
 * The shaped Linear items the fetch edge produces and the projection ({@link ./project}) consumes. Types only:
 * they are the contract between those two halves, so neither one owns them.
 */

import type { HistoryEventRow } from "../history/types.js";

/** A Linear comment, already shaped by the fetch edge. */
export interface LinearCommentItem {
  readonly id: string;
  readonly body: string;
  /**
   * The member's or external commenter's real Linear id (joinable against the members store), else a
   * display name/integration name when neither carries an id.
   */
  readonly author?: string;
  readonly tsIso: string;
  readonly url: string;
  readonly raw?: Readonly<Record<string, unknown>>;
  /** The comment this one replies to. Restores the reply TREE, which a flat list could not express. */
  readonly parentId?: string;
  /** `:emoji: xN` lines — the cheapest agreement signal the source offers. */
  readonly reactions?: readonly string[];
  readonly editedAtIso?: string;
  readonly resolvedAtIso?: string;
  /** The passage the comment quotes, when it quotes one. */
  readonly quotedText?: string;
}

/** A Linear issue with its current state, every comment, and its activity history. */
export interface LinearIssueItem {
  readonly identifier: string;
  readonly title: string;
  readonly description?: string;
  readonly url: string;
  readonly tsIso: string;
  /** The creator's real Linear id (joinable against the members store), falling back to a display name. */
  readonly author?: string;
  readonly state?: string;
  /** The workflow state's TYPE (`started`/`completed`/…) — state names are per-team, types are not. */
  readonly stateType?: string;
  readonly assignee?: string;
  readonly team?: string;
  /** The project's display NAME — what a reader sees. Never join on it: see {@link projectId}. */
  readonly project?: string;
  /**
   * The project's Linear id — what an issue-to-project JOIN keys on. A title is not unique and is renamed, so
   * a name-keyed join both merges distinct projects and loses an issue whose project was retitled.
   */
  readonly projectId?: string;
  readonly labels: readonly string[];
  readonly comments: readonly LinearCommentItem[];
  readonly raw?: Readonly<Record<string, unknown>>;
  /** PR4.3: encoded curated edges (sub-issues + typed relations) this issue declares. */
  readonly edgeRefs?: readonly string[];
  /** PR4.3: ref-only attachment lines (`title (url)`, never bytes). */
  readonly attachments?: readonly string[];
  /** The parent issue's identifier, when this is a sub-issue. */
  readonly parent?: string;
  /** The project milestone this issue is scheduled against. */
  readonly milestone?: string;
  /** The cycle (sprint) this issue sits in — never linked before, so sprint questions were unanswerable. */
  readonly cycle?: string;
  readonly cycleNumber?: number;
  readonly priority?: number;
  readonly priorityLabel?: string;
  readonly estimate?: number;
  readonly dueDate?: string;
  /**
   * Linear's suggested git branch name. Captured deliberately, and the one field here worth a warning: it
   * embeds the team key and a slugified title, so it is a private-identifier vector. Fine inside the corpus,
   * which is local; never into a fixture, cassette, test name or PR body.
   */
  readonly branchName?: string;
  readonly number?: number;
  readonly createdAtIso?: string;
  readonly completedAtIso?: string;
  readonly startedAtIso?: string;
  readonly canceledAtIso?: string;
  readonly archivedAtIso?: string;
  readonly triagedAtIso?: string;
  readonly subscribers?: readonly string[];
  readonly reactions?: readonly string[];
  /** Direction-normalised timestamped relation lines — see {@link ./curated.relationEventRefs}. */
  readonly relationEvents?: readonly string[];
  /**
   * This issue's activity events. They are written to the SIBLING history store and are NEVER emitted as
   * records — a one-line event can outrank the issue it belongs to under BM25 x recency. What reaches
   * retrieval is the bounded digest folded into this record's `text`.
   */
  readonly historyRows?: readonly HistoryEventRow[];
}

/** A Linear project/milestone summary. */
export interface LinearProjectItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /**
   * The project's FULL rich-text brief. The single biggest per-field content loss in the connector: only the
   * short `description` was ever captured, so every project's actual plan was absent from the corpus.
   */
  readonly content?: string;
  readonly url: string;
  readonly tsIso: string;
  /** The project's status NAME — from `status { name }`; Linear deprecated the `state` field. */
  readonly state?: string;
  readonly health?: string;
  readonly lead?: string;
  readonly startDate?: string;
  readonly targetDate?: string;
  readonly createdAtIso?: string;
  readonly completedAtIso?: string;
  readonly canceledAtIso?: string;
  readonly archivedAtIso?: string;
  readonly teams?: readonly string[];
  readonly members?: readonly string[];
  readonly labels?: readonly string[];
  readonly initiatives?: readonly string[];
  /** `label (url)` lines. An `attrs` destination, because a connection whose only home is `raw` is discarded. */
  readonly links?: readonly string[];
  readonly raw?: Readonly<Record<string, unknown>>;
  /** PR4.3: the project's status updates (the weekly "what's happening & why" narrative). */
  readonly updates?: readonly LinearUpdateItem[];
}

/** A Linear project update — the deliberately-authored weekly status narrative. */
export interface LinearUpdateItem {
  readonly id: string;
  readonly body: string;
  readonly url: string;
  readonly tsIso: string;
  /** The poster's real Linear id (joinable against the members store), falling back to a display name. */
  readonly author?: string;
  readonly health?: string;
  readonly reactions?: readonly string[];
  readonly editedAtIso?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** A Linear initiative — the top-level strategy artefact grouping projects. */
export interface LinearInitiativeItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** The initiative's FULL brief — the same loss as `Project.content`, for the strategy layer. */
  readonly content?: string;
  readonly url: string;
  readonly tsIso: string;
  readonly status?: string;
  readonly health?: string;
  readonly owner?: string;
  readonly targetDate?: string;
  readonly createdAtIso?: string;
  readonly archivedAtIso?: string;
  readonly projects?: readonly string[];
  /** Encoded `project-item` curated edges to this initiative's projects — see {@link ./entities}. */
  readonly projectEdges?: readonly string[];
  readonly links?: readonly string[];
  readonly raw?: Readonly<Record<string, unknown>>;
}

/**
 * A Linear document — a deliberately-authored spec/doc, WITH the parent bindings that say what it is about.
 * All six were dropped before, so a document landed in the corpus context-free.
 */
export interface LinearDocumentItem {
  readonly id: string;
  readonly title: string;
  readonly content?: string;
  readonly url: string;
  readonly tsIso: string;
  readonly project?: string;
  readonly initiative?: string;
  readonly issue?: string;
  readonly team?: string;
  readonly creator?: string;
  readonly owner?: string;
  readonly createdAtIso?: string;
  readonly archivedAtIso?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}
