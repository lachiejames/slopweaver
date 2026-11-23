import { describe, expect, it } from "vitest";

import { vantaRiskScenarioDtoSchema, vantaRiskScenariosPageSchema } from "../../../../atlas/vanta/riskApiSchemas.js";

/**
 * A risk scenario shaped exactly as `GET /v1/risk-scenarios` answers live — measured on every row the
 * sync read, each carrying `scoreBreakdown` with the value `null`. Every id is synthetic.
 */
const riskJson = {
  categories: ["Operational"],
  ciaCategories: ["Confidentiality"],
  customFields: [],
  description: "a shared credential reaches production",
  detailedDescription: null,
  identificationDate: "2026-01-02T03:04:05.000Z",
  impact: 4,
  isArchived: false,
  isSensitive: null,
  likelihood: 2,
  note: null,
  owner: "someone@example.invalid",
  requiredApprovers: [],
  residualImpact: 2,
  residualLikelihood: 1,
  reviewStatus: "APPROVED",
  riskId: "risk-1",
  riskRegister: "Enterprise",
  scoreBreakdown: null,
  treatment: "Mitigate",
  type: "Risk Scenario",
};

/** The document's own `ScoreBreakdownEntry` tree: a `SCORE` root and one `FACTOR` child beneath it. */
const breakdown = [
  {
    id: "node-root",
    kind: "SCORE",
    name: "Inherent score",
    parentId: null,
    score: 12.5,
    scoreLabel: "High",
    status: null,
  },
  {
    id: "node-child",
    kind: "FACTOR",
    name: "Data sensitivity",
    parentId: "node-root",
    score: null,
    scoreLabel: null,
    status: "MISSING",
  },
];

describe("vantaRiskScenarioDtoSchema", () => {
  it("accepts the live shape, where scoreBreakdown is null", () => {
    const parsed = vantaRiskScenarioDtoSchema.parse(riskJson);
    expect(parsed.scoreBreakdown).toBeNull();
    expect(parsed.riskId).toBe("risk-1");
  });

  it("accepts a populated breakdown, entry for entry", () => {
    const parsed = vantaRiskScenarioDtoSchema.parse({ ...riskJson, scoreBreakdown: breakdown });
    expect(parsed.scoreBreakdown).toEqual(breakdown);
  });

  it("accepts a row that omits scoreBreakdown entirely, so withdrawing the closed-beta field cannot refuse the page", () => {
    const { scoreBreakdown: _omitted, ...withoutBreakdown } = riskJson;
    const parsed = vantaRiskScenarioDtoSchema.parse(withoutBreakdown);
    expect(parsed.scoreBreakdown).toBeUndefined();
  });

  it("accepts a row that omits detailedDescription, which the document leaves optional", () => {
    const { detailedDescription: _omitted, ...withoutDetail } = riskJson;
    expect(vantaRiskScenarioDtoSchema.parse(withoutDetail)).toStrictEqual(withoutDetail);
  });

  it("still refuses a detailedDescription that is neither a string nor null, at its path", () => {
    const parsed = vantaRiskScenarioDtoSchema.safeParse({ ...riskJson, detailedDescription: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["detailedDescription"]);
  });

  it("refuses an unknown key on the row, naming it — the exact shape that broke the sync", () => {
    const parsed = vantaRiskScenarioDtoSchema.safeParse({ ...riskJson, somethingNew: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.code).toBe("unrecognized_keys");
    expect(parsed.error!.issues[0]!.message).toBe(`Unrecognized key: "somethingNew"`);
  });

  it("refuses an unknown key inside a breakdown entry, at that entry path", () => {
    const entry = { ...breakdown[0], weighting: 0.5 };
    const parsed = vantaRiskScenarioDtoSchema.safeParse({ ...riskJson, scoreBreakdown: [entry] });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.code).toBe("unrecognized_keys");
    expect(parsed.error!.issues[0]!.path).toEqual(["scoreBreakdown", 0]);
  });

  it("refuses a breakdown entry whose kind is not one Vanta documents", () => {
    const entry = { ...breakdown[0], kind: "WEIGHT" };
    const parsed = vantaRiskScenarioDtoSchema.safeParse({ ...riskJson, scoreBreakdown: [entry] });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.code).toBe("invalid_value");
    expect(parsed.error!.issues[0]!.path).toEqual(["scoreBreakdown", 0, "kind"]);
  });
});

describe("vantaRiskScenariosPageSchema", () => {
  it("parses a whole page of rows carrying the field", () => {
    const page = {
      results: {
        data: [riskJson, { ...riskJson, riskId: "risk-2", scoreBreakdown: breakdown }],
        pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
      },
    };
    const parsed = vantaRiskScenariosPageSchema.parse(page);
    expect(parsed.results.data.map((row) => row.riskId)).toEqual(["risk-1", "risk-2"]);
    expect(parsed.results.data[1]!.scoreBreakdown).toEqual(breakdown);
  });

  it("refuses the whole page when one row carries an undeclared key — the failure this test file exists for", () => {
    const page = {
      results: {
        data: [{ ...riskJson, scoreBreakdownV2: null }],
        pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
      },
    };
    const parsed = vantaRiskScenariosPageSchema.safeParse(page);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe(`Unrecognized key: "scoreBreakdownV2"`);
  });
});
