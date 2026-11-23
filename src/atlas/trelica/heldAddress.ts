/**
 * Where a Trelica page settled, read and held in a closed form.
 *
 * Two readers share this: the walk (`browserWalk.ts`), which stops on a lost session and holds every settled address
 * and title without what the client wrote into it, and the hand recheck (`hand/sessionProbes.ts`), which asks the same
 * sign-in question before it retires the owner's sign-in step. One test, so the two can never disagree about whether
 * the page in front of them is the Log in form.
 */
import { TRELICA_SHELL_TITLE, TRELICA_UNDECLARED_PATH, trelicaDeclaredPath } from "./browserPages.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "./providerText.js";
import { isTrelicaTenantHost, TRELICA_LOGIN_ORIGIN, TRELICA_TENANT_SIGN_IN_PATH } from "./tenant.js";

/**
 * Parse a URL, or `null` when it is not one.
 *
 * @param url the address as the client wrote it
 * @returns the parsed address, or `null` when it does not parse
 *
 * @internal
 */
export function parseTrelicaAddress({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether a settled URL is a Trelica sign-in page — which is what a lost session looks like.
 *
 * Two shapes: the vendor's shared sign-in origin, and a tenant's own origin at its sign-in path. Matching the tenant
 * shape by host rather than by this installation's tenant keeps the test pure, and `/Account/Login` on any tenant is
 * a sign-in form whoever's it is. The path is compared without case, as the server routes it, and otherwise exactly:
 * only the measured route is evidence.
 *
 * @param finalUrl where the browser settled
 * @returns whether the session is gone
 *
 * @internal
 */
export function isTrelicaSignInLanding({ finalUrl }: { finalUrl: string }): boolean {
  const settled = parseTrelicaAddress({ url: finalUrl });
  if (settled === null) {
    return false;
  }
  if (settled.origin === TRELICA_LOGIN_ORIGIN) {
    return true;
  }
  return (
    settled.protocol === "https:" &&
    isTrelicaTenantHost({ host: settled.hostname }) &&
    settled.pathname.toLowerCase() === TRELICA_TENANT_SIGN_IN_PATH.toLowerCase()
  );
}

/** What a settled address is held as when the walk could not read it as a URL. */
const UNREADABLE_ADDRESS = "an address the walk could not read";

/** What a settled address is held as when it is on neither the tenant's origin nor the sign-in origin. */
const FOREIGN_ADDRESS = "an origin that is not the tenant's own";

/**
 * Where a page settled, as the atlas may hold it. A redirect's path and query can carry a value — a run's id, a slug
 * a provider wrote — so the address the client wrote is never held: only the tenant origin with a declared page path
 * or its sign-in path, the vendor's sign-in origin alone, or a fixed marker.
 *
 * @param finalUrl where the browser settled, as the client wrote it
 * @param tenantOrigin this installation's tenant origin
 * @returns the closed address
 *
 * @internal
 */
export function trelicaHeldFinalUrl({ finalUrl, tenantOrigin }: { finalUrl: string; tenantOrigin: string }): string {
  const settled = parseTrelicaAddress({ url: finalUrl });
  if (settled === null) {
    return UNREADABLE_ADDRESS;
  }
  if (settled.origin === TRELICA_LOGIN_ORIGIN) {
    return TRELICA_LOGIN_ORIGIN;
  }
  if (settled.origin !== tenantOrigin) {
    return FOREIGN_ADDRESS;
  }
  if (isTrelicaSignInLanding({ finalUrl })) {
    return `${tenantOrigin}${TRELICA_TENANT_SIGN_IN_PATH}`;
  }
  const path = trelicaDeclaredPath({ pathname: settled.pathname });
  if (path === TRELICA_UNDECLARED_PATH) {
    return path;
  }
  return `${tenantOrigin}${path}`;
}

/**
 * A page's title as the atlas may hold it. A page can title itself with what a provider wrote — the error it is
 * showing — so only the bare product title Trelica sets is held as written, and any other is the withheld marker.
 *
 * @param title the document title the page settled on
 * @returns the bare product title as Trelica sets it, else the withheld marker
 *
 * @internal
 */
export function trelicaHeldTitle({ title }: { title: string }): string {
  if (title.trim() === TRELICA_SHELL_TITLE) {
    return TRELICA_SHELL_TITLE;
  }
  return TRELICA_PROVIDER_TEXT_WITHHELD;
}
