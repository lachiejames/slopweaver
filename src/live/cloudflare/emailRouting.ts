/**
 * The Cloudflare Email Routing seam the `alias` verb writes through — the only place this repo creates a
 * routing rule.
 *
 * ## Why this reuses the atlas's client rather than opening its own
 *
 * `../../atlas/cloudflare/client.ts` already owns the guarded SDK boundary: it wraps `fetch` so a
 * `success:false` body riding an HTTP 200 raises instead of reading as an empty success, it maps every
 * thrown SDK exception into one typed union, and it never reimplements retry. A second transport here
 * would be a second place for that envelope gap to reopen, on the one path in this repo that WRITES.
 *
 * ## The one rule that keeps a write inside its grant
 *
 * The token is the work account's — the same slot the Cloudflare atlas reads
 * (`$SLOPWEAVER_HOME/secrets/cloudflare-token`, `../../config.ts`) — so this verb can reach every zone that
 * account holds. {@link resolveZone} is therefore not a convenience: a zone name the account does not hold
 * REFUSES before any write, naming the zones it does hold, and nothing downstream accepts a zone id this
 * function did not return.
 */

import type Cloudflare from "cloudflare";

import { type AliasError, AliasErrors } from "../../alias/errors.js";
import { type AliasRule, forwardRuleBody, readAliasRule } from "../../alias/rules.js";
import { callCloudflare } from "../../atlas/cloudflare/client.js";
import { CloudflareClientErrors } from "../../atlas/cloudflare/errors.js";
import { err, ok, type Result } from "../../lib/result.js";

/** One zone this verb may write to, as the account really holds it. */
export interface ResolvedZone {
  readonly id: string;
  readonly name: string;
  /**
   * The account that owns the zone, read off the zone itself rather than configured beside it. Cloudflare
   * verifies a destination mailbox PER ACCOUNT, so an id taken from anywhere else would let a run check one
   * account's verified list and then write the rule into a different account's zone.
   */
  readonly accountId: string;
}

/** How many zones and rules one page asks for — a zone's rule list is tens of entries, never thousands. */
const PAGE = 100;

/**
 * Resolve a zone name against the zones the configured token can see.
 *
 * @param client the guarded Cloudflare client
 * @param zone the zone name the caller asked for
 * @returns the zone's id, or a refusal naming the zones the account holds
 */
export async function resolveZone({
  client,
  zone,
}: {
  client: Cloudflare;
  zone: string;
}): Promise<Result<ResolvedZone, AliasError>> {
  const listed = await callCloudflare({
    call: () => client.zones.list({ per_page: PAGE }),
    operation: "zones.list",
  });
  if (listed.isErr()) {
    return err(AliasErrors.cloudflareFailed({ cause: listed.error }));
  }
  const held = listed.value.result.map((entry) => entry.name);
  const matched = listed.value.result.filter((entry) => entry.name === zone);
  if (matched.length > 1) {
    return err(AliasErrors.zoneAmbiguous({ zone }));
  }
  const [only] = matched;
  if (only === undefined) {
    return err(AliasErrors.zoneNotInAccount({ held, zone }));
  }
  const accountId = only.account.id;
  if (accountId === undefined) {
    return err(
      AliasErrors.cloudflareFailed({
        cause: CloudflareClientErrors.schema({
          cause: `zone "${only.name}" (${only.id}) carried no account.id, so no verified destination list can be read for it`,
          operation: "zones.list",
        }),
      }),
    );
  }
  return ok({ accountId, id: only.id, name: only.name });
}

/**
 * Whether email routing is switched on for a zone, which no rule can route without.
 *
 * @param client the guarded Cloudflare client
 * @param zone the resolved zone
 * @returns nothing when routing is enabled, else why it cannot route
 */
export async function requireRoutingEnabled({
  client,
  zone,
}: {
  client: Cloudflare;
  zone: ResolvedZone;
}): Promise<Result<undefined, AliasError>> {
  const settings = await callCloudflare({
    call: () => client.emailRouting.get({ zone_id: zone.id }),
    operation: "emailRouting.get",
  });
  if (settings.isErr()) {
    return err(AliasErrors.cloudflareFailed({ cause: settings.error }));
  }
  return settings.value.enabled === true ? ok(undefined) : err(AliasErrors.routingDisabled({ zone: zone.name }));
}

/**
 * Every routing rule on a zone, as this verb reads one.
 *
 * @param client the guarded Cloudflare client
 * @param zone the resolved zone
 * @returns the rules, in the order Cloudflare returned them
 */
export async function listRules({
  client,
  zone,
}: {
  client: Cloudflare;
  zone: ResolvedZone;
}): Promise<Result<readonly AliasRule[], AliasError>> {
  const listed = await callCloudflare({
    call: () => client.emailRouting.rules.list({ per_page: PAGE, zone_id: zone.id }),
    operation: "emailRouting.rules.list",
  });
  if (listed.isErr()) {
    return err(AliasErrors.cloudflareFailed({ cause: listed.error }));
  }
  return ok(listed.value.result.map((payload) => readAliasRule({ payload })));
}

