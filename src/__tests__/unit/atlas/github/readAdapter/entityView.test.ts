/*
 * `githubEntityView` on one stored entity: the entity as its detail, and one observation taken from its own source
 * and state, under the scope of its own `scopeRef`, or `github` for a kind without one.
 */
import { describe, expect, it } from "vitest";

import type { GithubEntity } from "../../../../../atlas/github/kindFiles.js";
import { githubEntityView } from "../../../../../atlas/github/readAdapter.js";
import { ENTITIES, SEEN } from "./entities.js";

describe("githubEntityView", () => {
  it("reads a stale entity as a stale observation, carrying the rest of its source through", () => {
    const entity: GithubEntity = { ...ENTITIES.webhook, state: "stale" };
    expect(githubEntityView({ entity, kind: "webhook" })).toEqual({
      detail: entity,
      id: "webhook-id",
      kind: "webhook",
      observations: [
        {
          artifacts: [],
          deepLink: "https://github.example.test/webhook",
          deepLinkStatus: "provider-provided",
          endpoint: "/example/webhook",
          observedAt: SEEN,
          state: "stale",
          surface: "rest-live",
        },
      ],
      providerId: "webhook-provider",
      scope: "example-org",
    });
  });

  it("reads an observed entity as an observed observation", () => {
    const entity = ENTITIES.webhook;
    expect(githubEntityView({ entity, kind: "webhook" })).toEqual({
      detail: entity,
      id: "webhook-id",
      kind: "webhook",
      observations: [
        {
          artifacts: [],
          deepLink: "https://github.example.test/webhook",
          deepLinkStatus: "provider-provided",
          endpoint: "/example/webhook",
          observedAt: SEEN,
          state: "observed",
          surface: "rest-live",
        },
      ],
      providerId: "webhook-provider",
      scope: "example-org",
    });
  });

  it("scopes a platform-wide kind to github and a configuration kind to its own scopeRef", () => {
    const operation = githubEntityView({ entity: ENTITIES["rest-operation"], kind: "rest-operation" });
    const environment = githubEntityView({ entity: ENTITIES.environment, kind: "environment" });
    expect([operation.scope, environment.scope]).toEqual(["github", "example-org/example-repo/production"]);
  });

  it("reads a code-scanning default setup as observed, because its own state is the provider's setup state", () => {
    const entity = ENTITIES["code-scanning-default-setup"];
    expect(githubEntityView({ entity, kind: "code-scanning-default-setup" }).observations).toEqual([
      {
        artifacts: [],
        deepLink: "https://github.example.test/code-scanning-default-setup",
        deepLinkStatus: "provider-provided",
        endpoint: "/example/code-scanning-default-setup",
        observedAt: SEEN,
        state: "observed",
        surface: "rest-live",
      },
    ]);
  });
});
