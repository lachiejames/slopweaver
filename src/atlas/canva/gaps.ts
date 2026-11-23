/**
 * What this atlas knows it cannot see, in its own vocabulary.
 *
 * "The gap list is a deliverable" is the owner's own phrasing (`docs/atlas-intent/settled-decisions.md`), so these are
 * findings rather than apologies. Each condition below was MEASURED against the pinned
 * description while the atlas was built, and each names the concrete act that would close it — a gap nobody
 * can act on is a complaint.
 *
 * Three of the six are findings about CANVA rather than about this installation, which is the half of a gap
 * list that survives a credential arriving: a declared tag with no operation, a scope nothing calls, and an
 * entitlement the machine-readable extension forgot are true of the platform however much access you have.
 *
 * The kit's own two conditions (`api-browser-disagreement`, `browser-surface-unreadable`) stay available
 * beside these: corroboration between surfaces is part of the definition of an atlas, so its vocabulary
 * cannot belong to one platform.
 */
import { type AtlasGap, openGap } from "../kit/gaps.js";

import { CANVA_ATLAS_PLATFORM, type CanvaAtlasGap, type CanvaAtlasKind } from "./model.js";

/**
 * The conditions this atlas can raise about itself.
 *
 * - `no-integration-credential` — the Connect API is published, declared and unreachable, because this
 *   installation has no registered Canva integration and no user grant.
 * - `no-web-app-walk` — the web app has never been walked, so the mandatory browser surface is unfilled.
 *   Distinct from Nightfall's `no-console-session` on purpose: there IS a session here, and a condition
 *   named for a missing sign-in would send a reader to perform one that has already happened.
 * - `declared-unused-tag` — the description's own `tags` array advertises a product area and no operation
 *   carries that tag, so the vendor names a surface in its index and publishes no way to reach it.
 * - `grantable-uncallable-scope` — an OAuth scope an integration can be granted that no published operation
 *   names. The grant surface being wider than the call surface is the finding.
 * - `undeclared-entitlement` — an operation whose prose requires a plan or an organisation and whose
 *   machine-readable `x-required-capabilities` says nothing, so the two halves of the vendor's own
 *   eligibility contract disagree.
 * - `browser-only-capability` — the vendor's own description sends the reader to the Canva UI for something
 *   the Connect API cannot do. `docs/atlas-intent/02-both-surfaces.md`'s claim that the surfaces diverge, evidenced from
 *   the vendor's own bytes instead of asserted.
 * @internal
 */
export const CANVA_GAP_CONDITIONS = [
  "no-integration-credential",
  "no-web-app-walk",
  "declared-unused-tag",
  "grantable-uncallable-scope",
  "undeclared-entitlement",
  "browser-only-capability",
] as const;

/**
 * One condition this atlas can raise.
 * @internal
 */
export type CanvaGapCondition = (typeof CANVA_GAP_CONDITIONS)[number];

/**
 * Add this atlas's own channel vocabulary to a kit-built gap.
 *
 * @param gap the kit-built gap
 * @param kind the kind it concerns, or `null` for a cross-kind gap
 * @param surfaces which of this atlas's channels it concerns
 * @returns the gap as this atlas stores it
 */
function toStoredGap({
  gap,
  kind,
  surfaces,
}: {
  gap: AtlasGap;
  kind: CanvaAtlasKind | null;
  surfaces: readonly ("published-api" | "connect-api" | "web-app")[];
}): CanvaAtlasGap {
  return {
    condition: gap.condition,
    fields: [...gap.fields],
    firstDetectedAt: gap.firstDetectedAt,
    id: gap.id,
    kind,
    lastCheckedAt: gap.lastCheckedAt,
    lastDetectedAt: gap.lastDetectedAt,
    reason: gap.reason,
    scope: gap.scope,
    status: gap.status,
    surfaces: [...surfaces],
  };
}

