/**
 * The 1Password Events API client — the read-only half of this atlas's access.
 *
 * ## Why this is the credential we are relaxed about
 *
 * The Events API has no endpoint that returns an item's contents. `auditevents` reports that a principal
 * performed an action on an object identified by a UUID; there is no title, no field, no value anywhere in
 * its response shape. That is a property of the API rather than of this client's restraint, which is why
 * the owner can mint this token without weighing what it could leak.
 *
 * ## Host is per-region and comes from configuration
 *
 * 1Password serves the Events API from a per-region host, and an account on the wrong one gets a 401 that
 * reads exactly like a bad token. The host is therefore configurable (`credentials.ts`), validated as a
 * bare hostname there, and pinned here — a caller passes a PATH, never a URL, so this client can only ever
 * address the host it was built with.
 *
 * ## `redirect: 'manual'`
 *
 * A followed redirect would re-issue the request, bearer token included, at whatever host the redirect
 * names. A 3xx is a transport fault here, not something to chase.
 *
 * ## Every page is read through a strict boundary
 *
 * `eventsBoundaries.ts` declares every key a page and an item carry, so a key 1Password adds, drops or renames
 * refuses the walk by name rather than ending it early or riding into the projection unseen. The refusal names
 * a key, never a value.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { OnepasswordEventsCredentials } from "./credentials.js";
import { type OnepasswordAuditEventWire, readOnepasswordAuditPage } from "./eventsBoundaries.js";
import { OnepasswordEventsErrors, onepasswordEventsErrorLines } from "./eventsErrors.js";
import { onepasswordEventsEndpointFor } from "./inventory.js";

const REQUEST_TIMEOUT_MS = 30_000;

/** How many events one page asks for. 1Password's documented maximum for these endpoints is 1000. */
const PAGE_SIZE = 1000;

/**
 * The most pages one sync will walk. A bound rather than a limit on the data: an account with more than
 * this many events in the window has an incomplete read, which is reported as a
 * `events-pagination-incomplete` gap rather than silently accepted as the whole picture.
 */
const MAX_PAGES = 200;

/**
 * The HTTP seam. Injected so every branch below is reachable without a network call.
 *
 * NOT exported: it is a parameter type of {@link createOnepasswordEventsClient}, and a caller passing a fake
 * infers it from the call site. Exporting it would need an `@internal` block directly above the declaration,
 * which is the line the exemption below has to occupy.
 */
// named-object-params-exempt: must match the real global fetch's positional shape to be substitutable for it
type OnepasswordFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; redirect: "manual"; signal: AbortSignal; body?: string },
) => Promise<{ status: number; text: () => Promise<string> }>;

/** What this atlas can ask the Events API for. */
export interface OnepasswordEventsClient {
  /** Every audit event since `since`, walked to exhaustion or to the page bound. */
  listAuditEvents: (input: { since: string }) => Promise<Result<OnepasswordEventPage>>;
}

/** One completed walk of the audit-event feed. */
interface OnepasswordEventPage {
  readonly items: readonly OnepasswordAuditEventWire[];
  /** `true` when the walk stopped at {@link MAX_PAGES} with more still available. */
  readonly truncated: boolean;
}

/** Issue one request against the pinned host, returning status and body without interpreting either. */
async function request({
  credentials,
  path,
  method,
  body,
  fetchImpl,
}: {
  credentials: OnepasswordEventsCredentials;
  path: string;
  method: "GET" | "POST";
  body: string | null;
  fetchImpl: OnepasswordFetchLike;
}): Promise<Result<{ status: number; text: string }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://${credentials.host}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json",
      },
      method,
      redirect: "manual",
      signal: controller.signal,
      ...(body === null ? {} : { body }),
    });
    return ok({ status: response.status, text: await response.text() });
  } catch (error: unknown) {
    // The credential is never interpolated into a message; only the path is.
    return err(
      onepasswordEventsErrorLines({ error: OnepasswordEventsErrors.requestFailed({ cause: error, method, path }) }),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a non-2xx into this atlas's own words, without ever echoing the response body. */
function refusal({ path, status }: { path: string; status: number }): readonly string[] {
  return onepasswordEventsErrorLines({ error: OnepasswordEventsErrors.httpRefused({ path, status }) });
}

/**
 * Walk the audit feed from `since`, following the cursor until it runs out or the page bound is reached.
 *
 * A walk that stops at `MAX_PAGES` returns `truncated: true` rather than pretending it saw everything - the
 * caller turns that into a gap, because an atlas that silently held half the events would read complete.
 *
 * @param since the ISO instant the walk starts from
 * @returns every event read, and whether the bound cut the walk short
 */
async function listAuditEventsWith({
  credentials,
  fetchImpl,
  since,
}: {
  credentials: OnepasswordEventsCredentials;
  fetchImpl: OnepasswordFetchLike;
  since: string;
}): Promise<Result<OnepasswordEventPage>> {
  const endpoint = onepasswordEventsEndpointFor({ surface: "events-audit" });
  if (endpoint === null) {
    return err(
      onepasswordEventsErrorLines({ error: OnepasswordEventsErrors.endpointUnlisted({ surface: "events-audit" }) }),
    );
  }
  const items: OnepasswordAuditEventWire[] = [];
  let body = JSON.stringify({ limit: PAGE_SIZE, start_time: since });
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request({ body, credentials, fetchImpl, method: "POST", path: endpoint.path });
    if (response.isErr()) {
      return err(response.error);
    }
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(refusal({ path: endpoint.path, status: response.value.status }));
    }
    const read = readOnepasswordAuditPage({ text: response.value.text });
    if (read.isErr()) {
      return err(
        onepasswordEventsErrorLines({
          error: OnepasswordEventsErrors.responseChanged({ message: read.error.message }),
        }),
      );
    }
    items.push(...read.value.items);
    if (!read.value.hasMore) {
      return ok({ items, truncated: false });
    }
    body = JSON.stringify({ cursor: read.value.cursor });
  }
  return ok({ items, truncated: true });
}

/**
 * Build an Events API client bound to one account's region and token.
 *
 * @param credentials the resolved token and region host
 * @param fetchImpl the HTTP seam, defaulting to the global `fetch`
 * @returns the client
 */
export function createOnepasswordEventsClient({
  credentials,
  fetchImpl = globalOnepasswordFetch,
}: {
  credentials: OnepasswordEventsCredentials;
  fetchImpl?: OnepasswordFetchLike;
}): OnepasswordEventsClient {
  const doFetch = fetchImpl;
  return {
    listAuditEvents: ({ since }) => listAuditEventsWith({ credentials, fetchImpl: doFetch, since }),
  };
}

const globalOnepasswordFetch: OnepasswordFetchLike = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  return { status: response.status, text: () => response.text() };
};
