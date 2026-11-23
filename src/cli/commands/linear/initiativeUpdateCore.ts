/**
 * The PURE core of `linear initiative-update create` — argument parsing, form validation, the dry-run
 * preview, and the deterministic intent id. No I/O, so all of it is unit-testable without a mock.
 *
 * ## Why this is a separate noun from `linear initiative`
 *
 * The same collision `../../manifests/linear.ts` records for projects, and it is Linear's rather than ours:
 * the mutation `initiativeUpdate` EDITS an initiative, while `initiativeUpdateCreate` posts a status report
 * to one. Naming the report verb anything else here would make this surface disagree with every provider
 * document a reader might go and check.
 *
 * ## The intent id, and why health is part of it
 *
 * Identical construction and identical reasoning to `./projectUpdateCore.ts`: the id is a UUID v4-shaped
 * digest of the destination initiative, the declared health and the RENDERED body, so the same report on the
 * same initiative computes the same id in any process on any day and a retry is refused by its own
 * reservation. Health is in the digest because the same words at a different health are a different report.
 */
import { createHash } from "node:crypto";

import { unsetFieldAsNull } from "#lib/absent.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { WrittenObject } from "../../../corpus/linear/write.js";
import type { ReadInitiativeUpdate } from "../../../corpus/linear/writeInitiative.js";
import type { Result } from "../../../lib/result.js";
import { linearInitiativeUpdateFormSchema } from "../../../outbound/linear/initiativeSchema.js";
import type { LinearInitiativeUpdateForm } from "../../../outbound/linear/initiativeTypes.js";
import { renderInitiativeUpdateBody } from "../../../outbound/linear/render.js";
import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../parseFlags.js";
import type { LinearVerbError } from "./errors.js";
import { parseLinearFormCreateArgs } from "./formCreateArgs.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear initiative-update create` invocation. */
export interface LinearInitiativeUpdateArgs {
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}. */
const LINEAR_INITIATIVE_UPDATE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_INITIATIVE_UPDATE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_INITIATIVE_UPDATE_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_INITIATIVE_UPDATE_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear initiative-update create …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearInitiativeUpdateArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearInitiativeUpdateArgs, LinearVerbError> {
  return parseLinearFormCreateArgs({ argv, flags: LINEAR_INITIATIVE_UPDATE_FLAGS, noun: "initiative-update" });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearInitiativeUpdateForm({
  raw,
}: {
  raw: string;
}): Result<LinearInitiativeUpdateForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearInitiativeUpdateFormSchema });
}

/**
 * The deterministic initiative-update id for an intent, in UUID v4 layout.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 */
export function initiativeUpdateIntentId({ form }: { form: LinearInitiativeUpdateForm }): string {
  const material = JSON.stringify({
    body: renderInitiativeUpdateBody({ artifact: form.artifact }),
    fields: form.fields,
  });
  const hex = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The `InitiativeUpdateCreateInput` fields, built from the validated form.
 *
 * @param form the validated form
 * @returns the provider input
 */
export function initiativeUpdateInputFor({
  form,
}: {
  form: LinearInitiativeUpdateForm;
}): Readonly<Record<string, unknown>> {
  return {
    body: renderInitiativeUpdateBody({ artifact: form.artifact }),
    health: form.fields.health,
    initiativeId: form.fields.initiativeId,
  };
}

/**
 * The dry-run preview: the exact bytes that would be sent, plus the destination and the declared health.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function initiativeUpdateDryRunLines({
  form,
  id,
}: {
  form: LinearInitiativeUpdateForm;
  id: string;
}): readonly string[] {
  const body = renderInitiativeUpdateBody({ artifact: form.artifact });
  return [
    `update id:  ${id}  (derived from the intent, so a retry reuses it)`,
    `initiative: ${form.fields.initiativeId}`,
    `health:     ${form.fields.health}`,
    `evidence:   ${String(evidenceLinkCount({ artifact: form.artifact }))} link(s)`,
    `body bytes: ${String(Buffer.byteLength(body, "utf8"))}`,
    "--- update ---",
    body,
    "--- end ---",
  ];
}

/** How many evidence links an update carries; evidence is optional on an update, so an omitted list is none. */
function evidenceLinkCount({ artifact }: { artifact: LinearInitiativeUpdateForm["artifact"] }): number {
  const evidence = unsetFieldAsNull({ key: "evidence", record: artifact });
  if (evidence === null) {
    return 0;
  }
  return evidence.length;
}

/** What became of an initiative-update write. The same arms a project-update create has. */
export type LinearInitiativeUpdateOutcome =
  | { readonly kind: "written"; readonly update: ReadInitiativeUpdate }
  | { readonly kind: "unconfirmed"; readonly update: WrittenObject }
  | { readonly kind: "landed"; readonly update: ReadInitiativeUpdate; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The operator-facing report for an initiative-update outcome.
 *
 * A successful report states the health Linear ECHOED, not the one the form asked for — the same call
 * `./projectUpdateCore.ts` makes, and for the same reason: health is the field a reader acts on.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function initiativeUpdateOutcomeLines({
  outcome,
}: {
  outcome: LinearInitiativeUpdateOutcome;
}): readonly string[] {
  switch (outcome.kind) {
    case "written":
      return [`posted the initiative update, health ${outcome.update.health}`, outcome.update.url];
    case "unconfirmed":
      return [
        "the initiative update was posted but could NOT be read back, so its state is unverified.",
        `Linear echoes only an id on a write, so there is no URL to print until a read succeeds: ${outcome.update.id}`,
        "Do not re-run this: the mutation may have landed. Check the initiative, then reconcile.",
      ];
    case "landed":
      return [
        "posted the initiative update, despite a transport error — it was found at the id we chose.",
        outcome.update.url,
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact initiative update was already reserved at ${outcome.reservedIso}.`,
        "The id is derived from the initiative, the health and the rendered body, so the same report on the",
        "same initiative cannot be posted twice.",
        "Change the update, or delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the update could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look at the initiative in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for an initiative-update write.
 *
 * `createsWorkItem` is FALSE for the reason `./projectUpdateCore.ts` records: a status update creates
 * nothing anyone has to triage. It notifies every member watching the initiative, which is why it is an
 * approval-gated `external-write` like every other send here.
 *
 * @param home the resolved state home
 * @param id the initiative-update id
 * @param initiativeId the destination, recorded so the audit trail says where the write landed
 * @param health what the update declares, recorded because it is the field a reader acts on
 * @returns the request to admit
 */
export function initiativeUpdateDoorRequestFor({
  home,
  id,
  initiativeId,
  health,
}: {
  home: string;
  id: string;
  initiativeId: string;
  health: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: "initiative-update create" },
    artifact: { health, id, initiativeId },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
