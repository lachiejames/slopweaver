/**
 * The Linear INITIATIVE vocabulary — the strategy layer above projects, and the last of Linear's four
 * write-shaped objects this door had no words for.
 *
 * An initiative is a project's parent: it groups projects toward one outcome, carries its own status and
 * target date, and reports with its own status updates on its own cadence. So this file carries two
 * vocabularies rather than one — the initiative itself, and the status update posted TO it — for the same
 * reason `./projectTypes.ts` and `./projectUpdateTypes.ts` are separate files.
 *
 * ## Why `status` is a closed enum here where a project's `statusId` is an opaque string
 *
 * A project's status set is workspace-configurable, so nothing in this repo can know what is valid for a
 * destination and `LinearProjectFields.statusId` is deliberately opaque. An initiative's is NOT: Linear
 * ships `InitiativeStatus` as a fixed five-value GraphQL enum with no per-workspace configuration, so the
 * form can refuse a wrong value locally instead of letting the provider do it. Confirmed against the live
 * schema, reproducible with `slopweaver atlas linear read --id type:InitiativeStatus --json`.
 */
import type { SectionBlock } from "./types.js";

/**
 * Linear's `InitiativeStatus` enum, spelled as its own API spells it.
 *
 * Capitalised because that is the wire format — `Planned`, not `planned`. The health enum two declarations
 * below is lowerCamel for the same reason, and the inconsistency is Linear's rather than this file's.
 *
 * Reached through {@link LinearInitiativeFields}; a caller fills the form, never this type on its own.
 *
 * @internal
 */
export type LinearInitiativeStatus = "Active" | "Canceled" | "Completed" | "Planned" | "Proposed";

/**
 * The three healths an initiative update carries.
 *
 * Its own type rather than a reuse of `./projectUpdateTypes.ts`'s `LinearProjectHealth`, even though the
 * two enums presently carry the same three values. They are two distinct GraphQL enums —
 * `InitiativeUpdateHealthType` and `ProjectUpdateHealthType` — and Linear can widen one without the other;
 * a shared alias would silently make this form accept a value the initiative mutation refuses.
 *
 * Reached through {@link LinearInitiativeUpdateFields}; a caller fills the form, never this type on its own.
 *
 * @internal
 */
export type LinearInitiativeHealth = "atRisk" | "offTrack" | "onTrack";

/**
 * The fields an initiative write may set.
 *
 * `content` is deliberately absent, exactly as it is on `LinearProjectFields`: it is the long-form document
 * body Linear renders in its own editor, a different surface from the short `description` a reader scanning
 * a list sees, and nothing has asked this door to author one.
 */
export interface LinearInitiativeFields {
  readonly name: string;
  readonly description?: string | undefined;
  readonly ownerId?: string | undefined;
  readonly status?: LinearInitiativeStatus | undefined;
  readonly targetDate?: string | undefined;
  readonly leadTeamId?: string | undefined;
}

/** A complete initiative write — no body/artifact, just the fields, the same shape a project write has. */
export interface LinearInitiativeForm {
  readonly fields: LinearInitiativeFields;
}

/** The edge one `linear initiative link` asserts: which project joins which initiative. */
export interface LinearInitiativeLinkFields {
  readonly initiativeId: string;
  readonly projectId: string;
}

/** A complete initiative→project link write. */
export interface LinearInitiativeLinkForm {
  readonly fields: LinearInitiativeLinkFields;
}

/**
 * One piece of evidence: what it is, and where to see it.
 *
 * Reached through {@link LinearInitiativeUpdateArtifact}; a caller fills the form, never this type alone.
 *
 * @internal
 */
export interface LinearInitiativeUpdateEvidence {
  readonly label: string;
  readonly url: string;
}

/**
 * The body of one initiative status update.
 *
 * Structurally identical to `LinearProjectUpdateArtifact`, and that is by design rather than by copying:
 * Linear renders an initiative update in the same feed, the same digest and the same collapsible grammar as
 * a project update, so rule 7's arrangement is the same arrangement. `./render.ts`'s
 * `renderInitiativeUpdateBody` delegates rather than duplicating, which is where that sameness is stated
 * once instead of drifting in two places.
 */
export interface LinearInitiativeUpdateArtifact {
  /** The whole update above the fold — one line, and capped. */
  readonly summary: string;
  /** Optional ordered blocks, rendered inside the collapsible. */
  readonly detail?: readonly SectionBlock[] | undefined;
  /** Optional links for claims a ticket reference cannot carry. */
  readonly evidence?: readonly LinearInitiativeUpdateEvidence[] | undefined;
}

/** The non-body fields of an initiative update: which initiative, and what it says the health is. */
export interface LinearInitiativeUpdateFields {
  readonly initiativeId: string;
  readonly health: LinearInitiativeHealth;
}

/** A complete initiative-update write: the destination and health, plus the body. */
export interface LinearInitiativeUpdateForm {
  readonly fields: LinearInitiativeUpdateFields;
  readonly artifact: LinearInitiativeUpdateArtifact;
}
