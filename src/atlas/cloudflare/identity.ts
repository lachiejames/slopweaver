/**
 * Cloudflare's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts` — it was byte-identical here and in the Vanta atlas, and both
 * copies carried a comment saying it would be shared once a second atlas needed it. What is genuinely
 * Cloudflare's is the NAMESPACE: `cloudflare:<kind>`, so two kinds sharing a provider id cannot collide and
 * no other platform's atlas can produce the same id for a different thing. There is no tenant component,
 * because the manifest's own `selection` is what pins this atlas to one account.
 *
 * There IS a zone component, on every zone-scoped kind, and it is split into a second function rather than
 * left to each projection to remember — see {@link cloudflareZoneEntityId}.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { CloudflareAccountScopedKind, CloudflareZoneScopedKind } from "./model.js";

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * Unnamespaced by platform, deliberately: a gap id is only ever looked up within one atlas's own kind file,
 * and namespacing it now would change every stored gap's id — a silent full re-open of every accumulated
 * question, which is the one thing the gap lifecycle exists to prevent.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function cloudflareGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}

/**
 * A stable id for one ACCOUNT-scoped Cloudflare entity, keyed on Cloudflare's own provider-assigned
 * identifiers — never on a name, description, or anything the Cloudflare dashboard lets an operator rename.
 *
 * It REFUSES a zone-scoped kind at the type level, and that refusal is the whole point rather than
 * tidiness: several of Cloudflare's zone-scoped id spaces are allocated per zone rather than globally, so
 * an identity without the zone folds every zone onto the first one read. `model.ts`'s
 * `CLOUDFLARE_ZONE_SCOPED_KINDS` carries the measurement. Use {@link cloudflareZoneEntityId} for those.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param components Cloudflare's own immutable identifying fields — never a mutable name
 * @returns a 32-character hex digest
 */
export function cloudflareEntityId({
  kind,
  components,
}: {
  kind: CloudflareAccountScopedKind;
  components: Readonly<Record<string, string | null>>;
}): string {
  return stableEntityId({ components, namespace: `cloudflare:${kind}` });
}

/**
 * A stable id for one ZONE-scoped Cloudflare entity — the same hashing, with the zone folded in for you.
 *
 * `zoneId` is a parameter of its own rather than another `components` field so that it cannot be omitted:
 * every zone-scoped kind is typed into this function and every call therefore carries its zone. Adding it
 * by convention was the arrangement that failed — of the ten zone-scoped kinds, exactly one
 * (`projection/dnssec.ts`) happened to include a zone, and only because that kind's provider id IS the zone
 * id.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param zoneId the zone this entity was read from — the component that keeps the account's zones apart
 * @param components Cloudflare's own immutable identifying fields — never a mutable name
 * @returns a 32-character hex digest
 */
export function cloudflareZoneEntityId({
  kind,
  zoneId,
  components,
}: {
  kind: CloudflareZoneScopedKind;
  zoneId: string;
  components: Readonly<Record<string, string | null>>;
}): string {
  return stableEntityId({ components: { ...components, zoneId }, namespace: `cloudflare:${kind}` });
}
