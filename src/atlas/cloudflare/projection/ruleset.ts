/**
 * The `ruleset` and `zone-ruleset` entity shapes and their projection — modern Rulesets, at both scopes,
 * each with the rules it actually contains.
 *
 * ## Why this exists at all, which is the whole story of the kind
 *
 * `CLOUDFLARE_EXCLUDED_SURFACES` carried three entries covering this: "modern account and zone Rulesets",
 * "modern managed WAF delivered through Rulesets" and "Cache Rules delivered through Rulesets". No reason
 * was ever recorded for any of them. The owner's ruling is that rulesets are useful to know in an atlas and
 * a rule set is never an acceptable exclusion.
 *
 * MEASURED against an account, GET only, at account scope and across every zone: the rulesets, the
 * rules inside them and their bytes, judged against a terabyte as the owner's own example of a volume that
 * would justify an exclusion, and nowhere near it. The three exclusions are also ONE surface, not
 * three: managed WAF and Cache Rules are `phase` values inside those same rulesets, so holding rulesets holds all of them and nothing is counted twice.
 *
 * ## The list does not carry the rules, and that is why this fans out
 *
 * `rulesets.list` returns metadata only — id, name, phase, kind, version. The RULES arrive one
 * `rulesets.get` per ruleset, and they are the thing worth holding: an entitlement decision, an exposed-
 * credential check, a rate limit. So `ruleset` is a parent-fanout kind exactly like `account-certificate`,
 * and a single ruleset whose `get` fails costs that ruleset's rules rather than the whole kind's read.
 *
 * ## Zone scope is a separate KIND, not a separate scope on this one
 *
 * `model.ts` splits kinds by whether their entities belong to the account or to one zone, and identity
 * follows that split at the type level: a zone-scoped projection cannot compile without its zone. Ruleset
 * ids are allocated per zone, so the two cannot share a kind. `zone-ruleset` reads the configured deep zone
 * only, like every other zone-scoped kind here — every other zone is the open p0
 * `the-cloudflare-atlas-cannot-read-all-twelve-zones`, not a new exclusion.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId, cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The metadata `rulesets.list` returns for one ruleset, before its rules are fetched. */
export interface CloudflareRawRuleset {
  readonly id: string;
  readonly name?: string | null;
  readonly description?: string | null;
  readonly kind?: string | null;
  readonly phase?: string | null;
  readonly source?: string | null;
  readonly version?: string | null;
  readonly last_updated?: string | null;
}

/** One rule inside a ruleset, as stored. Kept as an open bucket: a rule's `action_parameters` shape is
 * decided by its action, and there are dozens of actions. */
export type CloudflareRulesetRule = unknown;

/** The detail this atlas stores for a `ruleset` or `zone-ruleset` entity. */
export interface CloudflareRulesetDetail {
  readonly kind: "ruleset" | "zone-ruleset";
  readonly name: string | null;
  readonly description: string | null;
  /** `managed` for a Cloudflare-published ruleset, `zone`/`root` for one this account wrote. */
  readonly rulesetKind: string | null;
  /** Which evaluation phase this ruleset runs in — `http_request_firewall_managed`, `http_ratelimit`, the
   * cache phases, and so on. This is the field that makes the managed-WAF and Cache-Rules surfaces the
   * SAME surface as this one. */
  readonly phase: string | null;
  readonly source: string | null;
  readonly version: string | null;
  readonly lastUpdated: string | null;
  readonly rules: readonly CloudflareRulesetRule[];
}

/**
 * Whether a stored entity's detail is a ruleset detail carrying a rules array — the guard a fan-out needs
 * to read previously-stored rules back out when this run's `get` for that ruleset failed.
 *
 * @param value the stored detail to test
 * @returns whether it is a ruleset detail this code can read rules from
 */
export function isCloudflareRulesetDetail(value: unknown): value is CloudflareRulesetDetail {
  return (
    isRecord(value) &&
    (value["kind"] === "ruleset" || value["kind"] === "zone-ruleset") &&
    Array.isArray(value["rules"])
  );
}

/**
 * Project one ruleset plus its resolved rules into an entity, at whichever scope it was read from.
 *
 * @param raw the ruleset's own metadata, from the inventory read
 * @param rules this ruleset's rules, either freshly read this run or preserved from what was already stored
 * @param accountId the account this ruleset was read under
 * @param zoneId the zone this ruleset belongs to, or `null` for an account-scoped one
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareRuleset({
  raw,
  rules,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawRuleset;
  rules: readonly CloudflareRulesetRule[];
  accountId: string;
  zoneId: string | null;
  at: string;
}): CloudflareEntity {
  const kind = zoneId === null ? "ruleset" : "zone-ruleset";
  const detail: CloudflareRulesetDetail = {
    description: unsetFieldAsNull({ key: "description", record: raw }),
    kind,
    lastUpdated: unsetFieldAsNull({ key: "last_updated", record: raw }),
    name: unsetFieldAsNull({ key: "name", record: raw }),
    phase: unsetFieldAsNull({ key: "phase", record: raw }),
    rules: [...rules],
    rulesetKind: unsetFieldAsNull({ key: "kind", record: raw }),
    source: unsetFieldAsNull({ key: "source", record: raw }),
    version: unsetFieldAsNull({ key: "version", record: raw }),
  };
  const id =
    zoneId === null
      ? cloudflareEntityId({ components: { accountId, providerId: raw.id }, kind: "ruleset" })
      : cloudflareZoneEntityId({ components: { accountId, providerId: raw.id }, kind: "zone-ruleset", zoneId });
  return {
    detail,
    firstSeenAt: at,
    id,
    kind,
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId },
    source: {
      channel: "rest-api",
      observedAt: at,
      operation: zoneId === null ? "account-rulesets-fanout" : "zone-rulesets-fanout",
    },
    state: "observed",
  };
}
