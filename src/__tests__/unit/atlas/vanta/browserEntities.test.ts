/*
 * The browser walk's entity builders, called directly: a reached page against one nobody reached, and the
 * per-operation fold across pages, including the not-found page whose chrome it refuses to credit.
 */
import { describe, expect, it } from "vitest";

import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";
import { operationEntities, pageEntity } from "../../../../atlas/vanta/browserEntities.js";
import type { VantaPageObservation } from "../../../../atlas/vanta/browserWalk.js";
import { vantaEntityId } from "../../../../atlas/vanta/identity.js";

const RUN_AT = "2026-09-04T10:00:00.000Z";
const SEEN_AT = "2026-09-04T09:58:00.000Z";

const SHOT: AtlasArtifactRef = {
  byteLength: 95_000,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "pages/abc.png",
  sha256: "a".repeat(64),
};

const call = ({
  operation,
  fields,
}: {
  operation: string;
  fields: readonly string[];
}): VantaPageObservation["calls"][number] => ({
  method: "POST",
  operation,
  pathShape: "/c/{tenant}/graphql",
  responseFields: fields,
  statusCode: 200,
});

/** A reached, photographed page, with per-test overrides spread over it. */
const reached = ({ over = {} }: { over?: Partial<VantaPageObservation> } = {}): VantaPageObservation => ({
  artifacts: [SHOT],
  attempted: true,
  calls: [],
  captureComplete: true,
  finalUrl: "https://app.vanta.com/c/acme/tests",
  observedAt: SEEN_AT,
  redirected: false,
  requestedUrl: "https://app.vanta.com/c/acme/tests",
  responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 40 },
  screenshotMissingBecause: null,
  statusCode: 200,
  surface: "tests-collection",
  title: "Tests - Vanta",
  unreachableBecause: null,
  ...over,
});

describe("pageEntity", () => {
  it("sources a reached page from the address and instant it was seen at, carrying its picture", () => {
    const entity = pageEntity({ at: RUN_AT, page: reached() });
    expect(entity.kind).toBe("browser-page");
    expect(entity.providerId).toBe("tests-collection");
    expect(entity.id).toBe(vantaEntityId({ components: { providerId: "tests-collection" }, kind: "browser-page" }));
    expect(entity.channels.browser!.firstSeenAt).toBe(SEEN_AT);
    expect(entity.channels.browser!.source).toEqual({
      artifacts: [SHOT],
      channel: "browser",
      deepLink: "https://app.vanta.com/c/acme/tests",
      deepLinkStatus: "browser-discovered",
      endpoint: "https://app.vanta.com/c/acme/tests",
      observedAt: SEEN_AT,
    });
    expect(entity.channels["manage-api"]).toBe(null);
  });

  it("gives a page nobody reached no source at all and this run's instant, rather than an invented one", () => {
    const entity = pageEntity({
      at: RUN_AT,
      page: reached({
        over: {
          artifacts: [],
          attempted: false,
          finalUrl: "",
          observedAt: "",
          screenshotMissingBecause: "the page was never photographed, because the visit did not complete",
          statusCode: null,
          unreachableBecause: "the walk stopped before this page",
        },
      }),
    });
    expect(entity.channels.browser!.source).toBe(null);
    expect(entity.channels.browser!.firstSeenAt).toBe(RUN_AT);
    expect(entity.channels.browser!.lastSeenAt).toBe(RUN_AT);
    expect(entity.channels.browser!.detail).toEqual({
      attempted: false,
      captureComplete: true,
      finalUrl: "",
      operationCount: 0,
      redirected: false,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 40 },
      screenshotMissingBecause: "the page was never photographed, because the visit did not complete",
      statusCode: null,
      surface: "tests-collection",
      title: "Tests - Vanta",
      unreachableBecause: "the walk stopped before this page",
    });
  });
});

describe("operationEntities", () => {
  it("folds one operation seen on two pages into one entity, widening its fields and naming both pages", () => {
    const entities = operationEntities({
      pages: [
        reached({
          over: {
            calls: [call({ fields: ["data.b"], operation: "tests" })],
            finalUrl: "https://app.vanta.com/c/acme/tests",
            surface: "tests-collection",
          },
        }),
        reached({
          over: {
            calls: [call({ fields: ["data.a"], operation: "tests" })],
            finalUrl: "https://app.vanta.com/c/acme/audits",
            observedAt: "2026-09-04T09:59:00.000Z",
            surface: "audits-collection",
          },
        }),
      ],
    });
    expect(entities).toHaveLength(1);
    const [entity] = entities;
    expect(entity!.providerId).toBe("tests");
    expect(entity!.channels.browser!.detail).toEqual({
      method: "POST",
      operation: "tests",
      pathShape: "/c/{tenant}/graphql",
      responseFields: ["data.a", "data.b"],
      seenOnSurfaces: ["audits-collection", "tests-collection"],
      statusCode: 200,
    });
    // The source is the FIRST page that made the call, and it carries no picture of its own.
    expect(entity!.channels.browser!.source!.deepLink).toBe("https://app.vanta.com/c/acme/tests");
    expect(entity!.channels.browser!.source!.observedAt).toBe(SEEN_AT);
    expect(entity!.channels.browser!.source!.artifacts).toEqual([]);
  });

  it("orders the entities by provider id, whatever order the pages made the calls in", () => {
    const entities = operationEntities({
      pages: [
        reached({
          over: { calls: [call({ fields: [], operation: "zeta" }), call({ fields: [], operation: "alpha" })] },
        }),
      ],
    });
    expect(entities.map((entity) => entity.providerId)).toEqual(["alpha", "zeta"]);
  });

  it("credits no operation to a page the client would not render", () => {
    const entities = operationEntities({
      pages: [
        reached({
          over: {
            calls: [call({ fields: ["data.id"], operation: "userContext" })],
            unreachableBecause: "the client has no such route",
          },
        }),
      ],
    });
    expect(entities).toEqual([]);
  });
});
