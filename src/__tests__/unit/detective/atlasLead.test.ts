import { describe, expect, it } from "vitest";

import { ATLAS_LEAD_SOURCE, atlasLeads, atlasLeadWeight } from "../../../detective/atlasLead.js";
import { renderBrief } from "../../../detective/brief.js";
import type { AtlasProbeCell, AtlasProbeReport, AtlasProbeRow } from "../../../store/atlas/probe.js";

/** One cell, overridden per case. */
function cell(over: Partial<AtlasProbeCell> = {}): AtlasProbeCell {
  return {
    byDetail: 0,
    byName: 6,
    entities: 6,
    kind: "user",
    lastAttemptOutcome: "ok",
    lastSuccessAtIso: "2026-09-20T01:02:03.000Z",
    platform: "jumpcloud",
    ...over,
  };
}

/** One keyword's row, overridden per case. */
function row(over: Partial<AtlasProbeRow> = {}): AtlasProbeRow {
  return { cells: [], elapsedMs: 9, platformNames: [], subject: "airtable", ...over };
}

/** A whole report, overridden per case. */
function report(over: Partial<AtlasProbeReport> = {}): AtlasProbeReport {
  return { atlasEntities: 695_759, elapsedMs: 1_700, holdings: [], platform: null, rows: [], ...over };
}

describe("atlasLeadWeight — the hit KIND dominates, the count only breaks ties", () => {
  it("ranks one platform-name hit above nine detail hits", () => {
    const named = atlasLeadWeight({ hits: 1, kinds: new Set(["platform-name"] as const) });
    const detail = atlasLeadWeight({ hits: 9, kinds: new Set(["detail"] as const) });
    expect(named).toBeGreaterThan(detail);
  });

  it("breaks a tie between two same-kind buckets on the cell count", () => {
    const many = atlasLeadWeight({ hits: 5, kinds: new Set(["detail"] as const) });
    const few = atlasLeadWeight({ hits: 1, kinds: new Set(["detail"] as const) });
    expect(many).toBeGreaterThan(few);
  });

  it("takes the STRONGEST kind when a platform matched several", () => {
    const mixed = atlasLeadWeight({ hits: 1, kinds: new Set(["detail", "kind-name"] as const) });
    const detailOnly = atlasLeadWeight({ hits: 1, kinds: new Set(["detail"] as const) });
    expect(mixed).toBeGreaterThan(detailOnly);
  });
});

