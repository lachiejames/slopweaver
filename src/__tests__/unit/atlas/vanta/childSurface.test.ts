import { describe, expect, it } from "vitest";

import { VANTA_CHILD_FAMILIES } from "../../../../atlas/vanta/childCensus.js";
import { projectVantaChildRow } from "../../../../atlas/vanta/childProjection.js";
import { vantaChildEndpoint } from "../../../../atlas/vanta/childSurface.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const RESOURCES_PATH = "/v1/integrations/{integrationId}/resource-kinds/{resourceKind}/resources";

/** The filled path alone, for the cases whose subject is how the template is filled. */
const pathFor = ({ parentId, specPath }: { parentId: string; specPath: string }): string =>
  unwrap(vantaChildEndpoint({ parentId, specPath })).path;

describe("vantaChildEndpoint", () => {
  it("answers one unfiltered GET, so the pagination walk owns every query parameter", () => {
    expect(unwrap(vantaChildEndpoint({ parentId: "v1", specPath: "/v1/vendors/{vendorId}/assessments" }))).toEqual({
      fixedQuery: {},
      method: "GET",
      path: "/v1/vendors/v1/assessments",
    });
  });

  it("percent-encodes an id that would otherwise change the shape of the path", () => {
    expect(pathFor({ parentId: "a/b", specPath: "/v1/vendors/{vendorId}/documents" })).toBe(
      "/v1/vendors/a%2Fb/documents",
    );
  });

  it("keeps a colon inside a ONE-parameter parent's id rather than splitting it", () => {
    expect(pathFor({ parentId: "a:b", specPath: "/v1/vendors/{vendorId}/documents" })).toBe(
      "/v1/vendors/a%3Ab/documents",
    );
  });

  it("fills two parameters from the two halves of a fan-out parent's own id, in order", () => {
    expect(pathFor({ parentId: "gcp:GCPRoleGrant", specPath: RESOURCES_PATH })).toBe(
      "/v1/integrations/gcp/resource-kinds/GCPRoleGrant/resources",
    );
  });

  it("fills the two parameters from exactly the id the parent kind's projection writes", () => {
    const parent = projectVantaChildRow({
      at: "2026-09-30T00:00:00.000Z",
      dto: {
        canUpdateDescription: false,
        canUpdateOwner: true,
        integrationId: "aws",
        isScopable: true,
        resourceKind: "AwsRole",
      },
      family: VANTA_CHILD_FAMILIES["integration-resource-kind"],
      parentId: "aws",
      surface: VANTA_CHILD_FAMILIES["integration-resource-kind"].surfaces[0]!,
    });
    expect(pathFor({ parentId: parent.providerId, specPath: RESOURCES_PATH })).toBe(
      "/v1/integrations/aws/resource-kinds/AwsRole/resources",
    );
  });

  it("refuses an id whose part count is not the template's parameter count, rather than mis-filling it", () => {
    expect(unwrapErr(vantaChildEndpoint({ parentId: "gcp", specPath: RESOURCES_PATH }))).toEqual([
      `parent id gcp has 1 ":"-separated part(s) and ${RESOURCES_PATH} has 2 parameter(s)`,
    ]);
    expect(unwrapErr(vantaChildEndpoint({ parentId: "a:b:c", specPath: RESOURCES_PATH }))).toEqual([
      `parent id a:b:c has 3 ":"-separated part(s) and ${RESOURCES_PATH} has 2 parameter(s)`,
    ]);
  });

  it("refuses a template with no parameter at all", () => {
    expect(unwrapErr(vantaChildEndpoint({ parentId: "x", specPath: "/v1/vendors" }))).toEqual([
      "/v1/vendors declares no path parameter for parent x to fill",
    ]);
  });
});
