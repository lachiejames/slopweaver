/**
 * Matching a concrete request back to the closed surface registry: the check the production transport in
 * `client.ts` runs on every request it is HANDED, so a URL the registry describes no operation for is refused
 * by the transport itself rather than merely never constructed. Pure and network-free; its own module because
 * it reads only the registry, never a credential or a response.
 */
import { JUMPCLOUD_ORIGINS } from "./generated/specLock.js";
import { JUMPCLOUD_SURFACES } from "./generated/surfaces.js";
import type { JumpcloudSurfaceRow } from "./surfaceRow.js";

/**
 * A registry path as a matcher: each `{brace}` parameter becomes one path segment, and nothing else moves.
 *
 * @param path the registry row's own path
 * @returns a regular expression anchored to the whole path
 */
function pathMatcher({ path }: { path: string }): RegExp {
  const escaped = path.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll(/\\\{[^}]*\\\}/g, "[^/]+")}$`);
}

/**
 * The registry row one absolute URL and method correspond to, or `null` when none does.
 *
 * The inverse of `client.ts`'s `buildUrl`, and it exists because a transport that takes a URL is a network
 * primitive: anything holding it can reach any endpoint at these origins unless the transport itself
 * checks. Matching is by ORIGIN, METHOD and PATH SHAPE — a bound id is one path segment, so
 * `/api/systems/abc` matches `/api/systems/{id}` and `/api/systems/abc/extra` matches nothing.
 *
 * An `excluded` row never matches: those operations are inventoried and have no callable variant at all.
 *
 * @param url the absolute URL a caller handed the transport
 * @param method the HTTP method it asked for
 * @returns the admitting row, or `null` when the registry admits no such request
 */
export function admittedRegistryRow({ url, method }: { url: string; method: string }): JumpcloudSurfaceRow | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const admitting = JUMPCLOUD_SURFACES.find(
    (row) =>
      row.coverage === "reachable" &&
      row.method === method &&
      JUMPCLOUD_ORIGINS[row.origin] === parsed.origin &&
      pathMatcher({ path: row.path }).test(parsed.pathname),
  );
  if (admitting === undefined) {
    // Absent by design: no reachable row admits this request, and `null` IS the transport's refusal signal.
    return null;
  }
  return admitting;
}
