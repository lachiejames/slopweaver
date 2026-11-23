/**
 * OAuth client-credentials token acquisition for the Vanta Manage API.
 *
 * `POST https://api.vanta.com/oauth/token` with a JSON (not form-encoded) body of
 * `{client_id, client_secret, grant_type: "client_credentials", scope: VANTA_OAUTH_SCOPE}` returns
 * `{access_token, expires_in, token_type}`.
 *
 * ## The refresh rule, and why a 401 does not trigger one
 *
 * Vanta allows exactly ONE active access token per application at a time — minting a second one
 * immediately revokes the first. So this provider caches `{accessToken, expiresAtMs}` in memory and
 * refreshes ONLY on time-based expiry (with a skew margin so a token is never used seconds before it
 * expires). An unexpected 401 on a token this provider believes is still fresh is deliberately NOT handled
 * by re-minting — that risks a revocation ping-pong with any other concurrent process using the same Vanta
 * application. `noteIfUnauthorized` is the caller-facing half of that decision: it appends an explanation to
 * a resource call's own 401, read from the typed status rather than from the sentence.
 *
 * ## The lock is not enough on its own, and a SHARED cache is what closes the rest
 *
 * The in-memory cache only protects concurrent callers WITHIN one process. Two `slopweaver` invocations
 * each held their own, so each minted, and the second silently revoked the first's token mid-run. The mint
 * lock (`src/admit/operationLock.ts`, keyed by a digest of the client id) serialises the two mints and
 * cannot help: the damage is done by the second mint existing at all.
 *
 * So a minted token is also written to a shared file (`./tokenCache.ts`) and read back INSIDE that same
 * lock, and a process that finds a live one never mints. MEASURED: two consecutive whole-estate
 * syncs on one credential each reported incomplete surfaces on HTTP 401, with different
 * surfaces each time — the signature of contention rather than of a missing scope, which would be stable.
 * That file's header carries the reproduction.
 *
 * ## The mint answer is read through a strict boundary, and its refusal quotes no provider key
 *
 * {@link VANTA_OAUTH_TOKEN_BOUNDARY} refuses an added, dropped or retyped field by name (owner ruling: stay
 * strict, update when upstream changes). Its refusal publishes each drift's closed kind and, as a path, only a key
 * this package declared — never one the provider wrote, because this response answers a request carrying the
 * client id and secret.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { acquireOperationLock } from "../../admit/operationLock.js";
import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { VantaCredentialErrors, vantaCredentialErrorLines } from "./credentialErrors.js";
import type { VantaCredentials } from "./credentials.js";
import {
  isVantaHttpError,
  type VantaHttpError,
  VantaHttpErrors,
  type VantaTransportFailure,
  vantaTransportFailureLines,
} from "./httpErrors.js";
import { readSharedVantaToken, vantaTokenCachePath, writeSharedVantaToken } from "./tokenCache.js";
import type { VantaTransport } from "./transport.js";

/** The token endpoint. Not under `/v1` — the resource endpoints are, this is not. */
const VANTA_OAUTH_TOKEN_PATH = "/oauth/token";

/**
 * Every scope this atlas ever requests, space-separated per Vanta's documented request-body shape.
 * `vanta-api.all:write` and `vanta-api.documents:upload` cover `writeClient.ts`'s write calls;
 * `vanta-api.all:read` covers the read-only sync.
 */
const VANTA_OAUTH_SCOPE = "vanta-api.all:read vanta-api.all:write vanta-api.documents:upload";

const vantaTokenResponseSchema = z
  .object({ access_token: z.string().min(1), expires_in: z.number().int().positive(), token_type: z.string().min(1) })
  .strict();

/** How long before real expiry a cached token is treated as already expired. */
const REFRESH_SKEW_MS = 60_000;

/** A cached token and when it stops being usable. */
interface CachedVantaToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/** A token provider: mints once, caches, and reuses until close to expiry. */
export interface VantaTokenProvider {
  /**
   * Get a currently-valid token, minting one if none is cached or the cached one is within the refresh skew
   * of expiring. A mint the token endpoint refused stays TYPED, so a sync grades a refused mint by its
   * status exactly as it grades a refused resource call.
   */
  getToken: () => Promise<Result<string, VantaTransportFailure>>;
}

/** The explanation appended to a resource call's own 401, naming the one-active-token-per-app constraint. */
export const VANTA_ONE_TOKEN_PER_APP_NOTE =
  "Vanta allows exactly one active access token per Manage application — minting a fresh one now would revoke whatever token is currently valid rather than fixing this refusal. If another process is using this same application concurrently, that is very likely the cause; otherwise the token or its scope needs to be re-issued by a human.";

