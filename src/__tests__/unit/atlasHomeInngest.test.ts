import { describe, expect, it } from "vitest";

import { inngestAtlasHomePaths } from "../../atlasHomeInngest.js";

describe("inngestAtlasHomePaths", () => {
  it("lays the Inngest generation out under the atlas root with all eleven kind files", () => {
    expect(inngestAtlasHomePaths({ atlasRoot: "/state/atlas" })).toEqual({
      kinds: {
        app: "/state/atlas/inngest/apps.jsonl",
        environment: "/state/atlas/inngest/environments.jsonl",
        "event-key": "/state/atlas/inngest/event-keys.jsonl",
        "event-type": "/state/atlas/inngest/event-types.jsonl",
        function: "/state/atlas/inngest/functions.jsonl",
        "graphql-operation": "/state/atlas/inngest/graphql-operations.jsonl",
        integration: "/state/atlas/inngest/integrations.jsonl",
        operation: "/state/atlas/inngest/operations.jsonl",
        page: "/state/atlas/inngest/pages.jsonl",
        "signing-key": "/state/atlas/inngest/signing-keys.jsonl",
        webhook: "/state/atlas/inngest/webhooks.jsonl",
      },
      manifest: "/state/atlas/inngest/manifest.json",
      root: "/state/atlas/inngest",
      sensitive: "/state/atlas/inngest/_sensitive",
      superseded: "/state/atlas/_superseded/inngest",
    });
  });

  it("hangs every path off whichever atlas root it is handed", () => {
    const paths = inngestAtlasHomePaths({ atlasRoot: "/other-home/atlas" });
    expect(paths.root).toBe("/other-home/atlas/inngest");
    expect(paths.kinds["webhook"]).toBe("/other-home/atlas/inngest/webhooks.jsonl");
    expect(paths.superseded).toBe("/other-home/atlas/_superseded/inngest");
  });
});
