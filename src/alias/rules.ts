/**
 * What a Cloudflare email-routing rule means to this verb, read from the payload rather than trusted from
 * the SDK's declared type.
 *
 * A routing rule is a matcher plus an action. The only shape this verb writes is the one Cloudflare's own
 * console writes for "forward a single address": one `to`/`literal` matcher on the address, one `forward`
 * action carrying one destination. Anything else in the zone is somebody's hand-made rule, and this module
 * reads it well enough to REPORT it and never well enough to think it owns it.
 *
 * Pure. No I/O, no clock, no network.
 */

import { isRecord } from "../lib/parsers.js";

/** One forwarding rule as this verb reads it. */
export interface AliasRule {
  /** Cloudflare's own id for the rule, empty when the payload carried none. */
  readonly ruleId: string;
  /** The address matched, lower-cased — empty when this rule matches something other than one address. */
  readonly address: string;
  /** Every destination the rule forwards to, in payload order. */
  readonly destinations: readonly string[];
  readonly enabled: boolean;
}

/** A string field off an unknown payload, or the empty string. */
function str({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/**
 * The single address a rule matches, or the empty string when it matches anything else.
 *
 * Cloudflare spells a single-address matcher `{ type: "literal", field: "to", value: "a@b" }`. A rule with
 * several matchers is somebody's own composite: it is not one address, so this reports none rather than
 * picking the first and claiming the rule is ours.
 *
 * @param matchers the rule's `matchers` field, as the payload carried it
 * @returns the matched address lower-cased, or the empty string
 */
function matchedAddress({ matchers }: { matchers: unknown }): string {
  if (!Array.isArray(matchers) || matchers.length !== 1) {
    return "";
  }
  const [only] = matchers;
  if (!isRecord(only) || only["type"] !== "literal" || only["field"] !== "to") {
    return "";
  }
  return str({ value: only["value"] }).toLowerCase();
}

/**
 * Every destination a rule forwards to.
 *
 * @param actions the rule's `actions` field, as the payload carried it
 * @returns the forwarded destinations, lower-cased, in payload order
 */
function forwardedTo({ actions }: { actions: unknown }): readonly string[] {
  if (!Array.isArray(actions)) {
    return [];
  }
  const forwarded: string[] = [];
  for (const action of actions) {
    if (!isRecord(action) || action["type"] !== "forward" || !Array.isArray(action["value"])) {
      continue;
    }
    for (const value of action["value"]) {
      if (typeof value === "string") {
        forwarded.push(value.toLowerCase());
      }
    }
  }
  return forwarded;
}

/**
 * Read one routing-rule payload.
 *
 * @param payload one entry of Cloudflare's rule list
 * @returns the rule as this verb reads it
 */
export function readAliasRule({ payload }: { payload: unknown }): AliasRule {
  if (!isRecord(payload)) {
    return { address: "", destinations: [], enabled: false, ruleId: "" };
  }
  return {
    address: matchedAddress({ matchers: payload["matchers"] }),
    destinations: forwardedTo({ actions: payload["actions"] }),
    // Cloudflare omits `enabled` on a rule it has disabled in some responses, and an absent flag is not an
    // enabled rule — a row claiming mail flows where it does not is the one error this cannot afford.
    enabled: payload["enabled"] === true,
    ruleId: str({ value: payload["tag"] === undefined ? payload["id"] : payload["tag"] }),
  };
}

/**
 * The rule already routing an address, when one is there.
 *
 * @param rules every rule read off the zone
 * @param address the address being provisioned
 * @returns the existing rule, or undefined
 */
export function existingRuleFor({
  rules,
  address,
}: {
  rules: readonly AliasRule[];
  address: string;
}): AliasRule | undefined {
  const wanted = address.toLowerCase();
  return rules.find((rule) => rule.address === wanted);
}

/** The matcher and action Cloudflare stores for "forward this one address to this one mailbox". */
export interface ForwardRuleBody {
  readonly matchers: readonly { readonly type: "literal"; readonly field: "to"; readonly value: string }[];
  readonly actions: readonly { readonly type: "forward"; readonly value: readonly string[] }[];
  readonly enabled: true;
  readonly name: string;
}

/**
 * The body that provisions one address.
 *
 * @param address the address to route
 * @param destination the mailbox it forwards to
 * @returns the rule body, ready for the SDK
 */
export function forwardRuleBody({ address, destination }: { address: string; destination: string }): ForwardRuleBody {
  return {
    actions: [{ type: "forward", value: [destination] }],
    enabled: true,
    matchers: [{ field: "to", type: "literal", value: address }],
    name: `slopweaver alias ${address}`,
  };
}
