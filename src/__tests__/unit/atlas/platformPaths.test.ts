import { describe, expect, it } from "vitest";

import { atlasPathsFor } from "../../../atlas/platformPaths.js";

describe("atlasPathsFor", () => {
  it("resolves the Inngest atlas under an explicit home, its whole kind map included", () => {
    expect(atlasPathsFor({ home: "/home-alpha", platform: "inngest" })).toEqual({
      kinds: {
        app: "/home-alpha/atlas/inngest/apps.jsonl",
        environment: "/home-alpha/atlas/inngest/environments.jsonl",
        "event-key": "/home-alpha/atlas/inngest/event-keys.jsonl",
        "event-type": "/home-alpha/atlas/inngest/event-types.jsonl",
        function: "/home-alpha/atlas/inngest/functions.jsonl",
        "graphql-operation": "/home-alpha/atlas/inngest/graphql-operations.jsonl",
        integration: "/home-alpha/atlas/inngest/integrations.jsonl",
        operation: "/home-alpha/atlas/inngest/operations.jsonl",
        page: "/home-alpha/atlas/inngest/pages.jsonl",
        "signing-key": "/home-alpha/atlas/inngest/signing-keys.jsonl",
        webhook: "/home-alpha/atlas/inngest/webhooks.jsonl",
      },
      manifest: "/home-alpha/atlas/inngest/manifest.json",
      root: "/home-alpha/atlas/inngest",
      sensitive: "/home-alpha/atlas/inngest/_sensitive",
      superseded: "/home-alpha/atlas/_superseded/inngest",
    });
  });

  it("matches a hyphenated platform by its directory name rather than the camel-case key it is stored under", () => {
    const paths = atlasPathsFor({ home: "/home-bravo", platform: "gemini-ai-studio" })!;
    expect(paths.root).toBe("/home-bravo/atlas/gemini-ai-studio");
    expect(paths.manifest).toBe("/home-bravo/atlas/gemini-ai-studio/manifest.json");
    expect(paths.superseded).toBe("/home-bravo/atlas/_superseded/gemini-ai-studio");
  });

  it("does not match the camel-case key itself", () => {
    expect(atlasPathsFor({ home: "/home-bravo", platform: "geminiAiStudio" })).toBe(null);
  });

  it("answers null for a platform no resolver names", () => {
    expect(atlasPathsFor({ home: "/home-charlie", platform: "no-such-platform" })).toBe(null);
  });
});
