/**
 * GitHub web-session cookies as pure data: parse, narrow, render and report their lifetime.
 *
 * Split from `./attachment.ts` at the cookie boundary; this leaf imports nothing back from it.
 */

import { epochSecondsToIso } from "../../lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubAttachError, GithubAttachErrors } from "./attach.errors.js";

/** A cookie as Playwright's `storageState` export writes it. */
interface StorageStateCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly expires?: number;
}

/**
 * Whether a cookie belongs to github.com — the only ones this product has any business persisting.
 *
 * @param domain the cookie's domain, as the storage state records it
 * @returns true for github.com and its dot-prefixed parent form
 */
function isGithubCookieDomain({ domain }: { domain: string }): boolean {
  return domain === "github.com" || domain === ".github.com";
}

/** The cookies that actually authenticate a GitHub web session, as opposed to carrying preferences. */
const GITHUB_AUTH_COOKIES: ReadonlySet<string> = new Set(["user_session", "_gh_sess"]);

/** When a saved session stops working, as far as the cookies themselves say. */
export interface SessionLifetime {
  /** The earliest hard expiry among the auth cookies, or undefined when every one is session-scoped. */
  readonly expiresAtIso: string | undefined;
  /** True when at least one auth cookie carries no expiry at all — GitHub decides when it lapses. */
  readonly sessionScoped: boolean;
}

/**
 * Whether an unknown value has the three cookie fields this module reads, all as non-empty strings.
 * Positional because TS1230 forbids destructuring in a type predicate — the same documented exception
 * `lib/parsers.ts` takes.
 */
function isStorageStateCookie(value: unknown): value is StorageStateCookie {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    value["name"].length > 0 &&
    typeof value["value"] === "string" &&
    typeof value["domain"] === "string"
  );
}

/**
 * Build the `Cookie` header for github.com from a Playwright `storageState` document.
 *
 * Only cookies whose domain IS github.com (or a dot-suffix parent of it) are included — a storage state
 * captured through a real login also holds cookies for other hosts, and sending those to GitHub would leak
 * one site's credentials to another. The presence of a session cookie is what separates "a file that
 * parses" from "a file that authenticates", so its absence is reported here rather than as a confusing
 * 404 three calls later.
 *
 * Never logs, returns or renders a cookie VALUE: the result is the assembled header, which the caller
 * passes straight to `fetch` and never prints.
 *
 * @param json the raw contents of the storage-state file
 * @param path the file's path, for the error message only
 * @returns the assembled `Cookie` header value, or why the session is unusable
 */
export function cookieHeaderFromStorageState({
  json,
  path,
}: {
  json: string;
  path: string;
}): Result<string, GithubAttachError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause: unknown) {
    return err(
      GithubAttachErrors.webSessionUnreadable({
        detail: `not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`,
        path,
      }),
    );
  }
  const cookiesValue: unknown = isRecord(parsed) ? parsed["cookies"] : undefined;
  if (!Array.isArray(cookiesValue)) {
    return err(GithubAttachErrors.webSessionUnreadable({ detail: "no `cookies` array", path }));
  }
  const forGithub: readonly StorageStateCookie[] = cookiesValue
    .filter((value: unknown) => isStorageStateCookie(value))
    .filter((cookie) => isGithubCookieDomain({ domain: cookie.domain }));
  if (!forGithub.some((cookie) => cookie.name === "user_session")) {
    return err(
      GithubAttachErrors.webSessionUnreadable({
        detail: "no github.com `user_session` cookie — the capture was not signed in",
        path,
      }),
    );
  }
  return ok(forGithub.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
}

/**
 * Read the lifetime of a saved session out of its own cookies.
 *
 * Answers the only question an operator actually has — "when will I have to do this again?" — from the
 * capture rather than from a guess about the identity provider. Only the AUTH cookies count: `_octo` and
 * `logged_in` carry year-long expiries and would make any session look like it lasts a year, which is the
 * confident wrong answer this function exists to avoid.
 *
 * A session-scoped auth cookie (Playwright writes `expires: -1`) has no expiry to report, and that is
 * reported as such rather than as "never expires": it means GitHub ends it on its own schedule, and the
 * honest statement is that the file works until it does not.
 *
 * @param json the raw contents of the storage-state file
 * @returns the earliest hard expiry among the auth cookies, and whether any is session-scoped
 */
export function sessionLifetimeOf({ json }: { json: string }): SessionLifetime {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { expiresAtIso: undefined, sessionScoped: false };
  }
  const cookiesValue: unknown = isRecord(parsed) ? parsed["cookies"] : undefined;
  if (!Array.isArray(cookiesValue)) {
    return { expiresAtIso: undefined, sessionScoped: false };
  }
  const auth = cookiesValue
    .filter((value: unknown) => isStorageStateCookie(value))
    .filter((cookie) => GITHUB_AUTH_COOKIES.has(cookie.name));
  // A cookie with no `expires` is session-scoped (counted below), so it has no hard expiry to contribute here.
  const hard = auth.flatMap(({ expires }) => (expires !== undefined && expires > 0 ? [expires] : []));
  const earliest = hard.length > 0 ? Math.min(...hard) : undefined;
  return {
    expiresAtIso: earliest === undefined ? undefined : epochSecondsToIso({ seconds: earliest }),
    sessionScoped: auth.some((cookie) => cookie.expires === undefined || cookie.expires <= 0),
  };
}

