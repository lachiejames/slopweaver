/**
 * The Inngest sync's per-kind builders: the compiled operation and page kinds, the declared-only GraphQL kind,
 * and the eight entity kinds written as an honest `not-configured` state rather than skipped.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { openInngestGap } from "../../../../atlas/inngest/gaps.js";
import {
  emptyInngestKindFile,
  INNGEST_KINDS,
  type InngestAtlasEntity,
  type InngestKind,
} from "../../../../atlas/inngest/model.js";
import {
  buildInngestKindFiles,
  INNGEST_ENTITY_KINDS,
  type InngestSyncObservations,
} from "../../../../atlas/inngest/syncKinds.js";

const OLD = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-13T09:00:00.000Z";

/** A stored entity of `kind`, as an earlier walk left it. */
function storedEntity({ kind, providerId }: { kind: InngestKind; providerId: string }): InngestAtlasEntity {
  return {
    channels: {
      api: null,
      browser: {
        channel: "browser",
        detail: { seen: providerId },
        firstSeenAt: OLD,
        lastSeenAt: OLD,
        source: null,
        state: "observed",
      },
      compiled: null,
    },
    id: `${kind}-${providerId}`,
    kind,
    providerId,
  };
}

/** One run's observations: one REST operation, one route, a stored app list and a stored GraphQL list. */
function observations(): InngestSyncObservations {
  return {
    at: AT,
    dashboardGapList: [],
    graphqlNote: "api.inngest.com/gql answered 200 with `introspection disabled`",
    operations: [
      {
        description: "List every app.",
        group: "Apps",
        operationId: "ListApps",
        referenceUrl: "https://api-docs.inngest.com/reference/list-apps",
        title: "List apps",
        version: "v2",
      },
    ],
    probedUrls: new Map([["/env/$envSlug/apps", null]]),
    restGapList: [],
    restOutcomes: new Map(),
    routeOutcomes: new Map(),
    routes: [{ parameterised: true, routePath: "/env/$envSlug/apps", section: "env" }],
    stored: {
      app: {
        ...emptyInngestKindFile({ kind: "app", updatedAt: OLD }),
        entities: [storedEntity({ kind: "app", providerId: "billing" })],
      },
      "graphql-operation": {
        ...emptyInngestKindFile({ kind: "graphql-operation", updatedAt: OLD }),
        entities: [storedEntity({ kind: "graphql-operation", providerId: "GetFunctions" })],
      },
      operation: {
        ...emptyInngestKindFile({ kind: "operation", updatedAt: OLD }),
        gaps: [
          openInngestGap({
            at: OLD,
            condition: "rest-catalogue-unreachable",
            fields: [],
            kind: "operation",
            reason: "the catalogue did not answer",
            scope: "https://api-docs.inngest.com/llms.txt",
            surfaces: ["compiled"],
          }),
        ],
      },
    },
  };
}

describe("INNGEST_ENTITY_KINDS", () => {
  it("is every kind but operation, page and graphql-operation, in model order", () => {
    expect(INNGEST_ENTITY_KINDS).toEqual([
      "app",
      "environment",
      "event-key",
      "event-type",
      "function",
      "integration",
      "signing-key",
      "webhook",
    ]);
  });
});

