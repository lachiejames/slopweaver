/**
 * The invocation and form half of {@link GithubVerbErrors}: a flag list the tokeniser refused, a sub-verb or
 * argument a verb cannot route, a flag it cannot run without or a value it does not accept, a form that is not
 * JSON or not the verb's shape, and a nested operation's own lines carried through. Composed into the one
 * factory by `./errors.ts`; import that, not this.
 */
import { withholdingCredentialLines } from "../../../outbound/github/descriptionWords.js";
import type {
  GithubArgumentMissingError,
  GithubArgumentRefusedError,
  GithubArgumentsRefusedError,
  GithubFlagMissingError,
  GithubFlagsRefusedError,
  GithubFormInvalidError,
  GithubFormNotJsonError,
  GithubInvalidFlagValueError,
  GithubUpstreamRefusedError,
  GithubUsageError,
} from "./errors.js";

/**
 * A parser's own detail with any credential shape withheld: V8's JSON refusal quotes a slice of the input, so a
 * token in a malformed form would otherwise print with it.
 *
 * @returns the detail, or the withheld line when it carries a credential shape
 */
function withheldDetail({ detail }: { detail: string }): string {
  return withholdingCredentialLines({ lines: [detail] }).join("");
}

/** The factory methods for a verb's own invocation and form, composed into `GithubVerbErrors`. */
export const githubArgsErrorFactories = {
  acknowledgementTooShort: ({ got, minWords }: { got: string; minWords: number }): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--acknowledge",
    got,
    message:
      "--acknowledge needs the REASON the real surface was unavailable, in at least " +
      `${String(minWords)} words — a bare marker waives nothing`,
  }),
  alertDismissFieldsMissing: (): GithubFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--number",
    message: "--number, --reason and --comment are required",
  }),
  argumentsRefused: ({ reasons }: { reasons: readonly string[] }): GithubArgumentsRefusedError => ({
    code: "ARGUMENTS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  attachExtraArgument: ({ got }: { got: string }): GithubArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    message: `unexpected argument ${got} — attach takes exactly one sub-verb`,
    name: got,
  }),
  attachOrgOnUpload: (): GithubArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    message: "--org is only meaningful for `github attach status`",
    name: "--org",
  }),
  attachSubVerbMissing: (): GithubArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: "a sub-verb is required: upload or status",
    name: "sub-verb",
  }),
  attachSubVerbUnknown: ({ got }: { got: string }): GithubArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    message: `unknown sub-verb ${got} — expected upload or status`,
    name: got,
  }),
  editNotObject: ({ got }: { got: string }): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--edit",
    got,
    message: "--edit must be a JSON object naming the fields to change",
  }),
  flagNotJson: ({ flag, cause }: { flag: string; cause: unknown }): GithubFormNotJsonError => {
    const detail = withheldDetail({ detail: cause instanceof Error ? cause.message : "unparseable" });
    return { code: "FORM_NOT_JSON", detail, form: flag, message: `${flag} is not valid JSON: ${detail}` };
  },
  flagValueEmpty: ({ flag }: { flag: string }): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag,
    got: "",
    message: `${flag} was given an empty value — pass the value itself`,
  }),
  flagsRefused: ({ reasons }: { reasons: readonly string[] }): GithubFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  formInvalid: ({ form, reasons }: { form: string; reasons: readonly string[] }): GithubFormInvalidError => {
    const withheld = withholdingCredentialLines({ lines: reasons });
    return { code: "FORM_INVALID", form, message: withheld.join("; "), reasons: withheld };
  },
  formNotJson: ({ cause }: { cause: unknown }): GithubFormNotJsonError => {
    const detail = withheldDetail({ detail: cause instanceof Error ? cause.message : "unknown" });
    return { code: "FORM_NOT_JSON", detail, form: "--form", message: `the form is not valid JSON: ${detail}` };
  },
  holdModesExclusive: (): GithubArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    message: "--status reports what is held NOW and --history what has been held; ask for one or the other",
    name: "--status",
  }),
  holdReportPlaces: ({ mode, flags }: { mode: string; flags: readonly string[] }): GithubArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    message: `${mode} reports and places nothing, so it refuses ${flags.map((name) => `--${name}`).join(", ")}`,
    name: mode,
  }),
  holdStatusTakesNoLimit: (): GithubArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    message: "--limit bounds the --history journal; --status reports every standing hold and takes none",
    name: "--limit",
  }),
  notPositiveWholeNumber: ({ flag, got }: { flag: string; got: string }): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag,
    got,
    message: `${flag} must be a positive whole number`,
  }),
  prRequired: (): GithubFlagMissingError => ({ code: "FLAG_MISSING", flag: "--pr", message: "--pr is required" }),
  remoteBlank: ({ got }: { got: string }): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--remote",
    got,
    message: "--remote must not be blank",
  }),
  replyBodyMissing: (): GithubFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--body",
    message: "--body <text|-> is required for `reply`",
  }),
  repoMalformed: ({ got }: { got: string }): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--repo",
    got,
    message: `--repo must be owner/name; "${got}" is not`,
  }),
  repoRequired: (): GithubFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--repo",
    message: "--repo owner/name is required",
  }),
  rerunTargetRequired: (): GithubFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--run-id",
    message: "exactly one of --run-id <id> or --number <n> is required",
  }),
  searchLimitOutOfRange: ({ got, max }: { got: string; max: number }): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit must be an integer from 1 to ${String(max)}`,
  }),
  searchTermMissing: (): GithubArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: "a search term is required",
    name: "search term",
  }),
  selfReviewNotJson: ({ cause }: { cause: unknown }): GithubFormNotJsonError => {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      code: "FORM_NOT_JSON",
      detail,
      form: "--self-review",
      message: `--self-review is not valid JSON: ${detail}`,
    };
  },
  stackPushFormMissing: (): GithubFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message: "stack push needs --form <json|-> or --file <path|->",
  }),
  stdinBodyEmpty: (): GithubInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--body",
    got: "-",
    message: "--body - was given but stdin was empty",
  }),
  threadRequired: (): GithubFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--thread",
    message: "--thread <id> is required",
  }),
  upstreamRefused: ({
    operation,
    reasons,
  }: {
    operation: string;
    reasons: readonly string[];
  }): GithubUpstreamRefusedError => ({
    code: "UPSTREAM_REFUSED",
    message: reasons.join("; "),
    operation,
    reasons,
  }),
  usage: ({ command, shape }: { command: string; shape: string }): GithubUsageError => ({
    code: "USAGE",
    command,
    message: `usage: slopweaver github ${command} ${shape} [...]`,
  }),
  vulnFormSourceMissing: (): GithubFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message: "`body` needs the form: --form <json|-> or --file <path|->",
  }),
} as const;
