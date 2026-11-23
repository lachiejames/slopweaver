/**
 * The closed request builder: every write's exact method, URL and body, and the refusals that keep a name, a
 * page token or an operation name from reaching a URL it was not built for.
 */
import { describe, expect, it } from "vitest";

import { buildGcpDoorRequest, type GcpDoorRequest } from "../../../gcp/request.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const RUN_REF = { project: "my-project-01", region: "australia-southeast1", service: "desktop-api" } as const;
const SECRET_REF = { project: "my-project-01", secret: "desktop_client_id" } as const;

/** The parts of a built request a test pins. */
function shapeOf({ request }: { request: GcpDoorRequest }): {
  method: string;
  url: string;
  effect: string;
  body: unknown;
} {
  const { body, effect, method, url } = unwrap(buildGcpDoorRequest({ request }));
  return { body, effect, method, url };
}

describe("buildGcpDoorRequest — Cloud Run", () => {
  it("creates by POST to the collection with serviceId, never allowMissing", () => {
    expect(
      shapeOf({ request: { kind: "run-service-create", ...RUN_REF, template: { containers: [{ image: "i" }] } } }),
    ).toEqual({
      body: { template: { containers: [{ image: "i" }] } },
      effect: "write",
      method: "POST",
      url: "https://run.googleapis.com/v2/projects/my-project-01/locations/australia-southeast1/services?serviceId=desktop-api",
    });
  });

  it("patches only the template, carrying the etag it was read at", () => {
    expect(
      shapeOf({
        request: { etag: "e1", kind: "run-service-patch", ...RUN_REF, template: { containers: [{ image: "i" }] } },
      }),
    ).toEqual({
      body: { etag: "e1", template: { containers: [{ image: "i" }] } },
      effect: "write",
      method: "PATCH",
      url: "https://run.googleapis.com/v2/projects/my-project-01/locations/australia-southeast1/services/desktop-api?updateMask=template",
    });
  });

  it("reads an IAM policy at version 3, so a conditional binding is never flattened", () => {
    expect(shapeOf({ request: { kind: "run-iam-get", ...RUN_REF } }).url).toBe(
      "https://run.googleapis.com/v2/projects/my-project-01/locations/australia-southeast1/services/desktop-api:getIamPolicy?options.requestedPolicyVersion=3",
    );
  });

  it("refuses a service name that would leave its collection", () => {
    expect(
      unwrapErr(buildGcpDoorRequest({ request: { kind: "run-service-get", ...RUN_REF, service: "../x" } })).code,
    ).toBe("INPUT_INVALID");
  });
});

describe("buildGcpDoorRequest — Secret Manager", () => {
  it("adds a version with the payload and its CRC32C in the body, and nothing in the URL", () => {
    expect(
      shapeOf({ request: { data: "aGk=", dataCrc32c: "1234", kind: "secret-version-add", ...SECRET_REF } }),
    ).toEqual({
      body: { payload: { data: "aGk=", dataCrc32c: "1234" } },
      effect: "write",
      method: "POST",
      url: "https://secretmanager.googleapis.com/v1/projects/my-project-01/secrets/desktop_client_id:addVersion",
    });
  });

  it("refuses a payload that is not base64, or a checksum that is not decimal", () => {
    expect(
      [
        { data: "not base64!", dataCrc32c: "1" },
        { data: "aGk=", dataCrc32c: "0x1" },
      ].map(
        ({ data, dataCrc32c }) =>
          unwrapErr(buildGcpDoorRequest({ request: { data, dataCrc32c, kind: "secret-version-add", ...SECRET_REF } }))
            .code,
      ),
    ).toEqual(["REQUEST_REFUSED", "REQUEST_REFUSED"]);
  });

  it("disables one numbered version with its etag", () => {
    expect(
      shapeOf({ request: { etag: '"abc"', kind: "secret-version-disable", ...SECRET_REF, version: "2" } }),
    ).toEqual({
      body: { etag: '"abc"' },
      effect: "write",
      method: "POST",
      url: "https://secretmanager.googleapis.com/v1/projects/my-project-01/secrets/desktop_client_id/versions/2:disable",
    });
  });

  it("creates a secret with automatic replication and the id as a query parameter", () => {
    expect(shapeOf({ request: { kind: "secret-create", ...SECRET_REF } })).toEqual({
      body: { replication: { automatic: {} } },
      effect: "write",
      method: "POST",
      url: "https://secretmanager.googleapis.com/v1/projects/my-project-01/secrets?secretId=desktop_client_id",
    });
  });

  it("refuses a page token carrying a second parameter", () => {
    expect(
      unwrapErr(buildGcpDoorRequest({ request: { kind: "secret-version-list", ...SECRET_REF, pageToken: "a&b=c" } }))
        .code,
    ).toBe("REQUEST_REFUSED");
  });

  it("reads a version by number or latest, and refuses any other version text", () => {
    expect(shapeOf({ request: { kind: "secret-version-access", ...SECRET_REF, version: "latest" } }).url).toBe(
      "https://secretmanager.googleapis.com/v1/projects/my-project-01/secrets/desktop_client_id/versions/latest:access",
    );
    expect(
      unwrapErr(buildGcpDoorRequest({ request: { kind: "secret-version-get", ...SECRET_REF, version: "0" } })).code,
    ).toBe("INPUT_INVALID");
  });
});

describe("buildGcpDoorRequest — the other families", () => {
  it("creates a service account with only the fields given", () => {
    expect(
      shapeOf({ request: { accountId: "desktop-api", kind: "service-account-create", project: "my-project-01" } }),
    ).toEqual({
      body: { accountId: "desktop-api", serviceAccount: {} },
      effect: "write",
      method: "POST",
      url: "https://iam.googleapis.com/v1/projects/my-project-01/serviceAccounts",
    });
  });

  it("enables an API by POST on its :enable", () => {
    expect(
      shapeOf({ request: { kind: "api-service-enable", project: "my-project-01", service: "run.googleapis.com" } }),
    ).toEqual({
      body: {},
      effect: "write",
      method: "POST",
      url: "https://serviceusage.googleapis.com/v1/projects/my-project-01/services/run.googleapis.com:enable",
    });
  });

  it("creates a Docker repository", () => {
    expect(
      shapeOf({
        request: {
          kind: "repository-create",
          project: "my-project-01",
          region: "australia-southeast1",
          repository: "desktop",
        },
      }),
    ).toEqual({
      body: { format: "DOCKER" },
      effect: "write",
      method: "POST",
      url: "https://artifactregistry.googleapis.com/v1/projects/my-project-01/locations/australia-southeast1/repositories?repositoryId=desktop",
    });
  });

  it("reads an operation only by a name shaped for its own provider", () => {
    expect(
      shapeOf({
        request: {
          kind: "operation-get",
          name: "projects/my-project-01/locations/australia-southeast1/operations/abc-123",
          provider: "run",
        },
      }).url,
    ).toBe("https://run.googleapis.com/v2/projects/my-project-01/locations/australia-southeast1/operations/abc-123");
    expect(
      unwrapErr(
        buildGcpDoorRequest({ request: { kind: "operation-get", name: "operations/../../x", provider: "run" } }),
      ).code,
    ).toBe("REQUEST_REFUSED");
  });
});