describe("buildInngestKindFiles", () => {
  it("builds exactly one file per kind", () => {
    const result = buildInngestKindFiles({ observed: observations() });
    expect(result.isOk()).toBe(true);
    expect(Object.keys(unwrap(result)).toSorted()).toEqual([...INNGEST_KINDS].toSorted());
  });

  it("projects the catalogued operation and the declared route under their provider ids", () => {
    const files = unwrap(buildInngestKindFiles({ observed: observations() }));
    expect(files.operation.entities.map((entity) => entity.providerId)).toEqual(["v2 ListApps"]);
    expect(files.page.entities.map((entity) => entity.providerId)).toEqual(["/env/$envSlug/apps"]);
    expect(files.operation.coverage.map((cell) => [cell.channel, cell.state])).toEqual([
      ["compiled", "synced"],
      ["api", "not-configured"],
    ]);
    expect(files.page.coverage.map((cell) => [cell.channel, cell.state])).toEqual([
      ["compiled", "synced"],
      ["browser", "unreadable"],
    ]);
  });

  it("closes a stored rest-catalogue-unreachable gap once the catalogue was read", () => {
    const files = unwrap(buildInngestKindFiles({ observed: observations() }));
    const reopened = files.operation.gaps.find((gap) => gap.condition === "rest-catalogue-unreachable")!;
    expect(reopened.status).toBe("closed");
  });

  it("raises a disposition-rule-never-fired gap for every reviewed rule the catalogue never reached", () => {
    // `ListApps` is a configuration read, so the three rules ahead of the catch-all match nothing.
    const files = unwrap(buildInngestKindFiles({ observed: observations() }));
    const dead = files.operation.gaps.filter((gap) => gap.condition === "disposition-rule-never-fired");
    // Sorted: the stored order is the gap reconciler's, not this module's.
    const pairs = dead.map((gap) => [gap.scope, gap.status]);
    expect(pairs.toSorted((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")))).toEqual([
      ["mutating-operation", "open"],
      ["sandbox-filesystem-read", "open"],
      ["time-series-observation", "open"],
    ]);
  });

  it("raises no dead-rule gap for a rule one catalogued operation matched", () => {
    const base = observations();
    const sendEvent = { ...base.operations[0]!, operationId: "SendEvent", title: "Send event" };
    const files = unwrap(buildInngestKindFiles({ observed: { ...base, operations: [...base.operations, sendEvent] } }));
    const dead = files.operation.gaps.filter((gap) => gap.condition === "disposition-rule-never-fired");
    expect(dead.map((gap) => gap.scope).toSorted()).toEqual(["sandbox-filesystem-read", "time-series-observation"]);
  });

  it("declares GraphQL unreadable with the literal introspection-disabled gap and keeps the walk's stored entities", () => {
    const files = unwrap(buildInngestKindFiles({ observed: observations() }));
    const graphql = files["graphql-operation"];
    expect(graphql.coverage.map((cell) => [cell.channel, cell.state, cell.reason])).toEqual([
      [
        "browser",
        "unreadable",
        "api.inngest.com/gql answered 200 with `introspection disabled`. Introspection is disabled, so nothing can be compiled from this endpoint",
      ],
    ]);
    expect(graphql.gaps.map((gap) => [gap.condition, gap.scope, gap.status])).toEqual([
      ["graphql-introspection-disabled", "api.inngest.com/gql", "open"],
    ]);
    expect(graphql.entities).toEqual([storedEntity({ kind: "graphql-operation", providerId: "GetFunctions" })]);
    expect(graphql.updatedAt).toBe(AT);
  });

  it("writes every entity kind as not-configured over api and unreadable over browser, with one credential gap", () => {
    const files = unwrap(buildInngestKindFiles({ observed: observations() }));
    const shapes = INNGEST_ENTITY_KINDS.map((kind) => [
      kind,
      files[kind].coverage.map((cell) => [cell.channel, cell.state, cell.lastSuccessAt]),
      files[kind].gaps.map((gap) => [gap.condition, gap.scope, gap.surfaces]),
      files[kind].updatedAt,
    ]);
    expect(shapes).toEqual(
      INNGEST_ENTITY_KINDS.map((kind) => [
        kind,
        [
          ["api", "not-configured", null],
          ["browser", "unreadable", null],
        ],
        [["api-credential-absent", kind, ["api", "browser"]]],
        AT,
      ]),
    );
  });

  it("keeps a stored entity kind's non-empty entity list while replacing its coverage", () => {
    const files = unwrap(buildInngestKindFiles({ observed: observations() }));
    expect(files.app.entities).toEqual([storedEntity({ kind: "app", providerId: "billing" })]);
    expect(files.webhook.entities).toEqual([]);
  });
});
