import { describe, expect, it } from "vitest";

import { projectInngestGraphqlOperations } from "../../../../atlas/inngest/projection.js";

const AT = "2026-09-07T02:00:00.000Z";

describe("projecting the GraphQL operations a walk observed", () => {
  it("opens one tally per name on its first sighting and folds every later sighting onto it", () => {
    const entities = projectInngestGraphqlOperations({
      at: AT,
      pages: [
        {
          calls: [
            { host: "api.inngest.com", operationName: "GetApps", operationType: "query", rootFields: ["apps"] },
            { host: "api.inngest.com", operationName: null, operationType: "unnamed", rootFields: [] },
            { host: "api.inngest.com", operationName: "NotGraphql", operationType: null, rootFields: [] },
          ],
          surface: "/env/production/apps",
        },
        {
          calls: [{ host: "app.inngest.com", operationName: "GetApps", operationType: "query", rootFields: ["envs"] }],
          surface: "/settings",
        },
      ],
    });

    expect(entities.map((entity) => entity.channels.browser!.detail)).toEqual([
      {
        onPages: ["/env/production/apps"],
        operationName: "(unnamed)",
        operationType: "unnamed",
        origin: "https://api.inngest.com",
        rootFields: [],
      },
      {
        onPages: ["/env/production/apps", "/settings"],
        operationName: "GetApps",
        operationType: "query",
        origin: "https://api.inngest.com",
        rootFields: ["apps", "envs"],
      },
    ]);
  });

  it("projects nothing for a walk that observed no GraphQL call", () => {
    expect(projectInngestGraphqlOperations({ at: AT, pages: [{ calls: [], surface: "/settings" }] })).toEqual([]);
  });
});
