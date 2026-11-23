/**
 * The atlases whose gap vocabulary is entirely their OWN, with the kit's two conditions left available beside
 * it rather than spread into it.
 *
 * Three shapes live here. Canva, Nightfall and Google Admin raise every condition through a named constructor,
 * so the set of conditions those constructors produce must BE the declared vocabulary. GraphQL Hive and WorkOS
 * build a stored gap by spreading the kit's, which escapes TypeScript's excess-property check, so the strict
 * stored schema is the only thing that would notice the kit growing a field. Hex and Twilio go through
 * `kit/channelGap.ts`, so that module's narrowing is tested here too.
 */
import { describe, expect, it } from "vitest";

import {
  CANVA_GAP_CONDITIONS,
  canvaBrowserOnlyCapabilityGap,
  canvaDeclaredUnusedTagGap,
  canvaGrantableUncallableScopeGap,
  canvaNoCredentialGap,
  canvaNoWebAppWalkGap,
  canvaUndeclaredEntitlementGap,
} from "../../../atlas/canva/gaps.js";
import { canvaAtlasGapSchema } from "../../../atlas/canva/model.js";
import {
  GOOGLE_ADMIN_GAP_CONDITIONS,
  googleAdminAdjacentApiGap,
  googleAdminNoConsoleSessionGap,
  googleAdminNoScopeGap,
  googleAdminObservedInventoryGap,
  googleAdminReadonlyScopeWriteGap,
  googleAdminUndeclaredScopeGap,
} from "../../../atlas/googleAdmin/gaps.js";
import { googleAdminAtlasGapSchema } from "../../../atlas/googleAdmin/model.js";
import { HIVE_GAP_CONDITIONS, openHiveGap } from "../../../atlas/graphqlHive/gaps.js";
import { hiveAtlasGapSchema } from "../../../atlas/graphqlHive/model.js";
import { HEX_GAP_CONDITIONS, openHexGap } from "../../../atlas/hex/gaps.js";
import { hexAtlasGapSchema } from "../../../atlas/hex/model.js";
import { openStoredChannelGap } from "../../../atlas/kit/channelGap.js";
import { KIT_GAP_CONDITIONS, reconcileGaps } from "../../../atlas/kit/gaps.js";
import { stableGapId } from "../../../atlas/kit/identity.js";
import {
  NIGHTFALL_GAP_CONDITIONS,
  nightfallNoConsoleSessionGap,
  nightfallNoCredentialGap,
  nightfallUndocumentedConsoleGap,
  nightfallUnenumerableKindGap,
  nightfallUnresolvableReferenceGap,
} from "../../../atlas/nightfall/gaps.js";
import { nightfallAtlasGapSchema } from "../../../atlas/nightfall/model.js";
import { openTwilioGap, TWILIO_GAP_CONDITIONS } from "../../../atlas/twilio/gaps.js";
import { twilioAtlasGapSchema } from "../../../atlas/twilio/model.js";
import { openWorkosGap, WORKOS_GAP_CONDITIONS } from "../../../atlas/workos/gaps.js";
import { workosAtlasGapSchema } from "../../../atlas/workos/model.js";
import { unwrap } from "../../../lib/result.js";

const AT = "2026-09-30T01:00:00.000Z";
const LATER = "2026-10-01T01:00:00.000Z";
const REASON = "raised by the vocabulary test";

const OWN_VOCABULARIES: readonly { readonly platform: string; readonly vocabulary: readonly string[] }[] = [
  { platform: "canva", vocabulary: CANVA_GAP_CONDITIONS },
  { platform: "google-admin", vocabulary: GOOGLE_ADMIN_GAP_CONDITIONS },
  { platform: "graphql-hive", vocabulary: HIVE_GAP_CONDITIONS },
  { platform: "hex", vocabulary: HEX_GAP_CONDITIONS },
  { platform: "nightfall", vocabulary: NIGHTFALL_GAP_CONDITIONS },
  { platform: "twilio", vocabulary: TWILIO_GAP_CONDITIONS },
  { platform: "workos", vocabulary: WORKOS_GAP_CONDITIONS },
];

describe("a vocabulary of the platform's own", () => {
  it("covers every platform in this family", () => {
    expect(OWN_VOCABULARIES.length).toBeGreaterThan(0);
    expect(OWN_VOCABULARIES.map((entry) => entry.platform)).toEqual([
      "canva",
      "google-admin",
      "graphql-hive",
      "hex",
      "nightfall",
      "twilio",
      "workos",
    ]);
  });

  // The kit's two stay available beside these; restating one would be two words for one phenomenon.
  it.each(OWN_VOCABULARIES)("$platform restates none of the kit's conditions", ({ vocabulary }) => {
    expect(vocabulary.filter((condition) => KIT_GAP_CONDITIONS.some((kit) => kit === condition))).toEqual([]);
  });

  it.each(OWN_VOCABULARIES)("$platform names no condition twice", ({ vocabulary }) => {
    expect(new Set(vocabulary).size).toBe(vocabulary.length);
  });
});

