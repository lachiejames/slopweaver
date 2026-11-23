/**
 * The Aether reduction over the portal's REAL response shapes.
 *
 * These bodies are the ones the live API returned — `/api/findings?tab=<state>` carrying `data[]`, and
 * `/api/findings/stats` carrying `sources[]`. The fixtures mirror them exactly, so a change to the reduction
 * that stops parsing the real portal fails here rather than in a live walk.
 */
import { describe, expect, it } from "vitest";

import { type ReducibleResponse, reduceAetherPortal } from "../../../../atlas/aether/reduction.js";

const AT = "2026-09-15T12:00:00.000Z";

/** One finding row as `/api/findings` returns it. */
function findingRow({
  id,
  code,
  severity,
  title = "A finding",
}: {
  id: number;
  code: string;
  severity: string;
  title?: string;
}): Record<string, unknown> {
  return {
    createdAt: "2026-04-14T11:21:46+00:00",
    findingId: code,
    id,
    lastUpdatedAt: "2026-04-22T05:09:16+00:00",
    projectName: "Application Suite",
    severity,
    sourceType: "report",
    status: 1,
    title,
  };
}

/** A `/api/findings?tab=<state>` response. */
function findingsResponse({ tab, rows }: { tab: string; rows: readonly Record<string, unknown>[] }): ReducibleResponse {
  return {
    body: { data: rows, page: 1, total: rows.length, totalPages: 1 },
    url: `https://app.tryaether.ai/api/findings?tab=${tab}&page=1&limit=100`,
  };
}

/** The `/api/findings/stats` response, carrying the project sources. */
const statsResponse: ReducibleResponse = {
  body: {
    severities: { critical: 0, high: 0, info: 0, low: 4, medium: 29 },
    sources: [{ name: "Application Suite", uuid: "00ecd21a-876e-4ae9-9218-2dc5711f88a9" }],
    statuses: { accepted_risk: 0, false_positive: 0, open: 33, resolved: 0, retesting: 0 },
    total: 33,
  },
  url: "https://app.tryaether.ai/api/findings/stats",
};

describe("reduceAetherPortal", () => {
  it("reduces an open finding with its code, severity, dates and the state from the tab", () => {
    const result = reduceAetherPortal({
      at: AT,
      responses: [
        findingsResponse({ rows: [findingRow({ code: "AETHER-APP-127", id: 2464, severity: "medium" })], tab: "open" }),
      ],
    });
    expect(result.findings.length).toBe(1);
    const finding = result.findings[0]!;
    expect(finding.code).toBe("AETHER-APP-127");
    expect(finding.severity).toBe("medium");
    expect(finding.findingState).toBe("open");
    expect(finding.providerId).toBe("2464");
    expect(finding.projectName).toBe("Application Suite");
    expect(finding.reportedAt).toBe("2026-04-14T11:21:46.000Z");
    expect(finding.updatedAt).toBe("2026-04-22T05:09:16.000Z");
    expect(finding.sourceType).toBe("report");
  });

  it("takes the finding state from the request tab, not the numeric status on the row", () => {
    const result = reduceAetherPortal({
      at: AT,
      responses: [
        findingsResponse({ rows: [findingRow({ code: "AETHER-APP-050", id: 1, severity: "low" })], tab: "closed" }),
      ],
    });
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]!.findingState).toBe("closed");
  });

  it("dedupes a finding that appears in two responses, keeping the first", () => {
    const row = findingRow({ code: "AETHER-APP-127", id: 2464, severity: "medium" });
    const result = reduceAetherPortal({
      at: AT,
      responses: [findingsResponse({ rows: [row], tab: "open" }), findingsResponse({ rows: [row], tab: "open" })],
    });
    expect(result.findings.length).toBe(1);
  });

  it("reduces the project from the stats sources, counting its open findings", () => {
    const result = reduceAetherPortal({
      at: AT,
      responses: [
        statsResponse,
        findingsResponse({ rows: [findingRow({ code: "AETHER-APP-1", id: 1, severity: "medium" })], tab: "open" }),
        findingsResponse({ rows: [findingRow({ code: "AETHER-APP-2", id: 2, severity: "low" })], tab: "closed" }),
      ],
    });
    expect(result.projects.length).toBe(1);
    const project = result.projects[0]!;
    expect(project.name).toBe("Application Suite");
    expect(project.providerId).toBe("00ecd21a-876e-4ae9-9218-2dc5711f88a9");
    expect(project.openFindingCount).toBe(1);
  });

  it("returns a finding with an unknown severity as unprojectable rather than storing a guess", () => {
    const result = reduceAetherPortal({
      at: AT,
      responses: [
        findingsResponse({
          rows: [findingRow({ code: "AETHER-APP-9", id: 9, severity: "catastrophic" })],
          tab: "open",
        }),
      ],
    });
    expect(result.findings.length).toBe(0);
    expect(result.unprojectable.length).toBe(1);
    expect(result.unprojectable[0]!).toContain("AETHER-APP-9");
  });

  it("refuses to state a finding whose response URL carries no known lifecycle tab", () => {
    const result = reduceAetherPortal({
      at: AT,
      responses: [
        {
          body: { data: [findingRow({ code: "AETHER-APP-3", id: 3, severity: "medium" })] },
          url: "https://app.tryaether.ai/api/findings?page=1",
        },
      ],
    });
    expect(result.findings.length).toBe(0);
    expect(result.unprojectable.length).toBe(1);
    expect(result.unprojectable[0]!).toContain("no known lifecycle tab");
  });

  it("ignores a response whose body is not a findings list", () => {
    const result = reduceAetherPortal({
      at: AT,
      responses: [{ body: { messages: [] }, url: "https://app.tryaether.ai/api/chat" }],
    });
    expect(result.findings.length).toBe(0);
    expect(result.projects.length).toBe(0);
    expect(result.unprojectable.length).toBe(0);
  });
});
