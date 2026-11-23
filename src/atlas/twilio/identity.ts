/**
 * Twilio's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `twilio:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing. There is no account component: the id must survive a
 * subaccount being renamed, and an Account SID is an installation identifier this repository does not carry
 * in a hash anyone greps.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { TwilioAtlasKind } from "./model.js";

/**
 * A stable id for one Twilio atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — Twilio's file stem for an api, `<METHOD> <path>` for a
 *   method, the declared route for a page, the SID for an account or a resource
 * @returns a 32-character hex digest
 */
export function twilioEntityId({ kind, providerId }: { kind: TwilioAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `twilio:${kind}` });
}

/**
 * A stable id for one Twilio atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 *
 * @internal
 */
export function twilioGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
