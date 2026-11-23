/**
 * The PURE core of `linear initiative` — argument parsing, form validation, the dry-run preview, the
 * deterministic intent ids and the door requests. No I/O, so all of it is unit-testable without a mock.
 *
 * ## Three sub-verbs, and why `link` is one of them
 *
 * `create` and `update` are the shape `./projectCore.ts` already proves. `link` is the third because an
 * initiative with no projects under it is inert — it is the object's whole purpose to group them, and a
 * door that can mint one but never attach anything to it has shipped the noun without the capability.
 * Linear models the attachment as its own object (`InitiativeToProject`) rather than as a field on either
 * side, which is why it is a sub-verb rather than a field on the initiative form.
 *
 * ## The intent id, per sub-verb
 *
 * Every id here is a UUID v4-shaped digest of the intent, the same construction `./projectCore.ts` uses and
 * for the same reason: a retry after a lost response reuses the id instead of creating a second object. The
 * LINK's digest is its two endpoints and nothing else, because an edge has no content — asserting the same
 * edge twice must collide, and that is the whole at-most-once guarantee for this kind.
 */
import { createHash } from "node:crypto";

import { unsetFieldAsNull } from "#lib/absent.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { WrittenObject } from "../../../corpus/linear/write.js";
import type { ReadInitiative, ReadInitiativeLink } from "../../../corpus/linear/writeInitiative.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  linearInitiativeFormSchema,
  linearInitiativeLinkFormSchema,
} from "../../../outbound/linear/initiativeSchema.js";
import type {
  LinearInitiativeFields,
  LinearInitiativeForm,
  LinearInitiativeLinkForm,
} from "../../../outbound/linear/initiativeTypes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { isValidIssueId } from "./core.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearForm } from "./formParse.js";

/** Which of the three things an invocation asked for. */
export type LinearInitiativeVerb = "create" | "link" | "update";

