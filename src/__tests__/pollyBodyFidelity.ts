/**
 * The Polly-facing half of request-body fidelity: the two calls `setup-polly.ts` makes into
 * `cassetteRequestBody.ts`, one at persist time and one at replay time, each resolving the provider allowlist
 * from the request's URL the same way. The design — why a projection, why a comparison in `beforeReplay` and
 * not a body matcher, what a projection can and cannot prove — lives in `cassetteRequestBody.ts`'s header.
 */
import { type Request as PollyRequest } from "@pollyjs/core";

import { CASSETTE_CONFIGS, providerForUrl } from "./cassetteRedactConfig.js";
import { type CassetteRedactConfig } from "./cassetteRedactTypes.js";
import { compareRequestBody, projectRequestBody } from "./cassetteRequestBody.js";

/** The provider allowlist a URL falls under, or `undefined` for a host no provider config covers. */
function configForUrl({ url }: { url: string | undefined }): CassetteRedactConfig | undefined {
  const provider = url === undefined ? undefined : providerForUrl({ url });
  return provider === undefined ? undefined : CASSETTE_CONFIGS[provider];
}

/** One request header as a single string — Polly types a header as possibly repeated, and content-type is not. */
function singleHeader({ req, name }: { req: PollyRequest; name: string }): string | undefined {
  const value = req.getHeader(name);
  if (typeof value === "string") {
    return value;
  }
  return Array.isArray(value) ? value[0] : undefined;
}

/**
 * The text a recording persists for one request body: its allowlist projection, never the body itself.
 *
 * @param text the raw body Polly captured, already known to be non-empty
 * @param mimeType the HAR entry's own declared content type, which picks the JSON, form or text projection
 * @param knownValues the operator's known-value list, scrubbed from whatever the projection keeps
 * @returns the projection to write into the HAR's `postData.text`
 */
export function persistedRequestBody({
  text,
  mimeType,
  url,
  knownValues,
}: {
  text: string;
  mimeType: string | undefined;
  url: string | undefined;
  knownValues: readonly string[];
}): string {
  return projectRequestBody({ body: text, config: configForUrl({ url }), contentType: mimeType, knownValues, url });
}

/**
 * Hold one LIVE request to the body the entry Polly is about to serve recorded: re-project the live body
 * through the same pure function that persisted the recorded one, and compare.
 *
 * @param req the live request, which names the failure because it is the one always present
 * @param postData the served entry's whole `postData` member — ABSENT is a recorded fact, not a gap
 * @param knownValues the operator's known-value list, applied exactly as it was at persist time
 * @returns the failure naming both projections and what to do next, or `undefined` when the live body matches
 */
export function liveBodyMismatch({
  req,
  postData,
  knownValues,
}: {
  req: PollyRequest;
  postData: { mimeType?: string; text?: string } | undefined;
  knownValues: readonly string[];
}): string | undefined {
  const config = configForUrl({ url: req.url });
  const live = projectRequestBody({
    body: typeof req.body === "string" ? req.body : undefined,
    config,
    contentType: singleHeader({ name: "content-type", req }),
    knownValues,
    url: req.url,
  });
  const verdict = compareRequestBody({ config, live, method: req.method, postData, url: req.url });
  if (verdict.kind !== "mismatch") {
    return undefined;
  }
  return `${verdict.message}\nEither the transport changed what it sends, or the cassette is stale — re-record it and read the diff.`;
}
