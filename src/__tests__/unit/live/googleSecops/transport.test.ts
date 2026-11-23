/**
 * Unit: the SecOps door's URL builder — every read lands on the instance's own regional host, under the
 * instance's own path, or is refused before any call.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseSecopsInstance } from "../../../../live/googleSecops/instance.js";
import { buildSecopsUrl } from "../../../../live/googleSecops/transport.js";

const NAME = "projects/acme-security/locations/australia-southeast1/instances/00000000-0000-4000-8000-000000000001";
const INSTANCE = unwrap(parseSecopsInstance({ value: NAME }));

/** Build one URL under the instance at v1 with no query. */
function build({ relativePath, apiVersion = "v1" }: { relativePath: string; apiVersion?: string }) {
  return buildSecopsUrl({ apiVersion, instance: INSTANCE, query: {}, relativePath });
}

describe("buildSecopsUrl", () => {
  it("puts a collection read under the instance on its regional host", () => {
    expect(unwrap(build({ relativePath: "dataTables" })).toString()).toBe(
      `https://australia-southeast1-chronicle.googleapis.com/v1/${NAME}/dataTables`,
    );
  });

  it("carries a nested resource path and its query parameters", () => {
    const url = unwrap(
      buildSecopsUrl({
        apiVersion: "v1",
        instance: INSTANCE,
        query: { pageSize: "100", pageToken: "abc" },
        relativePath: "dataTables/allowlist/dataTableRows",
      }),
    );
    expect(url.pathname).toBe(`/v1/${NAME}/dataTables/allowlist/dataTableRows`);
    expect(url.search).toBe("?pageSize=100&pageToken=abc");
  });

  it("refuses a dot segment that would walk out of the instance", () => {
    expect(unwrapErr(build({ relativePath: "../../../../other" })).code).toBe("PATH_REFUSED");
  });

  it("refuses a percent-encoded dot segment", () => {
    expect(unwrapErr(build({ relativePath: "%2e%2e/other" })).code).toBe("PATH_REFUSED");
  });

  it("refuses an empty segment", () => {
    expect(unwrapErr(build({ relativePath: "rules//x" })).code).toBe("PATH_REFUSED");
  });

  it("refuses an absolute URL in place of a path", () => {
    expect(unwrapErr(build({ relativePath: "https://example.com/v1/x" })).code).toBe("PATH_REFUSED");
  });

  it("refuses a protocol-relative path that would change the host", () => {
    expect(unwrapErr(build({ relativePath: "//example.com/x" })).code).toBe("PATH_REFUSED");
  });

  it("puts an instance custom method on the instance itself, with no slash before the colon", () => {
    expect(unwrap(build({ relativePath: ":listAllFindingsRefinementDeployments" })).pathname).toBe(
      `/v1/${NAME}:listAllFindingsRefinementDeployments`,
    );
  });

  it("refuses a custom method that carries a path after it", () => {
    expect(unwrapErr(build({ relativePath: ":listAll/../../x" })).message).toBe(
      "refused :listAll/../../x: not a resource path under the instance",
    );
  });

  it("refuses a query key that is not paging, naming it", () => {
    const error = unwrapErr(
      buildSecopsUrl({ apiVersion: "v1", instance: INSTANCE, query: { filter: "x" }, relativePath: "feeds" }),
    );
    expect(error.message).toBe("refused feeds: query parameter filter is not one this door sends — paging only");
  });

  it("refuses an API version this door does not read, naming it", () => {
    const error = unwrapErr(build({ apiVersion: "v1beta", relativePath: "rules" }));
    expect(error.code).toBe("PATH_REFUSED");
    expect(error.message).toBe("refused rules: API version v1beta is not read");
  });
});
