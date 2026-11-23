/**
 * The response and path primitives every `syncCloudflareAtlas` router and case shares: build a JSON
 * response, read a request's URL, shape a V4 list envelope, and pull a parent id out of a per-parent path.
 */

/**
 * A JSON `Response` with the given status.
 *
 * @returns the response, carrying `body` serialised as JSON
 */
export function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/**
 * The requested URL, however the SDK passed it — never `String(input)`, which would stringify a `Request`
 * via its default `Object` conversion rather than its actual URL.
 *
 * @returns the parsed request URL
 */
export function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/**
 * One page of a V4-paginated list envelope, terminating with an empty page 2.
 *
 * @returns the envelope for the requested page
 */
export function listPage({ page, items }: { page: number; items: readonly unknown[] }): {
  result: readonly unknown[];
  result_info: { count: number; page: number };
  success: true;
} {
  const result = page === 1 ? items : [];
  return { result, result_info: { count: result.length, page }, success: true };
}

/**
 * The application id path segment of a per-application policy-list request.
 *
 * @returns the id, or `null` if this is not one
 */
export function perAppPolicyApplicationId({ pathname }: { pathname: string }): string | null {
  const match = /\/access\/apps\/([^/]+)\/policies$/.exec(pathname);
  // Group 1 is not optional, so a match always captured it.
  return match === null ? null : match[1]!;
}

/**
 * The list id path segment of a per-list Gateway List items request.
 *
 * @returns the id, or `null` if this is not one
 */
export function gatewayListItemsListId({ pathname }: { pathname: string }): string | null {
  const match = /\/gateway\/lists\/([^/]+)\/items$/.exec(pathname);
  return match === null ? null : match[1]!;
}

/**
 * The list id path segment of a per-list account filter-list items request.
 *
 * @returns the id, or `null` if this is not one
 */
export function filterListItemsListId({ pathname }: { pathname: string }): string | null {
  const match = /\/rules\/lists\/([^/]+)\/items$/.exec(pathname);
  return match === null ? null : match[1]!;
}

/**
 * The project name path segment of a per-project Pages deployments request.
 *
 * @returns the project name, or `null` if this is not one
 */
export function pagesDeploymentsProjectName({ pathname }: { pathname: string }): string | null {
  const match = /\/pages\/projects\/([^/]+)\/deployments$/.exec(pathname);
  return match === null ? null : match[1]!;
}

/**
 * The project name path segment of a per-project Pages domains request.
 *
 * @returns the project name, or `null` if this is not one
 */
export function pagesDomainsProjectName({ pathname }: { pathname: string }): string | null {
  const match = /\/pages\/projects\/([^/]+)\/domains$/.exec(pathname);
  return match === null ? null : match[1]!;
}

/**
 * The script name path segment of a per-script Worker sub-resource request matching one exact trailing
 * segment (e.g. "settings", "deployments").
 *
 * @returns the script name, or `null` if this is not one
 */
export function workerScriptSubresourceName({
  pathname,
  segment,
}: {
  pathname: string;
  segment: string;
}): string | null {
  const marker = "/workers/scripts/";
  const start = pathname.indexOf(marker);
  if (start === -1 || !pathname.endsWith(`/${segment}`)) {
    return null;
  }
  const rest = pathname.slice(start + marker.length, pathname.length - segment.length - 1);
  return rest.includes("/") ? null : rest;
}
