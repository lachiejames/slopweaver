/**
 * The typed domain error for a LOCAL-FIRST Linear query — see `.claude/rules/error-handling.md` for the
 * shape. Its own union rather than a shared one: none of these failures can arise from a live provider read
 * (`LinearLiveError`) and none of the live ones can arise here, so folding the two would give every caller a
 * `switch` over variants half of which are unreachable.
 */

/** No readable Linear bronze was found under the resolved home or `--corpus` dir. */
export interface NoLocalCorpusError {
  readonly code: "NO_LOCAL_CORPUS";
  readonly message: string;
  readonly dir: string;
}

/** The invocation itself did not parse — an unknown flag, or a value flag with no value. */
export interface InvalidInvocationError {
  readonly code: "INVALID_INVOCATION";
  readonly message: string;
}

/** A filter value was outside the closed set the schema declares (a state type, a priority, a kind). */
export interface UnknownFilterValueError {
  readonly code: "UNKNOWN_FILTER_VALUE";
  readonly message: string;
  readonly flag: string;
}

/** `--assignee me` was asked for and no Linear handle for the owner could be resolved EXACTLY. */
export interface OwnerUnresolvedError {
  readonly code: "OWNER_UNRESOLVED";
  readonly message: string;
}

/** `--assignee me` was asked for over a `profile.json` that is there but cannot be trusted. */
export interface ProfileUnreadableError {
  readonly code: "PROFILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** `--assignee me` was asked for and the store could not answer who is on the identity roster. */
export interface RosterUnreadableError {
  readonly code: "ROSTER_UNREADABLE";
  readonly message: string;
}

/** The scan matched more distinct objects than it will hold; the caller must narrow the query. */
export interface TooManyMatchesError {
  readonly code: "TOO_MANY_MATCHES";
  readonly message: string;
  readonly ceiling: number;
}

/** The local scan itself failed — an unreadable bronze dir, a heap refusal, an io error. */
export interface LocalScanFailedError {
  readonly code: "LOCAL_SCAN_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Every failure a local-first Linear query can produce before any live verification runs. */
export type LinearQueryError =
  | InvalidInvocationError
  | NoLocalCorpusError
  | UnknownFilterValueError
  | OwnerUnresolvedError
  | ProfileUnreadableError
  | RosterUnreadableError
  | TooManyMatchesError
  | LocalScanFailedError;

/** Factories for every {@link LinearQueryError} variant. */
export const LinearQueryErrors = {
  /** @returns an {@link InvalidInvocationError} listing every rejection and the flags that ARE accepted */
  invalidInvocation: ({
    problems,
    accepted,
  }: {
    problems: readonly string[];
    accepted: readonly string[];
  }): InvalidInvocationError => ({
    code: "INVALID_INVOCATION",
    message: `linear query: ${problems.join("; ")} — accepted flags: ${accepted.join(" ")}`,
  }),

  /** @returns a {@link LocalScanFailedError} wrapping the underlying read failure */
  localScanFailed: ({ message, cause }: { message: string; cause?: unknown }): LocalScanFailedError => ({
    code: "LOCAL_SCAN_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns a {@link NoLocalCorpusError} naming the directory that held nothing */
  noLocalCorpus: ({ dir }: { dir: string }): NoLocalCorpusError => ({
    code: "NO_LOCAL_CORPUS",
    dir,
    message: `no Linear bronze under ${dir} — run \`slopweaver refresh --source linear\` first`,
  }),

  /** @returns an {@link OwnerUnresolvedError} naming both ways to fix it */
  ownerUnresolved: ({ profileId }: { profileId: string }): OwnerUnresolvedError => ({
    code: "OWNER_UNRESOLVED",
    message:
      `--assignee me needs a Linear handle for the owner and none resolved exactly: profile.json id ` +
      `"${profileId}" names no person in the store's identity roster carrying a Linear identity, and no ` +
      `person carries the declared slackBot.ownerUserId either. Fix the roster (\`slopweaver identity roster ` +
      `show\`, then \`identity roster replace\`), or pass --assignee <linear-handle>`,
  }),

  /** @returns a {@link RosterUnreadableError} carrying the store's own refusal */
  rosterUnreadable: ({ message }: { message: string }): RosterUnreadableError => ({
    code: "ROSTER_UNREADABLE",
    message: `--assignee me cannot resolve the owner: ${message}`,
  }),

  /** @returns a {@link ProfileUnreadableError} carrying the profile reader's own message and path */
  profileUnreadable: ({ message, path }: { message: string; path: string }): ProfileUnreadableError => ({
    code: "PROFILE_UNREADABLE",
    message: `--assignee me cannot resolve the owner: ${message}`,
    path,
  }),

  /** @returns a {@link TooManyMatchesError} carrying the ceiling the caller has to get under */
  tooManyMatches: ({ ceiling }: { ceiling: number }): TooManyMatchesError => ({
    code: "TOO_MANY_MATCHES",
    ceiling,
    message:
      `the query matched more than ${String(ceiling)} distinct Linear objects — narrow it with ` +
      `--team/--state/--assignee/--updated-since rather than paging a match set this size`,
  }),

  /** @returns an {@link UnknownFilterValueError} naming the flag and the values it accepts */
  unknownFilterValue: ({
    flag,
    value,
    accepted,
  }: {
    flag: string;
    value: string;
    accepted: readonly string[];
  }): UnknownFilterValueError => ({
    code: "UNKNOWN_FILTER_VALUE",
    flag,
    message: `${flag} does not accept "${value}" — one of: ${accepted.join(" | ")}`,
  }),
} as const;
