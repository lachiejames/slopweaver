/**
 * The typed failures `slopweaver proposal`'s argument parsers author — a flag that did not parse, a missing
 * positional, a required flag left off, a value outside its enum, a filled form that will not decode, and a
 * re-publish whose recorded address cannot be reconciled with the install's destination.
 *
 * A union of its own per `.claude/rules/error-handling.md`. A variant carrying `reasons` keeps one line per
 * problem, and {@link proposalErrorLines} is how a verb prints them: every runner here refuses one stderr
 * line per entry, exactly as the `readonly string[]` it replaced did.
 *
 * Pure: values in, values out.
 */
import { FEEDBACK_KIND_LIST, REGISTER_STATUS_LIST, SETTABLE_STATUS_LIST } from "./registerUsage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** Every failure a `proposal` verb's parser authors. */
export type ProposalError =
  | Listed<"FLAGS_INVALID">
  | (Plain<"USAGE"> & { readonly usage: string })
  | Plain<"DRAFT_FORM_REQUIRED">
  | (Plain<"FORM_NOT_JSON"> & { readonly detail: string })
  | Listed<"FORM_INVALID">
  | Plain<"INTAKE_BRIEF_REQUIRED">
  | Plain<"TEASER_FORM_REQUIRED">
  | Plain<"TEASER_TARGET_REQUIRED">
  | (Plain<"REGISTER_STATUS_UNKNOWN"> & { readonly status: string })
  | (Plain<"STATUS_NOT_SETTABLE"> & { readonly status: string })
  | Plain<"WHY_REQUIRED">
  | (Plain<"DATE_INVALID"> & { readonly name: string; readonly raw: string })
  | Plain<"DECISION_FIELDS_REQUIRED">
  | (Plain<"DECISION_OUTCOME_UNKNOWN"> & { readonly outcome: string })
  | Plain<"SUPERSEDE_FIELDS_REQUIRED">
  | Plain<"PERMALINK_REQUIRED">
  | Plain<"FOLLOW_UP_REF_REQUIRED">
  | Listed<"FEEDBACK_FIELDS_REQUIRED">
  | (Plain<"FEEDBACK_KIND_UNKNOWN"> & { readonly kind: string })
  | (Plain<"FEEDBACK_LOCATION_REQUIRED"> & { readonly kinds: readonly string[] })
  | Listed<"ANSWER_FIELDS_REQUIRED">
  | Plain<"AUDIENCE_REQUIRED">
  | Plain<"SYNC_SOURCE_REQUIRED">
  | Plain<"SYNC_SOURCE_EMPTY">
  | (Plain<"SYNC_LIMIT_INVALID"> & { readonly max: number })
  | (Plain<"PUBLISH_PARENT_RETIRED"> & { readonly hint: string })
  | (Plain<"DESTINATION_KIND_UNKNOWN"> & { readonly kind: string })
  | (Plain<"DESTINATION_FIELD_INVALID"> & { readonly flag: string })
  | (Plain<"REPUBLISH_PROVIDER_MISMATCH"> & { readonly published: string; readonly configured: string })
  | (Plain<"REPUBLISH_ADDRESS_INCOMPLETE"> & { readonly intakeId: string })
  | (Plain<"PUBLISH_TITLE_REQUIRED"> & { readonly destinationKind: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ProposalErrors = {
  answerFieldsRequired: ({ usage }: { usage: string }): ProposalError =>
    listed({ code: "ANSWER_FIELDS_REQUIRED", reasons: ["--id and --how are both required", usage] }),
  audienceRequired: (): ProposalError => ({
    code: "AUDIENCE_REQUIRED",
    message: '--audience "<who this is addressed to>" is required',
  }),
  dateInvalid: ({ name, raw }: { name: string; raw: string }): ProposalError => ({
    code: "DATE_INVALID",
    message: `--${name} "${raw}" is not a readable ISO-8601 timestamp`,
    name,
    raw,
  }),
  decisionFieldsRequired: (): ProposalError => ({
    code: "DECISION_FIELDS_REQUIRED",
    message: "--decision, --decider and --why are all required",
  }),
  decisionOutcomeUnknown: ({ outcome }: { outcome: string }): ProposalError => ({
    code: "DECISION_OUTCOME_UNKNOWN",
    message: `"${outcome}" is not a decision outcome — it is approved or rejected`,
    outcome,
  }),
  destinationFieldInvalid: ({ flag, why }: { flag: string; why: string }): ProposalError => ({
    code: "DESTINATION_FIELD_INVALID",
    flag,
    message: `--${flag} ${why}`,
  }),
  destinationKindUnknown: ({ kind, known }: { kind: string; known: readonly string[] }): ProposalError => ({
    code: "DESTINATION_KIND_UNKNOWN",
    kind,
    message: `"${kind}" is not a proposal destination this build can publish to — it is one of ${known.join(", ")}`,
  }),
  draftFormRequired: (): ProposalError => ({
    code: "DRAFT_FORM_REQUIRED",
    message: "--form <json|-> is required (use `-` to read the filled form from stdin, or --form-example)",
  }),
  feedbackFieldsRequired: ({ usage }: { usage: string }): ProposalError =>
    listed({ code: "FEEDBACK_FIELDS_REQUIRED", reasons: ["--kind, --who and --what are all required", usage] }),
  feedbackKindUnknown: ({ kind }: { kind: string }): ProposalError => ({
    code: "FEEDBACK_KIND_UNKNOWN",
    kind,
    message: `"${kind}" is not a feedback kind — it is one of ${FEEDBACK_KIND_LIST}`,
  }),
  feedbackLocationRequired: ({ kinds }: { kinds: readonly string[] }): ProposalError => ({
    code: "FEEDBACK_LOCATION_REQUIRED",
    kinds,
    message:
      `--where <permalink> is required for ${kinds.join(" and ")} — answering it means ` +
      "going back to where it was raised",
  }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): ProposalError =>
    listed({ code: "FLAGS_INVALID", reasons }),
  followUpRefRequired: (): ProposalError => ({
    code: "FOLLOW_UP_REF_REQUIRED",
    message: "--ref <handover-doc|linear-ticket|pr-url> is required",
  }),
  formInvalid: ({ reasons }: { reasons: readonly string[] }): ProposalError =>
    listed({ code: "FORM_INVALID", reasons }),
  formNotJson: ({ detail }: { detail: string }): ProposalError => ({
    code: "FORM_NOT_JSON",
    detail,
    message: `the form is not valid JSON: ${detail}`,
  }),
  intakeBriefRequired: (): ProposalError => ({
    code: "INTAKE_BRIEF_REQUIRED",
    message: '--brief "<what this proposal is about>" is required',
  }),
  permalinkRequired: (): ProposalError => ({ code: "PERMALINK_REQUIRED", message: "--permalink <url> is required" }),
  publishParentRetired: ({ hint }: { hint: string }): ProposalError => ({
    code: "PUBLISH_PARENT_RETIRED",
    hint,
    message:
      "--parent is no longer a publish flag: where a proposal goes is this install's choice, held in the store " +
      `rather than repeated on every run. Set it once with: ${hint}`,
  }),
  publishTitleRequired: ({ destinationKind }: { destinationKind: string }): ProposalError => ({
    code: "PUBLISH_TITLE_REQUIRED",
    destinationKind,
    message:
      `--title "<text>" is required to publish to a ${destinationKind}: the rendered proposal carries no title ` +
      "of its own, and that destination has nowhere else to take one from. Nothing was published.",
  }),
  republishAddressIncomplete: ({ intakeId }: { intakeId: string }): ProposalError => ({
    code: "REPUBLISH_ADDRESS_INCOMPLETE",
    intakeId,
    message:
      `intake ${intakeId} records only the URL of the page it published, not its id, so a re-publish can neither ` +
      "update that page nor safely create a second one. Nothing was published.",
  }),
  republishProviderMismatch: ({ published, configured }: { published: string; configured: string }): ProposalError => ({
    code: "REPUBLISH_PROVIDER_MISMATCH",
    configured,
    message:
      `this proposal was published to ${published}, but the install now publishes to ${configured}; a re-publish ` +
      "would leave the first copy behind as a second, stale one. Nothing was published.",
    published,
  }),
  registerStatusUnknown: ({ status }: { status: string }): ProposalError => ({
    code: "REGISTER_STATUS_UNKNOWN",
    message: `"${status}" is not a register status — it is one of ${REGISTER_STATUS_LIST}`,
    status,
  }),
  statusNotSettable: ({ status }: { status: string }): ProposalError => ({
    code: "STATUS_NOT_SETTABLE",
    message:
      `"${status}" is not a status this verb may set — it takes ${SETTABLE_STATUS_LIST}. ` +
      "Use `proposal decide`/`proposal supersede` for a decision, a rejection or a supersession.",
    status,
  }),
  supersedeFieldsRequired: (): ProposalError => ({
    code: "SUPERSEDE_FIELDS_REQUIRED",
    message: "--by and --why are both required",
  }),
  syncLimitInvalid: ({ max }: { max: number }): ProposalError => ({
    code: "SYNC_LIMIT_INVALID",
    max,
    message: `--limit must be an integer from 1 to ${String(max)}`,
  }),
  syncSourceEmpty: (): ProposalError => ({
    code: "SYNC_SOURCE_EMPTY",
    message: "--source named nothing usable after trimming",
  }),
  syncSourceRequired: (): ProposalError => ({
    code: "SYNC_SOURCE_REQUIRED",
    message:
      "--source <notion-page-id-or-url>[,<id-or-url>,...] is required. `proposal sync` discovers direct " +
      "child pages under each source; it never searches the workspace and never invents a status for what it finds.",
  }),
  teaserFormRequired: (): ProposalError => ({
    code: "TEASER_FORM_REQUIRED",
    message: "--form <json|-> is required; the teaser is a field on the same form the draft came from",
  }),
  teaserTargetRequired: (): ProposalError => ({
    code: "TEASER_TARGET_REQUIRED",
    message:
      "--page <url> or --intake <id> is required. A teaser leads with the link to the published proposal, " +
      "so there is nothing to render before the document exists.",
  }),
  usage: ({ usage }: { usage: string }): ProposalError => ({ code: "USAGE", message: usage, usage }),
  whyRequired: (): ProposalError => ({ code: "WHY_REQUIRED", message: '--why "<reason>" is required' }),
} as const;

/**
 * The lines a {@link ProposalError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function proposalErrorLines({ error }: { error: ProposalError }): readonly string[] {
  if (
    error.code === "FLAGS_INVALID" ||
    error.code === "FORM_INVALID" ||
    error.code === "FEEDBACK_FIELDS_REQUIRED" ||
    error.code === "ANSWER_FIELDS_REQUIRED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