/**
 * A resource call's failure with the one-active-token-per-app note appended when — and only when — it IS an
 * HTTP 401, still typed: decided on `code` and `status`, never on what a line says, so a reworded sentence
 * cannot lose the note and a 500 whose text mentions a 401 cannot gain it. Every other failure is returned
 * untouched. The token endpoint's own 401 never passes through here: the note is about a token already
 * minted, and a refused mint is a credential problem.
 *
 * @param error why a resource call failed
 * @returns the same failure, its lines carrying the note when it is a 401
 */
export function withUnauthorizedNote({ error }: { error: VantaTransportFailure }): VantaTransportFailure {
  if (!isVantaHttpError(error) || error.code !== "HTTP_STATUS" || error.status !== 401) {
    return error;
  }
  const reasons = [...error.reasons, VANTA_ONE_TOKEN_PER_APP_NOTE];
  return { ...error, message: reasons.join("; "), reasons };
}

/**
 * The lines a resource call's failure prints, through {@link withUnauthorizedNote}.
 *
 * @param error why a resource call failed
 * @returns the failure's lines, with the note appended to a 401
 */
export function noteIfUnauthorized({ error }: { error: VantaTransportFailure }): readonly string[] {
  return vantaTransportFailureLines({ error: withUnauthorizedNote({ error }) });
}

/**
 * The operation-lock key one application's mint is serialised under. Exported so a test can HOLD it and
 * prove, with no network at all, that a verb got as far as trying to mint — the one observable step between
 * "credentials resolved" and the first request to Vanta.
 *
 * @param clientId the application whose mint the lock guards
 * @returns the key `acquireOperationLock` hashes into a lock file name
 */
export function vantaMintLockKey({ clientId }: { clientId: string }): string {
  return `vanta-oauth-token:${clientId}`;
}

/** Build the mint request body. Vanta wants JSON, not form-encoding. */
function mintRequestBody({ credentials }: { credentials: VantaCredentials }): string {
  return JSON.stringify({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "client_credentials",
    scope: VANTA_OAUTH_SCOPE,
  });
}

/**
 * The token endpoint's strict read.
 *
 * @internal — exported so a test can lock the endpoint it names.
 */
export const VANTA_OAUTH_TOKEN_BOUNDARY = defineBoundary({
  endpoint: `POST ${VANTA_OAUTH_TOKEN_PATH}`,
  schema: vantaTokenResponseSchema,
});

/** The keys this package declares on the token response — the only path text a refusal may print. */
const DECLARED_TOKEN_KEYS: ReadonlySet<string> = new Set(Object.keys(vantaTokenResponseSchema.shape));

/** Parse the mint response, refusing anything that does not match Vanta's documented shape. */
function parseMintResponse({
  body,
}: {
  body: string;
}): Result<{ accessToken: string; expiresInSeconds: number }, VantaHttpError> {
  const parsed = VANTA_OAUTH_TOKEN_BOUNDARY.parseJson({ text: body });
  if (parsed.isErr()) {
    if (parsed.error.code === "BOUNDARY_NOT_JSON") {
      return err(VantaHttpErrors.bodyNotJson({ surface: "the token endpoint" }));
    }
    // Each drift publishes as its closed KIND, and as its path only when that path is a key this package declared:
    // the boundary's own message quotes a key the provider wrote, and this response answers a request carrying the
    // client id and secret.
    const issues = parsed.error.drift.map((drift) => ({
      message: drift.kind,
      path: DECLARED_TOKEN_KEYS.has(drift.path) ? [drift.path] : [],
    }));
    return err(VantaHttpErrors.bodyUnreadable({ issues, surface: "the token endpoint" }));
  }
  return ok({ accessToken: parsed.value.access_token, expiresInSeconds: parsed.value.expires_in });
}

/**
 * The filename one credential's shared token is cached under — a digest, never the client id itself, so a
 * directory listing of the state home names no application.
 *
 * @param clientId the application whose token this is
 * @returns the digest the cache file is named for
 *
 * @internal — exported so a test can name the same file this module writes.
 */
export function vantaTokenCacheKey({ clientId }: { clientId: string }): string {
  return createHash("sha256").update(clientId).digest("hex").slice(0, 32);
}

