/**
 * Reading Chrome's own profile index — the pure half of "which of the owner's profiles is the work one".
 *
 * Chrome keeps every profile it knows in `Local State`, under `profile.info_cache`, keyed by the profile's
 * DIRECTORY name (`Default`, `Profile 1`, …) and carrying the signed-in account's display name and email.
 * That index is what makes a profile pickable by a human and recordable by name: nothing here infers which
 * one to use, because a wrong inference means driving the owner's personal browsing as if it were work.
 *
 * **No account, domain or profile name is hard-coded anywhere in this repository**, and that is the
 * no-private-identifiers rule rather than an oversight — the recorded choice is the store's `browser-profile`
 * row (`./recordedProfile.ts`), off the tree. `slopweaver browser profile --list` prints the index so
 * the owner picks; `--set` records the directory the owner picked.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { type RealChromeError, RealChromeErrors } from "./errors.js";

/** One profile as Chrome's own index describes it. */
export interface ChromeProfile {
  /** The profile's directory name under the user-data root — what gets recorded. */
  readonly directory: string;
  /** Chrome's own display name for it, which the owner sees in their profile switcher. */
  readonly name: string;
  /** The signed-in account, when the profile has one. */
  readonly accountEmail: string | undefined;
}

/**
 * Parse `Local State` into the profiles Chrome knows, sorted by directory so a listing is stable.
 *
 * @param json the file's contents
 * @param path named in the refusal, so an unparseable index says which file to look at
 * @returns every profile the index carries, or why it could not be read
 */
export function parseChromeProfiles({
  json,
  path,
}: {
  json: string;
  path: string;
}): Result<readonly ChromeProfile[], RealChromeError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(RealChromeErrors.localStateUnreadable({ detail, path }));
  }
  const profile: unknown = isRecord(parsed) ? parsed["profile"] : undefined;
  const cache: unknown = isRecord(profile) ? profile["info_cache"] : undefined;
  if (!isRecord(cache)) {
    return err(RealChromeErrors.localStateUnreadable({ detail: "no profile.info_cache object", path }));
  }
  const profiles = Object.entries(cache).map(([directory, value]) => ({
    accountEmail: isRecord(value) && typeof value["user_name"] === "string" ? value["user_name"] : undefined,
    directory,
    name: isRecord(value) && typeof value["name"] === "string" ? value["name"] : directory,
  }));
  return ok(profiles.toSorted((a, b) => a.directory.localeCompare(b.directory)));
}

/**
 * Resolve a recorded directory name against the index.
 *
 * A recorded name that Chrome no longer lists is refused rather than used: a profile directory the owner
 * deleted and Chrome re-created under a different name would otherwise be read as an empty jar, which
 * reports "you are signed out" about a browser the owner is plainly signed in to.
 *
 * @param profiles the parsed index
 * @param directory the recorded directory name
 * @returns the matching profile, or why it does not resolve
 */
export function resolveRecordedProfile({
  profiles,
  directory,
}: {
  profiles: readonly ChromeProfile[];
  directory: string;
}): Result<ChromeProfile, RealChromeError> {
  const found = profiles.find((p) => p.directory === directory);
  if (found === undefined) {
    return err(RealChromeErrors.profileUnknown({ directory, known: profiles.map((p) => p.directory) }));
  }
  return ok(found);
}
