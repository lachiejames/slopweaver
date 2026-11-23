/**
 * Mint and re-mint the Falcon bearer, and make the token's short life a non-event.
 *
 * ## Why a provider rather than a token
 *
 * Falcon's bearer lives 1799 seconds — measured, not assumed. A full sync reads every fleet host with four
 * enrichment fan-outs, the open vulnerabilities and a console walk, so a run that
 * minted once at the start and held the string would expire mid-family and fail a read that was working a
 * minute earlier. Every call asks this provider for a token instead, and the provider decides whether the
 * one it holds is still worth using.
 *
 * The skew matters as much as the lifetime: a token that expires in four seconds is not usable for a
 * request that takes five, so {@link REFRESH_SKEW_MS} retires it early rather than discovering that at the
 * provider. The value is deliberately generous relative to a single call.
 *
 * ## The token never lands on disk
 *
 * It exists in this object and in an `Authorization` header. It is never written to a generation, never
 * logged, and never returned through an error message — a mint failure names the host and the status, never
 * the response body, because that body is where a provider is most likely to echo a credential back.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { CrowdstrikeCredentials } from "./credentialFiles.js";
import { type CrowdstrikeError, CrowdstrikeErrors } from "./errors.js";

/**
 * How long before true expiry a token is treated as spent.
 *
 * Sixty seconds against a measured 1799-second lifetime: long enough that no single request can outlive the
 * token it was issued, short enough that a sync does not re-mint needlessly.
 */
export const REFRESH_SKEW_MS = 60_000;

/** What a mint returned, as this atlas models it. */
export interface MintedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/** The seam that performs the token request, so tests need no network. */
export type TokenMinter = (args: {
  credentials: CrowdstrikeCredentials;
}) => Promise<Result<MintedToken, CrowdstrikeError>>;

/** Hands out a live bearer, minting or re-minting as needed. */
export interface TokenProvider {
  /**
   * A bearer valid now.
   *
   * @param nowMs the current instant, injected so expiry is testable without a clock
   * @returns a usable bearer, or why one could not be obtained
   */
  token({ nowMs }: { nowMs: number }): Promise<Result<string, CrowdstrikeError>>;
  /** Force the next {@link token} call to re-mint — used once after a 401 before giving up. */
  invalidate(): void;
  /** How many mints this provider has performed, so a sync can report re-mints rather than hide them. */
  mintCount(): number;
}

/**
 * Whether a held token is still usable at this instant.
 *
 * @param token the token being judged, or `null` when none is held
 * @param nowMs the current instant
 * @returns whether it may be used without re-minting
 */
export function isTokenUsable({ token, nowMs }: { token: MintedToken | null; nowMs: number }): boolean {
  return token !== null && token.expiresAtMs - REFRESH_SKEW_MS > nowMs;
}

/**
 * Build a token provider over an injected minter.
 *
 * @param credentials the resolved triple
 * @param mint the seam that performs the token request
 * @returns a provider that mints lazily and re-mints before expiry
 */
export function createTokenProvider({
  credentials,
  mint,
}: {
  credentials: CrowdstrikeCredentials;
  mint: TokenMinter;
}): TokenProvider {
  let held: MintedToken | null = null;
  let mints = 0;
  let inFlight: Promise<Result<MintedToken, CrowdstrikeError>> | null = null;
  // One mint at a time: a fan-out that all expires together must not mint once per concurrent call, so a
  // caller arriving while a mint is in flight joins it rather than starting its own.
  const pendingMint = (): Promise<Result<MintedToken, CrowdstrikeError>> => {
    if (inFlight !== null) {
      return inFlight;
    }
    const started = mint({ credentials });
    inFlight = started;
    return started;
  };

  return {
    invalidate: (): void => {
      held = null;
    },
    mintCount: (): number => mints,
    token: async ({ nowMs }): Promise<Result<string, CrowdstrikeError>> => {
      if (isTokenUsable({ nowMs, token: held })) {
        return ok(held!.accessToken);
      }
      const minted = await pendingMint();
      inFlight = null;
      if (minted.isErr()) {
        return err(minted.error);
      }
      mints += 1;
      held = minted.value;
      return ok(minted.value.accessToken);
    },
  };
}

/**
 * The production minter: one form POST to `/oauth2/token`.
 *
 * @param credentials the resolved triple
 * @returns the minted token, or a typed auth failure that never quotes the response body
 */
export const fetchCrowdstrikeToken: TokenMinter = async ({ credentials }) => {
  const requestedAtMs = Date.now();
  let response: Response;
  try {
    response = await fetch(`${credentials.apiHost}/oauth2/token`, {
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "client_credentials",
      }),
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
  } catch (error: unknown) {
    return err(
      CrowdstrikeErrors.authFailed({
        reason: `could not reach ${credentials.apiHost}: ${errorMessage({ error })}`,
        remintAttempted: false,
      }),
    );
  }
  if (!response.ok) {
    return err(
      CrowdstrikeErrors.authFailed({
        reason: `${credentials.apiHost} answered HTTP ${response.status}`,
        remintAttempted: false,
      }),
    );
  }
  return readMintedToken({ requestedAtMs, text: await response.text() });
};

/**
 * The `/oauth2/token` answer. Every key Falcon sends is declared, so an added, dropped or renamed one refuses by
 * name instead of reading as absence. The bounds are what the token is used for: an empty bearer or a lifetime
 * that is not positive leaves nothing a sync can hold.
 */
const TOKEN_ANSWER = defineBoundary({
  endpoint: "POST /oauth2/token",
  schema: z.strictObject({
    access_token: z.string().min(1),
    expires_in: z.number().positive(),
    token_type: z.unknown().optional(),
  }),
});

/**
 * Read a mint response through its strict boundary.
 *
 * A refusal carries the boundary's own message, which names a drifted KEY and never a value — the body is where a
 * provider is most likely to echo a credential back.
 *
 * @param text the response body as sent
 * @param requestedAtMs when the request was sent, so expiry is measured from then rather than from now
 * @returns the minted token, or why the response was unusable
 */
export function readMintedToken({
  text,
  requestedAtMs,
}: {
  text: string;
  requestedAtMs: number;
}): Result<MintedToken, CrowdstrikeError> {
  const parsed = TOKEN_ANSWER.parseJson({ text });
  if (parsed.isErr()) {
    return err(CrowdstrikeErrors.authFailed({ reason: parsed.error.message, remintAttempted: false }));
  }
  return ok({ accessToken: parsed.value.access_token, expiresAtMs: requestedAtMs + parsed.value.expires_in * 1000 });
}
