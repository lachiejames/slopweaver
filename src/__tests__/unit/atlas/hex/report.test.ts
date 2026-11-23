import { describe, expect, it } from "vitest";

import { HEX_CLIENT_SURFACE } from "../../../../atlas/hex/generated/clientSurface.js";
import type { HexAtlasEntity, HexAtlasKindFile } from "../../../../atlas/hex/model.js";
import { reportHexDisagreements, undeclaredGraphqlOperations, undeclaredNouns } from "../../../../atlas/hex/report.js";
import { declaredPathsFrom } from "../../../../cli/commands/hexAtlas/reportRun.js";

const AT = "2026-09-07T02:00:00.000Z";

/** One method entity carrying whichever channels a caller names. */
function entity({
  providerId,
  api,
  browser,
}: {
  providerId: string;
  api?: Record<string, unknown>;
  browser?: Record<string, unknown>;
}): HexAtlasEntity {
  const look = ({ channel, detail }: { channel: "api" | "browser"; detail: Record<string, unknown> }) => ({
    channel,
    detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: [],
      channel,
      deepLink: null,
      deepLinkStatus: "unavailable" as const,
      endpoint: providerId,
      observedAt: AT,
    },
    state: "observed" as const,
  });
  return {
    channels: {
      api: api === undefined ? null : look({ channel: "api", detail: api }),
      browser: browser === undefined ? null : look({ channel: "browser", detail: browser }),
    },
    id: providerId,
    kind: "method",
    providerId,
  };
}

/** A method kind file holding whichever entities a caller names. */
function methodFile({ entities }: { entities: readonly HexAtlasEntity[] }): HexAtlasKindFile {
  return {
    coverage: [],
    entities: [...entities],
    gaps: [],
    kind: "method",
    platform: "hex",
    schemaVersion: 1,
    updatedAt: AT,
  };
}

describe("finding the nouns the router mounts that the document does not declare", () => {
  it("names a mounted noun no declared path sits under", () => {
    const found = undeclaredNouns({ declaredPaths: ["/v1/projects", "/v1/cells/{cellId}"] });

    expect(found.some((row) => row.providerId === "suggestions")).toBe(true);
    expect(found.some((row) => row.providerId === "projects")).toBe(false);
  });

  // The document's own key for these two routes is a regular expression, which names neither of the paths
  // it clearly means — so both mounted nouns read as undeclared. That is the finding, not a parse failure.
  it("reports both semantic nouns, because the document's own key names neither", () => {
    const found = undeclaredNouns({ declaredPaths: ["/v1/semantic-(projects|models)/{semanticProjectId}"] });

    expect(found.map((row) => row.providerId)).toContain("semantic-models");
    expect(found.map((row) => row.providerId)).toContain("semantic-projects");
  });
});

describe("finding the client's GraphQL operations the document knows nothing about", () => {
  it("reports every one, because the document declares no GraphQL at all", () => {
    expect(undeclaredGraphqlOperations().length).toBe(HEX_CLIENT_SURFACE.graphqlOperations.length);
    expect(undeclaredGraphqlOperations().every((row) => row.kind === "undeclared-graphql")).toBe(true);
  });
});

describe("reporting where the surfaces disagree", () => {
  // A report over a generation whose browser channel has never been filled must not report every published
  // operation as browser-absent: technically true, and a lie about what was measured.
  it("still produces the anonymous findings with no walk, and says the browser half is unmeasurable", () => {
    const report = reportHexDisagreements({ declaredPaths: ["/v1/projects"], methods: methodFile({ entities: [] }) });

    expect(report.browserKnown).toBe(0);
    expect(report.unmeasurableBecause).toContain("Run `slopweaver atlas hex walk`");
    expect(report.disagreements.some((row) => row.kind === "undeclared-graphql")).toBe(true);
    expect(report.disagreements.some((row) => row.kind === "browser-only")).toBe(false);
  });

  it("names an operation the app called that no anonymous evidence knew", () => {
    const report = reportHexDisagreements({
      declaredPaths: ["/v1/projects"],
      methods: methodFile({
        entities: [entity({ browser: { responseFields: ["id"] }, providerId: "GET /api/v1/undocumented" })],
      }),
    });

    expect(report.disagreements.filter((row) => row.kind === "browser-only").map((row) => row.providerId)).toEqual([
      "GET /api/v1/undocumented",
    ]);
  });

  it("names the fields one channel carries and the other does not", () => {
    const report = reportHexDisagreements({
      declaredPaths: ["/v1/projects"],
      methods: methodFile({
        entities: [
          entity({
            api: { responseFields: ["values", "values[].id"] },
            browser: { fieldsWithheldBecause: null, responseFields: ["values", "values[].archived"] },
            providerId: "GET /v1/projects",
          }),
        ],
      }),
    });
    const divergence = report.disagreements.find((row) => row.kind === "field-divergence")!;

    expect(divergence.fields).toEqual(["values[].archived", "values[].id"]);
  });

  // A withheld row's field list is empty by POLICY. Comparing it would report every declared field as
  // browser-absent, which is the exact "technically true, a lie about what was measured" failure.
  it("excludes a withheld row from the field comparison and counts it instead", () => {
    const report = reportHexDisagreements({
      declaredPaths: ["/v1/cells/{cellId}/output"],
      methods: methodFile({
        entities: [
          entity({
            api: { responseFields: ["columns", "rows"] },
            browser: { fieldsWithheldBecause: "a query result", responseFields: [] },
            providerId: "GET /v1/cells/{cellId}/output",
          }),
        ],
      }),
    });

    expect(report.withheldFromComparison).toBe(1);
    expect(report.disagreements.some((row) => row.kind === "field-divergence")).toBe(false);
  });
});

describe("reading the declared path keys off the store", () => {
  it("takes them from the method rows rather than fetching the document again", () => {
    expect(
      declaredPathsFrom({
        providerIds: ["GET /v1/projects", "POST /v1/projects", "GRAPHQL OrgDetails", "* /api/v1/suggestions"],
      }),
    ).toEqual(["/v1/projects"]);
  });
});