/** One named constructor, with the condition and scope it is expected to raise. */
interface NamedConstructor<TGap> {
  readonly name: string;
  readonly build: (input: { at: string }) => TGap;
  readonly condition: string;
  readonly scope: string;
}

/** The fields every named-constructor gap is judged on. */
interface BuiltGap {
  readonly condition: string;
  readonly id: string;
  readonly scope: string;
  readonly status: "open" | "closed";
}

const CANVA_CONSTRUCTORS: readonly NamedConstructor<ReturnType<typeof canvaNoCredentialGap>>[] = [
  {
    build: ({ at }) => canvaNoCredentialGap({ at, kind: "analytics" }),
    condition: "no-integration-credential",
    name: "canvaNoCredentialGap",
    scope: "canva:analytics",
  },
  {
    build: ({ at }) => canvaNoWebAppWalkGap({ at, cookies: 4 }),
    condition: "no-web-app-walk",
    name: "canvaNoWebAppWalkGap",
    scope: "canva:web-app",
  },
  {
    build: ({ at }) => canvaDeclaredUnusedTagGap({ at, tags: ["brands"] }),
    condition: "declared-unused-tag",
    name: "canvaDeclaredUnusedTagGap",
    scope: "canva:published-api",
  },
  {
    build: ({ at }) => canvaGrantableUncallableScopeGap({ at, kind: "analytics", scopes: ["collaboration:event"] }),
    condition: "grantable-uncallable-scope",
    name: "canvaGrantableUncallableScopeGap",
    scope: "canva:analytics",
  },
  {
    build: ({ at }) => canvaUndeclaredEntitlementGap({ at, kind: "analytics", operations: ["createAutofillJob"] }),
    condition: "undeclared-entitlement",
    name: "canvaUndeclaredEntitlementGap",
    scope: "canva:analytics",
  },
  {
    build: ({ at }) =>
      canvaBrowserOnlyCapabilityGap({
        at,
        because: "the API cannot resize a design",
        kind: "analytics",
        operations: ["createDesignResizeJob"],
      }),
    condition: "browser-only-capability",
    name: "canvaBrowserOnlyCapabilityGap",
    scope: "canva:analytics",
  },
];

const NIGHTFALL_CONSTRUCTORS: readonly NamedConstructor<ReturnType<typeof nightfallNoCredentialGap>>[] = [
  {
    build: ({ at }) => nightfallNoCredentialGap({ at, kind: "ai-device" }),
    condition: "no-api-credential",
    name: "nightfallNoCredentialGap",
    scope: "nightfall:ai-device",
  },
  {
    build: ({ at }) => nightfallNoConsoleSessionGap({ at }),
    condition: "no-console-session",
    name: "nightfallNoConsoleSessionGap",
    scope: "nightfall:console",
  },
  {
    build: ({ at }) => nightfallUnenumerableKindGap({ at, kind: "annotation", via: "GET /annotations/{annotationId}" }),
    condition: "unenumerable-kind",
    name: "nightfallUnenumerableKindGap",
    scope: "nightfall:annotation",
  },
  {
    build: ({ at }) => nightfallUndocumentedConsoleGap({ areas: ["Detection rules"], at }),
    condition: "undocumented-console-surface",
    name: "nightfallUndocumentedConsoleGap",
    scope: "nightfall:console",
  },
  {
    build: ({ at }) => nightfallUnresolvableReferenceGap({ at, kind: "ai-device", references: ["policyUUIDs"] }),
    condition: "unresolvable-reference",
    name: "nightfallUnresolvableReferenceGap",
    scope: "nightfall:ai-device",
  },
];

