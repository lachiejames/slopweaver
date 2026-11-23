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

import { GOOGLE_ADMIN_ATLAS_PLATFORM, type GoogleAdminAtlasGap, type GoogleAdminAtlasKind } from "./model.js";

/**
 * The conditions this atlas can raise about itself.
 *
 * - `no-admin-scope` — the Admin APIs are published, declared and unreachable, because this installation's
 *   Google grant carries no administrator scope.
 * - `no-console-session` — the console has never been opened, so the mandatory browser surface is unfilled
 *   and no page's existence has been confirmed by looking at it.
 * - `undeclared-scope` — Google publishes the method with an EMPTY `scopes` array, so an OAuth caller
 *   cannot learn from the document what to ask for. This is a property of the vendor's own publication
 *   rather than of this installation's access, and it is exactly the kind of thing an atlas exists to
 *   surface.
 * - `readonly-scope-grants-a-write` — a method that creates or deletes stored configuration declares ONLY
 *   a `.readonly` scope. The sharpest finding the build produced, and the reason `dispositions.ts` refuses
 *   to derive read-versus-write from the declared scope.
 * - `adjacent-api-unmapped` — an API the Admin console renders a settings page for, which the selection
 *   criterion did not select. `apiSelection.ts` carries the criterion and the reason for each.
 * - `console-inventory-is-observed` — the walk's denominator came from the console's own links rather than
 *   from a published route inventory, because Google publishes none. So the page list is a floor and never
 *   a total, and this gap is PERMANENT: a route no visited page linked to cannot be detected from inside
 *   the walk at all.
 * @internal
 */
export const GOOGLE_ADMIN_GAP_CONDITIONS = [
  "no-admin-scope",
  "no-console-session",
  "undeclared-scope",
  "readonly-scope-grants-a-write",
  "adjacent-api-unmapped",
  "console-inventory-is-observed",
] as const;

/**
 * One condition this atlas can raise.
 * @internal
 */
export type GoogleAdminGapCondition = (typeof GOOGLE_ADMIN_GAP_CONDITIONS)[number];

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
  kind: GoogleAdminAtlasKind | null;
  surfaces: readonly ("discovery" | "admin-api" | "admin-console")[];
}): GoogleAdminAtlasGap {
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
 * atlas hold about Chrome devices" reads that kind's file, and a cross-kind gap filed somewhere else is a
 * gap that reader never sees.
 *
 * @param kind the kind this gap is about
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function googleAdminNoScopeGap({ kind, at }: { kind: GoogleAdminAtlasKind; at: string }): GoogleAdminAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "no-admin-scope",
      fields: [],
      kind,
      reason:
        "every method here is gated by a Workspace administrator scope and this installation's grant carries none that reach this kind, so its records have never been read — only Google's declaration of what one looks like. Check what is granted with `slopweaver atlas google-admin connect --status`, widen it with `slopweaver atlas google-admin connect`, then read with `slopweaver atlas google-admin fill`",
      scope: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["admin-api"],
    }),
    kind,
    surfaces: ["admin-api"],
  });
}

