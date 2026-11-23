/**
 * The typed failures the `atlas vanta` and `write vanta` verbs author themselves: a file a verb reads or
 * writes on the local side of a request, a flag left out or given a value it cannot use, a `--form` document
 * that is not the batch it names, and the refusals a write carries back from its client or its pre-door checks.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. Only how a refusal
 * is TYPED lives here: every request, payload, door and hatch these verbs reach is unchanged, and the lists a
 * client, a renderer or the dead-host refusal hand back ride as `reasons`, printed one line each as they came.
 */
import {
  isVantaCredentialUnset,
  type VantaCredentialError,
  vantaCredentialErrorsLines,
} from "../../../atlas/vanta/credentialErrors.js";
import { errorMessage } from "../../../lib/errorMessage.js";

/** A local file a verb needs to read could not be read. */
export interface VantaFileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A local file a verb writes — an evidence document, a rendered page or PDF — could not be written. */
export interface VantaFileUnwritableError {
  readonly code: "FILE_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** A flag the verb cannot run without was not given. */
export interface VantaFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/**
 * The flag tail itself was refused by the shared parser — an unknown flag, a value flag with no value after it,
 * a stray positional; `reasons` is its own list. Distinct from {@link VantaFlagMissingError}: a value flag the
 * caller DID name but gave no value is refused here, never read as "not passed", so it cannot silently swap in
 * whatever an absent flag means.
 */
export interface VantaFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A flag was given a value that names nothing it can act on; `got` is what arrived. */
export interface VantaInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** The `--form` document is not JSON at all. */
export interface VantaFormNotJsonError {
  readonly code: "FORM_NOT_JSON";
  readonly message: string;
}

/** The `--form` document is JSON, and not an object carrying an `updates` array. */
export interface VantaFormWrongShapeError {
  readonly code: "FORM_WRONG_SHAPE";
  readonly message: string;
}

/** One or more `updates` entries are not a valid deactivation; `reasons` names each issue, by index and path. */
export interface VantaFormEntriesInvalidError {
  readonly code: "FORM_ENTRIES_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A write request of a kind this verb does not send reached the write step. */
export interface VantaRequestUnperformableError {
  readonly code: "REQUEST_UNPERFORMABLE";
  readonly message: string;
  readonly kind: string;
}

/** The write client reached Vanta, or tried to, and refused; `reasons` is its own list. */
export interface VantaWriteFailedError {
  readonly code: "WRITE_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The policy source carries a refusal the upload stops on before anything is rendered; `reasons` is its lines. */
export interface VantaPolicyUploadRefusedError {
  readonly code: "POLICY_UPLOAD_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The policy markdown could not be rendered to a PDF; `reasons` is the renderer's own list. */
export interface VantaPdfRenderFailedError {
  readonly code: "PDF_RENDER_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The rendered PDF the approval covers could not be read back from disk just before it was attached. */
export interface VantaPolicyUploadPdfUnreadableError {
  readonly code: "POLICY_UPLOAD_PDF_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/**
 * The rendered PDF on disk no longer hashes to the `pdfSha256` the approved digest covers, so attaching it
 * would upload bytes nobody approved.
 */
export interface VantaPolicyUploadPdfChangedError {
  readonly code: "POLICY_UPLOAD_PDF_CHANGED";
  readonly message: string;
  readonly path: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
}

/**
 * The credential pair or the workspace slug could not be resolved; `errors` are the resolver's own typed
 * failures, carried through rather than flattened, so the exit a verb picks is decided by their codes.
 */
export interface VantaCredentialsUnresolvedError {
  readonly code: "CREDENTIALS_UNRESOLVED";
  readonly message: string;
  readonly errors: readonly VantaCredentialError[];
  readonly reasons: readonly string[];
}

/**
 * A live read reached Vanta, or tried to, and failed — or what it answered could not be built into the
 * verb's document; `reasons` is the client's (or the builder's) own list.
 */
export interface VantaReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure this verb directory authors. */
export type VantaVerbError =
  | VantaCredentialsUnresolvedError
  | VantaReadFailedError
  | VantaFileUnreadableError
  | VantaFileUnwritableError
  | VantaFlagMissingError
  | VantaFlagsRefusedError
  | VantaInvalidFlagValueError
  | VantaFormNotJsonError
  | VantaFormWrongShapeError
  | VantaFormEntriesInvalidError
  | VantaRequestUnperformableError
  | VantaWriteFailedError
  | VantaPolicyUploadRefusedError
  | VantaPdfRenderFailedError
  | VantaPolicyUploadPdfUnreadableError
  | VantaPolicyUploadPdfChangedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VantaVerbErrors = {
  credentialsUnresolved: ({ errors }: { errors: readonly VantaCredentialError[] }): VantaCredentialsUnresolvedError => {
    const reasons = vantaCredentialErrorsLines({ errors });
    return { code: "CREDENTIALS_UNRESOLVED", errors, message: reasons.join("; "), reasons };
  },
  evidenceUnfileable: ({ path, cause }: { path: string; cause: unknown }): VantaFileUnwritableError => ({
    code: "FILE_UNWRITABLE",
    message: `could not file the evidence document at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  flagsRefused: ({ reasons }: { reasons: readonly string[] }): VantaFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  formEntriesInvalid: ({ reasons }: { reasons: readonly string[] }): VantaFormEntriesInvalidError => ({
    code: "FORM_ENTRIES_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  formNotJson: (): VantaFormNotJsonError => ({
    code: "FORM_NOT_JSON",
    message: "--form did not contain valid JSON",
  }),
  formNotUpdatesObject: (): VantaFormWrongShapeError => ({
    code: "FORM_WRONG_SHAPE",
    message: '--form must be a JSON object with an "updates" array',
  }),
  formUnreadable: ({ path, cause }: { path: string; cause: unknown }): VantaFileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `could not read --form at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  formUpdatesNotArray: (): VantaFormWrongShapeError => ({
    code: "FORM_WRONG_SHAPE",
    message: '--form\'s "updates" must be an array',
  }),
  htmlUnwritable: ({ path, cause }: { path: string; cause: unknown }): VantaFileUnwritableError => ({
    code: "FILE_UNWRITABLE",
    message: `could not write --html at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  idsNamedNothing: ({ got }: { got: string }): VantaInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--ids",
    got,
    message: "--ids named no finding — pass one id, or several separated by commas",
  }),
  pdfRenderFailed: ({ reasons }: { reasons: readonly string[] }): VantaPdfRenderFailedError => ({
    code: "PDF_RENDER_FAILED",
    message: reasons.join("; "),
    reasons,
  }),
  readFailed: ({ reasons }: { reasons: readonly string[] }): VantaReadFailedError => ({
    code: "READ_FAILED",
    message: reasons.join("; "),
    reasons,
  }),
  pdfUnwritable: ({ path }: { path: string }): VantaFileUnwritableError => ({
    code: "FILE_UNWRITABLE",
    message: `could not write the rendered PDF to ${path}`,
    path,
  }),
  policyEmpty: (): VantaInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--policy",
    got: "",
    message: "--policy was given an empty id — pass the Vanta policy id itself",
  }),
  policyMissing: (): VantaFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--policy",
    message: "--policy <id> is required: the Vanta policy whose version menu should be described",
  }),
  policySourceUnreadable: ({ path }: { path: string }): VantaFileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `could not read ${path}`,
    path,
  }),
  policyUploadPdfChanged: ({
    path,
    expectedSha256,
    actualSha256,
  }: {
    path: string;
    expectedSha256: string;
    actualSha256: string;
  }): VantaPolicyUploadPdfChangedError => ({
    actualSha256,
    code: "POLICY_UPLOAD_PDF_CHANGED",
    expectedSha256,
    message:
      `the rendered PDF at ${path} changed after it was approved (approved sha256 ${expectedSha256}, ` +
      `now ${actualSha256}) — nothing was attached; render and approve it again`,
    path,
  }),
  policyUploadPdfUnreadable: ({
    path,
    cause,
  }: {
    path: string;
    cause: unknown;
  }): VantaPolicyUploadPdfUnreadableError => ({
    cause,
    code: "POLICY_UPLOAD_PDF_UNREADABLE",
    message: `could not re-read the approved PDF at ${path} before attaching it: ${errorMessage({ error: cause })}`,
    path,
  }),
  policyUploadRefused: ({ reasons }: { reasons: readonly string[] }): VantaPolicyUploadRefusedError => ({
    code: "POLICY_UPLOAD_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  requestUnperformable: ({ kind }: { kind: string }): VantaRequestUnperformableError => ({
    code: "REQUEST_UNPERFORMABLE",
    kind,
    message: `write vanta cannot perform a ${kind} request`,
  }),
  uploadFileEmpty: (): VantaInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--file",
    got: "",
    message: "--file was given an empty path — pass the policy markdown itself",
  }),
  uploadFileMissing: (): VantaFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--file",
    message: "--file <path.md> is required: the policy markdown to render and attach",
  }),
  uploadFileUnreadable: ({ path, cause }: { path: string; cause: unknown }): VantaFileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `could not read --file at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  uploadPolicyMissing: (): VantaFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--policy",
    message: "--policy <id> is required: the Vanta policy this version belongs to",
  }),
  writeFailed: ({ reasons }: { reasons: readonly string[] }): VantaWriteFailedError => ({
    code: "WRITE_FAILED",
    message: reasons.join("; "),
    reasons,
  }),
} as const;

/**
 * The lines a {@link VantaVerbError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function vantaVerbErrorLines({ error }: { error: VantaVerbError }): readonly string[] {
  if (
    error.code === "CREDENTIALS_UNRESOLVED" ||
    error.code === "READ_FAILED" ||
    error.code === "FLAGS_REFUSED" ||
    error.code === "FORM_ENTRIES_INVALID" ||
    error.code === "WRITE_FAILED" ||
    error.code === "POLICY_UPLOAD_REFUSED" ||
    error.code === "PDF_RENDER_FAILED"
  ) {
    return error.reasons;
  }
  return [error.message];
}

/**
 * Whether a failure means "Vanta was never configured on this machine" — the one failure a scheduled read
 * verb exits `EXIT_EXPECTED_EMPTY` on, so `automation run-due` stamps the slot rather than counting a fault.
 * Decided by the credential errors' codes, never by the wording of a line.
 *
 * @returns whether the failure is an absent credential or workspace slug
 */
export function isVantaVerbUnconfigured({ error }: { error: VantaVerbError }): boolean {
  return (
    error.code === "CREDENTIALS_UNRESOLVED" && error.errors.some((inner) => isVantaCredentialUnset({ error: inner }))
  );
}