const GOOGLE_ADMIN_CONSTRUCTORS: readonly NamedConstructor<ReturnType<typeof googleAdminNoScopeGap>>[] = [
  {
    build: ({ at }) => googleAdminNoScopeGap({ at, kind: "alertcenter-alerts" }),
    condition: "no-admin-scope",
    name: "googleAdminNoScopeGap",
    scope: "google-admin:alertcenter-alerts",
  },
  {
    build: ({ at }) => googleAdminNoConsoleSessionGap({ at }),
    condition: "no-console-session",
    name: "googleAdminNoConsoleSessionGap",
    scope: "google-admin:admin-console",
  },
  {
    build: ({ at }) => googleAdminObservedInventoryGap({ at, observed: 12, opened: 9 }),
    condition: "console-inventory-is-observed",
    name: "googleAdminObservedInventoryGap",
    scope: "google-admin:admin-console",
  },
  {
    build: ({ at }) =>
      googleAdminUndeclaredScopeGap({ at, kind: "alertcenter-alerts", operations: ["alertcenter.alerts.list"] }),
    condition: "undeclared-scope",
    name: "googleAdminUndeclaredScopeGap",
    scope: "google-admin:alertcenter-alerts",
  },
  {
    build: ({ at }) =>
      googleAdminReadonlyScopeWriteGap({
        at,
        kind: "alertcenter-alerts",
        operations: ["admin.channels.stop"],
        scope: "admin.reports.audit.readonly",
      }),
    condition: "readonly-scope-grants-a-write",
    name: "googleAdminReadonlyScopeWriteGap",
    scope: "google-admin:alertcenter-alerts",
  },
  {
    build: ({ at }) => googleAdminAdjacentApiGap({ apis: ["groupssettings"], at }),
    condition: "adjacent-api-unmapped",
    name: "googleAdminAdjacentApiGap",
    scope: "google-admin:admin-console",
  },
];

/**
 * The sorted conditions a platform's named constructors actually raise.
 *
 * @param constructors the platform's constructor table
 * @returns each built gap's condition, sorted
 */
function raisedConditions({
  constructors,
}: {
  constructors: readonly NamedConstructor<BuiltGap>[];
}): readonly string[] {
  return constructors.map((entry) => entry.build({ at: AT }).condition).toSorted();
}

describe("named gap constructors", () => {
  it("raise exactly Canva's declared vocabulary, one constructor per condition", () => {
    expect(CANVA_CONSTRUCTORS.length).toBeGreaterThan(0);
    expect(raisedConditions({ constructors: CANVA_CONSTRUCTORS })).toEqual([...CANVA_GAP_CONDITIONS].toSorted());
  });

  it("raise exactly Nightfall's declared vocabulary, one constructor per condition", () => {
    expect(NIGHTFALL_CONSTRUCTORS.length).toBeGreaterThan(0);
    expect(raisedConditions({ constructors: NIGHTFALL_CONSTRUCTORS })).toEqual(
      [...NIGHTFALL_GAP_CONDITIONS].toSorted(),
    );
  });

  it("raise exactly Google Admin's declared vocabulary, one constructor per condition", () => {
    expect(GOOGLE_ADMIN_CONSTRUCTORS.length).toBeGreaterThan(0);
    expect(raisedConditions({ constructors: GOOGLE_ADMIN_CONSTRUCTORS })).toEqual(
      [...GOOGLE_ADMIN_GAP_CONDITIONS].toSorted(),
    );
  });

  it.each(CANVA_CONSTRUCTORS)("$name keys on its condition and scope, never on when", ({ build, condition, scope }) => {
    const gap = build({ at: AT });

    expect(gap.condition).toBe(condition);
    expect(gap.scope).toBe(scope);
    expect(gap.status).toBe("open");
    expect(gap.id).toBe(stableGapId({ condition, scope }));
    expect(build({ at: LATER }).id).toBe(gap.id);
    expect(canvaAtlasGapSchema.parse(gap)).toEqual(gap);
  });

  it.each(NIGHTFALL_CONSTRUCTORS)(
    "$name keys on its condition and scope, never on when",
    ({ build, condition, scope }) => {
      const gap = build({ at: AT });

      expect(gap.condition).toBe(condition);
      expect(gap.scope).toBe(scope);
      expect(gap.status).toBe("open");
      expect(gap.id).toBe(stableGapId({ condition, scope }));
      expect(build({ at: LATER }).id).toBe(gap.id);
      expect(nightfallAtlasGapSchema.parse(gap)).toEqual(gap);
    },
  );

  it.each(GOOGLE_ADMIN_CONSTRUCTORS)(
    "$name keys on its condition and scope, never on when",
    ({ build, condition, scope }) => {
      const gap = build({ at: AT });

      expect(gap.condition).toBe(condition);
      expect(gap.scope).toBe(scope);
      expect(gap.status).toBe("open");
      expect(gap.id).toBe(stableGapId({ condition, scope }));
      expect(build({ at: LATER }).id).toBe(gap.id);
      expect(googleAdminAtlasGapSchema.parse(gap)).toEqual(gap);
    },
  );
});

describe("openHiveGap", () => {
  const gap = openHiveGap({
    at: AT,
    condition: HIVE_GAP_CONDITIONS[0],
    kind: "target",
    reason: REASON,
    scope: "graphql-hive:target",
    surfaces: ["api", "browser"],
  });

  it("builds a gap the strict stored schema admits unchanged, so the kit spread carries no stray field", () => {
    expect(hiveAtlasGapSchema.parse(gap)).toEqual(gap);
    expect(gap.fields).toEqual([]);
    expect(gap.surfaces).toEqual(["api", "browser"]);
  });

  it("keys on the kit's stable id, so the kit's reconcile closes it on its own recheck", () => {
    expect(gap.id).toBe(stableGapId({ condition: HIVE_GAP_CONDITIONS[0], scope: "graphql-hive:target" }));
    const reconciled = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: HIVE_GAP_CONDITIONS[0], resolved: true, scope: "graphql-hive:target" }],
        runFailed: false,
        stored: [gap],
      }),
    );

    expect(reconciled[0]!.status).toBe("closed");
  });
});

