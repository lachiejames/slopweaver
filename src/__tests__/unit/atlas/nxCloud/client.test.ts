import { describe, expect, it } from "vitest";

import { type NxCloudTransport, nxCloudCallUrl, performNxCloudCall } from "../../../../atlas/nxCloud/client.js";
import { ok, unwrap } from "../../../../lib/result.js";

const SCOPE = { orgId: "o1", workspaceId: "w1" };

describe("nxCloudCallUrl", () => {
  it("builds a URL from the inventory's own template, never from a caller's string", () => {
    const url = nxCloudCallUrl({ callId: "workspace-overview", orgId: "o1", workspaceId: "w1" });
    expect(unwrap(url)).toBe("https://cloud.nx.app/orgs/o1/workspaces/w1/overview.data");
  });

  it("appends the fixed query the inventory declares", () => {
    const url = nxCloudCallUrl({ callId: "workspace-insights", orgId: "o1", workspaceId: "w1" });
    expect(unwrap(url)).toBe("https://cloud.nx.app/orgs/o1/workspaces/w1/analytics/insights.data?dayCount=7");
  });

  it("refuses a call this build does not declare, rather than building a URL from the id", () => {
    const url = nxCloudCallUrl({ callId: "../../admin", orgId: "o1", workspaceId: "w1" });
    expect(url._unsafeUnwrapErr().code).toBe("PAYLOAD_UNREADABLE");
  });

  it("addresses a caller-supplied origin, so a test never reaches the real platform", () => {
    const url = nxCloudCallUrl({ callId: "organizations", orgId: "o", origin: "http://127.0.0.1:1", workspaceId: "w" });
    expect(unwrap(url)).toBe("http://127.0.0.1:1/orgs.data");
  });
});

describe("performNxCloudCall", () => {
  it("hands the transport the URL the inventory built and the caller's own cookie header", async () => {
    const seen: { url: string; cookieHeader: string }[] = [];
    const transport: NxCloudTransport = async ({ url, cookieHeader }) => {
      seen.push({ cookieHeader, url });
      return ok({ body: "", contentType: "text/x-script", statusCode: 200, url });
    };
    await performNxCloudCall({
      callId: "organizations",
      cookieHeader: "_nxCloudSession=x",
      orgId: SCOPE.orgId,
      transport,
      workspaceId: SCOPE.workspaceId,
    });
    expect(seen).toEqual([{ cookieHeader: "_nxCloudSession=x", url: "https://cloud.nx.app/orgs.data" }]);
  });

  it("returns a non-2xx as DATA rather than a failure, because a 403 is a finding", async () => {
    const transport: NxCloudTransport = async ({ url }) =>
      ok({ body: "", contentType: "text/html", statusCode: 403, url });
    const performed = await performNxCloudCall({
      callId: "workspace-overview",
      cookieHeader: "c",
      orgId: SCOPE.orgId,
      transport,
      workspaceId: SCOPE.workspaceId,
    });
    expect(unwrap(performed).statusCode).toBe(403);
  });

  it("never reaches the transport at all for a call the inventory does not declare", async () => {
    let called = false;
    const transport: NxCloudTransport = async ({ url }) => {
      called = true;
      return ok({ body: "", contentType: "", statusCode: 200, url });
    };
    await performNxCloudCall({
      callId: "nope",
      cookieHeader: "c",
      orgId: SCOPE.orgId,
      transport,
      workspaceId: SCOPE.workspaceId,
    });
    expect(called).toBe(false);
  });
});
