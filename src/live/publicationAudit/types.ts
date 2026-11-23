/**
 * The publication audit's vocabulary: what the fleet published, the sanitised finding a hit becomes, and how much of
 * each door a run actually read.
 *
 * The one rule every type here keeps: **no found text crosses this boundary.** A {@link PublicationFinding} carries a
 * class, a door, a link, the fixed names of the fields it sat in and an id hashed from non-secret coordinates — never
 * the match, the privacy message, a title,
 * a locus or an excerpt. The privacy check's own message is printable under the private terms, but it still names a
 * locus and a line, and an audit that persisted it would be one more place a leak could be read back from.
 *
 * Pure: types and one pure coverage constructor, no I/O.
 */

import type { PrivateTermClass } from "../../hygiene/privateTerms.js";
import type { InstallationStateKind } from "../../outbound/privacyCheck.js";

/** Every door the fleet publishes through. A closed set: a new door is a new member. */
export const PUBLICATION_DOORS = ["github", "slack", "linear", "notion"] as const;

/** One door the fleet publishes through. */
export type PublicationDoor = (typeof PUBLICATION_DOORS)[number];

/**
 * The class a finding names: the privacy check's own category, then its kind, label or class.
 *
 * `hygiene/<label>` takes the hygiene gate's fixed label; a label that is not a plain slug is reported as
 * `hygiene/unnamed` rather than carried, so no free text reaches a card through this field.
 */
export type PublicationClass =
  `installation-state/${InstallationStateKind}` | `hygiene/${string}` | `private-term/${PrivateTermClass}`;

/** One piece of text the fleet published, read back as it stands now. */
export interface PublishedText {
  readonly door: PublicationDoor;
  /**
   * The published object, by non-secret coordinates only — `pull 46`, `issue-comment 123`. Hashed into a finding's
   * id, never printed, so two fields of one object with one class are one finding.
   */
  readonly objectKey: string;
  /** The canonical address of the object, as its provider answers it, already checked against the door's shape. */
  readonly link: string;
  /**
   * True when the reader checked {@link link} against a shape whose only free text is the own repository's address
   * (`https://github.com/<own>/pull/<n>#issuecomment-<n>`): fixed path words and digits cannot carry a term, and the
   * address is forgiven, so the link is not judged again. Judging it would only withhold a link for a pattern that
   * happens to match a path word. A door whose addresses carry a title slug (Linear, Notion) sets it false.
   */
  readonly linkCarriesNoText: boolean;
  /**
   * Which field of the object the text is — a fixed name from the door's own table (`body`, `title`, `diff_hunk`),
   * never derived from the text. A finding carries it so the owner can tell prose somebody wrote (edit the comment)
   * from code a review comment quotes (the text is in the repository's history).
   */
  readonly field: string;
  /** The text exactly as it is published. */
  readonly text: string;
}

/** One hit, sanitised: what class, through which door, at which address. */
export interface PublicationFinding {
  /** Hashed from the door, the object's coordinates and the class: stable across runs, carrying no found text. */
  readonly findingId: string;
  readonly door: PublicationDoor;
  readonly className: PublicationClass;
  /**
   * The object's address, or `null` when the address itself matched a privacy rule and so is withheld — the card
   * then says the link is withheld rather than substituting a title.
   */
  readonly link: string | null;
  /** Every field of the object the class was found in, sorted — fixed table names, never text. */
  readonly fields: readonly string[];
}

/**
 * How much of one door a run read.
 *
 * `complete` is the only state that may settle an earlier finding. `partial` read something and missed something;
 * `not-swept` read nothing, which is never clean.
 */
export interface PublicationDoorCoverage {
  readonly door: PublicationDoor;
  readonly state: "complete" | "partial" | "not-swept";
  /** Published objects whose text was judged. */
  readonly objects: number;
  /** Pieces of text judged across them. */
  readonly texts: number;
  /** Every reason the door is not complete, as fixed labels — never a provider's error body. */
  readonly gaps: readonly string[];
  /**
   * Uploaded files the published text links, whose bytes this audit does not read. Counted, never swept, and never
   * reported clean: an image or a binary is outside a text check, so a door with any is `partial`, never `complete`.
   */
  readonly attachmentsNotSwept: number;
}

/** What one door's read of the audit produced: the texts to judge, and how much of the door it covered. */
export interface PublicationRead {
  readonly texts: readonly PublishedText[];
  readonly coverage: PublicationDoorCoverage;
}

/**
 * A door's coverage from what it read: `complete` only with no gap and no unread upload, else `partial`. Gaps are
 * deduplicated and sorted so two runs over the same state print identically.
 *
 * @returns the coverage row
 */
export function doorCoverage({
  door,
  objects,
  texts,
  gaps,
  attachmentsNotSwept,
}: {
  door: PublicationDoor;
  objects: number;
  texts: number;
  gaps: readonly string[];
  attachmentsNotSwept: number;
}): PublicationDoorCoverage {
  const fixed = [...new Set(gaps)].toSorted();
  const state = fixed.length === 0 && attachmentsNotSwept === 0 ? "complete" : "partial";
  return { attachmentsNotSwept, door, gaps: fixed, objects, state, texts };
}

/** Findings counted by door, then by class. */
export type PublicationCounts = Readonly<Record<string, Readonly<Record<string, number>>>>;
