/**
 * The names the GCP door puts in a URL, and the URL builder that refuses a path normalisation would move: a
 * shape Google documents passes, anything that could climb out of its collection or carry a second role fails.
 */
import { describe, expect, it } from "vitest";

import { checkMember, checkName, PUBLIC_MEMBERS } from "../../../gcp/names.js";
import { buildRun, buildSecret } from "../../../gcp/requestRunSecret.js";
import { built, checkAll, fixedUrl, RUN, SECRET_MANAGER } from "../../../gcp/requestUrl.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";

describe("checkName", () => {
  it("passes each documented shape unchanged", () => {
    expect(
      [
        checkName({ kind: "project", value: "acme-security" }),
        checkName({ kind: "region", value: "australia-southeast1" }),
        checkName({ kind: "run-service", value: "desktop-api" }),
        checkName({ kind: "secret-version", value: "latest" }),
        checkName({ kind: "image", value: "australia-southeast1-docker.pkg.dev/my-project-01/desktop/api:v1" }),
        checkName({ kind: "api-service", value: "run.googleapis.com" }),
      ].map((result) => unwrap(result)),
    ).toEqual([
      "acme-security",
      "australia-southeast1",
      "desktop-api",
      "latest",
      "australia-southeast1-docker.pkg.dev/my-project-01/desktop/api:v1",
      "run.googleapis.com",
    ]);
  });

  it("refuses a path climb, a zero version and a public-registry image, naming the shape it failed", () => {
    const refusals = [
      checkName({ kind: "run-service", value: "../x" }),
      checkName({ kind: "secret-version", value: "0" }),
      checkName({ kind: "image", value: "docker.io/library/nginx:latest" }),
    ].map((result) => unwrapErr(result));
    expect(refusals.map((error) => error.code)).toEqual(["INPUT_INVALID", "INPUT_INVALID", "INPUT_INVALID"]);
    expect(refusals[0]!.message).toBe('"../x" is not a Cloud Run service id');
  });
});

describe("checkMember", () => {
  it("passes each member prefix with its own shape, and both public members", () => {
    expect(
      [
        "user:someone@example.com",
        "serviceAccount:desktop-api@my-project-01.iam.gserviceaccount.com",
        "domain:example.com",
        ...PUBLIC_MEMBERS,
      ].map((member) => unwrap(checkMember({ member }))),
    ).toEqual([
      "user:someone@example.com",
      "serviceAccount:desktop-api@my-project-01.iam.gserviceaccount.com",
      "domain:example.com",
      "allUsers",
      "allAuthenticatedUsers",
    ]);
  });

  it("refuses a bare email, a second @ and an unknown prefix", () => {
    expect(
      ["someone@example.com", "user:a@b@example.com", "owner:someone@example.com"].map(
        (member) => unwrapErr(checkMember({ member })).code,
      ),
    ).toEqual(["INPUT_INVALID", "INPUT_INVALID", "INPUT_INVALID"]);
  });
});

describe("checkAll", () => {
  it("skips an undefined name and stops at the first bad one", () => {
    expect(
      unwrapErr(
        checkAll({
          names: [
            ["project", "my-project-01"],
            ["secret-version", undefined],
            ["region", "nowhere"],
            ["run-service", "../x"],
          ],
        }),
      ).message,
    ).toBe('"nowhere" is not a GCP region such as australia-southeast1');
  });

  it("passes when every defined name has its shape", () => {
    expect(
      unwrap(
        checkAll({
          names: [
            ["project", "my-project-01"],
            ["secret-version", undefined],
          ],
        }),
      ),
    ).toBe(undefined);
  });
});

describe("fixedUrl and built", () => {
  it("joins a base and a path, setting only the defined query parameters", () => {
    expect(
      unwrap(fixedUrl({ base: SECRET_MANAGER, path: "/projects/p/secrets", query: { a: "1", b: undefined } })),
    ).toBe("https://secretmanager.googleapis.com/v1/projects/p/secrets?a=1");
  });

  it("refuses a path that normalisation would move", () => {
    const refused = unwrapErr(fixedUrl({ base: RUN, path: "/projects/p/../../x", query: {} }));
    expect(refused.code).toBe("REQUEST_REFUSED");
    expect(refused.message).toContain("a name in it changes the URL path");
  });

  it("assembles a request around a fixed URL", () => {
    expect(
      unwrap(
        built({
          shape: { body: undefined, effect: "read", method: "GET", operation: "op" },
          url: ok("https://run.googleapis.com/v2/x"),
        }),
      ),
    ).toEqual({
      body: undefined,
      effect: "read",
      method: "GET",
      operation: "op",
      url: "https://run.googleapis.com/v2/x",
    });
  });
});

describe("buildRun and buildSecret", () => {
  it("names one operation per call", () => {
    const run = unwrap(
      buildRun({
        request: { kind: "run-service-get", project: "my-project-01", region: "australia-southeast1", service: "api" },
      }),
    );
    const secret = unwrap(buildSecret({ request: { kind: "secret-get", project: "my-project-01", secret: "s" } }));
    expect([run.operation, secret.operation]).toEqual(["gcp.run.services.get", "gcp.secretmanager.secrets.get"]);
  });

  it("refuses a bad project before building anything", () => {
    expect(unwrapErr(buildSecret({ request: { kind: "secret-get", project: "P", secret: "s" } })).code).toBe(
      "INPUT_INVALID",
    );
  });
});