/**
 * A cookie recovered from an import source, on its way to becoming a storage-state document.
 * @internal
 */
export interface ImportedCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly expires: number;
}

/**
 * Parse a raw `Cookie:` request header into cookies.
 *
 * This is the import door that needs no new access of any kind. The two cookies that matter are `HttpOnly`,
 * which stops PAGE SCRIPT reading them and does not stop a human reading them: DevTools shows their values
 * plainly, and copying the whole `Cookie` header off any github.com request is one action rather than four.
 *
 * A header carries names and values and NOTHING else — no expiry, no domain. Both are supplied here, and
 * the expiry deliberately as "session-scoped" rather than an invented date, so
 * {@link sessionLifetimeOf} reports honestly that GitHub owns the schedule instead of printing a
 * confident wrong number.
 *
 * @param text the raw header value, with or without a leading `Cookie:`
 * @returns every `name=value` pair it carried, in order
 */
export function parseCookieHeaderInput({ text }: { text: string }): readonly ImportedCookie[] {
  return text
    .replace(/^\s*cookie\s*:/i, "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf("=");
      return eq <= 0
        ? undefined
        : { domain: "github.com", expires: -1, name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
    })
    .filter((cookie: ImportedCookie | undefined) => cookie !== undefined);
}

/**
 * Parse a Netscape `cookies.txt` export into cookies.
 *
 * The second door, and the only one of the two that carries real EXPIRIES — which is the whole reason to
 * prefer it when an export is available: the session's lifetime becomes a measured fact rather than an
 * unknown. Lines are `domain \t flag \t path \t secure \t expiry \t name \t value`; a `#` comment and a
 * short line are skipped rather than treated as an error, because real exports carry both.
 *
 * @param text the file's contents
 * @returns every github.com cookie it carried, with its expiry
 */
export function parseNetscapeCookies({ text }: { text: string }): readonly ImportedCookie[] {
  const NETSCAPE_FIELDS = 7;
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.split("\t"))
      .filter((fields) => fields.length >= NETSCAPE_FIELDS)
      // `!` rather than `?? ""`: the length filter directly above guarantees these indices exist, so a
      // default would be dead code pretending to be a safety net — and an empty domain or name would sail
      // past the github.com filter as a silently-dropped cookie instead of an obvious bug.
      .map((fields) => ({
        domain: fields[0]!,
        expires: Number(fields[4]),
        name: fields[5]!,
        value: fields.slice(6).join("\t"),
      }))
      .filter((cookie) => Number.isFinite(cookie.expires))
      .filter((cookie) => isGithubCookieDomain({ domain: cookie.domain }))
  );
}

/**
 * Narrow a captured storage state to github.com cookies alone.
 *
 * A real interactive login through an SSO provider captures the IDENTITY PROVIDER's cookies too — measured
 * on the first successful capture: 55 cookies, of which 14 were github.com and the rest were
 * accounts.google.com, .google.com and .youtube.com. Persisting those would quietly make a file whose
 * stated purpose is "the GitHub session" into a Google credential as well, which is a far larger thing to
 * leave on disk and not what anyone consented to by running `attach login`.
 *
 * Nothing is lost by dropping them: the upload path already filters to github.com before sending, and the
 * persistent browser profile keeps the provider session for the NEXT login, which is where it belongs.
 *
 * @param json the raw storage state Playwright captured
 * @returns the same document carrying only github.com cookies
 */
export function narrowToGithubCookies({ json }: { json: string }): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  const cookiesValue: unknown = isRecord(parsed) ? parsed["cookies"] : undefined;
  if (!Array.isArray(cookiesValue)) {
    return json;
  }
  return JSON.stringify({
    cookies: cookiesValue
      .filter((value: unknown) => isStorageStateCookie(value))
      .filter((cookie) => isGithubCookieDomain({ domain: cookie.domain })),
    origins: [],
  });
}

/**
 * Render imported cookies as the same Playwright `storageState` document `attach login` would have written.
 *
 * One file format, whatever the door — so the upload path, the status path and the expiry reporting all stay
 * unaware of where a session came from, and an imported session is not a second thing to keep working.
 *
 * @param cookies the cookies recovered from an import source
 * @returns the storage-state JSON to write
 */
export function storageStateFromCookies({ cookies }: { cookies: readonly ImportedCookie[] }): string {
  return JSON.stringify({
    cookies: cookies.map((cookie) => ({
      domain: cookie.domain,
      expires: cookie.expires,
      httpOnly: false,
      name: cookie.name,
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: cookie.value,
    })),
    origins: [],
  });
}
