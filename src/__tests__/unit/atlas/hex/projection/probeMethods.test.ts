/*
 * `projectHexProbeMethods`: the thirteen nouns the unauthenticated census found mounted, one star method each.
 */
import { describe, expect, it } from "vitest";

import { projectHexProbeMethods } from "../../../../../atlas/hex/projection.js";
import { AT, apiEntity, ORIGIN } from "./harness.js";

describe("projectHexProbeMethods", () => {
  const projected = projectHexProbeMethods({ at: AT });

  it("projects exactly the thirteen mounted nouns, sorted by provider id", () => {
    expect(projected.map((entity) => entity.providerId)).toEqual([
      "* /api/v1/cells",
      "* /api/v1/collections",
      "* /api/v1/context",
      "* /api/v1/data-connections",
      "* /api/v1/embedding",
      "* /api/v1/groups",
      "* /api/v1/guides",
      "* /api/v1/projects",
      "* /api/v1/semantic-models",
      "* /api/v1/semantic-projects",
      "* /api/v1/suggestions",
      "* /api/v1/threads",
      "* /api/v1/users",
    ]);
  });

  it("carries the unauthenticated-probe evidence and each row's own noun as its citation, on every row", () => {
    const nouns = [
      "cells",
      "collections",
      "context",
      "data-connections",
      "embedding",
      "groups",
      "guides",
      "projects",
      "semantic-models",
      "semantic-projects",
      "suggestions",
      "threads",
      "users",
    ];
    expect(projected).toEqual(
      nouns.map((noun) =>
        apiEntity({
          deepLink: `https://app.hex.tech/api/v1/${noun}`,
          deepLinkStatus: "provider-provided",
          detail: {
            disposition: "entity",
            evidence: "unauthenticated-probe",
            excludedBecause: null,
            host: ORIGIN,
            observational: true,
            operationId: null,
            parameters: [],
            responseFields: [],
            securitySchemes: ["bearerAuth"],
            withheldBecause: null,
          },
          endpoint: `* /api/v1/${noun}`,
          kind: "method",
          providerId: `* /api/v1/${noun}`,
        }),
      ),
    );
  });
});
