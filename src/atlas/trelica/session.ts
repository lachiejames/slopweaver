/**
 * The signed-in session the first-party channel stands on: the owner's own Chrome cookies, plus the
 * antiforgery token this platform's own pages carry.
 *
 * ## It reads the owner's jar rather than holding a credential
 *
 * `docs/browser-route/proof-and-capture-verbs.md` names this lane: "a leg that needs a signed-in COOKIE and no rendered page reads
 * the owner's real Chrome's own cookie database". Nothing here logs in, nothing keeps a session file, and nothing
 * is written to disk — the cookies are read per run and used to make the calls in `inventory.ts`. Neither a
 * cookie value nor the antiforgery token is ever returned to a caller, printed, or stored in a generation;
 * `client.ts` holds them inside the closure that makes the calls.
 *
 * ## Why an antiforgery token at all, and why it is READ rather than minted
 *
 * The platform is an ASP.NET Core application and rejects a cross-site POST without a matching token. The
 * token sits in the page HTML the browser already renders and in a cookie the browser already holds, so
 * this reads the page the same way the browser does. There is no elevation here: presenting the token this
 * session already has is what the browser does on every click, and the alternative — omitting it and
 * calling only GET rows — would drop the atlas's central entity kind, which this platform's own client
 * lists by POSTing a filter.
 *
 * ## A missing cookie is SESSION_LOST, and it is the owner's to fix
 *
 * A verb here refuses in one line naming the action, exactly as `github attach upload` does. It never opens a login page, never types into one, and never navigates an identity provider's
 * sign-on URL on the owner's behalf: establishing a session is the owner's click, not this program's.
 */
import { readOriginCookies } from "../../browser/cookieJar.js";
import type { JarCookie } from "../../browser/cookieScope.js";
import { type RecordedProfilePort, readRecordedProfile } from "../../browser/recordedProfile.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type TrelicaAtlasError, TrelicaAtlasErrors } from "./errors.js";

/**
 * The cookie whose presence means this browser holds a signed-in session for the tenant.
 *
 * The platform's identity cookie, named by its framework rather than by this organisation, so the constant
 * carries no private identifier. Checked by NAME only — the value is never inspected, compared or logged.
 *
 * @internal
 */
export const TRELICA_SESSION_COOKIE = ".AspNetCore.Identity.Application";

/**
 * The cookie carrying the antiforgery token's other half.
 *
 * @internal
 */
export const TRELICA_XSRF_COOKIE = "XSRF-TOKEN";

/** The request header this platform reads the antiforgery token from. */
export const TRELICA_XSRF_HEADER = "x-xsrf-token";

/**
 * The path whose rendered HTML carries the page-state block the antiforgery token sits in.
 *
 * The end-user catalogue rather than an admin page, deliberately: every signed-in person can render it
 * whatever their roles, so reading the token never depends on a permission the atlas is about to discover
 * it does not have.
 *
 * @internal
 */
export const TRELICA_TOKEN_PAGE_PATH = "/Catalog";

/**
 * The token's own key inside the page-state block. Matched with a bounded, non-greedy pattern rather than
 * by parsing the surrounding script, because the block is a JavaScript literal rather than JSON.
 */
const ANTIFORGERY_PATTERN = /"antiforgeryToken":"([^"]{1,4096})"/;

/**
 * A live session's request headers, assembled once and never inspected by a caller.
 *
 * `cookie` and `antiforgery` are the two secrets; nothing outside `client.ts` reads either field, and
 * neither appears in any error this module can produce.
 */
export interface TrelicaSession {
  readonly cookie: string;
  readonly antiforgery: string;
  /** Which Chrome profile the session was read from — a directory NAME, never an account. */
  readonly profileDirectory: string;
}

/**
 * Render the jar rows a browser would send to one origin into a `Cookie` header.
 *
 * @param cookies the applicable jar rows
 * @returns the header value
 *
 * @internal
 */
export function cookieHeaderFromJar({ cookies }: { cookies: readonly JarCookie[] }): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/**
 * Whether a jar holds the cookie that means this browser is signed in to the tenant.
 *
 * @param cookies the applicable jar rows
 * @returns whether the identity cookie is present, by name
 *
 * @internal
 */
export function jarHoldsSession({ cookies }: { cookies: readonly JarCookie[] }): boolean {
  return cookies.some((cookie) => cookie.name === TRELICA_SESSION_COOKIE);
}

/**
 * The antiforgery token a rendered page carries.
 *
 * @param html the page's own HTML
 * @returns the token, or `null` when the page carries none — which is what a sign-in page looks like
 *
 * @internal
 */
export function antiforgeryTokenFrom({ html }: { html: string }): string | null {
  const token = ANTIFORGERY_PATTERN.exec(html)?.[1];
  if (token === undefined) {
    // No token on the page is the signed-out answer, and the caller refuses it as a lost session.
    return null;
  }
  return token;
}

/** How a page's HTML is fetched. Injected so session assembly is testable without a network or a browser. */
export type TrelicaPageFetcher = (input: {
  path: string;
  cookie: string;
}) => Promise<Result<string, TrelicaAtlasError>>;

/**
 * Assemble the session the first-party channel makes its calls with.
 *
 * @param home the state home whose recorded Chrome profile the jar is read from
 * @param tenantOrigin this installation's tenant origin
 * @param fetchPage how to render one page and hand back its HTML
 * @param profiles the door the recorded work profile is read through
 * @returns the session, or why there is none — always {@link TrelicaAtlasErrors.sessionLost} for a signed
 *   out browser, so a caller can tell "the owner must sign in" from "this is misconfigured"
 */
export async function resolveTrelicaSession({
  home,
  tenantOrigin,
  fetchPage,
  profiles,
}: {
  home: string;
  tenantOrigin: string;
  fetchPage: TrelicaPageFetcher;
  profiles: RecordedProfilePort;
}): Promise<Result<TrelicaSession, TrelicaAtlasError>> {
  const directory = await readRecordedProfile({ home, profiles });
  if (directory.isErr()) {
    return err(TrelicaAtlasErrors.tenantUnresolved({ reasons: [directory.error.message] }));
  }
  const cookies = await readOriginCookies({
    directory: directory.value,
    origin: tenantOrigin,
    platform: process.platform,
  });
  if (cookies.isErr()) {
    return err(TrelicaAtlasErrors.tenantUnresolved({ reasons: [cookies.error.message] }));
  }
  if (!jarHoldsSession({ cookies: cookies.value })) {
    return err(TrelicaAtlasErrors.sessionLost({ origin: tenantOrigin }));
  }
  const cookie = cookieHeaderFromJar({ cookies: cookies.value });
  const html = await fetchPage({ cookie, path: TRELICA_TOKEN_PAGE_PATH });
  if (html.isErr()) {
    return err(html.error);
  }
  const antiforgery = antiforgeryTokenFrom({ html: html.value });
  if (antiforgery === null) {
    // The cookie was present and the page still would not render as a signed-in one, which is what an
    // expired ticket looks like: the cookie outlives the session it stands for.
    return err(TrelicaAtlasErrors.sessionLost({ origin: tenantOrigin }));
  }
  return ok({ antiforgery, cookie, profileDirectory: directory.value });
}
