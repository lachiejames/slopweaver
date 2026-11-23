/**
 * Resolving `--platform` to a read snapshot — the half `atlas read` and `atlas coverage` do identically.
 *
 * Both verbs open the same way: require a platform, find its registration, read its store, and turn each
 * failure into the right exit code. Written twice that was thirty duplicated lines and two chances for the
 * two verbs to disagree about what an unknown platform costs; written once it is a seam either can grow a
 * flag against without the other drifting.
 *
 * The exit code travels WITH the error rather than being re-derived at each call site, because the
 * distinction it encodes is real: a platform the caller misspelled is a usage error they can fix, while a
 * store that will not open is a fault they cannot.
 */
import { type AtlasReadError, AtlasReadErrors, type AtlasReadSnapshot } from "../../../atlas/kit/read.js";
import type { AtlasPlatformRegistration } from "../../../atlas/kit/registration.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";

/** Lists every platform this build has — `atlasPlatforms` in production. */
export type AtlasPlatforms = () => readonly string[];

/**
 * Looks one platform up — `findAtlasPlatform` in production. Narrowed to the one field a resolve reads, so a
 * caller can hand in a registration that answers only its snapshot.
 */
export type AtlasPlatformLookup = (args: {
  platform: string;
}) => Pick<AtlasPlatformRegistration, "readSnapshot"> | null;

/** Why a platform could not be resolved, and what the process should exit with.
 * @internal
 */
export interface AtlasPlatformFailure {
  readonly exitCode: number;
  readonly error: AtlasReadError;
}

/**
 * Resolve a `--platform` value to that atlas's normalized snapshot.
 *
 * @param platform the flag's value; `undefined` when it was not given at all
 * @param home the state home to read from, when the caller passed one
 * @param platforms lists every platform this build has, for a miss's message
 * @param find looks one platform up
 * @returns the snapshot, or the failure plus the exit code it earns
 */
export async function resolvePlatformSnapshot({
  platform,
  home,
  platforms,
  find,
}: {
  platform: string | undefined;
  home: string | undefined;
  platforms: AtlasPlatforms;
  find: AtlasPlatformLookup;
}): Promise<Result<AtlasReadSnapshot, AtlasPlatformFailure>> {
  const known = platforms();
  if (platform === undefined) {
    return err({ error: AtlasReadErrors.platformMissing({ known }), exitCode: EXIT_USAGE });
  }
  const registration = find({ platform });
  if (registration === null) {
    return err({ error: AtlasReadErrors.platformUnknown({ known, platform }), exitCode: EXIT_USAGE });
  }
  const snapshot = await registration.readSnapshot(home === undefined ? {} : { home });
  if (snapshot.isErr()) {
    return err({ error: snapshot.error, exitCode: EXIT_ERROR });
  }
  return ok(snapshot.value);
}
