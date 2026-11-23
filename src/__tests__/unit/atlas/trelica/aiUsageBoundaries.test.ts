import { describe, expect, it } from "vitest";

import { TRELICA_AI_USAGE_READS } from "../../../../atlas/trelica/aiUsage.js";
import { TRELICA_AI_USAGE_BOUNDARIES } from "../../../../atlas/trelica/aiUsageBoundaries.js";
import { unwrap } from "../../../../lib/result.js";

/** The ten figures every row carries. */
const METRICS = {
  cachedInputTokens: 0,
  cachedOutputTokens: 0,
  credits: 0,
  inputTokens: 10,
  linesOfCodeAdded: 0,
  linesOfCodeRemoved: 0,
  outputTokens: 5,
  requests: 1,
  spend: 2.5,
  totalTokens: 15,
};

/** One page of a dimension, its table and series as given. */
function usagePage({ rows, series }: { rows: readonly unknown[]; series: readonly unknown[] }): unknown {
  return {
    granularity: "Monthly",
    rows: { items: rows, resultsTruncated: false, total: rows.length },
    usageByDate: series,
  };
}

/** One team row with the children given. */
function teamRow({ memberId, children }: { memberId: string; children: readonly unknown[] }): unknown {
  return { children, memberId, memberName: `Team ${memberId}`, metrics: METRICS };
}

describe("TRELICA_AI_USAGE_BOUNDARIES", () => {
  it("has a boundary for every dimension the explorer is read by", () => {
    expect(Object.keys(TRELICA_AI_USAGE_READS).length).toBeGreaterThan(0);
    expect(Object.keys(TRELICA_AI_USAGE_BOUNDARIES).toSorted()).toEqual(Object.keys(TRELICA_AI_USAGE_READS).toSorted());
  });

  it("admits a team tree three levels deep", () => {
    const tree = teamRow({
      children: [teamRow({ children: [teamRow({ children: [], memberId: "c" })], memberId: "b" })],
      memberId: "a",
    });
    const page = unwrap(TRELICA_AI_USAGE_BOUNDARIES.team.parse({ value: usagePage({ rows: [tree], series: [] }) }));
    expect(page.rows.items).toEqual([tree]);
  });

  it("refuses a fourth level of team rather than dropping it", () => {
    const deepest = teamRow({ children: [teamRow({ children: [], memberId: "d" })], memberId: "c" });
    const tree = teamRow({ children: [teamRow({ children: [deepest], memberId: "b" })], memberId: "a" });
    const refused = TRELICA_AI_USAGE_BOUNDARIES.team.parse({ value: usagePage({ rows: [tree], series: [] }) });
    expect(refused._unsafeUnwrapErr().message).toBe(
      'POST /AppsApi/AppAIUsage (team) answered a shape this version does not read — refused, not guessed: field "rows.items[0].children[0].children[0].children[0]" changed: Invalid input: expected never, received object',
    );
  });

  it("admits a person series entry with no email, as one in six measured did", () => {
    const series = {
      person: { name: "Some One" },
      personId: "person-1",
      spendByDate: { "2026-09": 1, "2026-10": null },
    };
    const page = unwrap(TRELICA_AI_USAGE_BOUNDARIES.person.parse({ value: usagePage({ rows: [], series: [series] }) }));
    expect(page.usageByDate).toEqual([series]);
  });

  it("refuses a cost-centre name, which no measured row carried", () => {
    const row = { costCenterId: "cc-1", costCenterName: "Engineering", metrics: METRICS };
    const refused = TRELICA_AI_USAGE_BOUNDARIES["cost-center"].parse({ value: usagePage({ rows: [row], series: [] }) });
    expect(refused._unsafeUnwrapErr().message).toBe(
      'POST /AppsApi/AppAIUsage (cost-center) answered a shape this version does not read — refused, not guessed: new field "rows.items[0].costCenterName"',
    );
  });

  it("keeps an API key's name and nothing of its vendor id in the census view", () => {
    const boundary = TRELICA_AI_USAGE_BOUNDARIES["api-key"];
    const row = {
      apiKey: { externalId: "sk-vendor-id", name: "Build key" },
      customerAppApiKeyId: "key-1",
      customerAppId: "ca-1",
      customerAppName: "Example AI",
      metrics: METRICS,
    };
    const admitted = unwrap(boundary.parse({ value: usagePage({ rows: [row], series: [] }) }));
    expect(boundary.censusView({ value: admitted })).toEqual(
      usagePage({ rows: [{ ...row, apiKey: { externalId: null, name: "Build key" } }], series: [] }),
    );
  });
});
