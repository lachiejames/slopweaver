/**
 * The PURE core of `linear label create` — argument parsing, form validation, the dry-run preview, the
 * deterministic intent id, and the report.
 *
 * ## The intent id
 *
 * A UUID v4-shaped digest of the kind and the validated fields, so the same label asked for twice is refused
 * by the ledger rather than created twice. The kind is IN the digest: an issue label and a project label of
 * one name are two different objects in two vocabularies, and both may legitimately exist.
 */
import { createHash } from "node:crypto";

import type { DoorRequest } from "../../../admit/types.js";
import type { ReadLinearLabel } from "../../../corpus/linear/writeLabels.js";
import type { Result } from "../../../lib/result.js";
import { linearLabelCreateFormSchema } from "../../../outbound/linear/labelSchema.js";
import type { LinearLabelCreateForm } from "../../../outbound/linear/labelTypes.js";
import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../parseFlags.js";
import type { LinearVerbError } from "./errors.js";
import { parseLinearFormCreateArgs } from "./formCreateArgs.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear label create` invocation. */
export interface LinearLabelArgs {
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}; `helpTruth.test.ts` reads the names derived below. */
const LINEAR_LABEL_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_LABEL_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_LABEL_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_LABEL_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear label create …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearLabelArgs({ argv }: { argv: readonly string[] }): Result<LinearLabelArgs, LinearVerbError> {
  return parseLinearFormCreateArgs({ argv, flags: LINEAR_LABEL_FLAGS, noun: "label" });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearLabelForm({ raw }: { raw: string }): Result<LinearLabelCreateForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearLabelCreateFormSchema });
}

/**
 * The deterministic label id for an intent, in UUID v4 layout.
 *
 * @param form the complete write; its kind and fields are both digested
 * @returns the UUID this intent always maps to
 */
export function labelIntentId({ form }: { form: LinearLabelCreateForm }): string {
  const digest = JSON.stringify({ fields: form.fields, kind: form.kind });
  const hex = createHash("sha256").update(digest, "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The ledger subject a label hangs off: its team, or `workspace` for a workspace label.
 *
 * @param form the validated form
 * @returns the team id, or the literal `workspace`
 */
export function labelSubject({ form }: { form: LinearLabelCreateForm }): string {
  if (form.fields.teamId === undefined) {
    return "workspace";
  }
  return form.fields.teamId;
}

/**
 * The `IssueLabelCreateInput` / `ProjectLabelCreateInput` fields, built from the validated form. Only the
 * fields the form carries are sent, so an absent `teamId` is a workspace label by Linear's own reading.
 *
 * @param form the validated form
 * @returns the provider input, without the id the API layer adds
 */
export function labelInputFor({ form }: { form: LinearLabelCreateForm }): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(form.fields).filter(([, value]) => value !== undefined));
}

/** Where a label will apply, in words. Pure. */
function scopeWords({ teamId }: { teamId: string | undefined }): string {
  if (teamId === undefined) {
    return "the whole workspace";
  }
  return `team ${teamId}`;
}

/**
 * The dry-run preview: the exact label that would be created.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function labelDryRunLines({ form, id }: { form: LinearLabelCreateForm; id: string }): readonly string[] {
  const group = form.fields.isGroup === true ? ["group:       yes — other labels may sit under it"] : [];
  const parent = form.fields.parentId === undefined ? [] : [`parent:      ${form.fields.parentId}`];
  return [
    `label id:    ${id}  (derived from the form, so a retry reuses it)`,
    `kind:        ${form.kind} label`,
    `name:        ${form.fields.name}`,
    `applies to:  ${scopeWords({ teamId: form.fields.teamId })}`,
    ...parent,
    ...group,
  ];
}

/** What became of a label write. Same arms as a relation write, and for the same reasons. */
export type LinearLabelOutcome =
  | { readonly kind: "written"; readonly label: ReadLinearLabel }
  | { readonly kind: "unconfirmed"; readonly labelId: string }
  | { readonly kind: "landed"; readonly label: ReadLinearLabel; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/** One label stated the way an operator copying its id reads it. */
function labelLine({ label }: { label: ReadLinearLabel }): string {
  return `${label.id}  ${label.kind} label "${label.name}" on ${scopeWords({ teamId: label.teamId })}`;
}

/**
 * The operator-facing report for a label outcome.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function labelOutcomeLines({ outcome }: { outcome: LinearLabelOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "written":
      return ["created the label", labelLine({ label: outcome.label })];
    case "unconfirmed":
      return [
        "the label was created but could NOT be read back, so its name and team are unverified.",
        `Linear echoes only an id on a label create: ${outcome.labelId}`,
        "Do not re-run this: the mutation may have landed. Run `slopweaver linear labels --team <key>` to look.",
      ];
    case "landed":
      return [
        "created the label, despite a transport error — it was found at the id we chose.",
        labelLine({ label: outcome.label }),
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact label was already reserved at ${outcome.reservedIso}.`,
        "The label id is derived from the form, so the same label cannot be created twice. Delete the",
        "ledger record if the earlier attempt definitely did not land.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the label could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Run `slopweaver linear labels --team <key>` to look, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The outcome as one machine-readable document, the intent id always present so a caller can reconcile.
 *
 * @param outcome what happened
 * @param id the deterministic intent id
 * @returns one JSON document
 */
export function labelOutcomeJson({ outcome, id }: { outcome: LinearLabelOutcome; id: string }): string {
  return JSON.stringify({ id, outcome }, undefined, 2);
}

/**
 * The door request for a label write.
 *
 * `createsWorkItem` is FALSE: a label is vocabulary, not work anyone has to triage. It is still an
 * `external-write` — every member of the team sees it in their label picker.
 *
 * @param home the resolved state home
 * @param id the label id
 * @param form the validated form, recorded so the audit trail says what was added where
 * @returns the request to admit
 */
export function labelDoorRequestFor({
  home,
  id,
  form,
}: {
  home: string;
  id: string;
  form: LinearLabelCreateForm;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: "label create" },
    artifact: { id, kind: form.kind, name: form.fields.name, subject: labelSubject({ form }) },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
