/**
 * The Linear PROJECT STATUS UPDATE vocabulary — the third thing this door writes, and a different shape
 * again from both an issue body and a comment.
 *
 * A comment is a message on one ticket. A project update is a REPORT to everyone watching a project, on a
 * cadence, and its distinguishing field is not prose at all: `health` is what a reader scanning a project
 * list actually acts on. So the form makes health a required, closed enum rather than something buried in
 * the words — a status update whose health has to be inferred from its paragraphs is the wall of text rule 7
 * exists to refuse, in a form that would otherwise pass every structural check.
 *
 * ## Why `evidence` is OPTIONAL here, when a comment requires it
 *
 * The comment form requires evidence because a comment reports a FINDING, and a finding with no link is a
 * claim with no provenance. A status update reports MOVEMENT: which items shipped, which are still open. Its
 * claims are ticket references, and the bare-reference gate already turns every `SUP-123` and `#N` in this
 * body into a real link or REFUSES the write — so the provenance rule is met by a mechanism that is already
 * mandatory here, and a second required list would be the same links typed twice. Evidence stays available
 * for the case a status update cites something that is not a ticket.
 *
 * This is a different call from the comment form's, made deliberately rather than by copying it.
 */
import type { SectionBlock } from "./types.js";

/**
 * The three healths Linear stores, spelled as its own API spells them.
 *
 * The names are the provider's `ProjectUpdateHealthType` values verbatim — `onTrack`, `atRisk`, `offTrack` —
 * rather than a friendlier local vocabulary, because a translation layer over a three-value enum buys
 * nothing and costs a mapping that can drift.
 */
type LinearProjectHealth = "atRisk" | "offTrack" | "onTrack";

/** One piece of evidence: what it is, and where to see it. */
interface LinearProjectUpdateEvidence {
  readonly label: string;
  readonly url: string;
}

/** The body of one project status update. */
export interface LinearProjectUpdateArtifact {
  /**
   * The whole update above the fold — one line, and capped.
   *
   * Linear shows a project update inline in the project's feed and in the update digest it emails, so this
   * IS the update as far as anyone scanning is concerned.
   */
  readonly summary: string;
  /** Optional ordered blocks, rendered inside the collapsible. */
  readonly detail?: readonly SectionBlock[] | undefined;
  /** Optional links for claims a ticket reference cannot carry — see the module doc. */
  readonly evidence?: readonly LinearProjectUpdateEvidence[] | undefined;
}

/** The non-body fields of a project update: which project, and what it says the health is. */
export interface LinearProjectUpdateFields {
  readonly projectId: string;
  readonly health: LinearProjectHealth;
  /**
   * The instant the overdue window this update answers opened — a `cycle reconcile` project-update proposal's
   * own `movedAtIso`: the last update it saw, or the project's creation when it saw none.
   *
   * When present it REPLACES the body in the intent id: one window is one report, however the words are
   * redrafted. A proposal's draft is composed fresh every pass, so a body-keyed id let the same proposal be
   * answered twice as two "different" updates, each notifying every watcher.
   */
  readonly overdueSince?: string | undefined;
}

/** A complete project-update write: the destination and health, plus the body. */
export interface LinearProjectUpdateForm {
  readonly fields: LinearProjectUpdateFields;
  readonly artifact: LinearProjectUpdateArtifact;
}
