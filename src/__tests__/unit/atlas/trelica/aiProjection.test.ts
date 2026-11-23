import { describe, expect, it } from "vitest";

import {
  projectTrelicaAiAlerts,
  projectTrelicaAiUsage,
  trelicaAiRowIdentity,
} from "../../../../atlas/trelica/aiProjection.js";
import { TRELICA_AI_USAGE_BOUNDARIES } from "../../../../atlas/trelica/aiUsageBoundaries.js";
import type { TrelicaAiAlertDetail, TrelicaAiUsageDetail } from "../../../../atlas/trelica/model.js";
import type { TrelicaAiUsageResult } from "../../../../atlas/trelica/usageWalk.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-10-02T00:00:00.000Z";
const WINDOW = { endDate: "2026-10-02", startDate: "2024-10-02" };

/** A full set of figures spending `spend`. */
function metrics({ spend }: { spend: number }): Record<string, number> {
  return {
    cachedInputTokens: 1,
    cachedOutputTokens: 2,
    credits: 0,
    inputTokens: 3,
    linesOfCodeAdded: 4,
    linesOfCodeRemoved: 5,
    outputTokens: 6,
    requests: 7,
    spend,
    totalTokens: 9,
  };
}

/** One read's result holding the given rows and series. */
function result({
  dimension,
  rows,
  series = [],
}: {
  dimension: TrelicaAiUsageResult["dimension"];
  rows: readonly unknown[];
  series?: readonly unknown[];
}): TrelicaAiUsageResult {
  return {
    dimension,
    granularity: "Monthly",
    path: `/AppsApi/AppAIUsage/UsageBy-${dimension}`,
    rows,
    series,
    statusCode: 200,
    stoppedAtFloor: false,
    total: rows.length,
  };
}

describe("trelicaAiRowIdentity", () => {
  it("keys a model by its application as well as its name", () => {
    const identity = trelicaAiRowIdentity({
      dimension: "model",
      row: { customerAppId: "app-1", customerAppName: "OpenAI Platform", model: "gpt-5" },
    })!;
    expect(identity.key).toBe("app-1:gpt-5");
    expect(identity.label).toBe("gpt-5");
  });

  it("holds the provider's empty-model bucket under its own key, and refuses only an absent model", () => {
    const app = { customerAppId: "app-1", customerAppName: "OpenAI Platform" };
    const unnamed = trelicaAiRowIdentity({ dimension: "model", row: { ...app, model: "" } })!;
    expect(unnamed.key).toBe("app-1:(no model recorded)");
    expect(unnamed.label).toBe("(no model recorded)");
    expect(trelicaAiRowIdentity({ dimension: "model", row: app })).toBe(null);
  });

  it("labels an API key by its own name and owns it to the key's application", () => {
    const identity = trelicaAiRowIdentity({
      dimension: "api-key",
      row: { apiKey: { customerAppId: "app-2", externalId: "key_x", name: "prod-evals" }, customerAppApiKeyId: "k-1" },
    })!;
    expect(identity).toEqual({
      customerAppId: "app-2",
      customerAppName: null,
      email: null,
      key: "k-1",
      label: "prod-evals",
    });
  });

  it("labels an unnamed API key by Trelica's id for it, never the vendor's externalId the row carries", () => {
    const row = { apiKey: { customerAppId: "app-2", externalId: "external-canary" }, customerAppApiKeyId: "k-1" };
    const identity = trelicaAiRowIdentity({ dimension: "api-key", row })!;

    expect(row.apiKey.externalId).toBe("external-canary");
    expect(identity.label).toBe("k-1");
    expect(JSON.stringify(identity).includes("external-canary")).toBe(false);
  });

  it("reads a person's name and address off the nested person", () => {
    const identity = trelicaAiRowIdentity({
      dimension: "person",
      row: { person: { email: "someone@example.com", name: "Some One" }, personId: "p-1" },
    })!;
    expect(identity.label).toBe("Some One");
    expect(identity.email).toBe("someone@example.com");
  });

  it.each(["cost-center", "person", "team"] as const)(
    "reads no owning app off a %s row, whose boundary declares none",
    (dimension) => {
      const row = {
        costCenterId: "cc-1",
        customerAppId: "app-canary",
        customerAppName: "Canary App",
        memberId: "m-1",
        person: { name: "Some One" },
        personId: "p-1",
      };
      const identity = trelicaAiRowIdentity({ dimension, row })!;

      expect(row.customerAppId).toBe("app-canary");
      expect([identity.customerAppId, identity.customerAppName]).toEqual([null, null]);
    },
  );

  it("identifies nothing when the key is absent", () => {
    expect(trelicaAiRowIdentity({ dimension: "app", row: { customerAppName: "No id" } })).toBe(null);
  });
});

/** One admissible table row per dimension, every key its strict boundary declares as read. */
const ADMISSIBLE_ROWS: Readonly<Record<TrelicaAiUsageResult["dimension"], Record<string, unknown>>> = {
  "api-key": {
    apiKey: { customerAppId: "app-1", name: "prod" },
    customerAppApiKeyId: "k-1",
    customerAppId: "app-1",
    customerAppName: "App",
    metrics: metrics({ spend: 1 }),
  },
  app: { customerAppId: "app-1", customerAppName: "App", metrics: metrics({ spend: 1 }) },
  "cost-center": { costCenterId: "cc-1", metrics: metrics({ spend: 1 }) },
  model: { customerAppId: "app-1", customerAppName: "App", metrics: metrics({ spend: 1 }), model: "gpt-5" },
  person: { metrics: metrics({ spend: 1 }), person: { name: "Some One" }, personId: "p-1" },
  team: { children: [], memberId: "m-1", memberName: "Team", metrics: metrics({ spend: 1 }) },
};

