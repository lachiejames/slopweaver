import { describe, expect, it } from "vitest";

import type { InngestDashboardRoute } from "../../../../atlas/inngest/dashboardRoutes.js";
import { openInngestGap } from "../../../../atlas/inngest/gaps.js";
import { INNGEST_OPERATION_KIND, INNGEST_PAGE_KIND } from "../../../../atlas/inngest/model.js";
import type { InngestProbeOutcome } from "../../../../atlas/inngest/projection.js";
import type { InngestCatalogueOperation } from "../../../../atlas/inngest/restCatalogue.js";
import { CREDENTIAL_REMEDY, dashboardGaps, restGaps } from "../../../../atlas/inngest/syncGaps.js";

const AT = "2026-10-11T04:05:06.000Z";

/**
 * One catalogue operation whose every field is a distinct sentinel derived from its own id.
 */
function operation({ operationId, version }: { operationId: string; version: "v1" | "v2" }): InngestCatalogueOperation {
  return {
    description: `description of ${operationId}`,
    group: `group of ${operationId}`,
    operationId,
    referenceUrl: `https://api-docs.example.test/${version}/${operationId}`,
    title: `title of ${operationId}`,
    version,
  };
}

/**
 * One dashboard route.
 */
function route({
  routePath,
  section,
  parameterised,
}: {
  routePath: string;
  section: string;
  parameterised: boolean;
}): InngestDashboardRoute {
  return { parameterised, routePath, section };
}

const ALPHA = operation({ operationId: "Alpha", version: "v1" });
const BETA = operation({ operationId: "Beta", version: "v2" });

describe("CREDENTIAL_REMEDY", () => {
  it("names the secrets command and the REST client clause exactly", () => {
    expect(CREDENTIAL_REMEDY).toBe(
      "an Inngest API credential scoped to this account, stored through `slopweaver secrets set`, and a REST " +
        "client landed against it — a widening of credential access rather than a piece of work",
    );
  });
});