/**
 * The gap that says the console has never been opened.
 *
 * MEASURED, and kept because the measurement is a property of the platform rather than of one run. The work Chrome profile was signed in and Google still demanded a password before rendering a
 * single console page. That is the Admin console's own step-up reauthentication, and every future walk has
 * to plan around it: a signed-in profile is not a walkable console.
 *
 * The owner clears it by signing in themselves, after which the walk runs, so this gap is raised only when a generation
 * carries no walk at all.
 *
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function googleAdminNoConsoleSessionGap({ at }: { at: string }): GoogleAdminAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "no-console-session",
      fields: [],
      kind: "page",
      reason:
        "no page of admin.google.com has been opened, so the browser surface is declared and unfilled. The Admin console answers even a signed-in profile with Google's own step-up reauthentication — a password challenge before it renders anything — and nothing here may enter a password. Being signed in is therefore not enough, so check this install's own state rather than assuming it: `slopweaver browser cookies --origin https://admin.google.com` says whether a session exists at all. One reauthentication the owner performs unblocks the walk, and `slopweaver atlas google-admin walk` then prints the brief",
      scope: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:admin-console`,
      surfaces: ["admin-console"],
    }),
    kind: "page",
    surfaces: ["admin-console"],
  });
}

/**
 * The gap that says the walked page list is a floor rather than a total.
 *
 * Google publishes no route inventory for the Admin console and no sitemap carrying one, so a walk's
 * denominator can only be the console's own links. That makes this gap PERMANENT rather than a thing to
 * close: a route no visited page linked to cannot be detected from inside the walk, so the atlas can say
 * how many routes it has SEEN and can never say how many exist.
 *
 * @param observed how many distinct routes the walk saw linked
 * @param opened how many of them it actually opened
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function googleAdminObservedInventoryGap({
  observed,
  opened,
  at,
}: {
  observed: number;
  opened: number;
  at: string;
}): GoogleAdminAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "console-inventory-is-observed",
      fields: [],
      kind: "page",
      reason: `the walk saw ${observed} distinct route(s) linked and opened ${opened} of them, and that denominator came from the console's own links because Google publishes no route inventory for it. So this page list is a FLOOR and never a total — a route no opened page linked to cannot be detected from inside the walk. This gap is permanent by construction rather than a thing to close, and it is what stops a reader taking the count as completeness`,
      scope: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:admin-console`,
      surfaces: ["admin-console"],
    }),
    kind: "page",
    surfaces: ["admin-console"],
  });
}

/**
 * The gap that says Google publishes a method without saying what to ask for.
 *
 * MEASURED: nineteen of the 336 methods carry an empty `scopes` array — every
 * `chromemanagement` connector-config, certificate-provisioning and long-running-operation method, and
 * every `cloudidentity` user-invitation method. A caller reading the document alone cannot construct a
 * consent request for any of them. Reproduce it:
 *
 * ```bash
 * grep -c '"scopes":\[\]' src/atlas/googleAdmin/generated/surfaces.ts
 * ```
 *
 * @param kind the kind holding the scopeless methods
 * @param operations the method names that declare none, sorted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function googleAdminUndeclaredScopeGap({
  kind,
  operations,
  at,
}: {
  kind: GoogleAdminAtlasKind;
  operations: readonly string[];
  at: string;
}): GoogleAdminAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "undeclared-scope",
      fields: [...operations],
      kind,
      reason: `Google publishes ${operations.length} method(s) here with an empty scopes array, so a caller reading the discovery document alone cannot learn what consent to request. This is unactionable through the API and closes only if Google publishes the scope — the console is what reaches these surfaces today`,
      scope: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["discovery", "admin-api"],
    }),
    kind,
    surfaces: ["discovery", "admin-api"],
  });
}

/**
 * The gap that says a `.readonly` scope grants a write.
 *
 * MEASURED, and this atlas's best finding. Three methods do it.
 * `chromemanagement.customers.telemetry.notificationConfigs.create` and `.delete` create and delete stored
 * configuration while declaring exactly one scope, `chrome.management.telemetry.readonly`. And
 * `admin.channels.stop` — which deletes a push-notification channel — declares only
 * `admin.reports.audit.readonly` in `admin.reports_v1`, while the SAME method in `admin.directory_v1`
 * declares writeable scopes beside its readonly ones and so does not fire this gap at all.
 *
 * That asymmetry between two copies of one method is worth its own sentence: it is the same finding as
 * `surfaceNaming.ts`'s provider-key measurement seen from the other side, and an atlas that keyed on the
 * method id alone would have had to pick one of the two scope sets and lose the other.
 *
 * An administrator granting a readonly-sounding scope believing it cannot write is granting more than they
 * think. It is also why `dispositions.ts` derives read-versus-write from the HTTP method and a named table
 * rather than from the declared scope.
 *
 * @param kind the kind holding them
 * @param operations the method names, sorted
 * @param scope the readonly scope they declare
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function googleAdminReadonlyScopeWriteGap({
  kind,
  operations,
  scope,
  at,
}: {
  kind: GoogleAdminAtlasKind;
  operations: readonly string[];
  scope: string;
  at: string;
}): GoogleAdminAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "readonly-scope-grants-a-write",
      fields: [...operations],
      kind,
      reason: `these method(s) create or delete stored configuration while declaring only ${scope} — a scope whose name says it cannot write. An administrator granting it believing it read-only grants more than they think. Nothing here closes this: it is a fact about what Google publishes, recorded so a reader planning a grant sees it`,
      scope: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:${kind}`,
      surfaces: ["discovery", "admin-api"],
    }),
    kind,
    surfaces: ["discovery", "admin-api"],
  });
}

/**
 * The gap that says the Admin console renders pages this atlas mapped no API for.
 *
 * Filed against `page` because it is a statement about the console surface rather than about any resource
 * kind. `apiSelection.ts` carries the criterion that excluded each one and the cost of doing so.
 *
 * @param apis the adjacent API names whose console page is unmapped, sorted
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function googleAdminAdjacentApiGap({ apis, at }: { apis: readonly string[]; at: string }): GoogleAdminAtlasGap {
  return toStoredGap({
    gap: openGap({
      at,
      condition: "adjacent-api-unmapped",
      fields: [...apis],
      kind: "page",
      reason:
        "the Admin console renders a settings page for each of these, and the selection criterion in apiSelection.ts did not select their API because each declares an end-user scope alongside its administrator one. The console half of these pages is still in scope for the walk; their API half is not mapped. Widening the criterion there is the fix, never bolting a document onto the pin list",
      scope: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:admin-console`,
      surfaces: ["discovery", "admin-console"],
    }),
    kind: "page",
    surfaces: ["discovery", "admin-console"],
  });
}