describe("projectTrelicaAiUsage reads only what each dimension's boundary admitted", () => {
  it.each(Object.entries(ADMISSIBLE_ROWS))("reads no key a %s row's boundary does not declare", (dimension, row) => {
    const boundary = TRELICA_AI_USAGE_BOUNDARIES[dimension as TrelicaAiUsageResult["dimension"]];
    const page = { granularity: "Monthly", rows: { items: [row], resultsTruncated: false, total: 1 }, usageByDate: [] };
    unwrap(boundary.parse({ value: page }));
    const read = new Set<string>();
    const recording = new Proxy(row, {
      get: (target, key, receiver) => {
        if (typeof key === "string") {
          read.add(key);
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });

    const projected = projectTrelicaAiUsage({
      at: AT,
      minimumSpend: null,
      result: result({ dimension: dimension as TrelicaAiUsageResult["dimension"], rows: [recording] }),
      window: WINDOW,
    });

    expect(projected.entities.length).toBe(1);
    expect([...read].filter((key) => !Object.hasOwn(row, key))).toEqual([]);
  });
});

describe("projectTrelicaAiUsage", () => {
  it("holds a row with its window, its figures and the series the explorer charted for it", () => {
    const projected = projectTrelicaAiUsage({
      at: AT,
      minimumSpend: null,
      result: result({
        dimension: "app",
        rows: [{ customerAppId: "app-1", customerAppName: "OpenAI Platform", metrics: metrics({ spend: 12 }) }],
        series: [{ customerAppId: "app-1", spendByDate: { "2026-09": 7, "2026-10": 5 } }],
      }),
      window: WINDOW,
    });
    expect(projected.unprojected).toBe(0);
    const entity = projected.entities[0]!;
    expect(entity.providerId).toBe("app:app-1");
    const detail = entity.channels["first-party-api"]!.detail as TrelicaAiUsageDetail;
    expect(detail.metrics.spend).toBe(12);
    expect(detail.spendByPeriod).toEqual({ "2026-09": 7, "2026-10": 5 });
    expect(detail.windowStart).toBe("2024-10-02");
    expect(detail.granularity).toBe("Monthly");
  });

  it("flattens the team tree, each child keyed by its path and pointing at its parent", () => {
    const projected = projectTrelicaAiUsage({
      at: AT,
      minimumSpend: null,
      result: result({
        dimension: "team",
        rows: [
          {
            children: [{ memberId: "t-2", memberName: "Platform", metrics: metrics({ spend: 4 }) }],
            memberId: "t-1",
            memberName: "Engineering",
            metrics: metrics({ spend: 10 }),
          },
        ],
      }),
      window: WINDOW,
    });
    expect(projected.entities.map((entity) => entity.providerId).toSorted()).toEqual(["team:t-1", "team:t-1/t-2"]);
    const child = projected.entities.find((entity) => entity.providerId === "team:t-1/t-2")!;
    const detail = child.channels["first-party-api"]!.detail as TrelicaAiUsageDetail;
    expect(detail.parentId).toBe("t-1");
    expect(detail.level).toBe(1);
  });

  it("leaves out a row below the floor without counting it as unprojected", () => {
    const projected = projectTrelicaAiUsage({
      at: AT,
      minimumSpend: 1,
      result: result({
        dimension: "api-key",
        rows: [
          { apiKey: { name: "big" }, customerAppApiKeyId: "k-1", metrics: metrics({ spend: 40 }) },
          { apiKey: { name: "tiny" }, customerAppApiKeyId: "k-2", metrics: metrics({ spend: 0.002 }) },
        ],
      }),
      window: WINDOW,
    });
    expect(projected.entities.map((entity) => entity.providerId)).toEqual(["api-key:k-1"]);
    expect(projected.unprojected).toBe(0);
  });

  it("counts a row missing a figure rather than zero-filling it", () => {
    const { requests: _dropped, ...partial } = metrics({ spend: 3 });
    const projected = projectTrelicaAiUsage({
      at: AT,
      minimumSpend: null,
      result: result({
        dimension: "app",
        rows: [{ customerAppId: "app-1", customerAppName: "Partial", metrics: partial }],
      }),
      window: WINDOW,
    });
    expect(projected.entities).toEqual([]);
    expect(projected.unprojected).toBe(1);
  });
});

describe("projectTrelicaAiAlerts", () => {
  it("holds an alert with its trend, through the allowlist", () => {
    const entities = projectTrelicaAiAlerts({
      at: AT,
      endpoint: "/AppsApi/AppAIAlert/History",
      records: [
        {
          baselineMedian: 2000,
          customerAppId: "app-1",
          customerAppLogoUrl: "https://example.com/logo.png",
          customerAppName: "OpenAI Platform",
          date: "2026-10-01",
          evalDaySpend: 5700,
          id: "alert-1",
          status: "New",
          subType: "Spike",
          trend: [{ date: "2026-09-30", spend: 2100 }, { date: "broken" }],
          type: "Spike",
        },
        { id: "alert-2" },
      ],
    });
    expect(entities.map((entity) => entity.providerId)).toEqual(["alert-1"]);
    const detail = entities[0]!.channels["first-party-api"]!.detail as TrelicaAiAlertDetail;
    expect(detail).toEqual({
      baselineMedian: 2000,
      customerAppId: "app-1",
      customerAppName: "OpenAI Platform",
      date: "2026-10-01",
      evalDaySpend: 5700,
      status: "New",
      subType: "Spike",
      trend: [{ date: "2026-09-30", spend: 2100 }],
      type: "Spike",
    });
  });
});
