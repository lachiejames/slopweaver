/**
 * The one credential this atlas has: the owner's own signed-in Nx Cloud session, read out of the browser the owner
 * is already using.
 *
 * ## Why a cookie rather than a token
 *
 * MEASURED. Nx Cloud publishes no REST surface this installation can reach — `/api/v1/...`
 * answers 404 — and its documented API wants either a personal access token, which is minted by hand at
 * `/profile/tokens` and is the owner's action, or the workspace CI token, which lives in a GitHub Actions
 * secret this machine cannot read. What the platform DOES accept is the cookie its own web client sends,
 * and the owner is signed in all day. So this is `docs/browser-route/proof-and-capture-verbs.md`'s first mechanism — read the owner's jar — and
 * the atlas needs no credential of its own at rest.
 *
 * ## What lands on disk, and what is ever printed
 *
 * Nothing, and nothing. The jar is re-read per sync, the decrypted values are held only long enough to
 * build one `Cookie` header, and no cookie VALUE is printed, logged, stored in a generation or carried in
 * an error. `sessionCookieNames` exists so a status line can say what the browser holds without saying what
 * it holds — the same line `slopweaver browser cookies` already draws.
 */

import { readOriginCookies } from "../../browser/cookieJar.js";
import { type RecordedProfilePort, readRecordedProfile } from "../../browser/recordedProfile.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type NxCloudAtlasError, NxCloudAtlasErrors } from "./errors.js";

/**
 * The cookie Nx Cloud carries its signed-in session in.
 *
 * A header assembled without it is not a session, and sending one would produce a page of sign-in HTML that
 * parses as a failed call rather than as the sign-out it actually is.
 *
 * @internal
 */
export const NX_CLOUD_SESSION_COOKIE = "_nxCloudSession";

/**
 * A session read out of the owner's browser: the header to send, and the names it was built from.
 *
 * @internal
 */
export interface NxCloudSession {
  /** The assembled `Cookie` header. Never logged, never stored. */
  readonly header: string;
  /** The cookie NAMES the header carries, sorted. Safe to print — this is what `browser cookies` prints. */
  readonly cookieNames: readonly string[];
  /** Which Chrome profile it came from, for a status line. */
  readonly profileDirectory: string;
}

/**
 * Read the owner's own Chrome and assemble the `Cookie` header for cloud.nx.app.
 *
 * @param home the Slopweaver home the recorded profile choice lives under
 * @param origin the origin to read cookies for
 * @param profiles the door the recorded work profile is read through
 * @param readCookies what reads and decrypts the profile's cookie jar; the owner's real Chrome unless a test supplies a fake
 * @returns the session, or why the browser holds none
 */
export async function readNxCloudSession({
  home,
  origin,
  profiles,
  readCookies = readOriginCookies,
}: {
  home: string;
  origin: string;
  profiles: RecordedProfilePort;
  readCookies?: typeof readOriginCookies;
}): Promise<Result<NxCloudSession, NxCloudAtlasError>> {
  const directory = await readRecordedProfile({ home, profiles });
  if (directory.isErr()) {
    return err(NxCloudAtlasErrors.sessionAbsent({ detail: directory.error.message }));
  }
  const cookies = await readCookies({ directory: directory.value, origin, platform: process.platform });
  if (cookies.isErr()) {
    return err(NxCloudAtlasErrors.sessionAbsent({ detail: cookies.error.message }));
  }
  const names = cookies.value.map((cookie) => cookie.name);
  if (!names.includes(NX_CLOUD_SESSION_COOKIE)) {
    return err(
      NxCloudAtlasErrors.sessionAbsent({
        detail: `profile ${directory.value} holds ${String(names.length)} cookie(s) for ${origin} and none of them is \`${NX_CLOUD_SESSION_COOKIE}\``,
      }),
    );
  }
  return ok({
    cookieNames: [...names].toSorted(),
    header: cookies.value.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    profileDirectory: directory.value,
  });
}
