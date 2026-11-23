/**
 * The PURE core of `linear document create|update` — argument parsing, form validation, the deterministic
 * intent id, the provider inputs, the dry-run preview and the outcome report. No I/O, so all of it is
 * unit-testable without a mock.
 *
 * ## The intent id
 *
 * Same construction as `./projectCore.ts`'s `projectIntentId`, over the fields AND the rendered content: the
 * same proposal to the same destination computes the same id in any process on any day, so a retry finds the
 * reservation instead of creating a second page. It is taken over the ORIGINAL form, before references are
 * linked and mentions resolved, so a roster refresh between two attempts cannot change which page is meant.
 *
 * ## Update replaces the page, and only the page
 *
 * An update sends `title` and `content` and nothing else. The destination is recorded at create and a form
 * naming a different one is refused (`./documentWrite.ts`), because what `DocumentUpdateInput` does with a
 * second parent id, or a cleared one, is undocumented and unmeasured.
 */
import { createHash } from "node:crypto";

import type { DoorRequest } from "../../../admit/types.js";
import type { ReadLinearDocument } from "../../../corpus/linear/writeDocument.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { renderDocumentContent } from "../../../outbound/linear/documentRender.js";
import { linearDocumentFormSchema } from "../../../outbound/linear/documentSchema.js";
import type {
  LinearDocumentDestination,
  LinearDocumentDestinationKind,
  LinearDocumentForm,
} from "../../../outbound/linear/documentTypes.js";
import { type FidelityReport, fidelityLines } from "../../../outbound/linear/fidelity.js";
import { parseVerifiedMentionIds } from "../../../outbound/linear/mentionIndex.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { isValidIssueId } from "./core.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { parseLinearForm } from "./formParse.js";

/** A parsed `linear document` invocation. */
export interface LinearDocumentArgs {
  readonly verb: "create" | "update";
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly home: string | undefined;
  /** The document to update; required for `update`, refused for `create`, whose id is derived. */
  readonly documentId: string | undefined;
  /** The `--mention-id key=<linear-user-id>` pairs the caller verified live — see `./formCreateArgs.ts`. */
  readonly mentionIds: ReadonlyMap<string, string>;
}

/** The flags this verb accepts, as a {@link FlagSpec}; `helpTruth.test.ts` reads the names derived below. */
const LINEAR_DOCUMENT_FLAGS: FlagSpec = {
  boolean: ["dry-run"],
  string: ["form", "document-id", "home", "mention-id"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_DOCUMENT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINEAR_DOCUMENT_FLAGS }),
  ...booleanFlagsOf({ spec: LINEAR_DOCUMENT_FLAGS }),
].map((name) => `--${name}`);

/** The `--document-id` problems for one verb: required and a UUID v4 on update, absent on create. */
function documentIdProblems({
  verb,
  documentId,
}: {
  verb: "create" | "update";
  documentId: string | undefined;
}): readonly string[] {
  if (verb === "create") {
    return documentId === undefined
      ? []
      : ["--document-id is for update only; a create derives its id from the form so a retry reuses it"];
  }
  if (documentId === undefined) {
    return ["--document-id <uuid> is required for update; it is the id slopweaver reserved when it created the page"];
  }
  // `--document-id` reaches a ledger filename, so it takes `linear issue`'s UUID v4 guard for the same reason.
  return isValidIssueId({ id: documentId })
    ? []
    : [`--document-id must be a UUID v4; "${documentId}" is not, and it would reach a ledger filename`];
}