describe("openWorkosGap", () => {
  const gap = openWorkosGap({
    at: AT,
    condition: WORKOS_GAP_CONDITIONS[0],
    kind: "organization",
    reason: REASON,
    scope: "workos:organization",
    surfaces: ["api"],
  });

  it("builds a gap the strict stored schema admits unchanged, so the kit spread carries no stray field", () => {
    expect(workosAtlasGapSchema.parse(gap)).toEqual(gap);
    expect(gap.fields).toEqual([]);
    expect(gap.surfaces).toEqual(["api"]);
  });

  it("keys on the kit's stable id, so the kit's reconcile closes it on its own recheck", () => {
    expect(gap.id).toBe(stableGapId({ condition: WORKOS_GAP_CONDITIONS[0], scope: "workos:organization" }));
    const reconciled = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: WORKOS_GAP_CONDITIONS[0], resolved: true, scope: "workos:organization" }],
        runFailed: false,
        stored: [gap],
      }),
    );

    expect(reconciled[0]!.status).toBe("closed");
  });
});

describe("openStoredChannelGap", () => {
  it("narrows the kit's gap into a channelled atlas's stored shape, stamped and keyed on the stable id", () => {
    const gap = openStoredChannelGap({
      at: AT,
      condition: "api-browser-disagreement",
      fields: ["title"],
      kind: "project",
      reason: REASON,
      scope: "hex:project/abc",
      surfaces: ["api", "browser"],
    });

    expect(gap).toEqual({
      condition: "api-browser-disagreement",
      fields: ["title"],
      firstDetectedAt: AT,
      id: stableGapId({ condition: "api-browser-disagreement", scope: "hex:project/abc" }),
      kind: "project",
      lastCheckedAt: AT,
      lastDetectedAt: AT,
      reason: REASON,
      scope: "hex:project/abc",
      status: "open",
      surfaces: ["api", "browser"],
    });
  });

  it("copies the caller's arrays, so a later push to them cannot reach the stored gap", () => {
    const fields = ["title"];
    const surfaces: ("api" | "browser")[] = ["api"];
    const gap = openStoredChannelGap({
      at: AT,
      condition: "c",
      fields,
      kind: null,
      reason: REASON,
      scope: "s",
      surfaces,
    });
    fields.push("owner");
    surfaces.push("browser");

    expect(gap.fields).toEqual(["title"]);
    expect(gap.surfaces).toEqual(["api"]);
  });
});

describe("openHexGap", () => {
  const input = {
    at: AT,
    condition: HEX_GAP_CONDITIONS[0],
    fields: [],
    kind: "project",
    reason: REASON,
    scope: "hex:project",
    surfaces: ["api"],
  } as const;
  const gap = openHexGap(input);

  it("is exactly the kit's channel gap, and the strict stored schema admits it unchanged", () => {
    expect(gap).toEqual(openStoredChannelGap(input));
    expect(hexAtlasGapSchema.parse(gap)).toEqual(gap);
  });

  it("closes through the kit's reconcile on a recheck of its own condition and scope", () => {
    const reconciled = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: HEX_GAP_CONDITIONS[0], resolved: true, scope: "hex:project" }],
        runFailed: false,
        stored: [gap],
      }),
    );

    expect(reconciled[0]!.status).toBe("closed");
    expect(reconciled[0]!.lastCheckedAt).toBe(LATER);
  });
});

describe("openTwilioGap", () => {
  const input = {
    at: AT,
    condition: TWILIO_GAP_CONDITIONS[0],
    fields: [],
    kind: "account",
    reason: REASON,
    scope: "twilio:account",
    surfaces: ["browser"],
  } as const;
  const gap = openTwilioGap(input);

  it("is exactly the kit's channel gap, and the strict stored schema admits it unchanged", () => {
    expect(gap).toEqual(openStoredChannelGap(input));
    expect(twilioAtlasGapSchema.parse(gap)).toEqual(gap);
  });

  it("closes through the kit's reconcile on a recheck of its own condition and scope", () => {
    const reconciled = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: TWILIO_GAP_CONDITIONS[0], resolved: true, scope: "twilio:account" }],
        runFailed: false,
        stored: [gap],
      }),
    );

    expect(reconciled[0]!.status).toBe("closed");
    expect(reconciled[0]!.lastCheckedAt).toBe(LATER);
  });
});
