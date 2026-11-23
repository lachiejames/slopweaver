import { describe, expect, it } from "vitest";

import {
  LINEAR_SETTING_SURFACES,
  type LinearSettingSurface,
  SETTINGS_PAGE_SIZE,
} from "../../../../atlas/linear/settingSurfaces.js";
import { projectSettingSurface, settingsPageCursor } from "../../../../atlas/linear/settings.js";

const surface = ({
  group,
  field,
  kind,
  perTeam = false,
  teamKeyPath = null,
  labelField = "name",
}: {
  group: string;
  field: string;
  kind: "single" | "list" | "connection";
  perTeam?: boolean;
  teamKeyPath?: readonly string[] | null;
  labelField?: string | null;
}): LinearSettingSurface => ({
  document: "query X { y }",
  group,
  labelField,
  perTeam,
  shape: { field, kind },
  teamKeyPath,
  whyRead: "a test",
});

describe("projectSettingSurface", () => {
  it("keys a single-object surface on its group, because there is exactly one of it", () => {
    const records = projectSettingSurface({
      data: { organization: { name: "Acme", urlKey: "acme" } },
      surface: surface({ field: "organization", group: "organization", kind: "single" }),
    });
    expect(records.length).toBe(1);
    expect(records[0]!.providerId).toBe("organization:organization");
    expect(records[0]!.detail.settingScope).toBe("workspace");
    expect(records[0]!.detail.label).toBe("Acme");
  });

  it("keys a connection row on the provider's own id", () => {
    const records = projectSettingSurface({
      data: { workflowStates: { nodes: [{ id: "abc", name: "Todo", team: { key: "ENG" } }] } },
      surface: surface({
        field: "workflowStates",
        group: "workflow-state",
        kind: "connection",
        teamKeyPath: ["team", "key"],
      }),
    });
    expect(records[0]!.providerId).toBe("workflow-state:abc");
    expect(records[0]!.detail.settingScope).toBe("ENG");
  });

  it("puts the TEAM in a fanned-out row's key, so one object reachable from two teams is two records", () => {
    const sla = surface({ field: "slaConfigurations", group: "sla-configuration", kind: "list", perTeam: true });
    const forEng = projectSettingSurface({
      data: { slaConfigurations: [{ id: "s1", name: "P1" }] },
      surface: sla,
      teamKey: "ENG",
    });
    const forOps = projectSettingSurface({
      data: { slaConfigurations: [{ id: "s1", name: "P1" }] },
      surface: sla,
      teamKey: "OPS",
    });
    expect(forEng[0]!.providerId).toBe("sla-configuration:ENG:s1");
    expect(forOps[0]!.providerId).toBe("sla-configuration:OPS:s1");
    expect(forEng[0]!.detail.settingScope).toBe("ENG");
  });

  it("falls back to the workspace scope when a team-keyed row names no team", () => {
    const records = projectSettingSurface({
      data: { issueLabels: { nodes: [{ id: "l1", name: "bug", team: null }] } },
      surface: surface({
        field: "issueLabels",
        group: "issue-label",
        kind: "connection",
        teamKeyPath: ["team", "key"],
      }),
    });
    expect(records[0]!.detail.settingScope).toBe("workspace");
  });

  it("reads a plain list surface", () => {
    const records = projectSettingSurface({
      data: { templates: [{ id: "t1", name: "Bug report" }] },
      surface: surface({ field: "templates", group: "template", kind: "list" }),
    });
    expect(records[0]!.providerId).toBe("template:t1");
  });

  it("answers with no records when the surface's field is absent", () => {
    expect(
      projectSettingSurface({ data: {}, surface: surface({ field: "teams", group: "team", kind: "connection" }) }),
    ).toEqual([]);
  });

  it("carries an empty label rather than a missing one when the row has no label field", () => {
    const records = projectSettingSurface({
      data: { rateLimitStatus: { identifier: "x" } },
      surface: surface({ field: "rateLimitStatus", group: "rate-limit", kind: "single", labelField: null }),
    });
    expect(records[0]!.detail.label).toBe("");
  });
});

describe("settingsPageCursor", () => {
  it("reports the next page of a connection", () => {
    const page = settingsPageCursor({
      data: { teams: { nodes: [], pageInfo: { endCursor: "c1", hasNextPage: true } } },
      surface: surface({ field: "teams", group: "team", kind: "connection" }),
    });
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBe("c1");
  });

  it("reports no next page when the provider says the connection is exhausted", () => {
    const page = settingsPageCursor({
      data: { teams: { nodes: [], pageInfo: { endCursor: "c1", hasNextPage: false } } },
      surface: surface({ field: "teams", group: "team", kind: "connection" }),
    });
    expect(page.hasNextPage).toBe(false);
  });

  it("refuses to page when the provider claims another page and hands back no cursor", () => {
    const page = settingsPageCursor({
      data: { teams: { nodes: [], pageInfo: { endCursor: null, hasNextPage: true } } },
      surface: surface({ field: "teams", group: "team", kind: "connection" }),
    });
    expect(page.hasNextPage).toBe(false);
  });

  it("says a non-connection surface has no next page", () => {
    const page = settingsPageCursor({
      data: { organization: { id: "o" } },
      surface: surface({ field: "organization", group: "organization", kind: "single" }),
    });
    expect(page.hasNextPage).toBe(false);
    expect(page.endCursor).toBe(null);
  });
});

describe("LINEAR_SETTING_SURFACES", () => {
  it("has at least one entry in LINEAR_SETTING_SURFACES, so the guards below are not vacuously green", () => {
    expect(LINEAR_SETTING_SURFACES.length).toBeGreaterThan(0);
  });

  it("gives every group a distinct name, so two rows cannot write one another's records", () => {
    const groups = LINEAR_SETTING_SURFACES.map((row) => row.group);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("asks every connection for a cursor and a pageInfo, so no read can silently truncate", () => {
    const connections = LINEAR_SETTING_SURFACES.filter((row) => row.shape.kind === "connection");
    // Asserted as FIELD NAMES rather than as our old literal text: an SDK-generated document reaches the
    // same fields through a `...PageInfo` spread, and a text check for `pageInfo { hasNextPage endCursor }`
    // would report a document that pages perfectly well as unbounded.
    expect(connections.filter((row) => !row.document.includes("hasNextPage"))).toEqual([]);
    expect(connections.filter((row) => !row.document.includes("endCursor"))).toEqual([]);
    expect(connections.filter((row) => !row.document.includes("$after"))).toEqual([]);
  });

  it("pages at Linear's own maximum", () => {
    expect(SETTINGS_PAGE_SIZE).toBe(250);
  });

  it("selects no field whose value is a credential", () => {
    const denied = [
      "secret",
      "calendarHash",
      "samlSettings",
      "scimSettings",
      "authSettings",
      "aiProviderConfiguration",
    ];
    expect(LINEAR_SETTING_SURFACES.filter((row) => denied.some((field) => row.document.includes(field)))).toEqual([]);
  });

  it("sends a teamId only from a row that fans out per team", () => {
    expect(LINEAR_SETTING_SURFACES.filter((row) => row.document.includes("$teamId") !== row.perTeam)).toEqual([]);
  });
});
