/**
 * The one HTTP boundary the two API channels reach the tenant through.
 *
 * A single module so the redirect posture, the timeout and the error mapping are decided once. Everything
 * here is a READ: the caller supplies a method and a body from `inventory.ts`'s closed table, and this
 * module adds nothing to either.
 *
 * ## Redirects are NOT followed, and that is what makes a lost session detectable
 *
 * MEASURED: a signed-out request to a tenant page answers `302` to the vendor's shared sign-in
 * origin, and `fetch`'s default is to follow it and hand back a `200` for a login form. A caller that
 * followed the redirect would read the login page's HTML, find no antiforgery token in it, and report
 * something vague; refusing to follow keeps "your session is gone" a status code rather than an inference.
 */
import type { Boundary } from "../../lib/boundary.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { TrelicaHttp } from "./client.js";
import { type TrelicaAtlasError, TrelicaAtlasErrors } from "./errors.js";
import { type TrelicaPublishedDocumentBody, trelicaPublishedDocumentBoundary } from "./publishedDocumentBoundary.js";
import type { TrelicaDocumentFetcher, TrelicaPublishedDocument } from "./publishedSpec.js";
import { trelicaPublishedDocumentPath } from "./publishedSpec.js";
import type { TrelicaPageFetcher } from "./session.js";

/**
 * How long one request may take before it is abandoned.
 *
 * The application inventory pages at two hundred records, and thirty seconds sits well past one page's
 * measured answer time over this tenant, so it gives a slow tenant room without letting a hung socket stall a
 * whole run. Reproduce the answer time with `time slopweaver atlas trelica sync`.
 *
 * @internal
 */
export const TRELICA_REQUEST_TIMEOUT_MS = 30_000;

/**
 * One request against the tenant, answered with its status and body or a typed failure. The real one is
 * this module's own `fetch` call; a factory takes it as an optional field so a test can answer instead.
 * @internal
 */
export type TrelicaRequest = (input: {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly label: string;
}) => Promise<Result<{ statusCode: number; text: string }, TrelicaAtlasError>>;

/** Run one request against the tenant, mapping every throw into a typed failure. */
async function request({
  url,
  method,
  headers,
  body,
  label,
}: {
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body: string | undefined;
  label: string;
}): Promise<Result<{ statusCode: number; text: string }, TrelicaAtlasError>> {
  try {
    const response = await fetch(url, {
      headers,
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(TRELICA_REQUEST_TIMEOUT_MS),
      ...(body === undefined ? {} : { body }),
    });
    return ok({ statusCode: response.status, text: await response.text() });
  } catch (cause: unknown) {
    return err(TrelicaAtlasErrors.transportFailed({ callId: label, cause: errorMessage({ error: cause }) }));
  }
}

/**
 * The HTTP surface `client.ts` makes its admitted calls through.
 *
 * @param requester what sends the request; this module's own `fetch` unless a test answers instead
 * @returns the injected transport
 */
export function trelicaHttp({ requester = request }: { requester?: TrelicaRequest } = {}): TrelicaHttp {
  return async ({ url, method, headers, body }) => requester({ body, headers, label: method, method, url });
}

/**
 * The page fetcher `session.ts` reads the antiforgery token through.
 *
 * @param tenantOrigin this installation's tenant origin
 * @param requester what sends the request; this module's own `fetch` unless a test answers instead
 * @returns the injected fetcher
 */
export function trelicaPageFetcher({
  tenantOrigin,
  requester = request,
}: {
  tenantOrigin: string;
  requester?: TrelicaRequest;
}): TrelicaPageFetcher {
  return async ({ path, cookie }) => {
    const response = await requester({
      body: undefined,
      headers: { accept: "text/html", cookie },
      label: `page:${path}`,
      method: "GET",
      url: `${tenantOrigin}${path}`,
    });
    if (response.isErr()) {
      return err(response.error);
    }
    if (response.value.statusCode !== 200) {
      // A redirect here is a signed-out browser: the tenant sends an unauthenticated request to the
      // vendor's shared sign-in origin rather than rendering the page.
      return err(TrelicaAtlasErrors.sessionLost({ origin: tenantOrigin }));
    }
    return ok(response.value.text);
  };
}

/**
 * The document fetcher `publishedSpec.ts` compiles the published surface through.
 *
 * The documents are served by the tenant and need no credential at all — MEASURED, they answer
 * to an unauthenticated request. The session cookie is still presented, because a vendor that starts
 * gating them tomorrow should keep working rather than start reporting every document unreadable.
 *
 * @param tenantOrigin this installation's tenant origin
 * @param cookie the session cookie header, presented but not required
 * @param requester what sends the request; this module's own `fetch` unless a test answers instead
 * @returns the injected fetcher
 */
export function trelicaDocumentFetcher({
  tenantOrigin,
  cookie,
  requester = request,
}: {
  tenantOrigin: string;
  cookie: string;
  requester?: TrelicaRequest;
}): TrelicaDocumentFetcher {
  return async ({ document }: { document: TrelicaPublishedDocument }) => {
    const path = trelicaPublishedDocumentPath({ document });
    const response = await requester({
      body: undefined,
      headers: { accept: "application/json", cookie },
      label: `document:${document}`,
      method: "GET",
      url: `${tenantOrigin}${path}`,
    });
    if (response.isErr()) {
      return err(response.error);
    }
    if (response.value.statusCode !== 200) {
      return err(
        TrelicaAtlasErrors.documentUnreadable({
          detail: `the tenant answered HTTP ${String(response.value.statusCode)} for ${path}`,
          document,
        }),
      );
    }
    const boundary: Boundary<TrelicaPublishedDocumentBody> = trelicaPublishedDocumentBoundary;
    const admitted = boundary.parseJson({ text: response.value.text });
    if (admitted.isErr()) {
      // Neither refusal quotes the body: a not-JSON one names the path, a drift one names keys and kinds.
      const detail =
        admitted.error.code === "BOUNDARY_NOT_JSON"
          ? `${path} answered a body that is not JSON`
          : admitted.error.message;
      return err(TrelicaAtlasErrors.documentUnreadable({ detail, document }));
    }
    return ok(admitted.value);
  };
}
