/**
 * The Linear PROJECT + MILESTONE vocabulary.
 *
 * Deliberately narrower than `LinearIssueForm`: a project is not a concatenated markdown body the way an
 * issue's description is, so there is no block-based artifact here, no collapsible, no structural-escape
 * problem to solve. Every field is a scalar Linear's own `ProjectCreateInput`/`ProjectUpdateInput`/
 * `ProjectMilestoneCreateInput` already exposes (confirmed against the pinned `@linear/sdk` schema, not
 * assumed from an older training cut) — see `projectSchema.ts` for which ones this form chooses to expose
 * and why the rest are left out.
 *
 * `leadId`, `statusId` and `labelIds` are opaque strings here for the same reason `stateId` is opaque on
 * `LinearIssueFields`: a project's status set and label set are workspace/team-specific, so what counts as
 * valid depends on the destination, not on a constant in this file.
 */

/**
 * The fields a project write may set. Shared between create and update — `teamIds` and `name` are always
 * present, mirroring how `linear issue update` always resends `title`/`teamId` rather than patching only
 * the touched field.
 */
export interface LinearProjectFields {
  readonly name: string;
  readonly teamIds: readonly string[];
  readonly description?: string | undefined;
  readonly leadId?: string | undefined;
  readonly statusId?: string | undefined;
  readonly targetDate?: string | undefined;
  readonly priority?: 0 | 1 | 2 | 3 | 4 | undefined;
  readonly labelIds?: readonly string[] | undefined;
}

/** A complete project write — no body/artifact, just the fields. */
export interface LinearProjectForm {
  readonly fields: LinearProjectFields;
}

/**
 * The fields a milestone create may set. `description` is genuine markdown per Linear's own field doc ("in
 * markdown format"), unlike a project's plain-text `description` — see `projectSchema.ts`.
 */
export interface LinearMilestoneFields {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly targetDate?: string | undefined;
  readonly sortOrder?: number | undefined;
}

/** A complete milestone write. */
export interface LinearMilestoneForm {
  readonly fields: LinearMilestoneFields;
}