/**
 * Parse `linear document <create|update> …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearDocumentArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<LinearDocumentArgs, LinearVerbError> {
  const verb = argv[0];
  if (verb !== "create" && verb !== "update") {
    return err(LinearVerbErrors.usage({ noun: "document", shape: "<create|update>" }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: LINEAR_DOCUMENT_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formSource = typeof values["form"] === "string" ? values["form"] : undefined;
  const documentId = typeof values["document-id"] === "string" ? values["document-id"] : undefined;
  const mentions = parseVerifiedMentionIds({
    raw: typeof values["mention-id"] === "string" ? values["mention-id"] : undefined,
  });
  const missingForm =
    formSource === undefined ? ["--form <json|-> is required (use `-` to read the form from stdin)"] : [];
  const problems = [...missingForm, ...documentIdProblems({ documentId, verb }), ...mentions.errors];
  if (formSource === undefined || problems.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: problems }));
  }
  return ok({
    documentId,
    dryRun: values["dry-run"] === true,
    formSource,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    mentionIds: mentions.verified,
    verb,
  });
}

/**
 * Validate a filled form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseLinearDocumentForm({ raw }: { raw: string }): Result<LinearDocumentForm, LinearVerbError> {
  return parseLinearForm({ raw, schema: linearDocumentFormSchema });
}

/**
 * The deterministic document id for an intent, in UUID v4 layout, over the fields plus the rendered content.
 *
 * @param form the ORIGINAL form, before references are linked or mentions resolved
 * @returns the UUID this intent always maps to
 */
export function documentIntentId({ form }: { form: LinearDocumentForm }): string {
  const material = JSON.stringify({ content: renderDocumentContent({ content: form.content }), fields: form.fields });
  const hex = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`;
  return [uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20, 32)].join("-");
}

/**
 * The document id this write targets: the operator's `--document-id` for an update, the intent's own id for
 * a create. `parseLinearDocumentArgs` already refuses an update without one and a create with one.
 *
 * @param args the parsed invocation
 * @param form the ORIGINAL form
 * @returns the id the write reserves or replaces
 */
export function documentWriteId({ args, form }: { args: LinearDocumentArgs; form: LinearDocumentForm }): string {
  if (args.documentId === undefined) {
    return documentIntentId({ form });
  }
  return args.documentId;
}

/** Which `DocumentCreateInput` field each destination kind fills. */
const DESTINATION_FIELD: Readonly<Record<LinearDocumentDestinationKind, string>> = {
  initiative: "initiativeId",
  issue: "issueId",
  project: "projectId",
  team: "teamId",
};

/**
 * The `DocumentCreateInput` fields, minus the id the API seam folds in.
 *
 * @param form the form as it will be sent — references linked, mentions resolved
 * @returns the provider input
 */
export function documentCreateInputFor({ form }: { form: LinearDocumentForm }): Readonly<Record<string, unknown>> {
  return {
    content: renderDocumentContent({ content: form.content }),
    [DESTINATION_FIELD[form.fields.destination.kind]]: form.fields.destination.id,
    title: form.fields.title,
  };
}

/**
 * The `DocumentUpdateInput` fields: the title and the page, never a parent — see the module doc.
 *
 * @param form the form as it will be sent
 * @returns the provider input
 */
export function documentUpdateInputFor({ form }: { form: LinearDocumentForm }): Readonly<Record<string, unknown>> {
  return { content: renderDocumentContent({ content: form.content }), title: form.fields.title };
}

/**
 * Whether two destinations name the same object, compared exactly as written.
 *
 * @param a one destination
 * @param b the other
 * @returns true when kind and id both match
 */
export function sameDestination({ a, b }: { a: LinearDocumentDestination; b: LinearDocumentDestination }): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * The dry-run preview: the destination, the title and the exact markdown that would be sent — rendered by the
 * same function the send uses, because a preview from a second code path is a preview of something else.
 *
 * @param args the parsed invocation, for the verb
 * @param form the form as it would be sent
 * @param id the id the write would reserve or replace
 * @param mentions the mention keys the page names
 * @returns the operator-facing lines
 */
export function documentDryRunLines({
  args,
  form,
  id,
  mentions,
}: {
  args: LinearDocumentArgs;
  form: LinearDocumentForm;
  id: string;
  mentions: readonly string[];
}): readonly string[] {
  const content = renderDocumentContent({ content: form.content });
  const idLine =
    args.verb === "create"
      ? `document id: ${id}  (derived from the intent, so a retry reuses it)`
      : `document id: ${id}  (replacing this page's title and content)`;
  return [
    idLine,
    `destination: ${form.fields.destination.kind} ${form.fields.destination.id}`,
    `title:       ${form.fields.title}`,
    ...(mentions.length === 0 ? [] : [`notifies:    ${mentions.join(", ")}`]),
    `content bytes: ${String(Buffer.byteLength(content, "utf8"))}`,
    "--- content ---",
    content,
    "--- end ---",
  ];
}

/**
 * What became of a document write. A project write's six arms, for the same reasons, plus `unapplied`: an
 * update Linear acknowledged whose read-back shows the page exactly where the precheck left it.
 */
export type LinearDocumentOutcome =
  | { readonly kind: "written"; readonly document: ReadLinearDocument; readonly fidelity: FidelityReport }
  | { readonly kind: "unconfirmed"; readonly id: string }
  | { readonly kind: "unapplied"; readonly document: ReadLinearDocument }
  | {
      readonly kind: "landedAfterError";
      readonly document: ReadLinearDocument;
      readonly reason: string;
      readonly fidelity: FidelityReport;
    }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string | undefined }
  | { readonly kind: "failed"; readonly reason: string };

