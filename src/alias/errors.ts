/**
 * The typed failures of provisioning an alias, as one domain union.
 *
 * Every variant is a refusal a person can act on without opening Cloudflare: which zone, which address,
 * which check. `CLOUDFLARE_FAILED` is the one that wraps the guarded SDK boundary's own
 * `CloudflareClientError` (`../atlas/cloudflare/errors.ts`) rather than restating it, so the HTTP-layer
 * detail survives into a row without this union growing a variant per status code.
 *
 * Pure. No I/O.
 */

import type { CloudflareClientError } from "../atlas/cloudflare/errors.js";

/** A zone name the configured account does not hold — the refusal that keeps this verb inside its grant. */
export interface ZoneNotInAccountError {
  readonly code: "ZONE_NOT_IN_ACCOUNT";
  readonly message: string;
  readonly zone: string;
  /** Every zone the account really holds, so the reader can see what they meant to type. */
  readonly held: readonly string[];
}

/** Two zones of the same name under one account, which no write may guess between. */
export interface ZoneAmbiguousError {
  readonly code: "ZONE_AMBIGUOUS";
  readonly message: string;
  readonly zone: string;
}

/** A label or zone that cannot make an address this verb could read back. */
export interface InvalidLabelError {
  readonly code: "INVALID_LABEL";
  readonly message: string;
  readonly label: string;
}

/** A destination mailbox Cloudflare has not verified, which it will not route to. */
export interface DestinationUnverifiedError {
  readonly code: "DESTINATION_UNVERIFIED";
  readonly message: string;
  readonly destination: string;
}

/** An address already routed, reported rather than duplicated. */
export interface RuleAlreadyExistsError {
  readonly code: "RULE_ALREADY_EXISTS";
  readonly message: string;
  readonly address: string;
  readonly destination: string;
}

/** Email routing switched off on the zone, which no rule can be created under. */
export interface RoutingDisabledError {
  readonly code: "ROUTING_DISABLED";
  readonly message: string;
  readonly zone: string;
}

/** Whatever the guarded Cloudflare boundary mapped, carried forward rather than flattened to a string. */
export interface CloudflareFailedError {
  readonly code: "CLOUDFLARE_FAILED";
  readonly message: string;
  readonly cause: CloudflareClientError;
}

/** Everything provisioning an alias can fail with. */
export type AliasError =
  | ZoneNotInAccountError
  | ZoneAmbiguousError
  | InvalidLabelError
  | DestinationUnverifiedError
  | RuleAlreadyExistsError
  | RoutingDisabledError
  | CloudflareFailedError;

/** The factories every caller builds these with, so a test constructs what the real code constructs. */
export const AliasErrors = {
  cloudflareFailed: ({ cause }: { cause: CloudflareClientError }): CloudflareFailedError => ({
    cause,
    code: "CLOUDFLARE_FAILED",
    message: `cloudflare ${cause.operation} failed: ${cause.message}`,
  }),
  destinationUnverified: ({ destination }: { destination: string }): DestinationUnverifiedError => ({
    code: "DESTINATION_UNVERIFIED",
    destination,
    message:
      `cloudflare has not verified ${destination}, and will not route to an unverified destination — ` +
      "it mails a code there once, and the address is usable the moment that code is followed",
  }),
  invalidLabel: ({ label, why }: { label: string; why: string }): InvalidLabelError => ({
    code: "INVALID_LABEL",
    label,
    message: `"${label}" cannot be part of an alias address: ${why}`,
  }),
  routingDisabled: ({ zone }: { zone: string }): RoutingDisabledError => ({
    code: "ROUTING_DISABLED",
    message: `email routing is not enabled on ${zone}, so no address on it can receive mail yet`,
    zone,
  }),
  ruleAlreadyExists: ({ address, destination }: { address: string; destination: string }): RuleAlreadyExistsError => ({
    address,
    code: "RULE_ALREADY_EXISTS",
    destination,
    message: `${address} already forwards to ${destination}, so there is nothing to provision`,
  }),
  zoneAmbiguous: ({ zone }: { zone: string }): ZoneAmbiguousError => ({
    code: "ZONE_AMBIGUOUS",
    message: `the account holds more than one zone called ${zone}, and a write may not guess between them`,
    zone,
  }),
  zoneNotInAccount: ({ zone, held }: { zone: string; held: readonly string[] }): ZoneNotInAccountError => ({
    code: "ZONE_NOT_IN_ACCOUNT",
    held,
    message: `${zone} is not a zone this Cloudflare account holds — it holds ${held.join(", ")}`,
    zone,
  }),
} as const;
