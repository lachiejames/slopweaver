/**
 * The typed read over the raw transport: every fixed Datadog route the SDK does not cover reads here, and every
 * read names the strict `defineBoundary` its endpoint declares.
 *
 * ## Every response crosses a boundary, and a malformed one is a failure
 *
 * The caller supplies a {@link Boundary}, never a bare Zod schema. A loose schema reads a renamed field as an
 * absent one and answers zero at exit 0, which is the confident wrong answer this whole package is arranged
 * against; a boundary refuses it by naming the key (the owner's rule, in `src/lib/boundary.ts`).
 * Nothing here returns a default on a parse miss, and nothing here parses JSON other than
 * `boundary.parseJson`.
 *
 * ## What lives where
 *
 * HTTP — the host, the credentials, read-only enforcement, the rate-limit retry — is `rawTransport.ts`, which
 * answers text and never interprets it. This file is only the read: text in, a boundary's verdict out, with the
 * HTTP status and the rate-limit budget carried through either way. So production and every test fake reach a
 * requester through {@link rawRequesterFrom}, and cannot disagree about what the real requester accepts.
 */
import type { Boundary } from "#lib/boundary.js";
import type { Logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import type { DatadogConfig } from "./config.js";
import { datadogBoundaryRefusal, datadogQueryErrorLines } from "./queryErrors.js";
import type { RateLimitSnapshot } from "./rateLimit.js";
import {
  createRawTransport,
  type FetchLike,
  type RawFailure,
  type RawMethod,
  type RawTransport,
  type SleepLike,
} from "./rawTransport.js";

/** A response, read through its endpoint's boundary, with the budget it was measured against. */
interface RawResponse<T> {
  readonly body: T;
  readonly status: number;
  /** The rate-limit budget from this response, or `null` on an unmetered endpoint. */
  readonly rateLimit: RateLimitSnapshot | null;
}

/** One typed request: the route, and the boundary its answer must cross. */
interface RawRequest<T> {
  readonly method: RawMethod;
  readonly path: string;
  /** The endpoint's strict boundary — the only way this file reads a body. */
  readonly boundary: Boundary<T>;
  /** The JSON request body, or omitted for none. */
  readonly body?: unknown;
}

/** A typed raw path bound to one transport. */
export interface RawRequester {
  /**
   * Issue one request and read its body through the endpoint's boundary.
   *
   * @param method `GET`, or `POST` against an allowlisted read route
   * @param path the API path, with any query string
   * @param boundary the endpoint's strict boundary
   * @param body the JSON request body, or omitted for none
   * @returns the parsed body, or every reason the call cannot be believed
   */
  request: <T>(input: RawRequest<T>) => Promise<Result<RawResponse<T>>>;
  /**
   * The same call, keeping the HTTP status on the failure arm — a 2xx whose body the boundary refused keeps
   * its 2xx, so a caller can tell a malformed 200 from a 500.
   *
   * @param method `GET`, or `POST` against an allowlisted read route
   * @param path the API path, with any query string
   * @param boundary the endpoint's strict boundary
   * @param body the JSON request body, or omitted for none
   * @returns the parsed body, or the failure with its status attached
   */
  requestWithStatus: <T>(input: RawRequest<T>) => Promise<Result<RawResponse<T>, RawFailure>>;
  /** The budget from the most recent metered response, or `null` if nothing metered has been called. */
  lastRateLimit: () => RateLimitSnapshot | null;
}

/**
 * Bind the typed read to a transport. Every `RawRequester`, real or fake, is built here.
 *
 * @param transport the raw-text transport the requests travel over
 * @returns the requester
 */
export function rawRequesterFrom({ transport }: { transport: RawTransport }): RawRequester {
  const requestWithStatus = async <T>(input: RawRequest<T>): Promise<Result<RawResponse<T>, RawFailure>> => {
    const { body, method, path } = input;
    // Annotated, not destructured: the boundary-schema gate licenses `boundary.parseJson(` by this declaration.
    const boundary: Boundary<T> = input.boundary;
    const answered = await transport.requestRawTextWithStatus({ body, method, path });
    if (answered.isErr()) {
      return err(answered.error);
    }
    const { bodyText, rateLimit, status } = answered.value;
    const read = boundary.parseJson({ text: bodyText });
    if (read.isErr()) {
      return err({
        rateLimit,
        reasons: datadogQueryErrorLines({ error: datadogBoundaryRefusal({ refusal: read.error }) }),
        status,
      });
    }
    return ok({ body: read.value, rateLimit, status });
  };
  const request = async <T>(input: RawRequest<T>): Promise<Result<RawResponse<T>>> =>
    (await requestWithStatus(input)).mapErr((failure) => failure.reasons);
  return { lastRateLimit: transport.lastRateLimit, request, requestWithStatus };
}

/**
 * Build the typed raw path over a real transport, taking exactly what `createRawTransport` takes and passing it
 * through whole: the config the host and both keys come from, the logger a rate-limit wait is announced on, and
 * the optional fetch and sleep seams.
 *
 * @returns a requester bound to that config
 */
export function createRawRequester(input: {
  config: DatadogConfig;
  logger: Logger;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
}): RawRequester {
  return rawRequesterFrom({ transport: createRawTransport(input) });
}