/**
 * Get a usable token, minting one only when no process already holds a live one.
 *
 * The shared read happens INSIDE the mint lock, which is the whole point: without it, two processes both
 * miss the cache, both take the lock in turn, and both mint — the second revoking the first. Holding the
 * lock across the read means the second one finds what the first just wrote.
 *
 * @param credentials the client id/secret to mint with
 * @param transport the bound Vanta transport
 * @param logger where a failed lock release is reported — never swallowed, but also never allowed to
 *   overturn a mint that otherwise succeeded
 * @param home the state home the lock and the shared cache live under
 * @param now the current time in epoch milliseconds, injected so this stays testable
 * @returns the cached-token shape, or every reason minting failed
 */
async function mintVantaToken({
  credentials,
  transport,
  logger,
  home,
  now,
}: {
  credentials: VantaCredentials;
  transport: VantaTransport;
  logger: Logger;
  home: string;
  now: () => number;
}): Promise<Result<CachedVantaToken, VantaTransportFailure>> {
  const acquired = acquireOperationLock({
    home,
    key: vantaMintLockKey({ clientId: credentials.clientId }),
    nowIso: new Date(now()).toISOString(),
  });
  if (!acquired.isOk()) {
    return err(vantaCredentialErrorLines({ error: VantaCredentialErrors.mintLockHeld({ holder: acquired.error }) }));
  }
  try {
    return await sharedOrMinted({ credentials, home, now, transport });
  } finally {
    try {
      acquired.value.release();
    } catch (error: unknown) {
      // Reported, never swallowed — but the mint's own outcome (returned above) still stands: a lock we
      // could not release is a problem for the NEXT mint, not evidence this one failed.
      logger.error({
        msg: `could not release the Vanta token mint lock: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

/**
 * The token, taken from the shared cache when one is live and minted otherwise.
 *
 * Split out of {@link mintVantaToken} so the lock's acquire/release stays one readable shell around one
 * named decision — and the ORDER is the whole point: this runs while the lock is held, so a second process
 * arriving behind the first finds what the first just wrote instead of minting a token that revokes it.
 *
 * @param credentials the client id/secret to mint with
 * @param transport the bound Vanta transport
 * @param home the state home the shared cache lives under
 * @param now the current time in epoch milliseconds
 * @returns the token, or every reason minting failed
 */
async function sharedOrMinted({
  credentials,
  transport,
  home,
  now,
}: {
  credentials: VantaCredentials;
  transport: VantaTransport;
  home: string;
  now: () => number;
}): Promise<Result<CachedVantaToken, VantaTransportFailure>> {
  const cachePath = vantaTokenCachePath({ home, key: vantaTokenCacheKey({ clientId: credentials.clientId }) });
  const shared = readSharedVantaToken({ nowMs: now(), path: cachePath, skewMs: REFRESH_SKEW_MS });
  if (shared !== null) {
    return ok(shared);
  }
  const response = await transport.request({
    body: mintRequestBody({ credentials }),
    headers: { "content-type": "application/json" },
    method: "POST",
    path: VANTA_OAUTH_TOKEN_PATH,
    sensitiveValues: [credentials.clientId, credentials.clientSecret],
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const parsed = parseMintResponse({ body: response.value.body });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const token = { accessToken: parsed.value.accessToken, expiresAtMs: now() + parsed.value.expiresInSeconds * 1000 };
  writeSharedVantaToken({ path: cachePath, token });
  return ok(token);
}

/**
 * Build a token provider bound to one set of credentials and one transport.
 *
 * @param credentials the client id/secret to mint with
 * @param transport the bound Vanta transport, used only for the token endpoint
 * @param logger where a failed lock release is reported
 * @param home the state home the mint lock lives under
 * @param now the current time in epoch milliseconds; defaults to the real clock
 * @returns the provider
 */
export function createVantaTokenProvider({
  credentials,
  transport,
  logger,
  home,
  now = () => Date.now(),
}: {
  credentials: VantaCredentials;
  transport: VantaTransport;
  logger: Logger;
  home: string;
  now?: () => number;
}): VantaTokenProvider {
  let cached: CachedVantaToken | null = null;

  return {
    getToken: async (): Promise<Result<string, VantaTransportFailure>> => {
      if (cached !== null && cached.expiresAtMs - REFRESH_SKEW_MS > now()) {
        return ok(cached.accessToken);
      }
      const minted = await mintVantaToken({ credentials, home, logger, now, transport });
      if (minted.isErr()) {
        return err(minted.error);
      }
      cached = minted.value;
      return ok(minted.value.accessToken);
    },
  };
}
