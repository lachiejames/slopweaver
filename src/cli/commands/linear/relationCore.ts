/**
 * The PURE core of `linear relation create` — argument parsing, form validation, the dry-run preview, and
 * the deterministic intent id.
 *
 * ## The intent id, and the one thing it deliberately does NOT collapse
 *
 * The id is a UUID v4-shaped digest of the two issue ids and the type, so asserting the same edge twice is
 * refused rather than duplicated. It is NOT symmetric: `A blocks B` and `B blocks A` are different edges
 * with different meanings and different ids, which is correct. It follows that `A related-to B` and
 * `B related-to A` also compute different ids even though Linear renders them the same way — the honest
 * trade, because the alternative is a canonicalisation rule that would have to know which types are
 * symmetric and would silently refuse a legitimate second assertion the day Linear changed one.
 */
import { createHash } from "node:crypto";

import type { DoorRequest } from "../../../admit/types.js";
import type { WrittenRelation } from "../../../corpus/linear/write.js";
import type { Result } from "../../../lib/result.js";
import { linearRelationFormSchema } from "../../../outbound/linear/commentSchema.js";
import type { LinearRelationForm } from "../../../outbound/linear/commentTypes.js";
import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../parseFlags.js";
import type { LinearVerbError } from "./errors.js";
import { parseLinearFormCreateArgs } from "./formCreateArgs.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear relation create` invocation. */
export interface LinearRelationArgs {
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}; `helpTruth.test.ts` reads the names derived below. */
const LINEAR_RELATION_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_RELATION_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_RELATION_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_RELATION_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear relation create …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearRelationArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearRelationArgs, LinearVerbError> {
  return parseLinearFormCreateArgs({ argv, flags: LINEAR_RELATION_FLAGS, noun: "relation" });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearRelationForm({ raw }: { raw: string }): Result<LinearRelationForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearRelationFormSchema });
}

/**
 * The deterministic relation id for an intent, in UUID v4 layout.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 */
export function relationIntentId({ form }: { form: LinearRelationForm }): string {
  const hex = createHash("sha256").update(JSON.stringify(form.fields), "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The `IssueRelationCreateInput` fields, built from the validated form.
 *
 * @param form the validated form
 * @returns the provider input
 */
export function relationInputFor({ form }: { form: LinearRelationForm }): Readonly<Record<string, unknown>> {
  return {
    issueId: form.fields.issueId,
    relatedIssueId: form.fields.relatedIssueId,
    type: form.fields.type,
  };
}

/**
 * The dry-run preview: the exact edge that would be asserted.
 *
 * The direction is spelled out in words rather than left to the field names, because `blocks` is the one
 * type where getting the two ids the wrong way round produces a valid edge that says the opposite thing.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function relationDryRunLines({ form, id }: { form: LinearRelationForm; id: string }): readonly string[] {
  const { issueId, relatedIssueId, type } = form.fields;
  const reading =
    type === "blocks"
      ? `${issueId} BLOCKS ${relatedIssueId}`
      : `${issueId} is ${type === "duplicate" ? "a DUPLICATE of" : "RELATED to"} ${relatedIssueId}`;
  return [
    `relation id: ${id}  (derived from the intent, so a retry reuses it)`,
    `type:        ${type}`,
    `reads as:    ${reading}`,
  ];
}

/** What became of a relation write. Same arms as a comment write, and for the same reasons. */
export type LinearRelationOutcome =
  | { readonly kind: "written"; readonly relation: WrittenRelation }
  | { readonly kind: "unconfirmed"; readonly relationId: string }
  | { readonly kind: "landed"; readonly relation: WrittenRelation; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/** One relation stated the way an operator reads it. */
function relationLine({ relation }: { relation: WrittenRelation }): string {
  return `${relation.issueId} —${relation.type}→ ${relation.relatedIssueId}`;
}

/**
 * The operator-facing report for a relation outcome.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function relationOutcomeLines({ outcome }: { outcome: LinearRelationOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "written":
      return ["created the relation", relationLine({ relation: outcome.relation })];
    case "unconfirmed":
      return [
        "the relation was created but could NOT be read back, so its state is unverified.",
        `Linear echoes only an id on a write, so neither endpoint is known until a read succeeds: ${outcome.relationId}`,
        "Do not re-run this: the mutation may have landed. Check the issue, then reconcile.",
      ];
    case "landed":
      return [
        "created the relation, despite a transport error — it was found at the id we chose.",
        relationLine({ relation: outcome.relation }),
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact relation was already reserved at ${outcome.reservedIso}.`,
        "The relation id is derived from the two issues and the type, so the same edge cannot be asserted",
        "twice. Delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the relation could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look at the issue in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for a relation write.
 *
 * `createsWorkItem` is FALSE: an edge between two tickets a team already has creates nothing anyone has to
 * triage. It is still an `external-write` — it changes what other people see on their issues.
 *
 * @param home the resolved state home
 * @param id the relation id
 * @param issueId the first issue, recorded so the audit trail says where the write landed
 * @returns the request to admit
 */
export function relationDoorRequestFor({
  home,
  id,
  issueId,
}: {
  home: string;
  id: string;
  issueId: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: "relation create" },
    artifact: { id, issueId },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
