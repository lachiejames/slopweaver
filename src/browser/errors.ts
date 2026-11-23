/**
 * The real-Chrome lane's own typed error union — the owner's own signed-in work profile, and nothing
 * else's.
 *
 * A union rather than the default `readonly string[]` because each member has a different correction and
 * the caller acts on which one it is: an unrecorded profile is one `slopweaver browser profile --set` away,
 * a keyring that will not answer is a one-time macOS approval, a jar with no session cookie means the owner is
 * signed out of that site in their own browser, and an unsupported platform is not fixable at all. Collapsed
 * into one string, the commonest of them ("you are signed out of GitHub in Chrome") would read as "the
 * cookie jar is broken", which sends the reader to the wrong place entirely.
 */

/** What the store's row is called when it is the source of a refusal; anything else is the retired file's path. */
export const STORED_PROFILE_SOURCE = "the store's browser-profile row";

/** No work profile has been recorded, so there is no jar to read. */
export interface ProfileUnsetError {
  readonly code: "PROFILE_UNSET";
  readonly message: string;
}

/** The recorded profile — the store's row, or the retired `browser.json` it is imported from — is not the declared shape. */
export interface ProfileRegisterMalformedError {
  readonly code: "PROFILE_REGISTER_MALFORMED";
  readonly message: string;
  /** Where the document came from: the retired file's path, or the store's row. */
  readonly source: string;
  readonly detail: string;
}

/** The store holding the recorded profile could not be selected, reached or queried. Nothing was read or written. */
export interface ProfileStoreUnavailableError {
  readonly code: "PROFILE_STORE_UNAVAILABLE";
  readonly message: string;
}

