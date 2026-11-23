import { describe, expect, it } from "vitest";

import { graphqlOperationName, isInngestHost, reduceInngestCalls } from "../../../../atlas/inngest/browserReduction.js";
import type { CapturedResponse } from "../../../../browser/pageTransport.js";

/** One captured response, with only the fields the reduction reads varied. */
function response(over: Partial<CapturedResponse>): CapturedResponse {
  return { body: null, method: "GET", statusCode: 200, url: "https://app.inngest.com/x", ...over };
}

describe("deciding whether a host is Inngest's own", () => {
  // A substring test would admit a third party's telemetry into a first-party surface map.
  it("matches the domain and its subdomains and rejects a lookalike", () => {
    expect(isInngestHost({ host: "inngest.com" })).toBe(true);
    expect(isInngestHost({ host: "api.inngest.com" })).toBe(true);
    expect(isInngestHost({ host: "notinngest.com" })).toBe(false);
    expect(isInngestHost({ host: "inngest.com.evil.test" })).toBe(false);
  });
});

describe("reading a GraphQL operation's declared name", () => {
  it("takes the name the client declared and nothing else from the envelope", () => {
    expect(
      graphqlOperationName({ requestBody: '{"operationName":"GetApps","variables":{"envID":"secret"},"query":"x"}' }),
    ).toBe("GetApps");
  });

  it("answers null for an envelope that declares none, a body that is not JSON, and no body at all", () => {
    expect(graphqlOperationName({ requestBody: '{"query":"query { apps { id } }"}' })).toBe(null);
    expect(graphqlOperationName({ requestBody: "not json" })).toBe(null);
    expect(graphqlOperationName({ requestBody: undefined })).toBe(null);
  });
});

describe("reducing what the dashboard asked for", () => {
  it("keeps only Inngest's own hosts", () => {
    const rows = reduceInngestCalls({
      responses: [
        response({ url: "https://api.inngest.com/v2/apps" }),
        response({ url: "https://cdn.segment.com/analytics.js" }),
      ],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.host).toBe("api.inngest.com");
  });

  // Every GraphQL operation is posted to one path, so the path identifies nothing and the operation NAME is
  // the identity. Two different operations must not collapse into one row.
  it("keys a GraphQL call on its operation name rather than on its path", () => {
    const rows = reduceInngestCalls({
      responses: [
        response({
          method: "POST",
          requestBody: '{"operationName":"GetApps","query":"query GetApps { apps { id } }"}',
          url: "https://api.inngest.com/gql",
        }),
        response({
          method: "POST",
          requestBody: '{"operationName":"GetEnvs","query":"query GetEnvs { workspaces { id } }"}',
          url: "https://api.inngest.com/gql",
        }),
      ],
    });
    expect(rows.length).toBe(2);
    expect(rows.map((row) => row.operationName!).toSorted((left, right) => left.localeCompare(right))).toEqual([
      "GetApps",
      "GetEnvs",
    ]);
    expect(rows.find((row) => row.operationName === "GetApps")!.rootFields).toEqual(["query.apps"]);
    expect(rows.find((row) => row.operationName === "GetApps")!.operationType).toBe("query");
  });

  it("counts a GraphQL call carrying no readable document rather than attributing it", () => {
    const rows = reduceInngestCalls({
      responses: [response({ method: "POST", url: "https://api.inngest.com/gql" })],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.operationName).toBe(null);
    expect(rows[0]!.operationType).toBe("unnamed");
    expect(rows[0]!.rootFields).toEqual([]);
  });

  it("replaces every identifier segment in a path shape and never a real route name", () => {
    const rows = reduceInngestCalls({
      responses: [response({ url: "https://api.inngest.com/v2/apps/01JQKZ8P5T7X2W9V3C4B6N8M0A/functions" })],
    });
    expect(rows[0]!.pathShape).toBe("/v2/apps/{ulid}/functions");
  });

  it("stores field NAMES out of a response body and never a value", () => {
    const rows = reduceInngestCalls({
      responses: [
        response({
          body: { data: { apps: [{ id: "01J", name: "a-private-name" }] } },
          url: "https://api.inngest.com/v2/apps",
        }),
      ],
    });
    expect(rows[0]!.fields).toEqual(["data", "data.apps", "data.apps[].id", "data.apps[].name"]);
  });
});
