/**
 * The shared HTTP seam every `VantaClient` operation module calls through. `transport.ts`/`oauth.ts` are
 * reused unchanged; this module adds token resolution on top of them, and reads every JSON answer through the
 * strict `Boundary` (`#lib/boundary.ts`) its operation module declared for that endpoint at load — so a field
 * Vanta adds, drops, renames or retypes refuses the read by name rather than being stripped. It returns
 * `Result<T, VantaSdkError>` rather than throwing — see `./errors.ts`'s header for why.
 *
 * There is no official Vanta SDK (`docs/provider-sdks.md`), so this client is ours and the owner's ruling for
 * hand-written clients applies: stay strict, and update the client when Vanta changes.
 */
import type { Boundary } from "#lib/boundary.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { vantaTransportFailureLines } from "../httpErrors.js";
import type { VantaTokenProvider } from "../oauth.js";
import { noteIfUnauthorized } from "../oauth.js";
import type { VantaRawResponse, VantaTransport } from "../transport.js";
import { type VantaSdkError, VantaSdkErrors, type VantaSdkMethod } from "./errors.js";

/** Redact the one token this call used from a failed result's reasons. */
function redactToken({ token, reasons }: { token: string; reasons: readonly string[] }): readonly string[] {
  if (token === "") {
    return reasons;
  }
  return reasons.map((line) => line.split(token).join("[REDACTED]"));
}

/**
 * Resolve a token and issue one request. Returns the raw response on success; parsing its body is each
 * caller's own job, since a 204 has none to parse.
 *
 * @param operationId the SDK operation name, carried into any error for diagnostics
 * @param method the HTTP verb
 * @param path the request path
 * @param headers the request headers, before the bearer token is added
 * @param body the request body, or `undefined` for a GET/no-body write
 * @param tokenProvider mints/reuses the bearer token
 * @param transport the bound Vanta transport
 * @returns the raw response, or the reason the request failed
 */
export async function performVantaSdkRequest({
  operationId,
  method,
  path,
  headers,
  body,
  tokenProvider,
  transport,
}: {
  operationId: string;
  method: VantaSdkMethod;
  path: string;
  headers: Readonly<Record<string, string>>;
  body: string | FormData | undefined;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<VantaRawResponse, VantaSdkError>> {
  const token = await tokenProvider.getToken();
  if (token.isErr()) {
    return err(
      VantaSdkErrors.apiError({
        method,
        operationId,
        path,
        reasons: vantaTransportFailureLines({ error: token.error }),
      }),
    );
  }
  const response = await transport.request({
    headers: { ...headers, authorization: `Bearer ${token.value}` },
    method,
    path,
    ...(body === undefined ? {} : { body }),
  });
  if (response.isErr()) {
    return err(
      VantaSdkErrors.apiError({
        method,
        operationId,
        path,
        reasons: redactToken({ reasons: noteIfUnauthorized({ error: response.error }), token: token.value }),
      }),
    );
  }
  return ok(response.value);
}

/**
 * Issue a request expecting a JSON body back, read through the endpoint's strict boundary.
 *
 * @param operationId the SDK operation name, carried into any error for diagnostics
 * @param method the HTTP verb
 * @param path the request path, filled — the boundary names the template
 * @param headers the request headers, before the bearer token is added
 * @param body the request body, or `undefined` for a GET/no-body write
 * @param boundary the endpoint's strict read, declared once at module load by its operation module
 * @param tokenProvider mints/reuses the bearer token
 * @param transport the bound Vanta transport
 * @returns the parsed body, or the reason the request failed or the boundary refused its answer
 */
export async function requestJson<TValue>({
  operationId,
  method,
  path,
  headers = {},
  body,
  boundary: endpointBoundary,
  tokenProvider,
  transport,
}: {
  operationId: string;
  method: VantaSdkMethod;
  path: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | FormData;
  boundary: Boundary<TValue>;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<TValue, VantaSdkError>> {
  // Annotated, not destructured: the boundary-schema gate licenses `boundary.parseJson(` by this declaration.
  const boundary: Boundary<TValue> = endpointBoundary;
  const raw = await performVantaSdkRequest({ body, headers, method, operationId, path, tokenProvider, transport });
  if (raw.isErr()) {
    return err(raw.error);
  }
  return boundary
    .parseJson({ text: raw.value.body })
    .mapErr((boundaryError) => VantaSdkErrors.responseValidationError({ boundaryError, method, operationId, path }));
}

/**
 * Issue a request expecting no body back (a 204), e.g. every delete.
 *
 * @param operationId the SDK operation name, carried into any error for diagnostics
 * @param method the HTTP verb
 * @param path the request path
 * @param headers the request headers, before the bearer token is added
 * @param body the request body, or `undefined` for a no-body write
 * @param tokenProvider mints/reuses the bearer token
 * @param transport the bound Vanta transport
 * @returns `null` on success, or the reason the request failed
 */
export async function requestNoContent({
  operationId,
  method,
  path,
  headers = {},
  body,
  tokenProvider,
  transport,
}: {
  operationId: string;
  method: VantaSdkMethod;
  path: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | FormData;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<null, VantaSdkError>> {
  const raw = await performVantaSdkRequest({ body, headers, method, operationId, path, tokenProvider, transport });
  return raw.isErr() ? err(raw.error) : ok(null);
}