/**
 * The gap that says this installation cannot call the API it has mapped.
 *
 * Raised on every kind rather than once for the platform, deliberately: a reader asking "what does the atlas
 * hold about folders" reads that kind's file, and a cross-kind gap filed somewhere else is a gap that reader
 * never sees.
 *
 * @param kind the kind this gap is about
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function canvaNoCredentialGap({ kind, at }: { kind: CanvaAtlasKind; at: string }): CanvaAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "no-integration-credential",
      fields: [],
      kind,
      reason:
        "53 of the 59 published operations declare oauthAuthCode and this installation has no registered Canva integration and no user grant, so nothing of this kind has ever been read — only the vendor's declaration of what could be asked. Close it by registering an integration at canva.com/developers and storing its token: slopweaver secrets set canva-access-token",
      scope: `${CANVA_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["connect-api"],
    }),
    kind,
    surfaces: ["connect-api"],
  });
}

/**
 * The gap that says the mandatory browser surface has never been walked.
 *
 * MEASURED, and the reason this is not Nightfall's `no-console-session`: the cookie probe reports
 * a signed-in session, so nothing here is waiting on the owner. What is missing is the walk.
 *
 * @param cookies how many cookies the probe found, quoted so the claim is checkable rather than asserted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function canvaNoWebAppWalkGap({ cookies, at }: { cookies: number; at: string }): CanvaAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "no-web-app-walk",
      fields: [],
      kind: "page",
      reason: `no page of canva.com has been opened, so the browser surface is declared and unfilled — but it is NOT blocked on the owner: \`slopweaver browser cookies --origin https://www.canva.com\` reports ${cookies} cookies in the owner's own Chrome profile, so a signed-in session already exists and the missing piece is the walk itself. Every page's existence, the settings pages' screenshots and the methods the web client calls are what it would land`,
      scope: `${CANVA_ATLAS_PLATFORM}:web-app`,
      surfaces: ["web-app"],
    }),
    kind: "page",
    surfaces: ["web-app"],
  });
}

/**
 * The gap that says the vendor's own index advertises a product area it publishes no operation for.
 *
 * MEASURED over the pinned description: `tags` declares `brands`, with the description "Allow management of
 * brands", and zero of the 59 operations carry it. So Canva names a brands surface in the document's own
 * index and gives no way to reach it — which is a lead for the browser half rather than a defect in this
 * extraction, and exactly the class of thing an atlas exists to surface.
 *
 * @param tags the declared tag names no operation carries, sorted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function canvaDeclaredUnusedTagGap({ tags, at }: { tags: readonly string[]; at: string }): CanvaAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "declared-unused-tag",
      fields: [...tags],
      kind: null,
      reason: `Canva's own description declares these tags in its \`tags\` index and no operation carries any of them, so the vendor advertises the product area and publishes no operation that reaches it. No credential closes this one — either the vendor publishes an operation, or the area is reachable only in the browser, which is what the web-app walk would establish`,
      scope: `${CANVA_ATLAS_PLATFORM}:published-api`,
      surfaces: ["published-api", "web-app"],
    }),
    kind: null,
    surfaces: ["published-api", "web-app"],
  });
}

/**
 * The gap that says a scope can be granted and calls nothing.
 *
 * MEASURED: the description declares 18 OAuth scopes and its operations between them name 16.
 * `collaboration:event` and `folder:permission:write` are grantable to an integration and reach no published
 * operation at all — so the consent screen a user is shown is strictly wider than what the published API can
 * do with it.
 *
 * @param kind the kind the scope governs
 * @param scopes the scope strings no operation names, sorted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function canvaGrantableUncallableScopeGap({
  kind,
  scopes,
  at,
}: {
  kind: CanvaAtlasKind;
  scopes: readonly string[];
  at: string;
}): CanvaAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "grantable-uncallable-scope",
      fields: [...scopes],
      kind,
      reason: `${scopes.join(", ")} can be granted to a Canva integration and no published operation names ${scopes.length === 1 ? "it" : "any of them"} — the GRANT surface is wider than the CALL surface, so a user's consent screen offers more than the published API can spend. Either an unpublished operation uses it or the capability is browser-only; the web-app walk is what would tell them apart`,
      scope: `${CANVA_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["published-api", "connect-api"],
    }),
    kind,
    surfaces: ["published-api", "connect-api"],
  });
}

/**
 * The gap that says the vendor's own eligibility contract disagrees with itself.
 *
 * This atlas's sharpest finding, and the reason `eligibility.ts` exists as a module rather than two lines.
 * Canva declares eligibility twice — in `<Availability>` prose and in the machine-readable
 * `x-required-capabilities` extension — and the two do not agree: nine operations carry the prose, seven
 * carry the extension, and the two autofill jobs whose prose requires a Canva Enterprise organisation
 * declare no capability at all. `docs/atlas-intent/04-corroboration.md` says both records are kept and which one is right
 * is the owner's call, so this raises the disagreement rather than picking a side.
 *
 * @param kind the kind whose operations disagree
 * @param operations the operation ids carrying prose and no capability, sorted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function canvaUndeclaredEntitlementGap({
  kind,
  operations,
  at,
}: {
  kind: CanvaAtlasKind;
  operations: readonly string[];
  at: string;
}): CanvaAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "undeclared-entitlement",
      fields: [...operations],
      kind,
      reason: `${operations.join(", ")} declare a plan or organisation requirement in their \`<Availability>\` prose and declare no \`x-required-capabilities\` at all, so Canva's two statements of its own eligibility contract disagree. A caller trusting the machine-readable half would believe a scope grant is sufficient. Both records are kept and neither is preferred — which surface wins when two disagree is not this atlas's call (docs/atlas-intent/04-corroboration.md)`,
      scope: `${CANVA_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["published-api"],
    }),
    kind,
    surfaces: ["published-api"],
  });
}

/**
 * The gap that says the vendor sends the reader to the browser for something the API cannot do.
 *
 * `docs/atlas-intent/02-both-surfaces.md` — an API-only atlas is a defeated one, because the two surfaces diverge — with
 * the divergence read out of the vendor's own description instead of asserted. MEASURED: nine operations
 * name the Canva UI, and TWO of them do it for a capability the description says the Connect API does not
 * have at all. The other seven only compare themselves to the browser, so the flag on the row is the wide
 * census and this gap is the narrow judgement — `sync.ts` names the two.
 *
 * `because` is the vendor's own words for THIS kind rather than a fixed sentence, and that is a correction
 * to how this gap first read: a single sentence naming both cases put resizing in the folder kind's gap,
 * where a reader asking about folders met a paragraph about designs. A gap that describes something other
 * than what it is filed under is a gap that trains a reader to skim.
 *
 * @param kind the kind whose operations name the browser
 * @param operations the operation ids that name it, sorted
 * @param because what the vendor says this kind's operations cannot do through the API
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function canvaBrowserOnlyCapabilityGap({
  kind,
  operations,
  because,
  at,
}: {
  kind: CanvaAtlasKind;
  operations: readonly string[];
  because: string;
  at: string;
}): CanvaAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "browser-only-capability",
      fields: [...operations],
      kind,
      reason: `${operations.join(", ")} send the reader to the Canva UI for something the vendor says the Connect API cannot do: ${because}. This is the platform itself evidencing why the browser surface is mandatory rather than a completeness ritual, and the web-app walk is what would map what is actually there`,
      scope: `${CANVA_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["published-api", "web-app"],
    }),
    kind,
    surfaces: ["published-api", "web-app"],
  });
}
