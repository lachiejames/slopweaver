/**
 * What this atlas knows it cannot see, in its own vocabulary.
 *
 * "The gap list is a deliverable" is the owner's own phrasing (`docs/atlas-intent/settled-decisions.md`), so these are
 * findings rather than apologies. Each condition below was MEASURED while the atlas was
 * built, and each names the concrete act that would close it — a gap nobody can act on is a complaint.
 *
 * The kit's own two conditions (`api-browser-disagreement`, `browser-surface-unreadable`) stay available
 * beside these: corroboration between surfaces is part of the definition of an atlas, so its vocabulary
 * cannot belong to one platform.
 */
import { type AtlasGap, openGap } from "../kit/gaps.js";

import { NIGHTFALL_ATLAS_PLATFORM, type NightfallAtlasGap, type NightfallAtlasKind } from "./model.js";

/**
 * The conditions this atlas can raise about itself.
 *
 * - `no-api-credential` — the workflow API is published, declared and unreachable, because this
 *   installation holds no bearer token.
 * - `no-console-session` — the console has never been opened, so the mandatory browser surface is unfilled
 *   and no page's existence has been confirmed by looking at it.
 * - `unenumerable-kind` — the vendor publishes a fetch-by-id for this kind and no list operation at all, so
 *   even a credentialled channel could never enumerate it. This is a property of the platform rather than
 *   of this installation's access, and it is the kind of thing an atlas exists to surface.
 * - `undocumented-console-surface` — the console renders product areas the six published documents do not
 *   describe at all. Recorded from the vendor's own help centre rather than from a walk, which is why the
 *   gap says `documented` and not `observed`.
 * - `unresolvable-reference` — a record REFERENCES something by identifier that no published operation can
 *   resolve to a name. This is the sharpest finding the build produced and it is the reason this condition
 *   exists rather than being folded into the one above.
 * @internal
 */
export const NIGHTFALL_GAP_CONDITIONS = [
  "no-api-credential",
  "no-console-session",
  "unenumerable-kind",
  "undocumented-console-surface",
  "unresolvable-reference",
] as const;

/**
 * One condition this atlas can raise.
 * @internal
 */
export type NightfallGapCondition = (typeof NIGHTFALL_GAP_CONDITIONS)[number];

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
  kind: NightfallAtlasKind | null;
  surfaces: readonly ("published-api" | "workflow-api" | "console")[];
}): NightfallAtlasGap {
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
 * Raised on every kind rather than once for the platform, deliberately: a reader asking "what does the
 * atlas hold about endpoint devices" reads that kind's file, and a cross-kind gap filed somewhere else is a
 * gap that reader never sees.
 *
 * @param kind the kind this gap is about
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function nightfallNoCredentialGap({ kind, at }: { kind: NightfallAtlasKind; at: string }): NightfallAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "no-api-credential",
      fields: [],
      kind,
      reason:
        "every published operation declares bearerAuth and this installation holds no Nightfall credential, so this kind's records have never been read — only the vendor's declaration of what one looks like. Close it with: slopweaver secrets set nightfall-api-key",
      scope: `${NIGHTFALL_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["workflow-api"],
    }),
    kind,
    surfaces: ["workflow-api"],
  });
}

/**
 * The gap that says the mandatory browser surface has never been opened.
 *
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function nightfallNoConsoleSessionGap({ at }: { at: string }): NightfallAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "no-console-session",
      fields: [],
      kind: "page",
      reason:
        "no page of app.nightfall.ai has been opened, so the browser surface is declared and unfilled: `slopweaver browser cookies --origin https://app.nightfall.ai` reports no cookies in the work Chrome profile, and the Nightfall application JumpCloud configures is a hidden OIDC application for the DLP browser extension rather than a console tile. A sign-in the owner performs unblocks the walk",
      scope: `${NIGHTFALL_ATLAS_PLATFORM}:console`,
      surfaces: ["console"],
    }),
    kind: "page",
    surfaces: ["console"],
  });
}

