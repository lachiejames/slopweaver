/**
 * The address a provisioned alias takes, and the one shape each of its parts may have.
 *
 * ## Why the owner's identity comes first
 *
 * An address carries its holder's name as a prefix, because without one the team cannot tell who owns which
 * email. A bare `claude-one@` names a seat and nobody, so the only way to answer "whose plan is this, and may we cancel
 * it" is to sign into the provider and look. With the identity leading, every address one person holds
 * sorts together, an offboarding is one read of the zone's routing rules, and the billing line names a
 * person rather than a sequence number.
 *
 * ## Why the provider is in the middle
 *
 * The plans live on acme-owned identities so no Claude data sits on a personal account, and the same holds for
 * Codex. Claude and Codex plans are bought, renewed and cancelled separately, so the address says which
 * assistant it belongs to. A per-provider domain would multiply the zones the owner has to hold; a label alone could not say it at all.
 *
 * Pure. No I/O, no clock, no network.
 */

import { err, ok, type Result } from "../lib/result.js";
import { type AliasError, AliasErrors } from "./errors.js";

/**
 * The assistants an alias can be provisioned for — a CLOSED set, because each one is a subscription the owner
 * actually holds and an address nobody can reach is worse than a refusal.
 */
export type AliasProvider = "claude" | "codex";

/** Every provider, in the order a usage line lists them. */
export const ALIAS_PROVIDERS: readonly AliasProvider[] = ["claude", "codex"];

/**
 * A label: lower-case, digits and inner hyphens, 1–32 characters, never opening or closing on a hyphen.
 *
 * Deliberately narrower than what a mail server would accept. The local part this builds is read back by
 * {@link parseAliasAddress}, and a label carrying its own `@`, a dot or an upper-case letter makes that
 * round trip lossy — which is how an alias would be provisioned that no later read can attribute.
 */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** A zone name, as Cloudflare spells one: labels joined by dots, no scheme, no trailing dot. */
const ZONE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** One provisioned address, kept as its parts so a caller never re-splits the string it was handed. */
export interface AliasAddress {
  /** Whose plan it is, `ada-owner` in `ada-owner-claude-one@`. */
  readonly identity: string;
  readonly provider: AliasProvider;
  readonly label: string;
  readonly zone: string;
  /**
   * `<identity>-<provider>-<label>@<zone>`, which is what Cloudflare stores and what the owner types into a
   * signup form.
   */
  readonly address: string;
}

/**
 * Whether a string is one of the providers this verb knows.
 *
 * @param value the candidate, straight off the command line
 * @returns whether it names a provider
 */
export function isAliasProvider(value: string): value is AliasProvider {
  return ALIAS_PROVIDERS.some((provider) => provider === value);
}

/**
 * The provider a local part names, and where in its hyphen-split segments it sits.
 *
 * Exactly one segment may be a provider. The identity is everything before it and the label everything
 * after, so a SECOND provider segment would make that split ambiguous and is refused at build time by
 * {@link aliasAddress} rather than guessed at here.
 */
function providerSegment({
  segments,
}: {
  segments: readonly string[];
}): { provider: AliasProvider; at: number } | null {
  const found: { provider: AliasProvider; at: number }[] = [];
  segments.forEach((segment, at) => {
    const known = ALIAS_PROVIDERS.find((provider) => provider === segment);
    if (known !== undefined) {
      found.push({ at, provider: known });
    }
  });
  if (found.length !== 1) {
    return null;
  }
  return found[0]!;
}

/**
 * Build the address for one seat.
 *
 * An identity or a label carrying a provider as one of its own hyphen-delimited segments is refused rather
 * than accepted quietly. `--identity claude-smith --provider claude --label one` would otherwise mint
 * `claude-smith-claude-one@`, whose two `claude` segments leave {@link parseAliasAddress} no way to say
 * where the identity stops — an address no later read can attribute, which is the one thing this module
 * exists to prevent.
 *
 * @param identity whose plan it is, and what the address opens with
 * @param provider which assistant the seat is for
 * @param label the seat's own name, `one` in `ada-owner-claude-one@`
 * @param zone the domain the address lives on
 * @returns the address, or why it could not be built
 */
export function aliasAddress({
  identity,
  provider,
  label,
  zone,
}: {
  identity: string;
  provider: AliasProvider;
  label: string;
  zone: string;
}): Result<AliasAddress, AliasError> {
  if (!LABEL.test(identity)) {
    return err(
      AliasErrors.invalidLabel({ label: identity, why: "lower-case letters, digits and inner hyphens, 1-32 long" }),
    );
  }
  if (!LABEL.test(label)) {
    return err(AliasErrors.invalidLabel({ label, why: "lower-case letters, digits and inner hyphens, 1-32 long" }));
  }
  const identityProvider = identity.split("-").find((segment) => isAliasProvider(segment));
  if (identityProvider !== undefined) {
    return err(
      AliasErrors.invalidLabel({
        label: identity,
        why: `it carries the provider ${identityProvider}, which is what separates the identity from the label`,
      }),
    );
  }
  const labelProvider = label.split("-").find((segment) => isAliasProvider(segment));
  if (labelProvider !== undefined) {
    return err(
      AliasErrors.invalidLabel({
        label,
        why: `it carries the provider ${labelProvider}, which is what separates the identity from the label`,
      }),
    );
  }
  if (!ZONE.test(zone)) {
    return err(AliasErrors.invalidLabel({ label: zone, why: "a zone is dot-joined lower-case labels" }));
  }
  return ok({ address: `${identity}-${provider}-${label}@${zone}`, identity, label, provider, zone });
}

/**
 * Read a provisioned address back into its parts.
 *
 * @param address the address as Cloudflare stored it
 * @returns the parts, or why this is not one of ours
 */
export function parseAliasAddress({ address }: { address: string }): Result<AliasAddress, AliasError> {
  const at = address.indexOf("@");
  if (at === -1) {
    return err(AliasErrors.invalidLabel({ label: address, why: "an address needs a zone after an @" }));
  }
  const local = address.slice(0, at);
  const zone = address.slice(at + 1);
  const segments = local.split("-");
  const found = providerSegment({ segments });
  if (found === null) {
    return err(
      AliasErrors.invalidLabel({ label: local, why: "it names no provider this verb knows, or names two of them" }),
    );
  }
  if (found.at === 0 || found.at === segments.length - 1) {
    return err(
      AliasErrors.invalidLabel({
        label: local,
        why: "an address is <identity>-<provider>-<label>, so the provider is never first or last",
      }),
    );
  }
  return aliasAddress({
    identity: segments.slice(0, found.at).join("-"),
    label: segments.slice(found.at + 1).join("-"),
    provider: found.provider,
    zone,
  });
}