/** Another writer recorded a profile between this writer's read and its compare-and-set. Nothing was written. */
export interface ProfileRevisionConflictError {
  readonly code: "PROFILE_REVISION_CONFLICT";
  readonly message: string;
  /** The revision this writer read and pinned to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** A profile was recorded, but Chrome's own `Local State` does not list it. */
export interface ProfileUnknownError {
  readonly code: "PROFILE_UNKNOWN";
  readonly message: string;
  readonly directory: string;
  readonly known: readonly string[];
}

/** Chrome's user-data directory is not where this platform puts it. */
export interface UserDataMissingError {
  readonly code: "USER_DATA_MISSING";
  readonly message: string;
  readonly path: string;
}

/** `Local State` is there but will not parse as the document Chrome writes. */
export interface LocalStateUnreadableError {
  readonly code: "LOCAL_STATE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** The OS keyring would not hand over the `Chrome Safe Storage` password. */
export interface KeyUnavailableError {
  readonly code: "KEY_UNAVAILABLE";
  readonly message: string;
  readonly detail: string;
}

/**
 * The keyring read was still waiting when its bound ran out — a keychain dialog nobody answered, most likely
 * behind another window — so the child was killed rather than left to stall the seat.
 */
export interface KeyReadTimedOutError {
  readonly code: "KEY_READ_TIMED_OUT";
  readonly message: string;
  readonly timeoutMs: number;
}

/** The password decrypted nothing that verifies, so it belongs to a different Chrome install. */
export interface KeyWrongError {
  readonly code: "KEY_WRONG";
  readonly message: string;
}

/** The cookie database could not be copied or opened. */
export interface JarUnreadableError {
  readonly code: "JAR_UNREADABLE";
  readonly message: string;
  readonly detail: string;
}

/** The jar holds no session cookie for the origin, which means the owner is signed out of it in their own Chrome. */
export interface OriginNotSignedInError {
  readonly code: "ORIGIN_NOT_SIGNED_IN";
  readonly message: string;
  readonly origin: string;
}

/** This platform's Chrome does not store cookies the way this lane reads them. */
export interface UnsupportedPlatformError {
  readonly code: "UNSUPPORTED_PLATFORM";
  readonly message: string;
  readonly platform: string;
}

/** Chrome's own binary is not where Playwright's registry looks for it. */
export interface ChromeNotFoundError {
  readonly code: "CHROME_NOT_FOUND";
  readonly message: string;
  readonly detail: string;
}

/** The profile pin script could not be generated or written. */
export interface PinUnwritableError {
  readonly code: "PIN_UNWRITABLE";
  readonly message: string;
  readonly detail: string;
}

/** Every way reading the owner's real Chrome can fail. */
export type RealChromeError =
  | ChromeNotFoundError
  | PinUnwritableError
  | ProfileUnsetError
  | ProfileRegisterMalformedError
  | ProfileStoreUnavailableError
  | ProfileRevisionConflictError
  | ProfileUnknownError
  | UserDataMissingError
  | LocalStateUnreadableError
  | KeyUnavailableError
  | KeyReadTimedOutError
  | KeyWrongError
  | JarUnreadableError
  | OriginNotSignedInError
  | UnsupportedPlatformError;

/** Construct one typed failure. Tests build fixtures through this, exactly as the real code does. */
export const RealChromeErrors = {
  chromeNotFound: ({ detail }: { detail: string }): ChromeNotFoundError => ({
    code: "CHROME_NOT_FOUND",
    detail,
    message:
      "Playwright's own registry cannot find Chrome, so there is no browser to pin a profile on. " +
      `Install Google Chrome where it normally lives and re-run. (${detail})`,
  }),
  jarUnreadable: ({ detail }: { detail: string }): JarUnreadableError => ({
    code: "JAR_UNREADABLE",
    detail,
    message: `the profile's cookie database could not be read: ${detail}`,
  }),
  keyUnavailable: ({ detail }: { detail: string }): KeyUnavailableError => ({
    code: "KEY_UNAVAILABLE",
    detail,
    message:
      "the OS keyring would not release Chrome's own cookie key. macOS asks once, per binary, and remembers " +
      `the answer — re-run and choose Always Allow. (${detail})`,
  }),
  keyReadTimedOut: ({ timeoutMs }: { timeoutMs: number }): KeyReadTimedOutError => ({
    code: "KEY_READ_TIMED_OUT",
    message:
      `the OS keyring did not answer within ${String(Math.round(timeoutMs / 1000))}s, so the read was stopped. ` +
      "A keychain dialog is most likely waiting behind another window — answer it (Always Allow) and re-run. " +
      "Nothing was read.",
    timeoutMs,
  }),
  keyWrong: (): KeyWrongError => ({
    code: "KEY_WRONG",
    message:
      "the keyring's Chrome key does not decrypt this profile's cookies, so the jar belongs to a different " +
      "Chrome install than the keyring entry. Nothing was read.",
  }),
  localStateUnreadable: ({ path, detail }: { path: string; detail: string }): LocalStateUnreadableError => ({
    code: "LOCAL_STATE_UNREADABLE",
    detail,
    message: `Chrome's profile index at ${path} could not be read: ${detail}`,
    path,
  }),
  originNotSignedIn: ({ origin }: { origin: string }): OriginNotSignedInError => ({
    code: "ORIGIN_NOT_SIGNED_IN",
    message:
      `your Chrome profile holds no session cookie for ${origin}. Sign in to it in your own browser, the ` +
      "way you already do, and re-run — there is no second profile to sign in to.",
    origin,
  }),
  pinUnwritable: ({ detail }: { detail: string }): PinUnwritableError => ({
    code: "PIN_UNWRITABLE",
    detail,
    message:
      "the Chrome profile pin could not be written, so a browser leg would fall back to whichever profile " +
      `you last used. Nothing was launched. (${detail})`,
  }),
  profileUnknown: ({ directory, known }: { directory: string; known: readonly string[] }): ProfileUnknownError => ({
    code: "PROFILE_UNKNOWN",
    directory,
    known,
    message:
      `Chrome lists no profile directory named ${directory}. It knows: ${known.join(", ")}. ` +
      "Run `slopweaver browser profile --list` and re-record the one you actually work in.",
  }),
  // The correction depends on the source, because `browser profile --set` READS before it writes: a bad retired file
  // fails that read too until it leaves the home, and a bad row is never read as unset, so `--set` cannot paper it over.
  profileRegisterMalformed: ({
    detail,
    source,
  }: {
    detail: string;
    source: string;
  }): ProfileRegisterMalformedError => ({
    code: "PROFILE_REGISTER_MALFORMED",
    detail,
    message:
      `${source} is not a recorded Chrome profile ({ "profileDirectory": "<directory>" }): ${detail}. Nothing ` +
      (source === STORED_PROFILE_SOURCE
        ? "was launched, and the row is not read as unset — `slopweaver store status` says what the store holds."
        : "was launched. That file is retired: move it out of the home, then record the work profile with " +
          "`slopweaver browser profile --set <directory>`."),
    source,
  }),
  profileRevisionConflict: ({ expectedRevision }: { expectedRevision: number }): ProfileRevisionConflictError => ({
    code: "PROFILE_REVISION_CONFLICT",
    expectedRevision,
    message:
      `the recorded Chrome profile changed while this one was being recorded (read at revision ` +
      `${String(expectedRevision)}), so nothing was written; run \`slopweaver browser profile\` to see which ` +
      "one is recorded now, and decide whether to set it again.",
  }),
  profileStoreUnavailable: ({ doing, reason }: { doing: string; reason: string }): ProfileStoreUnavailableError => ({
    code: "PROFILE_STORE_UNAVAILABLE",
    message:
      `this install records its work Chrome profile in the store, and the store could not ${doing}, so which ` +
      "profile is the work one is UNKNOWN — nothing was launched, rather than guessing (`slopweaver store " +
      `status\` says what the store is doing). The store said: ${reason}`,
  }),
  profileUnset: (): ProfileUnsetError => ({
    code: "PROFILE_UNSET",
    message:
      "no Chrome profile has been recorded, and this lane never guesses which of your profiles is the work " +
      "one. Run `slopweaver browser profile --list`, then `--set <directory>`; it is recorded in this install's " +
      "store.",
  }),
  unsupportedPlatform: ({ platform }: { platform: string }): UnsupportedPlatformError => ({
    code: "UNSUPPORTED_PLATFORM",
    message:
      `reading Chrome's own cookie jar is implemented for macOS and Linux; this is ${platform}. ` +
      "Nothing was read, and nothing was launched.",
    platform,
  }),
  userDataMissing: ({ path }: { path: string }): UserDataMissingError => ({
    code: "USER_DATA_MISSING",
    message: `Chrome's user-data directory is not at ${path}, so there is no profile index to read.`,
    path,
  }),
} as const;