/**
 * The gap that says a kind can be fetched by id and never listed.
 *
 * MEASURED on the stored generation: `annotation` is reachable only through
 * `GET /annotations/{annotationId}`, so an id has to come from somewhere else — a violation's findings
 * carry `annotationUUID`. A credential would not close this one; only the vendor publishing a list would.
 *
 * @param kind the kind that cannot be enumerated
 * @param via the operation that can nonetheless reach one, named so a reader can act on it
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function nightfallUnenumerableKindGap({
  kind,
  via,
  at,
}: {
  kind: NightfallAtlasKind;
  via: string;
  at: string;
}): NightfallAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "unenumerable-kind",
      fields: [via],
      kind,
      reason: `the vendor publishes no list operation for this kind — ${via} fetches one by id and nothing enumerates them, so even a credentialled channel could only reach records whose ids another kind already carries. A credential does not close this; the vendor publishing a list would`,
      scope: `${NIGHTFALL_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["published-api", "workflow-api"],
    }),
    kind,
    surfaces: ["published-api", "workflow-api"],
  });
}

/**
 * The gap that says the console holds product areas no published document describes.
 *
 * The subjects are the vendor's own help-centre section names, which is a DOCUMENTED denominator rather
 * than an observed one — the distinction the Slack atlas's "reported N, reached one" failure makes
 * necessary. It is a lead for the walk, never a claim that these pages were reached or even exist as
 * routes.
 *
 * @param areas the vendor's own section names, sorted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function nightfallUndocumentedConsoleGap({
  areas,
  at,
}: {
  areas: readonly string[];
  at: string;
}): NightfallAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "undocumented-console-surface",
      fields: [...areas],
      kind: "page",
      reason:
        "the vendor's own help centre documents these product areas and none of the six published API documents declares an operation for any of them, so whatever the console shows there is reachable only by opening it. These are section names the vendor DOCUMENTS, not routes anything has visited — the walk's denominator has to come from the console itself",
      scope: `${NIGHTFALL_ATLAS_PLATFORM}:console`,
      surfaces: ["published-api", "console"],
    }),
    kind: "page",
    surfaces: ["published-api", "console"],
  });
}

/**
 * The gap that says a record points at something no published operation can name.
 *
 * MEASURED across all six documents, and it is this atlas's best finding. A `Violation` declares
 * `detectionRuleUUIDs`, `detectorUUIDs` and `policyUUIDs`; a `Finding` declares `detectorUUID` and
 * `subDetectorUUID`; an exfiltration and a posture event each declare `policyUUIDs`. **No path in any of
 * the six documents lists policies, detection rules or detectors.** Reproduce it:
 *
 * ```bash
 * grep -hoE '^  "/[^"]*"' <spec-dir>/*.yaml | grep -iE 'polic|detect|rule'   # returns nothing
 * ```
 *
 * So the API can tell you that a violation fired and cannot tell you WHICH RULE fired it. That is exactly
 * the class of thing an atlas exists to reveal, and it is unactionable through the API at all: only the
 * console resolves those identifiers, which is a second, independent reason the browser surface here is
 * mandatory rather than a completeness ritual.
 *
 * @param kind the kind whose records carry the dangling references
 * @param references the field names that carry them, sorted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function nightfallUnresolvableReferenceGap({
  kind,
  references,
  at,
}: {
  kind: NightfallAtlasKind;
  references: readonly string[];
  at: string;
}): NightfallAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "unresolvable-reference",
      fields: [...references],
      kind,
      reason: `records of this kind reference ${references.join(", ")}, and no operation in any of the vendor's six published documents lists policies, detection rules or detectors — so the API can say that something fired without saying which rule fired it. Only the console resolves these identifiers, which is an independent reason the browser surface is mandatory here`,
      scope: `${NIGHTFALL_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["published-api", "console"],
    }),
    kind,
    surfaces: ["published-api", "console"],
  });
}
