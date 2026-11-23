/**
 * The PURE core of `linear project-update create` — argument parsing, form validation, the dry-run preview,
 * and the deterministic intent id. No I/O, so all of it is unit-testable without a mock.
 *
 * ## The intent id, and why health is part of it
 *
 * A project update is append-shaped like a comment, so a retry's failure mode is a DUPLICATE report and a
 * second notification to everyone watching. The id is a UUID v4-shaped digest of the destination project,
 * the declared health and the RENDERED body, so the same update on the same project computes the same id in
 * any process on any day and the second attempt is refused by its own reservation.
 *
 * Health is in the digest deliberately. The same words at a different health are a DIFFERENT report — "we
 * are still shipping, and now off track" is not the update that said "on track" — so changing only the
 * health must produce a new id rather than collide with the earlier one.
 *
 * ## An update that answers an overdue window is keyed by the WINDOW
 *
 * A `cycle reconcile` proposal drafts its body fresh on every pass, so a body digest let one proposal be
 * answered twice — measured, a second pass re-proposed three just-posted projects, and a second
 * `post` would have minted a new id, reserved cleanly and notified every watcher again. A form carrying
 * `fields.overdueSince` (the proposal's `movedAtIso`) is therefore keyed by the project and that instant
 * alone: redrafting the words or changing the health cannot mint a second report for the same window, while
 * a real post moves the project's last update, so the next overdue window gets a new id. Without the field,
 * the body digest above is unchanged, byte for byte.
 */
import { createHash } from "node:crypto";

import { unsetFieldAsNull } from "#lib/absent.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { ReadProjectUpdate, WrittenObject } from "../../../corpus/linear/write.js";
import type { Result } from "../../../lib/result.js";
import { linearProjectUpdateFormSchema } from "../../../outbound/linear/projectUpdateSchema.js";
import type { LinearProjectUpdateForm } from "../../../outbound/linear/projectUpdateTypes.js";
import { renderProjectUpdateBody } from "../../../outbound/linear/render.js";
import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../parseFlags.js";
import type { LinearVerbError } from "./errors.js";
import { parseLinearFormCreateArgs } from "./formCreateArgs.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear project-update create` invocation. */
export interface LinearProjectUpdateArgs {
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}. */
const LINEAR_PROJECT_UPDATE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_PROJECT_UPDATE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_PROJECT_UPDATE_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_PROJECT_UPDATE_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear project-update create …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearProjectUpdateArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearProjectUpdateArgs, LinearVerbError> {
  return parseLinearFormCreateArgs({ argv, flags: LINEAR_PROJECT_UPDATE_FLAGS, noun: "project-update" });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearProjectUpdateForm({
  raw,
}: {
  raw: string;
}): Result<LinearProjectUpdateForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearProjectUpdateFormSchema });
}

/**
 * The deterministic project-update id for an intent, in UUID v4 layout.
 *
 * @param form the complete write
 * @returns the UUID this intent always maps to
 */
export function projectUpdateIntentId({ form }: { form: LinearProjectUpdateForm }): string {
  const { overdueSince } = form.fields;
  // An update answering a named overdue window is keyed by that window alone — see the module doc.
  const material =
    overdueSince === undefined
      ? JSON.stringify({ body: renderProjectUpdateBody({ artifact: form.artifact }), fields: form.fields })
      : JSON.stringify({ overdueSince, projectId: form.fields.projectId });
  const hex = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The `ProjectUpdateCreateInput` fields, built from the validated form.
 *
 * @param form the validated form
 * @returns the provider input
 */
export function projectUpdateInputFor({ form }: { form: LinearProjectUpdateForm }): Readonly<Record<string, unknown>> {
  return {
    body: renderProjectUpdateBody({ artifact: form.artifact }),
    health: form.fields.health,
    projectId: form.fields.projectId,
  };
}

/**
 * The dry-run preview: the exact bytes that would be sent, plus the destination and the declared health.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @returns the operator-facing lines
 */
export function projectUpdateDryRunLines({
  form,
  id,
}: {
  form: LinearProjectUpdateForm;
  id: string;
}): readonly string[] {
  const body = renderProjectUpdateBody({ artifact: form.artifact });
  return [
    `update id:  ${id}  (derived from the intent, so a retry reuses it)`,
    `project:    ${form.fields.projectId}`,
    `health:     ${form.fields.health}`,
    ...(form.fields.overdueSince === undefined
      ? []
      : [`answers:    the window overdue since ${form.fields.overdueSince} (the id is keyed by it, not the body)`]),
    `evidence:${String(evidenceLinkCount({ artifact: form.artifact }))} link(s)`,
    `body bytes: ${String(Buffer.byteLength(body, "utf8"))}`,
    "--- update ---",
    body,
    "--- end ---",
  ];
}

/** How many evidence links a project update carries; its evidence is optional (see the type), so omitted is none. */
function evidenceLinkCount({ artifact }: { artifact: LinearProjectUpdateForm["artifact"] }): number {
  const evidence = unsetFieldAsNull({ key: "evidence", record: artifact });
  if (evidence === null) {
    return 0;
  }
  return evidence.length;
}

/** What became of a project-update write. The same arms a comment create has. */
export type LinearProjectUpdateOutcome =
  | { readonly kind: "written"; readonly update: ReadProjectUpdate }
  | { readonly kind: "unconfirmed"; readonly update: WrittenObject }
  | { readonly kind: "landed"; readonly update: ReadProjectUpdate; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The operator-facing report for a project-update outcome.
 *
 * A successful report states the health Linear ECHOED, not the one the form asked for. They are the same
 * every time until they are not, and health is the field a reader of the project acts on.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function projectUpdateOutcomeLines({ outcome }: { outcome: LinearProjectUpdateOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "written":
      return [`posted the project update, health ${outcome.update.health}`, outcome.update.url];
    case "unconfirmed":
      return [
        "the project update was posted but could NOT be read back, so its state is unverified.",
        `Linear echoes only an id on a write, so there is no URL to print until a read succeeds: ${outcome.update.id}`,
        "Do not re-run this: the mutation may have landed. Check the project, then reconcile.",
      ];
    case "landed":
      return [
        "posted the project update, despite a transport error — it was found at the id we chose.",
        outcome.update.url,
        `the error was: ${outcome.reason}`,
      ];
    case "duplicate":
      return [
        `refused: this exact project update was already reserved at ${outcome.reservedIso}.`,
        "The id is derived from the project, the health and the rendered body, so the same report on the",
        "same project cannot be posted twice.",
        "Change the update, or delete the ledger record if the earlier attempt definitely did not land.",
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the update could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look at the project in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for a project-update write.
 *
 * `createsWorkItem` is FALSE: a status update creates nothing anyone has to triage. It notifies every member
 * watching the project, which is why it is an approval-gated `external-write` like every other send here.
 *
 * @param home the resolved state home
 * @param id the project-update id
 * @param projectId the destination project, recorded so the audit trail says where the write landed
 * @param health what the update declares, recorded because it is the field a reader acts on
 * @returns the request to admit
 */
export function projectUpdateDoorRequestFor({
  home,
  id,
  projectId,
  health,
}: {
  home: string;
  id: string;
  projectId: string;
  health: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: "project-update create" },
    artifact: { health, id, projectId },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
