/**
 * The two requests `slopweaver claude reset` makes — the status read and the claim — and nothing else. Effectful, no
 * filesystem. The Anthropic SDK exposes neither OAuth account endpoint, so this is a plain `fetch`
 * (`docs/provider-sdks.md`), shaped by `./resetStatus.ts` and `./resetClaim.ts`.
 *
 * Neither function throws, and neither keeps what it catches: a thrown `fetch` can hold the whole request, bearer
 * included, so a failure comes back as a constant reason.
 */
import { RESET_STATUS_URL, resetHeaders } from "./resetStatus.js";

/** How long the status read may take. */
const STATUS_TIMEOUT_MS = 10_000;

/** How long the claim may take — Claude Code's own claim allows 25s. */
const CLAIM_TIMEOUT_MS = 25_000;

/** What came back from one request, or why nothing did. */
export type ResetResponse =
  | { readonly status: number; readonly bodyText: string; readonly retryAfterSeconds?: number }
  | { readonly reason: string };

/** One request, ready to send. */
export interface ResetRequest {
  readonly init: RequestInit;
  readonly url: string;
}

/** The transport a request goes out on — `fetch` in the shipped verb, a plain fake in a test. */
export type ResetSend = typeof fetch;

/** The seconds a `retry-after` header names, when it names a whole number. */
function retryAfterOf({ response }: { response: Response }): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null || !/^\d+$/.test(raw)) {
    return undefined;
  }
  return Number(raw);
}

/**
 * Send one request and read it into a {@link ResetResponse}, keeping nothing a throw carried.
 *
 * @param request the url and init to send
 * @param send the transport
 * @returns the status, body and any whole-second `retry-after`, or a constant reason when nothing came back
 */
export async function exchange({ request, send }: { request: ResetRequest; send: ResetSend }): Promise<ResetResponse> {
  try {
    const response = await send(request.url, request.init);
    const bodyText = await response.text();
    const retryAfterSeconds = retryAfterOf({ response });
    return { bodyText, status: response.status, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
  } catch {
    return { reason: "the request failed before an answer came back" };
  }
}

/**
 * The status read for one login.
 *
 * @param accessToken the bound login's access token, never stored or logged
 * @returns the GET to send
 */
export function resetStatusRequest({ accessToken }: { accessToken: string }): ResetRequest {
  return {
    init: { headers: resetHeaders({ accessToken }), method: "GET", signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
    url: RESET_STATUS_URL,
  };
}

/**
 * One claim, ready to send.
 *
 * @param accessToken the bound login's access token, never stored or logged
 * @param body the claim body `resetClaimBody` built
 * @param url the claim URL `resetClaimUrl` built
 * @returns the POST to send
 */
export function resetClaimRequest({
  accessToken,
  body,
  url,
}: {
  accessToken: string;
  body: string;
  url: string;
}): ResetRequest {
  return {
    init: {
      body,
      headers: resetHeaders({ accessToken }),
      method: "POST",
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    },
    url,
  };
}

/**
 * Read one login's reset status.
 *
 * @param accessToken the bound login's access token, never stored or logged
 * @returns the answer, or why none came back
 */
export async function requestResetStatus({ accessToken }: { accessToken: string }): Promise<ResetResponse> {
  return exchange({ request: resetStatusRequest({ accessToken }), send: fetch });
}

/**
 * Send one claim.
 *
 * @param accessToken the bound login's access token, never stored or logged
 * @param body the claim body `resetClaimBody` built
 * @param url the claim URL `resetClaimUrl` built
 * @returns the answer, or why none came back
 */
export async function requestResetClaim({
  accessToken,
  body,
  url,
}: {
  accessToken: string;
  body: string;
  url: string;
}): Promise<ResetResponse> {
  return exchange({ request: resetClaimRequest({ accessToken, body, url }), send: fetch });
}
