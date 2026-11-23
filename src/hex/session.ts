/**
 * One place a verb gets a live Hex client from — resolve the configuration, build the client on the real
 * `fetch` and a real timer, and hand it over.
 *
 * Its own module rather than a line in each verb so the eight runners share one credential path and one
 * transport policy: a second construction site is how a retry rule or a header quietly diverges. The seams
 * stay injectable underneath (`createHexClient` takes both), which is what keeps every branch of the client
 * testable without a network while this module is the only thing that ever supplies the real ones. Both
 * are optional here too, defaulting to the real ones, so a test can prove the configuration reaches the
 * client it opens without a network.
 */
import { err, ok, type Result } from "../lib/result.js";
import { createHexClient, type HexClient, type HexFetchLike, type HexSleepLike } from "./client.js";
import { resolveHexConfig } from "./config.js";
import type { HexReadError } from "./errors.js";

/** The default HTTP seam: the global `fetch`, with its headers flattened into a plain record. */
const globalFetch: HexFetchLike = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { headers, status: response.status, text: () => response.text() };
};

/** The default wait seam: a real timer, used only by the client's single 429 retry. */
const realSleep: HexSleepLike = ({ seconds }) =>
  new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });

/**
 * Open a Hex client for this install.
 *
 * @param env the environment to resolve `HEX_API_TOKEN` from; defaults to `process.env`
 * @param home the state home whose `secrets/hex-api-token` is the fallback; omitted takes `$SLOPWEAVER_HOME`
 * @param fetch the HTTP seam the client is built on; omitted takes the global `fetch`
 * @param sleep the wait seam the client's 429 retry uses; omitted takes a real timer
 * @returns the client, or the typed reason there is none — `TOKEN_MISSING` is the install's, not Hex's
 */
export function openHexClient({
  env = process.env,
  home,
  fetch = globalFetch,
  sleep = realSleep,
}: {
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  fetch?: HexFetchLike;
  sleep?: HexSleepLike;
} = {}): Result<HexClient, HexReadError> {
  const config = resolveHexConfig({ env, ...(home === undefined ? {} : { home }) });
  if (config.isErr()) {
    return err(config.error);
  }
  return ok(createHexClient({ config: config.value, fetch, sleep }));
}
