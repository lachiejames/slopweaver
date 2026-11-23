/**
 * The typed failures the `atlas google-admin` verbs author themselves: a `connect` invocation refused before
 * any browser opens, and a `walk` observation that cannot be published.
 *
 * Two unions of their own per `.claude/rules/error-handling.md`, scoped to this verb directory. Every
 * `connect` refusal carries the usage it is printed beside, because the shared Google connect shell prints
 * a refusal as its lines and knows no door's usage; the flag tokeniser's own refusals ride as `reasons`,
 * one per line of `message`, so a caller printing `message` writes exactly the lines the list used to.
 */

/** The flag tokeniser refused the `connect` tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface GoogleAdminFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
  readonly usage: string;
}

/** A `connect` flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface GoogleAdminInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
  readonly usage: string;
}

/** `--without identity` was asked for, which would leave a grant that names no account. */
export interface GoogleAdminIdentityExcludedError {
  readonly code: "IDENTITY_EXCLUDED";
  readonly message: string;
  readonly usage: string;
}

/** `--without` removed every capability the chosen `--grant` would have requested. */
export interface GoogleAdminNothingToConsentError {
  readonly code: "NOTHING_TO_CONSENT";
  readonly message: string;
  readonly grant: string;
  readonly usage: string;
}

/** Every way parsing one `atlas google-admin connect` invocation can fail. */
export type GoogleAdminConnectArgsError =
  | GoogleAdminFlagsInvalidError
  | GoogleAdminInvalidFlagValueError
  | GoogleAdminIdentityExcludedError
  | GoogleAdminNothingToConsentError;

/** The observation file could not be read at all. */
export interface GoogleAdminObservationUnreadableError {
  readonly code: "OBSERVATION_UNREADABLE";
  readonly message: string;
  readonly path: string;
  /** What the read reported. */
  readonly cause: string;
}

/** The observation file was read and is not JSON. */
export interface GoogleAdminObservationNotJsonError {
  readonly code: "OBSERVATION_NOT_JSON";
  readonly message: string;
  readonly path: string;
}

/** The observation file is JSON and not a walk observation; `detail` is the schema's first complaint. */
export interface GoogleAdminObservationInvalidError {
  readonly code: "OBSERVATION_INVALID";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** Every way reading one `atlas google-admin walk --observation` document can fail. */
export type GoogleAdminObservationError =
  GoogleAdminObservationUnreadableError | GoogleAdminObservationNotJsonError | GoogleAdminObservationInvalidError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const GoogleAdminErrors = {
  capabilityUnknown: ({
    unknown,
    known,
    usage,
  }: {
    unknown: readonly string[];
    known: readonly string[];
    usage: string;
  }): GoogleAdminInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--without",
    got: unknown.join(", "),
    message: `unknown --without capability: ${unknown.join(", ")} (expected one of ${known.join(", ")})`,
    usage,
  }),
  flagsInvalid: ({ reasons, usage }: { reasons: readonly string[]; usage: string }): GoogleAdminFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("\n"),
    reasons,
    usage,
  }),
  grantUnknown: ({
    grant,
    known,
    usage,
  }: {
    grant: string;
    known: readonly string[];
    usage: string;
  }): GoogleAdminInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--grant",
    got: grant,
    message: `unknown --grant: ${grant} (expected ${known.join(" | ")})`,
    usage,
  }),
  identityExcluded: ({ usage }: { usage: string }): GoogleAdminIdentityExcludedError => ({
    code: "IDENTITY_EXCLUDED",
    message:
      "--without identity is refused: userinfo.email is what binds the grant to an account, so a grant without it could not be named",
    usage,
  }),
  nothingToConsent: ({ grant, usage }: { grant: string; usage: string }): GoogleAdminNothingToConsentError => ({
    code: "NOTHING_TO_CONSENT",
    grant,
    message: `--without excluded every capability --grant ${grant} would have requested, so there is nothing to consent to`,
    usage,
  }),
  observationInvalid: ({ path, detail }: { path: string; detail: string }): GoogleAdminObservationInvalidError => ({
    code: "OBSERVATION_INVALID",
    detail,
    message: `${path} is not a walk observation: ${detail}`,
    path,
  }),
  observationNotJson: ({ path }: { path: string }): GoogleAdminObservationNotJsonError => ({
    code: "OBSERVATION_NOT_JSON",
    message: `${path} is not valid JSON`,
    path,
  }),
  observationUnreadable: ({ path, cause }: { path: string; cause: string }): GoogleAdminObservationUnreadableError => ({
    cause,
    code: "OBSERVATION_UNREADABLE",
    message: `could not read ${path}: ${cause}`,
    path,
  }),
} as const;

/**
 * The lines one `connect` refusal prints ahead of its usage, one log record each, exactly as the verb
 * printed them before it had a type: the tokeniser's list as that list, and every other refusal as its one
 * message. `message` stays the joined form, for a caller that displays one.
 *
 * @returns the lines, in order, without the usage
 */
export function googleAdminConnectErrorLines({ error }: { error: GoogleAdminConnectArgsError }): readonly string[] {
  if (error.code === "FLAGS_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
