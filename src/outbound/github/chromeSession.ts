/**
 * The GitHub **web** session — the one credential in this repository that is not a token, read out of the
 * browser the owner is already signed in to.
 *
 * Every other `slopweaver github` verb authenticates with a personal access token through Octokit. The
 * attachment pipeline cannot: its endpoints are the web application's own internal asset pipeline, they are
 * not part of any published API, and they do not accept token auth. What they accept is a cookied,
 * signed-in browser session. That difference is confined to this file and `attachClient.ts`; nothing else
 * in the repo learns about it.
 *
 * ## Where the session comes from
 *
 * The owner's own Chrome, at the moment of the call. `docs/browser-route.md` carries the rule
 * in full: the owner's real work Chrome is the only browser anything here uses, and no profile, login window or
 * saved session file exists under `$SLOPWEAVER_HOME` (`docs/browser-route/screenshot-reading-and-retirement.md`). The owner is signed in to github.com all day, so
 * the cookie is a READ (`src/browser/cookieJar.ts`) rather than a login, and there is nothing to keep alive,
 * refresh, expire or leak.
 *
 * Three failure modes are absent rather than handled better: an expired saved
 * session, a login window nobody was watching, and a capture that succeeded against a signed-out browser.
 * The one that remains is honest and has one correction: the owner is signed out of GitHub **in their own browser**,
 * and signing back in there is the fix.
 *
 * ## What lands on disk
 *
 * Nothing. The jar is re-read per call, the decrypted values are held only long enough to build one
 * `Cookie` header, and no cookie value is ever printed, logged or written. `attach status` reports which
 * account the browser holds and when its cookies lapse — never a value.
 */

import { readOriginCookies } from "../../browser/cookieJar.js";
import { storageStateFromJar } from "../../browser/cookieScope.js";
import { type RecordedProfilePort, readRecordedProfile } from "../../browser/recordedProfile.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubAttachError, GithubAttachErrors } from "./attach.errors.js";
import { GITHUB_ORIGIN } from "./attachment.js";
import { cookieHeaderFromStorageState, sessionLifetimeOf } from "./webSessionCookies.js";

/** The cookie GitHub renders the signed-in account's login into, and the only one `status` reads by name. */
const LOGIN_COOKIE = "dotcom_user";

/**
 * Read the owner's own Chrome and assemble the `Cookie` header for github.com.
 *
 * @param home the Slopweaver home whose store records the profile choice
 * @param profiles the door the recorded work profile is read through
 * @returns the assembled `Cookie` header, or why the browser holds no usable session
 */
export async function githubCookieHeader({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<string, GithubAttachError>> {
  const state = await githubStorageState({ home, profiles });
  if (state.isErr()) {
    return err(state.error);
  }
  return cookieHeaderFromStorageState({ json: state.value.json, path: state.value.source });
}

/**
 * The jar as a `storageState` document, which is the shape every reader in `webSessionCookies.ts` already parses.
 *
 * Rendering the rows into the document the retired lane used to WRITE is what let the whole pipeline below
 * this file stay untouched when the browser under it went away — the readers, their tests and their
 * error messages all still describe exactly what they describe.
 *
 * @param home the Slopweaver home whose store records the profile choice
 * @param profiles the door the recorded work profile is read through
 * @returns the document and a human description of where it came from, or why it could not be built
 */
async function githubStorageState({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<{ json: string; source: string }, GithubAttachError>> {
  const directory = await readRecordedProfile({ home, profiles });
  if (directory.isErr()) {
    return err(GithubAttachErrors.webSessionMissing({ path: directory.error.message }));
  }
  const cookies = await readOriginCookies({
    directory: directory.value,
    origin: GITHUB_ORIGIN,
    platform: process.platform,
  });
  if (cookies.isErr()) {
    return err(GithubAttachErrors.webSessionUnreadable({ detail: cookies.error.message, path: directory.value }));
  }
  return ok({
    json: storageStateFromJar({ cookies: cookies.value }),
    source: `your Chrome profile ${directory.value}`,
  });
}

/** What `attach status` reports — which browser account, and how long its cookies last. Never a value. */
export interface GithubSessionStatus {
  /** The Chrome profile directory the session was read from, or the refusal when there is none. */
  readonly source: string;
  readonly present: boolean;
  readonly usable: boolean;
  /** The account github.com says the browser is signed in as. */
  readonly login: string | undefined;
  /** The earliest hard expiry among the auth cookies, when they carry one. */
  readonly expiresAtIso: string | undefined;
  /** True when an auth cookie has no expiry — GitHub ends it on its own schedule. */
  readonly sessionScoped: boolean;
  readonly detail: string | undefined;
}

/**
 * Report what the owner's browser currently holds for github.com.
 *
 * @param home the Slopweaver home whose store records the profile choice
 * @param profiles the door the recorded work profile is read through
 * @returns the status, which is always answerable — an unreadable jar or an unreachable store is a status, not a throw
 */
export async function githubSessionStatus({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<GithubSessionStatus> {
  const state = await githubStorageState({ home, profiles });
  if (state.isErr()) {
    return {
      detail: state.error.message,
      expiresAtIso: undefined,
      login: undefined,
      present: false,
      sessionScoped: false,
      source: "your Chrome profile",
      usable: false,
    };
  }
  const header = cookieHeaderFromStorageState({ json: state.value.json, path: state.value.source });
  const lifetime = sessionLifetimeOf({ json: state.value.json });
  return {
    detail: header.isErr() ? header.error.message : undefined,
    expiresAtIso: lifetime.expiresAtIso,
    login: loginFromStorageState({ json: state.value.json }),
    present: true,
    sessionScoped: lifetime.sessionScoped,
    source: state.value.source,
    usable: header.isOk(),
  };
}

/**
 * The signed-in account, read from the one cookie GitHub puts it in.
 *
 * `dotcom_user` is not `HttpOnly` and not a credential — it is the username the web app renders its own
 * avatar menu from — so reporting it names the account without reporting anything that authenticates.
 *
 * @param json the storage-state document
 * @returns the login, or `undefined` when the browser is signed out
 * @internal
 */
export function loginFromStorageState({ json }: { json: string }): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const cookies: unknown = isRecord(parsed) ? parsed["cookies"] : undefined;
  if (!Array.isArray(cookies)) {
    return undefined;
  }
  for (const cookie of cookies) {
    if (isRecord(cookie) && cookie["name"] === LOGIN_COOKIE && typeof cookie["value"] === "string") {
      return cookie["value"];
    }
  }
  return undefined;
}