/** The duplicate report's first line: when the slot was reserved, or that it could not be read. */
function duplicateLead({ reservedIso }: { reservedIso: string | undefined }): string {
  if (reservedIso === undefined) {
    return "refused: this exact intent's ledger slot is taken and could not be read, so it counts as reserved.";
  }
  return `refused: this exact intent was already reserved at ${reservedIso}.`;
}

/**
 * The operator-facing report for a document outcome.
 *
 * @param outcome what happened
 * @param verb which action was attempted
 * @returns the lines to print
 */
export function documentOutcomeLines({
  outcome,
  verb,
}: {
  outcome: LinearDocumentOutcome;
  verb: "create" | "update";
}): readonly string[] {
  const past = verb === "create" ? "created" : "updated";
  switch (outcome.kind) {
    case "written":
      return [
        `${past} document "${outcome.document.title}"`,
        outcome.document.url,
        `document id: ${outcome.document.id}`,
        ...fidelityLines({ report: outcome.fidelity }),
      ];
    case "unconfirmed":
      return [
        `the document at ${outcome.id} was ${past} but could NOT be read back, so its state is unverified.`,
        "Linear echoes only an id on a write, so there is no title or URL to print until a read succeeds.",
        "Do not re-run this: the mutation may have landed. Check the document, then reconcile.",
      ];
    case "unapplied":
      return [
        `Linear acknowledged the update to "${outcome.document.title}", but the page reads as it did before it ` +
          `(updatedAt ${outcome.document.updatedAt} has not moved), so nothing shows the update applied.`,
        outcome.document.url,
        "Read the page in Linear. Re-running is safe: an update replaces the page, and the edit guard still holds.",
      ];
    case "duplicate":
      return [
        duplicateLead({ reservedIso: outcome.reservedIso }),
        "The document id is derived from the content, so an identical form maps to the identical page.",
        "To change the page, run `linear document update --document-id <id>` with the edited form.",
      ];
    case "landedAfterError":
      return [
        `${past} document "${outcome.document.title}", despite a transport error — found at the id we chose.`,
        outcome.document.url,
        `the error was: ${outcome.reason}`,
        ...fidelityLines({ report: outcome.fidelity }),
      ];
    case "indeterminate":
      return [
        "the mutation errored AND the document could not be proven written, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look at the document in Linear, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for a document write.
 *
 * `createsWorkItem` is true only for a create, the standing `./projectCore.ts`'s request takes: a new page is
 * something a team notices, and an edit to one slopweaver already made is not.
 *
 * @param verb which action is being admitted
 * @param destination where the page lives, recorded so the audit trail says where the write landed
 * @param home the resolved state home
 * @param id the document id
 * @returns the request to admit
 */
export function documentDoorRequestFor({
  verb,
  destination,
  home,
  id,
}: {
  verb: "create" | "update";
  destination: LinearDocumentDestination;
  home: string;
  id: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: `document ${verb}` },
    artifact: { destination: `${destination.kind}:${destination.id}`, id },
    meta: {
      createsWorkItem: verb === "create",
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