/** A parsed `linear initiative` invocation. */
export interface LinearInitiativeArgs {
  readonly verb: LinearInitiativeVerb;
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  readonly initiativeId: string | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}. */
const LINEAR_INITIATIVE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "initiative-id", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_INITIATIVE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_INITIATIVE_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_INITIATIVE_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear initiative <create|update|link> …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearInitiativeArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearInitiativeArgs, LinearVerbError> {
  const verb = argv[0];
  if (verb !== "create" && verb !== "update" && verb !== "link") {
    return err(LinearVerbErrors.usage({ noun: "initiative", shape: "<create|update|link>" }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: LINEAR_INITIATIVE_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formSource = typeof values["form"] === "string" ? values["form"] : undefined;
  const initiativeId = typeof values["initiative-id"] === "string" ? values["initiative-id"] : undefined;
  const errors = initiativeArgProblems({ formSource, initiativeId, verb });
  if (formSource === undefined || errors.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({
    dryRun: values["dry-run"] === true,
    formSource,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    initiativeId,
    json: values["json"] === true,
    verb,
  });
}

/**
 * Every usage problem in one invocation, collected rather than reported one at a time.
 *
 * Split from {@link parseLinearInitiativeArgs} so the routing half stays a router: three sub-verbs times two
 * optional inputs is where a parser stops being readable, and the caller fixing a command line wants the
 * whole list anyway.
 *
 * @param verb which sub-verb was asked for
 * @param formSource the `--form` value, or undefined when it was not given
 * @param initiativeId the `--initiative-id` value, or undefined when it was not given
 * @returns one operator-facing line per problem, empty when the invocation is usable
 */
function initiativeArgProblems({
  verb,
  formSource,
  initiativeId,
}: {
  verb: LinearInitiativeVerb;
  formSource: string | undefined;
  initiativeId: string | undefined;
}): readonly string[] {
  return [
    ...(formSource === undefined ? ["--form <json|-> is required (use `-` to read the form from stdin)"] : []),
    ...(verb === "update" && initiativeId === undefined
      ? ["--initiative-id <uuid> is required for update; it is the id slopweaver reserved when it created it"]
      : []),
    // Re-uses `linear issue`'s UUID v4 guard: `--initiative-id` reaches a ledger filename the same way
    // `--issue-id` does, so the same path-traversal hole needs the same closing.
    ...(initiativeId !== undefined && !isValidIssueId({ id: initiativeId })
      ? [`--initiative-id must be a UUID v4; "${initiativeId}" is not, and it would reach a ledger filename`]
      : []),
    ...(verb === "link" && initiativeId !== undefined
      ? ["--initiative-id is not meaningful for link — the form's own fields name both endpoints"]
      : []),
  ];
}

/**
 * Validate a filled `create`/`update` form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearInitiativeForm({ raw }: { raw: string }): Result<LinearInitiativeForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearInitiativeFormSchema });
}

/**
 * Validate a filled `link` form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearInitiativeLinkForm({
  raw,
}: {
  raw: string;
}): Result<LinearInitiativeLinkForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearInitiativeLinkFormSchema });
}

/** A sha256 digest laid out as a UUID v4 — the shared construction every intent id here uses. */
function uuidFrom({ material }: { material: string }): string {
  const hex = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The deterministic initiative id for an intent, in UUID v4 layout.
 *
 * Reached in production through {@link initiativeWriteId}; exported so a test can name the id a create derives.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 * @internal
 */
export function initiativeIntentId({ form }: { form: LinearInitiativeForm }): string {
  return uuidFrom({ material: JSON.stringify(form.fields) });
}

/**
 * The initiative id this write targets: the `--initiative-id` the operator named, or — for a create that
 * names none — the id derived from the intent, so a retry of the same create reuses it.
 * `parseLinearInitiativeArgs` already refuses an update without one, so only a create ever derives.
 *
 * @param args the parsed invocation, whose `initiativeId` is the operator's own
 * @param form the ORIGINAL form, so the same authored content maps to the same id whatever the checkout's
 *   reference context
 * @returns the id the write reserves and sends
 */
export function initiativeWriteId({ args, form }: { args: LinearInitiativeArgs; form: LinearInitiativeForm }): string {
  if (args.initiativeId === undefined) {
    return initiativeIntentId({ form });
  }
  return args.initiativeId;
}

/**
 * The deterministic link id for an intent, in UUID v4 layout.
 *
 * @param form the complete link write
 * @returns the UUID this pair of endpoints always maps to
 */
export function initiativeLinkIntentId({ form }: { form: LinearInitiativeLinkForm }): string {
  return uuidFrom({ material: JSON.stringify(form.fields) });
}

/**
 * The `InitiativeCreateInput`/`InitiativeUpdateInput` fields, built from the validated form. Optional fields
 * are OMITTED rather than sent as null — same reasoning `./projectCore.ts` records.
 *
 * @param fields the validated form fields
 * @returns the provider input, with unset optional fields OMITTED
 */
export function initiativeInputFor({ fields }: { fields: LinearInitiativeFields }): Readonly<Record<string, unknown>> {
  return {
    name: fields.name,
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields.ownerId === undefined ? {} : { ownerId: fields.ownerId }),
    ...(fields.status === undefined ? {} : { status: fields.status }),
    ...(fields.targetDate === undefined ? {} : { targetDate: fields.targetDate }),
    ...(fields.leadTeamId === undefined ? {} : { leadTeamId: fields.leadTeamId }),
  };
}

/**
 * The dry-run preview for a `create`/`update`: the exact fields that would be sent.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function initiativeDryRunLines({ form, id }: { form: LinearInitiativeForm; id: string }): readonly string[] {
  const { fields } = form;
  return [
    `initiative id: ${id}  (derived from the intent, so a retry reuses it)`,
    `name:          ${fields.name}`,
    `description:   ${initiativeFieldPreview({ fields, key: "description" })}`,
    `owner:         ${initiativeFieldPreview({ fields, key: "ownerId" })}`,
    `status:        ${initiativeFieldPreview({ fields, key: "status" })}`,
    `target:        ${initiativeFieldPreview({ fields, key: "targetDate" })}`,
    `lead team:     ${initiativeFieldPreview({ fields, key: "leadTeamId" })}`,
  ];
}

/**
 * What an initiative write does with each optional field the form leaves unset, in the words the preview
 * prints: an omitted status is whatever Linear defaults a new initiative to, and every other field is sent
 * as none at all.
 */
const INITIATIVE_UNSET_PREVIEW = {
  description: "(none)",
  leadTeamId: "(none)",
  ownerId: "(none)",
  status: "(Linear default)",
  targetDate: "(none)",
} as const;

/** One optional initiative field as the dry run previews it: the value the write sends, or what unset means. */
function initiativeFieldPreview({
  fields,
  key,
}: {
  fields: LinearInitiativeFields;
  key: keyof typeof INITIATIVE_UNSET_PREVIEW;
}): string {
  const value = unsetFieldAsNull({ key, record: fields });
  if (value === null) {
    return INITIATIVE_UNSET_PREVIEW[key];
  }
  return value;
}

/**
 * The dry-run preview for a `link`: the edge that would be asserted.
 *
 * @param form the validated link form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function initiativeLinkDryRunLines({
  form,
  id,
}: {
  form: LinearInitiativeLinkForm;
  id: string;
}): readonly string[] {
  return [
    `link id:    ${id}  (derived from the two endpoints, so the same edge cannot be asserted twice)`,
    `initiative: ${form.fields.initiativeId}`,
    `project:    ${form.fields.projectId}`,
  ];
}

/** What became of an initiative write. The same arms `./projectCore.ts` documents, for the same reasons. */
export type LinearInitiativeOutcome =
  | { readonly kind: "written"; readonly initiative: ReadInitiative }
  | { readonly kind: "unconfirmed"; readonly initiative: WrittenObject }
  | { readonly kind: "landed"; readonly initiative: ReadInitiative; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/** What became of a link write. */
export type LinearInitiativeLinkOutcome =
  | { readonly kind: "written"; readonly link: ReadInitiativeLink }
  | { readonly kind: "unconfirmed"; readonly linkId: string }
  | { readonly kind: "landed"; readonly link: ReadInitiativeLink; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The operator-facing report for an initiative outcome.
 *
 * @param outcome what happened
 * @param verb which action was attempted
 * @returns the lines to print
 */
export function initiativeOutcomeLines({
  outcome,
  verb,
}: {
  outcome: LinearInitiativeOutcome;
  verb: "create" | "update";
}): readonly string[] {
  const past = verb === "create" ? "created" : "updated";
  switch (outcome.kind) {
    case "written":
      return [`${past} initiative "${outcome.initiative.name}"`, outcome.initiative.url];
    case "unconfirmed":
      return [
        `the initiative at ${outcome.initiative.id} was ${past} but could NOT be read back, so its state is unverified.`,
        "Linear echoes only an id on a write, so there is no name or URL to print until a read succeeds.",
        "Do not re-run this: the mutation may have landed. Check the initiative, then reconcile.",
      ];
    case "landed":
      return [
        `${past} initiative "${outcome.initiative.name}", despite a transport error — found at the id we chose.`,
        outcome.initiative.url,
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact intent was already reserved at ${outcome.reservedIso}.`,
        "The initiative id is derived from the fields, so an identical form maps to the identical initiative.",
        "Change the form, or delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the initiative could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look for the initiative in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The operator-facing report for a link outcome.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function initiativeLinkOutcomeLines({ outcome }: { outcome: LinearInitiativeLinkOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "written":
      return [`linked project ${outcome.link.projectId} to initiative ${outcome.link.initiativeId}`];
    case "unconfirmed":
      return [
        "the link was asserted but could NOT be read back, so its state is unverified.",
        `Linear echoes only an id on a write, so neither endpoint is known until a read succeeds: ${outcome.linkId}`,
        "Do not re-run this: the mutation may have landed. Check the initiative, then reconcile.",
      ];
    case "landed":
      return [
        `linked project ${outcome.link.projectId} to initiative ${outcome.link.initiativeId}, despite a ` +
          "transport error — it was found at the id we chose.",
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact edge was already reserved at ${outcome.reservedIso}.`,
        "A link's id is derived from its two endpoints, so the same project cannot be joined twice.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the link could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look at the initiative in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for an initiative write.
 *
 * `createsWorkItem` is true only for a `create`: a new initiative is a plan a team notices unprompted, the
 * same call `./projectCore.ts` makes for a project. An `update` edits one they already know about, and a
 * `link` files an existing project under an existing initiative — neither creates anything to triage.
 *
 * @param verb which action is being admitted
 * @param home the resolved state home
 * @param id the initiative or link id
 * @returns the request to admit
 */
export function initiativeDoorRequestFor({
  verb,
  home,
  id,
}: {
  verb: LinearInitiativeVerb;
  home: string;
  id: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: `initiative ${verb}` },
    artifact: { id },
    meta: {
      createsWorkItem: verb === "create",
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
