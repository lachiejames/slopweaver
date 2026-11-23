/**
 * The PURE core of `linear project` — argument parsing, form validation, the dry-run preview, and the
 * deterministic intent id. Extends the exact pattern `./core.ts` proves for `linear issue`: no I/O here,
 * every decision unit-testable without a mock.
 *
 * A project has no concatenated markdown body the way an issue does — see `../../../outbound/linear/
 * projectSchema.ts` for why — so `update` needs no replace-vs-patch distinction and no description-hash
 * conflict guard: `ProjectUpdateInput` is patch-shaped already, and every field this form sends is a scalar,
 * so there is nothing here that a plain ownership check (in `./projectRun.ts`) does not already guard.
 */

import { createHash } from "node:crypto";
import { unsetFieldAsNull } from "#lib/absent.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { ReadProject, WrittenObject } from "../../../corpus/linear/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type FidelityReport, fidelityLines } from "../../../outbound/linear/fidelity.js";
import { linearProjectFormSchema } from "../../../outbound/linear/projectSchema.js";
import type { LinearProjectFields, LinearProjectForm } from "../../../outbound/linear/projectTypes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { isValidIssueId } from "./core.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear project` invocation. */
export interface LinearProjectArgs {
  readonly verb: "create" | "update";
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  readonly projectId: string | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}; `helpTruth.test.ts` reads the names derived below. */
const LINEAR_PROJECT_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "project-id", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_PROJECT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_PROJECT_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_PROJECT_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear project <create|update> …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearProjectArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearProjectArgs, LinearVerbError> {
  const verb = argv[0];
  if (verb !== "create" && verb !== "update") {
    return err(LinearVerbErrors.usage({ noun: "project", shape: "<create|update>" }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: LINEAR_PROJECT_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const formSource = typeof values["form"] === "string" ? values["form"] : undefined;
  if (formSource === undefined) {
    errors.push("--form <json|-> is required (use `-` to read the form from stdin)");
  }
  const projectId = typeof values["project-id"] === "string" ? values["project-id"] : undefined;
  if (verb === "update" && projectId === undefined) {
    errors.push(
      "--project-id <uuid> is required for update; it is the id slopweaver reserved when it created the project",
    );
  }
  // Re-uses `linear issue`'s UUID v4 guard: `--project-id` reaches a ledger filename the same way `--issue-id`
  // does, so the same path-traversal hole needs the same closing.
  if (projectId !== undefined && !isValidIssueId({ id: projectId })) {
    errors.push(`--project-id must be a UUID v4; "${projectId}" is not, and it would reach a ledger filename`);
  }
  if (errors.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({
    dryRun: values["dry-run"] === true,
    formSource: formSource!,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    projectId,
    verb,
  });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearProjectForm({ raw }: { raw: string }): Result<LinearProjectForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearProjectFormSchema });
}

/**
 * The deterministic project id for an intent, in UUID v4 layout — same construction as `intentId` in
 * `./core.ts`, applied to the fields alone (there is no rendered body to fold in).
 *
 * Reached in production through {@link projectWriteId}; exported so a test can name the id a create derives.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 * @internal
 */
export function projectIntentId({ form }: { form: LinearProjectForm }): string {
  const hex = createHash("sha256").update(JSON.stringify(form.fields), "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The project id this write targets: the `--project-id` the operator named, or — for a create that names
 * none — the id derived from the intent, so a retry of the same create reuses it. `parseLinearProjectArgs`
 * already refuses an update without one, so only a create ever derives.
 *
 * @param args the parsed invocation, whose `projectId` is the operator's own
 * @param form the ORIGINAL form, so the same authored content maps to the same id whatever the checkout's
 *   reference context
 * @returns the id the write reserves and sends
 */
export function projectWriteId({ args, form }: { args: LinearProjectArgs; form: LinearProjectForm }): string {
  if (args.projectId === undefined) {
    return projectIntentId({ form });
  }
  return args.projectId;
}

/**
 * The `ProjectCreateInput`/`ProjectUpdateInput` fields, built from the validated form. Optional fields are
 * OMITTED rather than sent as null — same reasoning as `createInputFor` in `./issueInput.ts`.
 *
 * @param fields the validated form fields
 * @returns the provider input, with unset optional fields OMITTED
 */
export function projectInputFor({ fields }: { fields: LinearProjectFields }): Readonly<Record<string, unknown>> {
  return {
    name: fields.name,
    teamIds: fields.teamIds,
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields.leadId === undefined ? {} : { leadId: fields.leadId }),
    ...(fields.statusId === undefined ? {} : { statusId: fields.statusId }),
    ...(fields.targetDate === undefined ? {} : { targetDate: fields.targetDate }),
    ...(fields.priority === undefined ? {} : { priority: fields.priority }),
    ...(fields.labelIds === undefined ? {} : { labelIds: fields.labelIds }),
  };
}

/**
 * The dry-run preview: the exact fields that would be sent.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function projectDryRunLines({ form, id }: { form: LinearProjectForm; id: string }): readonly string[] {
  const { fields } = form;
  return [
    `project id: ${id}  (derived from the intent, so a retry reuses it)`,
    `name:       ${fields.name}`,
    `teams:      ${fields.teamIds.join(", ")}`,
    `description:${fields.description === undefined ? " (none)" : ` ${fields.description}`}`,
    `lead:       ${projectFieldPreview({ fields, key: "leadId" })}`,
    `status:     ${projectFieldPreview({ fields, key: "statusId" })}`,
    `target:     ${projectFieldPreview({ fields, key: "targetDate" })}`,
    `priority:   ${fields.priority === undefined ? "(unset)" : String(fields.priority)}`,
    `labels:     ${fields.labelIds === undefined || fields.labelIds.length === 0 ? "(none)" : fields.labelIds.join(", ")}`,
  ];
}

/**
 * What a project write does with each optional field the form leaves unset, in the words the preview prints:
 * an omitted status lands the project in the team's default, and an omitted lead or target date sends none.
 */
const PROJECT_UNSET_PREVIEW = { leadId: "(none)", statusId: "(team default)", targetDate: "(none)" } as const;

/** One optional project field as the dry run previews it: the value the write sends, or what unset means. */
function projectFieldPreview({
  fields,
  key,
}: {
  fields: LinearProjectFields;
  key: keyof typeof PROJECT_UNSET_PREVIEW;
}): string {
  const value = unsetFieldAsNull({ key, record: fields });
  if (value === null) {
    return PROJECT_UNSET_PREVIEW[key];
  }
  return value;
}

/** What became of a project write. Same six arms as {@link LinearIssueOutcome}, same reasoning throughout. */
export type LinearProjectOutcome =
  | { readonly kind: "written"; readonly project: ReadProject; readonly fidelity: FidelityReport | undefined }
  | { readonly kind: "unconfirmed"; readonly project: WrittenObject }
  | {
      readonly kind: "landedAfterError";
      readonly project: ReadProject;
      readonly reason: string;
      readonly fidelity: FidelityReport | undefined;
    }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * What a successful write can honestly claim about the state it left behind.
 *
 * @param fidelity the description comparison, or `undefined` when no description was sent
 * @returns the lines to print
 */
function projectVerificationLines({ fidelity }: { fidelity: FidelityReport | undefined }): readonly string[] {
  if (fidelity === undefined) {
    return ["no description was sent, so there is nothing to verify against the read-back."];
  }
  return fidelityLines({ report: fidelity });
}

/**
 * The operator-facing report for a project outcome.
 *
 * @param outcome what happened
 * @param verb which action was attempted
 * @returns the lines to print
 */
export function projectOutcomeLines({
  outcome,
  verb,
}: {
  outcome: LinearProjectOutcome;
  verb: "create" | "update";
}): readonly string[] {
  const past = verb === "create" ? "created" : "updated";
  switch (outcome.kind) {
    case "written":
      return [
        `${past} project "${outcome.project.name}"`,
        outcome.project.url,
        ...projectVerificationLines({ fidelity: outcome.fidelity }),
      ];
    case "unconfirmed":
      return [
        `the project at ${outcome.project.id} was ${past} but could NOT be read back, so its state is unverified.`,
        "Linear echoes only an id on a write, so there is no name or URL to print until a read succeeds.",
        "Do not re-run this: the mutation may have landed. Check the project, then reconcile.",
      ];
    case "duplicate":
      return [
        `refused: this exact intent was already reserved at ${outcome.reservedIso}.`,
        "The project id is derived from the content, so an identical form maps to the identical project.",
        "Change the form, or delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "landedAfterError":
      return [
        `${past} project "${outcome.project.name}", despite a transport error — found at the id we chose.`,
        outcome.project.url,
        `the error was: ${outcome.reason}`,
        ...projectVerificationLines({ fidelity: outcome.fidelity }),
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the project could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look for the project in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for a Linear project write.
 *
 * `createsWorkItem` is true only for a create: a new project is something a team notices, the same standing
 * `doorRequestFor` in `./core.ts` uses for an issue create.
 *
 * @param verb which action is being admitted
 * @param teamIds the destination teams, recorded so the audit trail says where the write landed
 * @param home the resolved state home
 * @param id the project id
 * @returns the request to admit
 */
export function projectDoorRequestFor({
  verb,
  teamIds,
  home,
  id,
}: {
  verb: "create" | "update";
  teamIds: readonly string[];
  home: string;
  id: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: `project ${verb}` },
    artifact: { id, teamIds },
    meta: {
      createsWorkItem: verb === "create",
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