describe("atlasLeads", () => {
  it("returns nothing for a report that found nothing, so no detective is spent on the atlases", () => {
    expect(atlasLeads({ report: report({ rows: [row()] }) })).toEqual([]);
  });

  it("gives ONE lead per platform even when that platform matched several kinds", () => {
    const leads = atlasLeads({
      report: report({
        rows: [
          row({
            cells: [
              cell({ entities: 500, kind: "application", platform: "jumpcloud" }),
              cell({ entities: 40, kind: "group", platform: "jumpcloud" }),
              cell({ entities: 8, kind: "user", platform: "jumpcloud" }),
            ],
          }),
        ],
      }),
    });
    expect(leads.length).toBe(1);
    expect(leads[0]!.startShape).toBe("jumpcloud");
  });

  it("gives every lead ONE source, so the round-robin hands the whole estate one slot per round", () => {
    const leads = atlasLeads({
      report: report({
        rows: [row({ cells: [cell({ platform: "jumpcloud" }), cell({ platform: "vanta" })] })],
      }),
    });
    expect(leads.map((lead) => lead.source)).toEqual([ATLAS_LEAD_SOURCE, ATLAS_LEAD_SOURCE]);
  });

  it("carries the REAL entity count in the why, and a nominal weight in rows", () => {
    const leads = atlasLeads({
      report: report({ rows: [row({ cells: [cell({ entities: 191_732, kind: "application" })] })] }),
    });
    expect(leads[0]!.why).toContain("191732 stored record(s)");
    expect(leads[0]!.rows).toBeLessThan(191_732);
  });

  it("names the staleness of the cell it opens on", () => {
    const leads = atlasLeads({
      report: report({ rows: [row({ cells: [cell({ lastSuccessAtIso: "2026-09-19T17:40:04.640Z" })] })] }),
    });
    expect(leads[0]!.why).toContain("last synced 2026-09-19T17:40:04.640Z");
  });

  it("says a kind has NEVER synced rather than staying quiet about it", () => {
    const leads = atlasLeads({ report: report({ rows: [row({ cells: [cell({ lastSuccessAtIso: null })] })] }) });
    expect(leads[0]!.why).toContain("NEVER synced successfully");
  });

  it("names a failed latest attempt, which is the third cause of a zero", () => {
    const leads = atlasLeads({
      report: report({ rows: [row({ cells: [cell({ lastAttemptOutcome: "auth-failed" })] })] }),
    });
    expect(leads[0]!.why).toContain("latest attempt auth-failed");
  });

  it("leads on a platform the question NAMES, even when it stored no matching row", () => {
    const leads = atlasLeads({
      report: report({
        rows: [
          row({ platformNames: ["airtable"], subject: "airtable" }),
          row({ cells: [cell({ byDetail: 9, byName: 0, entities: 9 })], subject: "password" }),
        ],
      }),
    });
    expect(leads[0]!.startShape).toBe("airtable");
    expect(leads[0]!.why).toContain("names the airtable atlas itself");
  });

  it("drops a keyword under the shared minimum, so a hand-built report cannot smuggle one past", () => {
    const leads = atlasLeads({ report: report({ rows: [row({ cells: [cell()], subject: "ab" })] }) });
    expect(leads).toEqual([]);
  });

  it("orders strongest first and breaks a tie on the platform, so two runs order identically", () => {
    const leads = atlasLeads({
      report: report({
        rows: [
          row({ cells: [cell({ entities: 3, kind: "user", platform: "vanta" })] }),
          row({ cells: [cell({ entities: 3, kind: "user", platform: "github" })], subject: "sync" }),
        ],
      }),
    });
    expect(leads.map((lead) => lead.startShape)).toEqual(["github", "vanta"]);
  });

  it("folds two keywords onto one platform rather than spending two detectives on it", () => {
    const leads = atlasLeads({
      report: report({
        rows: [
          row({ cells: [cell({ entities: 6, kind: "user" })], subject: "airtable" }),
          row({ cells: [cell({ entities: 4, kind: "group" })], subject: "sync" }),
        ],
      }),
    });
    expect(leads.length).toBe(1);
    expect(leads[0]!.why).toContain(`"airtable", "sync"`);
    expect(leads[0]!.why).toContain("10 stored record(s)");
  });
});

describe("the brief an atlas lead renders", () => {
  it("opens on the platform, and carries the honesty contract a count needs", () => {
    const leads = atlasLeads({
      report: report({ rows: [row({ cells: [cell({ entities: 162, kind: "vulnerability", platform: "vanta" })] })] }),
    });
    const brief = renderBrief({
      context: {
        index: 1,
        nameFinding: null,
        question: "what do we know about airtable sync failures",
        recalled: [],
        reportPath: "/tmp/report-1.md",
        total: 1,
      },
      lead: leads[0]!,
    });
    expect(brief).toContain("Your lead is in an ATLAS, not in the corpus");
    expect(brief).toContain("slopweaver atlas vanta read --query");
    expect(brief).toContain("A ZERO is not a provider holding none");
    expect(brief).toContain("slopweaver atlas <platform> coverage");
  });

  it("does NOT print the atlas block for a store lead, so a store detective reads no page it will not use", () => {
    const brief = renderBrief({
      context: {
        index: 1,
        nameFinding: null,
        question: "what happened",
        recalled: [],
        reportPath: "/tmp/report-1.md",
        total: 1,
      },
      lead: { keyword: "airtable", rows: 12, source: "slack", startShape: "exact", why: "12 slack record(s)" },
    });
    expect(brief).not.toContain("A ZERO is not a provider holding none");
  });
});
