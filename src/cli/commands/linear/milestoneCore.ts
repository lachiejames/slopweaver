/**
 * The PURE core of `linear milestone create` — argument parsing, form validation, the dry-run preview, and
 * the deterministic intent id. Same pattern as `./projectCore.ts`, scaled down further: milestone create is
 * the only verb this pass ships (see `AGENTS.md`'s handover doc — no milestone update), so there is no
 * ownership gate here at all; nothing ever reads milestone ownership.
 */

import { createHash } from "node:crypto";
import { unsetFieldAsNull } from "#lib/absent.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { ReadMilestone, WrittenObject } from "../../../corpus/linear/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { linearMilestoneFormSchema } from "../../../outbound/linear/projectSchema.js";
import type { LinearMilestoneFields, LinearMilestoneForm } from "../../../outbound/linear/projectTypes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear milestone create` invocation. */
export interface LinearMilestoneArgs {
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}; `helpTruth.test.ts` reads the names derived below. */
const LINEAR_MILESTONE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_MILESTONE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_MILESTONE_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_MILESTONE_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear milestone create …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearMilestoneArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearMilestoneArgs, LinearVerbError> {
  if (argv[0] !== "create") {
    return err(LinearVerbErrors.usage({ noun: "milestone", shape: "create" }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: LINEAR_MILESTONE_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const formSource = typeof values["form"] === "string" ? values["form"] : undefined;
  if (formSource === undefined) {
    errors.push("--form <json|-> is required (use `-` to read the form from stdin)");
  }
  if (errors.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({
    dryRun: values["dry-run"] === true,
    formSource: formSource!,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
  });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearMilestoneForm({ raw }: { raw: string }): Result<LinearMilestoneForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearMilestoneFormSchema });
}

/**
 * The deterministic milestone id for an intent, in UUID v4 layout — same construction as `projectIntentId`.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 */
export function milestoneIntentId({ form }: { form: LinearMilestoneForm }): string {
  const hex = createHash("sha256").update(JSON.stringify(form.fields), "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The `ProjectMilestoneCreateInput` fields, built from the validated form. Optional fields are OMITTED
 * rather than sent as null, same reasoning as `projectInputFor`.
 *
 * @param fields the validated form fields
 * @returns the provider input, with unset optional fields OMITTED
 */
export function milestoneInputFor({ fields }: { fields: LinearMilestoneFields }): Readonly<Record<string, unknown>> {
  return {
    name: fields.name,
    projectId: fields.projectId,
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields.targetDate === undefined ? {} : { targetDate: fields.targetDate }),
    ...(fields.sortOrder === undefined ? {} : { sortOrder: fields.sortOrder }),
  };
}

/**
 * The dry-run preview: the exact fields that would be sent.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function milestoneDryRunLines({ form, id }: { form: LinearMilestoneForm; id: string }): readonly string[] {
  const { fields } = form;
  return [
    `milestone id: ${id}  (derived from the intent, so a retry reuses it)`,
    `project:      ${fields.projectId}`,
    `name:         ${fields.name}`,
    `target:       ${milestoneFieldPreview({ fields, key: "targetDate" })}`,
    `sort order:   ${fields.sortOrder === undefined ? "(default)" : String(fields.sortOrder)}`,
    "--- description ---",
    milestoneFieldPreview({ fields, key: "description" }),
    "--- end ---",
  ];
}

/** A milestone form may leave its target date and description unset; the write then sends neither. */
type MilestoneOptionalText = "description" | "targetDate";

/** One optional milestone field as the dry run previews it: the value the write sends, or `(none)` when unset. */
function milestoneFieldPreview({ fields, key }: { fields: LinearMilestoneFields; key: MilestoneOptionalText }): string {
  const value = unsetFieldAsNull({ key, record: fields });
  if (value === null) {
    return "(none)";
  }
  return value;
}

/**
 * What became of a milestone write. Only `written`/`unconfirmed`/`indeterminate`/`duplicate`/`failed` — no
 * `landedAfterError`-vs-update ambiguity to resolve, because there is no milestone UPDATE in this pass for
 * "the object pre-existed" to be a confound: every milestone id this verb ever sees is freshly reserved.
 */
export type LinearMilestoneOutcome =
  | { readonly kind: "written"; readonly milestone: ReadMilestone }
  | { readonly kind: "unconfirmed"; readonly milestone: WrittenObject }
  | { readonly kind: "landed"; readonly milestone: ReadMilestone; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The line pointing at the milestone's project.
 *
 * A url when the follow-up project read found one, and the bare id when it did not — never a blank or an
 * "undefined" where a link belongs. `ReadMilestone.projectUrl` says when the second case arises: the SDK's
 * milestone fragment carries the project as a bare `{ id }`, so the url is a second read that can come back
 * empty for a project that has since gone.
 *
 * @param milestone the milestone that was read back
 * @returns one line naming the project
 */
function projectPointerLine({ milestone }: { milestone: ReadMilestone }): string {
  if (milestone.projectUrl === undefined) {
    return `project: ${milestone.projectId} (no project found at that id, so there is no URL to print)`;
  }
  return `project: ${milestone.projectUrl}`;
}

/**
 * The operator-facing report for a milestone outcome.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function milestoneOutcomeLines({ outcome }: { outcome: LinearMilestoneOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "written":
      return [`created milestone "${outcome.milestone.name}"`, projectPointerLine({ milestone: outcome.milestone })];
    case "unconfirmed":
      return [
        `the milestone at ${outcome.milestone.id} was created but could NOT be read back, so its state is unverified.`,
        "Linear echoes only an id on a write, so there is no name or URL to print until a read succeeds.",
        "Do not re-run this: the mutation may have landed. Check the project, then reconcile.",
      ];
    case "landed":
      return [
        `created milestone "${outcome.milestone.name}", despite a transport error — found at the id we chose.`,
        projectPointerLine({ milestone: outcome.milestone }),
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact intent was already reserved at ${outcome.reservedIso}.`,
        "The milestone id is derived from the content, so an identical form maps to the identical milestone.",
        "Change the form, or delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the milestone could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look for the milestone in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for a milestone write. `createsWorkItem` is false: a milestone is scheduling scaffolding
 * inside an existing project, not an independent item a team notices the way a new project or issue is.
 *
 * @param home the resolved state home
 * @param id the milestone id
 * @param projectId the destination project, recorded so the audit trail says where the write landed
 * @returns the request to admit
 */
export function milestoneDoorRequestFor({
  home,
  id,
  projectId,
}: {
  home: string;
  id: string;
  projectId: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: "milestone create" },
    artifact: { id, projectId },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
