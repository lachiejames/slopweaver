/**
 * The audit-log pull's request plumbing, shared by discovery, the inventory read and entry paging: one call
 * parsed by its endpoint's boundary, the refusal fact a failed call leaves in the manifest, and a list paged to
 * its last page. Effectful only through the injected sender.
 */
import type { Boundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpAuditError, GcpAuditErrors } from "./errors.js";
import type { GcpRefusalFact } from "./store.js";
import type { GcpAuditRequest, GcpAuditSend } from "./transport.js";

/**
 * One request, parsed by its boundary, a drift mapped to `RESPONSE_CHANGED`.
 *
 * @param send the sender
 * @param request the operation
 * @param boundary the endpoint's strict schema
 * @returns the parsed answer, or the failure
 */
export async function call<T>({
  send,
  request,
  boundary,
}: {
  send: GcpAuditSend;
  request: GcpAuditRequest;
  boundary: Boundary<T>;
}): Promise<Result<T, GcpAuditError>> {
  const answered = await send({ request });
  if (answered.isErr()) {
    return err(answered.error);
  }
  const parsed = boundary.parse({ value: answered.value });
  if (parsed.isErr()) {
    return err(GcpAuditErrors.responseChanged({ detail: parsed.error.message, endpoint: boundary.endpoint }));
  }
  return ok(parsed.value);
}

/**
 * A refusal fact from a failed call.
 *
 * @param what the container or operation that was refused
 * @param error the failure
 * @returns the fact the manifest keeps
 */
export function refusal({ what, error }: { what: string; error: GcpAuditError }): GcpRefusalFact {
  return { message: error.message, status: error.code === "TRANSPORT_FAILED" ? error.status : null, what };
}

/**
 * The token to ask for the next page with. Google ends a list with no token or an EMPTY one, and both mean done.
 *
 * @param next the `nextPageToken` a page answered
 * @returns the token, or undefined on the last page
 */
export function nextPageToken({ next }: { next: string | undefined }): string | undefined {
  if (next === undefined || next.length === 0) {
    return undefined;
  }
  return next;
}

/**
 * The `pageToken` field a request carries: absent on the first page, never present-but-undefined.
 *
 * @param pageToken the token the previous page returned
 * @returns `{ pageToken }`, or an empty object on the first page
 */
export function pageTokenField({ pageToken }: { pageToken: string | undefined }): { readonly pageToken?: string } {
  if (pageToken === undefined) {
    return {};
  }
  return { pageToken };
}

/**
 * Follow a list's page tokens to the end. An inventory read short of its last page would hide a sink or a
 * bucket and let a generation call itself complete.
 *
 * @param fetchPage reads one page, given the token the previous page returned
 * @returns every item on every page, or the failure that stopped paging
 */
export async function pageToEnd<T>({
  fetchPage,
}: {
  fetchPage: (args: {
    pageToken: string | undefined;
  }) => Promise<Result<{ items: readonly T[]; next: string | undefined }, GcpAuditError>>;
}): Promise<Result<readonly T[], GcpAuditError>> {
  const found: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchPage({ pageToken });
    if (page.isErr()) {
      return err(page.error);
    }
    found.push(...page.value.items);
    pageToken = nextPageToken({ next: page.value.next });
  } while (pageToken !== undefined);
  return ok(found);
}