/**
 * Whether Cloudflare has verified a destination mailbox, which it will not forward to otherwise.
 *
 * @param client the guarded Cloudflare client
 * @param accountId the account the destination belongs to
 * @param destination the mailbox an alias forwards to
 * @returns nothing when it is verified, else the refusal naming what to check
 */
export async function requireVerifiedDestination({
  client,
  accountId,
  destination,
}: {
  client: Cloudflare;
  accountId: string;
  destination: string;
}): Promise<Result<undefined, AliasError>> {
  const listed = await callCloudflare({
    call: () => client.emailRouting.addresses.list({ account_id: accountId, per_page: PAGE }),
    operation: "emailRouting.addresses.list",
  });
  if (listed.isErr()) {
    return err(AliasErrors.cloudflareFailed({ cause: listed.error }));
  }
  const wanted = destination.toLowerCase();
  const found = listed.value.result.find(
    (entry) => typeof entry.email === "string" && entry.email.toLowerCase() === wanted,
  );
  // An address Cloudflare has never heard of and one it has not verified are the same fact to a caller: mail
  // will not arrive. Both answer the same refusal, which names the one-time code rather than a status field.
  const verified = found !== undefined && typeof found.verified === "string" && found.verified.length > 0;
  return verified ? ok(undefined) : err(AliasErrors.destinationUnverified({ destination }));
}

/**
 * Create the forwarding rule for one address.
 *
 * @param client the guarded Cloudflare client
 * @param zone the resolved zone
 * @param address the address to route
 * @param destination the mailbox it forwards to
 * @returns the created rule as this verb reads it
 */
export async function createForwardRule({
  client,
  zone,
  address,
  destination,
}: {
  client: Cloudflare;
  zone: ResolvedZone;
  address: string;
  destination: string;
}): Promise<Result<AliasRule, AliasError>> {
  const body = forwardRuleBody({ address, destination });
  const created = await callCloudflare({
    call: () =>
      client.emailRouting.rules.create({
        actions: body.actions.map((action) => ({ type: action.type, value: [...action.value] })),
        enabled: body.enabled,
        matchers: body.matchers.map((matcher) => ({ field: matcher.field, type: matcher.type, value: matcher.value })),
        name: body.name,
        zone_id: zone.id,
      }),
    operation: "emailRouting.rules.create",
  });
  if (created.isErr()) {
    return err(AliasErrors.cloudflareFailed({ cause: created.error }));
  }
  return ok(readAliasRule({ payload: created.value }));
}

/** Where a zone's catch-all sends everything it catches — one mailbox, or nowhere at all. */
export type CatchAllTarget = { readonly kind: "forward"; readonly destination: string } | { readonly kind: "drop" };

/**
 * The catch-all a zone is standing on right now.
 *
 * Read before every catch-all write, and that is the point rather than an optimisation: a catch-all update
 * REPLACES the rule wholesale, so a caller who does not read it first cannot say what they overwrote. The
 * per-address path already refuses to clobber a standing rule; this is the same protection for the wider
 * one.
 *
 * @param client the guarded Cloudflare client
 * @param zone the resolved zone
 * @returns the standing catch-all as this verb reads one
 */
export async function getCatchAll({
  client,
  zone,
}: {
  client: Cloudflare;
  zone: ResolvedZone;
}): Promise<Result<AliasRule, AliasError>> {
  const got = await callCloudflare({
    call: () => client.emailRouting.rules.catchAlls.get({ zone_id: zone.id }),
    operation: "emailRouting.rules.catchAlls.get",
  });
  if (got.isErr()) {
    return err(AliasErrors.cloudflareFailed({ cause: got.error }));
  }
  return ok(readAliasRule({ payload: got.value }));
}

/**
 * Point the zone's catch-all at one destination, or switch it off.
 *
 * A catch-all forwards every address on the zone, provisioned or not, which is what makes a per-seat step
 * unnecessary — and also what makes it the widest write here, so it is its own verb rather than a flag on
 * provisioning.
 *
 * Cloudflare requires an action on EVERY catch-all write, so switching it off is `drop` plus `enabled:
 * false` rather than an omitted action: a caller asking to stop catching mail never has to name a mailbox
 * it is not going to.
 *
 * @param client the guarded Cloudflare client
 * @param zone the resolved zone
 * @param target the mailbox everything forwards to, or dropping it
 * @returns the catch-all as this verb reads it
 */
export async function setCatchAll({
  client,
  zone,
  target,
}: {
  client: Cloudflare;
  zone: ResolvedZone;
  target: CatchAllTarget;
}): Promise<Result<AliasRule, AliasError>> {
  const actions =
    target.kind === "forward"
      ? [{ type: "forward" as const, value: [target.destination] }]
      : [{ type: "drop" as const }];
  const updated = await callCloudflare({
    call: () =>
      client.emailRouting.rules.catchAlls.update({
        actions,
        enabled: target.kind === "forward",
        matchers: [{ type: "all" }],
        zone_id: zone.id,
      }),
    operation: "emailRouting.rules.catchAlls.update",
  });
  if (updated.isErr()) {
    return err(AliasErrors.cloudflareFailed({ cause: updated.error }));
  }
  return ok(readAliasRule({ payload: updated.value }));
}
