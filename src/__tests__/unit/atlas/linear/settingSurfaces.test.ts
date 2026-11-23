/*
 * The Linear configuration inventory, read directly: its page bounds, its exact row order, and the concrete
 * shape of the rows whose scope or selection is special.
 */
import { describe, expect, it } from "vitest";

import {
  LINEAR_SETTING_SURFACES,
  SETTINGS_MAX_PAGES,
  SETTINGS_PAGE_SIZE,
} from "../../../../atlas/linear/settingSurfaces.js";

describe("settings page bounds", () => {
  it("pages at Linear's own maximum and admits a hundred pages before refusing the read as unbounded", () => {
    expect(SETTINGS_PAGE_SIZE).toBe(250);
    expect(SETTINGS_MAX_PAGES).toBe(100);
  });
});

describe("LINEAR_SETTING_SURFACES rows", () => {
  it("walks every group in a fixed order, so adding, dropping or reordering a row is a reviewed change", () => {
    expect(LINEAR_SETTING_SURFACES.map((row) => row.group)).toEqual([
      "organization",
      "team",
      "workflow-state",
      "integration",
      "issue-label",
      "project-label",
      "initiative-label",
      "project-status",
      "template",
      "webhook",
      "oauth-application",
      "triage-responsibility",
      "time-schedule",
      "customer-status",
      "customer-tier",
      "release-pipeline",
      "custom-emoji",
      "account-setting",
      "issue-priority",
      "sla-configuration",
      "rate-limit",
    ]);
  });

  it("reads teams as a workspace-wide connection keyed on each team's own key", () => {
    const team = LINEAR_SETTING_SURFACES.find((row) => row.group === "team")!;
    expect(team.shape).toEqual({ field: "teams", kind: "connection" });
    expect(team.perTeam).toBe(false);
    expect(team.teamKeyPath).toEqual(["key"]);
  });

  it("fans the SLA configuration out per team, as a list taking a teamId", () => {
    const sla = LINEAR_SETTING_SURFACES.find((row) => row.group === "sla-configuration")!;
    expect(sla.shape).toEqual({ field: "slaConfigurations", kind: "list" });
    expect(sla.perTeam).toBe(true);
    expect(sla.document).toContain("$teamId");
  });

  it("reads the rate-limit budgets as one workspace-scoped object with no label", () => {
    const rateLimit = LINEAR_SETTING_SURFACES.find((row) => row.group === "rate-limit")!;
    expect(rateLimit.shape).toEqual({ field: "rateLimitStatus", kind: "single" });
    expect(rateLimit.labelField).toBe(null);
    expect(rateLimit.teamKeyPath).toBe(null);
  });

  it("selects a webhook's public fields at the full page size and never its signing secret", () => {
    const webhook = LINEAR_SETTING_SURFACES.find((row) => row.group === "webhook")!;
    expect(webhook.document).toBe(
      "query LinearAtlasWebhooks($after: String) { webhooks(first: 250, after: $after) { nodes { id label url enabled resourceTypes createdAt updatedAt team { key } } pageInfo { hasNextPage endCursor } } }",
    );
    expect(webhook.document.includes("secret")).toBe(false);
  });
});