describe("restGaps", () => {
  it("returns nothing when no mirror is broken, v2 discriminates and no operation is absent", () => {
    const outcomes = new Map<string, InngestProbeOutcome>([
      ["v1 Alpha", { evidence: "exists-auth-required", note: "alpha answered 401" }],
      ["v2 Beta", { evidence: "exists-method-not-allowed", note: "beta answered 405" }],
    ]);

    expect(
      restGaps({
        at: AT,
        brokenMirrors: [],
        operations: [ALPHA, BETA],
        outcomes,
        v2ControlAgrees: false,
        v2Note: "v2 note that must not surface",
      }),
    ).toEqual([]);
  });

  it("returns nothing for every evidence value that is not a 404, and for an operation never probed", () => {
    const evidences = [
      "exists-auth-required",
      "exists-method-not-allowed",
      "exists-unauthenticated",
      "exists-sign-in-redirect",
      "unprobeable-control-agrees",
      "unprobeable-parameterised",
      "unprobeable-mutating",
      "probe-failed",
    ] as const;
    const operations = [
      ...evidences.map((evidence) => operation({ operationId: `Op-${evidence}`, version: "v1" })),
      operation({ operationId: "NeverProbed", version: "v2" }),
    ];
    const outcomes = new Map<string, InngestProbeOutcome>([
      ...evidences.map((evidence): [string, InngestProbeOutcome] => [
        `v1 Op-${evidence}`,
        { evidence, note: `note for ${evidence}` },
      ]),
      ["NeverProbed", { evidence: "absent-404", note: "wrong-key sentinel for NeverProbed" }],
      ["v1 NeverProbed", { evidence: "absent-404", note: "wrong-version sentinel for NeverProbed" }],
    ]);

    expect(
      restGaps({ at: AT, brokenMirrors: [], operations, outcomes, v2ControlAgrees: false, v2Note: "unused" }),
    ).toEqual([]);
  });

  it("orders the broken-mirror gap, then the v2 gap, then only the operation whose address answered 404", () => {
    const outcomes = new Map<string, InngestProbeOutcome>([
      ["v1 Alpha", { evidence: "exists-auth-required", note: "alpha note that must not surface" }],
      ["v2 Beta", { evidence: "absent-404", note: "GET https://api.example.test/v2/betas answered 404" }],
      ["Beta", { evidence: "exists-unauthenticated", note: "wrong-key sentinel keyed by operation id only" }],
      ["v1 Beta", { evidence: "absent-404", note: "wrong-key sentinel keyed by the wrong version" }],
    ]);

    const gaps = restGaps({
      at: AT,
      brokenMirrors: [
        "https://mirror-one.example.test/page.md (500)",
        "https://mirror-two.example.test/llms-full.txt (503)",
      ],
      operations: [ALPHA, BETA],
      outcomes,
      v2ControlAgrees: true,
      v2Note: "/v2/zzz answered 401 authorization_header_missing and /v2/apps answered the same",
    });

    expect(gaps).toEqual([
      openInngestGap({
        at: AT,
        condition: "vendor-document-errors",
        fields: [],
        kind: INNGEST_OPERATION_KIND,
        reason:
          "Inngest's API reference serves its operation catalogue but answers HTTP 500 for " +
          "https://mirror-one.example.test/page.md (500), https://mirror-two.example.test/llms-full.txt (503) — " +
          "the markdown mirror its own client bundle asks for. So no machine-readable source states any " +
          "operation's HTTP method or path template, and this atlas records neither rather than inferring " +
          "them from an operation's title",
        scope: "api-docs.inngest.com markdown mirror",
        surfaces: ["compiled"],
      }),
      openInngestGap({
        at: AT,
        condition: "rest-route-unprobeable",
        fields: [],
        kind: INNGEST_OPERATION_KIND,
        reason:
          "the v2 REST surface authenticates before it routes, so no unauthenticated request can establish " +
          "whether a v2 address exists. Observed this run: /v2/zzz answered 401 authorization_header_missing " +
          "and /v2/apps answered the same. Closed only by an Inngest API credential scoped to this account, " +
          "stored through `slopweaver secrets set`, and a REST client landed against it — a widening of " +
          "credential access rather than a piece of work",
        scope: "api.inngest.com /v2",
        surfaces: ["compiled"],
      }),
      openInngestGap({
        at: AT,
        condition: "rest-route-absent",
        fields: [],
        kind: INNGEST_OPERATION_KIND,
        reason:
          "the reviewed address for v2 Beta answered 404 while this surface's controls discriminate, so the " +
          "reviewed binding in restAddresses.ts is wrong. GET https://api.example.test/v2/betas answered 404",
        scope: "v2 Beta",
        surfaces: ["compiled"],
      }),
    ]);
  });

  it("emits one absent gap per 404 operation, in operation order, each carrying its own note", () => {
    const outcomes = new Map<string, InngestProbeOutcome>([
      ["v2 Beta", { evidence: "absent-404", note: "beta note" }],
      ["v1 Alpha", { evidence: "absent-404", note: "alpha note" }],
    ]);

    const gaps = restGaps({
      at: AT,
      brokenMirrors: [],
      operations: [ALPHA, BETA],
      outcomes,
      v2ControlAgrees: false,
      v2Note: "unused",
    });

    expect(gaps).toEqual([
      openInngestGap({
        at: AT,
        condition: "rest-route-absent",
        fields: [],
        kind: INNGEST_OPERATION_KIND,
        reason:
          "the reviewed address for v1 Alpha answered 404 while this surface's controls discriminate, so the " +
          "reviewed binding in restAddresses.ts is wrong. alpha note",
        scope: "v1 Alpha",
        surfaces: ["compiled"],
      }),
      openInngestGap({
        at: AT,
        condition: "rest-route-absent",
        fields: [],
        kind: INNGEST_OPERATION_KIND,
        reason:
          "the reviewed address for v2 Beta answered 404 while this surface's controls discriminate, so the " +
          "reviewed binding in restAddresses.ts is wrong. beta note",
        scope: "v2 Beta",
        surfaces: ["compiled"],
      }),
    ]);
  });

  it("opens only the broken-mirror gap when v2 discriminates and nothing is absent", () => {
    const gaps = restGaps({
      at: AT,
      brokenMirrors: ["https://only-mirror.example.test/page.md (500)"],
      operations: [],
      outcomes: new Map(),
      v2ControlAgrees: false,
      v2Note: "unused",
    });

    expect(gaps).toEqual([
      openInngestGap({
        at: AT,
        condition: "vendor-document-errors",
        fields: [],
        kind: INNGEST_OPERATION_KIND,
        reason:
          "Inngest's API reference serves its operation catalogue but answers HTTP 500 for " +
          "https://only-mirror.example.test/page.md (500) — " +
          "the markdown mirror its own client bundle asks for. So no machine-readable source states any " +
          "operation's HTTP method or path template, and this atlas records neither rather than inferring " +
          "them from an operation's title",
        scope: "api-docs.inngest.com markdown mirror",
        surfaces: ["compiled"],
      }),
    ]);
  });
});

