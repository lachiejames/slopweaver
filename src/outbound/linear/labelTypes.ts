/**
 * The typed form `slopweaver linear label create` validates: ONE issue label or ONE project label.
 *
 * Two kinds rather than one with a flag, because Linear keeps them as two vocabularies with two mutations —
 * an issue label is applied through an issue's `labelIds`, a project label through a project's, and an id
 * from one is meaningless in the other. `groupType` exists only on the issue arm because only
 * `IssueLabelCreateInput` declares it (`@linear/sdk` 95.2.0).
 *
 * `id` is deliberately absent: code derives it from the intent, so a retry after a lost response reuses it.
 * `teamId` absent means a WORKSPACE label, present means one scoped to that team — Linear's own reading.
 */

/**
 * How the members of a label group may be applied: one of them, or any number.
 *
 * @internal — reached through {@link LinearIssueLabelFields.groupType}; nothing outside names the union.
 */
export type LinearLabelGroupType = "multiSelect" | "singleSelect";

/** The fields of an issue-label create. */
export interface LinearIssueLabelFields {
  readonly name: string;
  readonly color?: string | undefined;
  readonly description?: string | undefined;
  readonly teamId?: string | undefined;
  readonly parentId?: string | undefined;
  readonly isGroup?: boolean | undefined;
  readonly groupType?: LinearLabelGroupType | undefined;
}

/** The fields of a project-label create. Same as an issue label's, less `groupType`. */
export interface LinearProjectLabelFields {
  readonly name: string;
  readonly color?: string | undefined;
  readonly description?: string | undefined;
  readonly teamId?: string | undefined;
  readonly parentId?: string | undefined;
  readonly isGroup?: boolean | undefined;
}

/** A complete label write, discriminated on which vocabulary it adds to. */
export type LinearLabelCreateForm =
  | { readonly kind: "issue"; readonly fields: LinearIssueLabelFields }
  | { readonly kind: "project"; readonly fields: LinearProjectLabelFields };
