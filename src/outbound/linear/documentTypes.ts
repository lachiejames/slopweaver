/**
 * The Linear DOCUMENT vocabulary — the long-form page (a proposal, an RFC, a design note) Linear attaches to a
 * project, an initiative, an issue or a team.
 *
 * A document is not a ticket, so it does not borrow the issue's Problem/Solution/AI-prompt shape: those
 * sections describe a unit of work, and a proposal written into one reads as a ticket wearing a costume. What
 * it DOES borrow is the issue's block vocabulary, `FreeformBlock` from `./types.ts`, unchanged — the same
 * paragraphs, lists, checklists, media, code and `##` headings, rendered by the same `renderBlock`, refused by
 * the same structural checks. One vocabulary means one set of escape rules, not a second copy to drift.
 *
 * The destination is ONE tagged value rather than four optional ids. `DocumentCreateInput` accepts
 * `projectId`, `initiativeId`, `issueId` and `teamId` side by side and documents no rule for sending two, so
 * the form makes "exactly one" unrepresentable to get wrong instead of checking it after the fact.
 */
import type { FreeformBlock } from "./types.js";

/** Which kind of object a document hangs off. Each maps to one `DocumentCreateInput` id field. */
export type LinearDocumentDestinationKind = "initiative" | "issue" | "project" | "team";

/** Where a document lives: one object, by kind and id. */
export interface LinearDocumentDestination {
  readonly kind: LinearDocumentDestinationKind;
  /**
   * The destination's id. A UUID for every kind; an issue also accepts its identifier (`ENG-42`), which
   * `DocumentCreateInput.issueId` documents explicitly.
   */
  readonly id: string;
}

/** The scalar fields of a document write. */
interface LinearDocumentFields {
  /** The document's title — its own level-one heading in Linear's UI, so the body never repeats it. */
  readonly title: string;
  readonly destination: LinearDocumentDestination;
}

/** A complete document write: the fields, and the body as an ordered array of blocks. */
export interface LinearDocumentForm {
  readonly fields: LinearDocumentFields;
  readonly content: readonly FreeformBlock[];
}