describe("dashboardGaps", () => {
  const ROUTES = [
    route({ parameterised: false, routePath: "/alpha", section: "alpha-section" }),
    route({ parameterised: true, routePath: "/env/$envSlug/runs", section: "env" }),
    route({ parameterised: false, routePath: "/gone", section: "gone-section" }),
    route({ parameterised: false, routePath: "/broken", section: "broken-section" }),
    route({ parameterised: false, routePath: "/redirect", section: "redirect-section" }),
    route({ parameterised: false, routePath: "/auth", section: "auth-section" }),
    route({ parameterised: false, routePath: "/method", section: "method-section" }),
    route({ parameterised: false, routePath: "/open", section: "open-section" }),
    route({ parameterised: false, routePath: "/mutating", section: "mutating-section" }),
    route({ parameterised: false, routePath: "/never-probed", section: "never-probed-section" }),
  ];

  const OUTCOMES = new Map<string, InngestProbeOutcome>([
    ["/alpha", { evidence: "unprobeable-control-agrees", note: "control answered the same sign-in redirect" }],
    ["/env/$envSlug/runs", { evidence: "unprobeable-parameterised", note: "no concrete address exists" }],
    ["/gone", { evidence: "absent-404", note: "GET /gone answered 404" }],
    ["/broken", { evidence: "probe-failed", note: "GET /broken answered 502" }],
    ["/redirect", { evidence: "exists-sign-in-redirect", note: "redirect note that must not surface" }],
    ["/auth", { evidence: "exists-auth-required", note: "auth note that must not surface" }],
    ["/method", { evidence: "exists-method-not-allowed", note: "method note that must not surface" }],
    ["/open", { evidence: "exists-unauthenticated", note: "open note that must not surface" }],
    ["/mutating", { evidence: "unprobeable-mutating", note: "mutating note that must not surface" }],
    // wrong-key sentinels: a lookup by section or by an unslashed path would surface these
    ["never-probed-section", { evidence: "absent-404", note: "wrong-key sentinel keyed by section" }],
    ["never-probed", { evidence: "probe-failed", note: "wrong-key sentinel keyed by an unslashed path" }],
    ["alpha-section", { evidence: "probe-failed", note: "wrong-key sentinel keyed by the alpha section" }],
    ["env", { evidence: "absent-404", note: "wrong-key sentinel keyed by the env section" }],
  ]);

  it("returns the complete ordered gaps for unprobeable, absent and failed routes and none for the rest", () => {
    expect(dashboardGaps({ at: AT, outcomes: OUTCOMES, routes: ROUTES })).toEqual([
      openInngestGap({
        at: AT,
        condition: "dashboard-route-unprobeable",
        fields: [],
        kind: INNGEST_PAGE_KIND,
        reason:
          "/alpha is declared by the application's own route table and its existence cannot be established " +
          "without signing in. control answered the same sign-in redirect. Closed by: slopweaver atlas inngest walk",
        scope: "/alpha",
        surfaces: ["compiled"],
      }),
      openInngestGap({
        at: AT,
        condition: "dashboard-route-unprobeable",
        fields: [],
        kind: INNGEST_PAGE_KIND,
        reason:
          "/env/$envSlug/runs is declared by the application's own route table and its existence cannot be " +
          "established without signing in. no concrete address exists. Closed by: slopweaver atlas inngest walk",
        scope: "/env/$envSlug/runs",
        surfaces: ["compiled"],
      }),
      openInngestGap({
        at: AT,
        condition: "dashboard-route-absent",
        fields: [],
        kind: INNGEST_PAGE_KIND,
        reason: "/gone is declared by the application's own route table and answered 404. GET /gone answered 404",
        scope: "/gone",
        surfaces: ["compiled"],
      }),
      openInngestGap({
        at: AT,
        condition: "dashboard-route-errors",
        fields: [],
        kind: INNGEST_PAGE_KIND,
        reason: "/broken answered a server error rather than a page or a sign-in wall. GET /broken answered 502",
        scope: "/broken",
        surfaces: ["compiled"],
      }),
    ]);
  });

  it("returns nothing when no route has an outcome under its own path", () => {
    expect(
      dashboardGaps({
        at: AT,
        outcomes: new Map<string, InngestProbeOutcome>([
          ["alpha-section", { evidence: "absent-404", note: "wrong-key sentinel" }],
        ]),
        routes: [route({ parameterised: false, routePath: "/alpha", section: "alpha-section" })],
      }),
    ).toEqual([]);
  });

  it("returns nothing for no routes", () => {
    expect(dashboardGaps({ at: AT, outcomes: OUTCOMES, routes: [] })).toEqual([]);
  });
});
