/**
 * The two mechanics every Vanta Manage API WRITE shares, extracted so a second write surface cannot
 * quietly grow its own copy: resolve a token and issue one request (redacting that token from any refusal),
 * and read a write's JSON body through the strict boundary its write client declared for that endpoint.
 *
 * Both lived privately in `writeClient.ts` while documents were the only write. `vulnerabilityWriteClient.ts`
 * is the second, and duplicating a token-redaction routine is exactly the class of drift that ends with one
 * copy leaking a bearer token into an error line.
 */
import type { Boundary } from "#lib/boundary.js";
import { err, ok, type Result } from "../../lib/result.js";
import { VantaHttpErrors, vantaHttpErrorLines, vantaTransportFailureLines } from "./httpErrors.js";
import type { VantaTokenProvider } from "./oauth.js";
import { noteIfUnauthorized } from "./oauth.js";
import type { VantaRawResponse, VantaTransport } from "./transport.js";

/** Redact the one token this call used from a failed result's errors. */
function withTokenRedacted<TValue>({ token, result }: { token: string; result: Result<TValue> }): Result<TValue> {
  if (result.isOk() || token === "") {
    return result;
  }
  return err(result.error.map((line) => line.split(token).join("[REDACTED]")));
}

/**
 * Resolve a token and issue one write request, redacting it and appending the one-token-per-app note on any
 * failure.
 *
 * @param method the HTTP method — every Vanta write this package makes is a POST or a DELETE
 * @param path the endpoint path, already built by the calling client
 * @param headers request headers other than `authorization`, which this function supplies
 * @param body the request body, or `undefined` for a bodiless write
 * @param retryPolicy `"never"` for a write whose per-item REPORT a replay would corrupt; omit for the
 *   transport's standard retry behaviour, which is what every write here had before the flag existed
 * @param tokenProvider mints/reuses the bearer token
 * @param transport the bound Vanta transport
 * @returns the raw response, or every reason the write could not be issued
 */
export async function performVantaWrite({
  method,
  path,
  headers,
  body,
  retryPolicy,
  tokenProvider,
  transport,
}: {
  method: "POST" | "DELETE";
  path: string;
  headers: Readonly<Record<string, string>>;
  body: string | FormData | undefined;
  retryPolicy?: "standard" | "never";
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<VantaRawResponse>> {
  const token = await tokenProvider.getToken();
  if (token.isErr()) {
    return err(vantaTransportFailureLines({ error: token.error }));
  }
  const response = await transport.request({
    headers: { ...headers, authorization: `Bearer ${token.value}` },
    method,
    path,
    ...(body === undefined ? {} : { body }),
    ...(retryPolicy === undefined ? {} : { retryPolicy }),
  });
  if (response.isErr()) {
    return withTokenRedacted({ result: err(noteIfUnauthorized({ error: response.error })), token: token.value });
  }
  return ok(response.value);
}

/**
 * Read a write response's JSON body through its endpoint's strict boundary, refusing any field added, dropped,
 * renamed or retyped by name.
 *
 * @param surface the surface name, as a refusal should say it
 * @param body the raw response body
 * @param boundary the endpoint's strict read, declared once at load by the write client that owns it
 * @returns the parsed value, or every reason it could not be read
 */
export function parseVantaWriteBody<TValue>({
  surface,
  body,
  boundary: endpointBoundary,
}: {
  surface: string;
  body: string;
  boundary: Boundary<TValue>;
}): Result<TValue> {
  // Annotated, not destructured: the boundary-schema gate licenses `boundary.parseJson(` by this declaration.
  const boundary: Boundary<TValue> = endpointBoundary;
  return boundary
    .parseJson({ text: body })
    .mapErr((boundaryError) => vantaHttpErrorLines({ error: VantaHttpErrors.bodyRefused({ boundaryError, surface }) }));
}
