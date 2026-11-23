/**
 * The one request `slopweaver claude spend` makes: the usage answer, unskipped, over a bound login. Effectful, no
 * filesystem — the send and its never-throw answer are shared with `./resetExchange.ts`, and so are the headers,
 * since both are the same first-party OAuth account call. Parsed by `./spendStatus.ts`.
 */
import { exchange, type ResetRequest, type ResetResponse } from "./resetExchange.js";
import { resetHeaders } from "./resetStatus.js";
import { SPEND_STATUS_URL } from "./spendStatus.js";

/** How long the spend read may take — the same as the reset status read. */
const SPEND_TIMEOUT_MS = 10_000;

/**
 * The spend read for one login.
 *
 * @param accessToken the bound login's access token, never stored or logged
 * @returns the GET to send
 */
export function spendStatusRequest({ accessToken }: { accessToken: string }): ResetRequest {
  return {
    init: { headers: resetHeaders({ accessToken }), method: "GET", signal: AbortSignal.timeout(SPEND_TIMEOUT_MS) },
    url: SPEND_STATUS_URL,
  };
}

/**
 * Read one login's monthly spend.
 *
 * @param accessToken the bound login's access token, never stored or logged
 * @returns the answer, or why none came back
 */
export async function requestSpendStatus({ accessToken }: { accessToken: string }): Promise<ResetResponse> {
  return exchange({ request: spendStatusRequest({ accessToken }), send: fetch });
}
