import { describe, expect, it } from "vitest";

import { renderBrief } from "../../../detective/brief.js";
import { type HexAtlasSubject, hexLeads, hexLeadWeight } from "../../../detective/hexLead.js";

/** One atlas subject, overridden per case. */
function subject(over: Partial<HexAtlasSubject> = {}): HexAtlasSubject {
  return {
    categories: [],
    description: null,
    family: "project",
    name: "Growth cockpit",
    projectId: "p1",
    queriedTables: [],
    ...over,
  };
}

describe("hexLeadWeight — the hit KIND dominates, the count only breaks ties", () => {
  it("ranks one title hit above nine connection hits", () => {
    const title = hexLeadWeight({ hits: 1, kinds: new Set(["project-title"] as const) });
    const connections = hexLeadWeight({ hits: 9, kinds: new Set(["connection"] as const) });
    expect(title).toBeGreaterThan(connections);
  });

  it("breaks a tie between two same-kind buckets on the count", () => {
    const many = hexLeadWeight({ hits: 4, kinds: new Set(["queried-table"] as const) });
    const few = hexLeadWeight({ hits: 1, kinds: new Set(["queried-table"] as const) });
    expect(many).toBeGreaterThan(few);
  });

  it("takes the STRONGEST kind when a subject matched several", () => {
    const mixed = hexLeadWeight({ hits: 1, kinds: new Set(["queried-table", "project-title"] as const) });
    const tableOnly = hexLeadWeight({ hits: 1, kinds: new Set(["queried-table"] as const) });
    expect(mixed).toBeGreaterThan(tableOnly);
  });
});

describe("hexLeads", () => {
  it("returns nothing when no keyword touches anything, so no detective is sent to Hex", () => {
    expect(hexLeads({ keywords: ["quarterly", "revenue"], subjects: [subject()] })).toEqual([]);
  });

  it("opens a lead on the project id when a title matches", () => {
    const leads = hexLeads({ keywords: ["cockpit"], subjects: [subject()] });
    expect(leads.length).toBe(1);
    expect(leads[0]!.source).toBe("hex");
    expect(leads[0]!.startShape).toBe("p1");
    expect(leads[0]!.keyword).toBe("cockpit");
  });

  it("reaches a question nobody phrased in the notebook's words, through a QUERIED TABLE name", () => {
    const leads = hexLeads({
      keywords: ["booking"],
      subjects: [subject({ queriedTables: ["public.Booking", "public.User"] })],
    });
    expect(leads.length).toBe(1);
    expect(leads[0]!.why).toContain("public.Booking");
  });

  it("matches a keyword the project's author wrote only in its description", () => {
    const leads = hexLeads({
      keywords: ["retention"],
      subjects: [subject({ description: "Weekly retention by cohort" })],
    });
    expect(leads.length).toBe(1);
    expect(leads[0]!.why).toBe(
      'the Hex atlas holds the project "Growth cockpit" matching "retention" (project-description)',
    );
  });

  it("opens no lead from a description nobody wrote", () => {
    expect(hexLeads({ keywords: ["retention"], subjects: [subject({ description: null })] })).toEqual([]);
  });

  it("skips a keyword too short to discriminate", () => {
    expect(hexLeads({ keywords: ["co"], subjects: [subject()] })).toEqual([]);
  });

  it("folds every connection hit into ONE workspace-wide lead carrying no project", () => {
    const leads = hexLeads({
      keywords: ["bigquery"],
      subjects: [
        subject({ family: "connection", name: "BigQuery prod", projectId: null }),
        subject({ family: "connection", name: "BigQuery staging", projectId: null }),
      ],
    });
    expect(leads.length).toBe(1);
    expect(leads[0]!.startShape).toBeNull();
    expect(leads[0]!.why).toContain("BigQuery prod, BigQuery staging");
  });

  it("orders a title match above a table-only match", () => {
    const leads = hexLeads({
      keywords: ["booking"],
      subjects: [
        subject({ name: "Site capacity", projectId: "p2", queriedTables: ["public.Booking"] }),
        subject({ name: "Booking health", projectId: "p1" }),
      ],
    });
    expect(leads.map((lead) => lead.startShape)).toEqual(["p1", "p2"]);
  });

  it("orders identically across two runs of the same input", () => {
    const subjects = [
      subject({ name: "Alpha", projectId: "a", queriedTables: ["public.Booking"] }),
      subject({ name: "Beta", projectId: "b", queriedTables: ["public.Booking"] }),
    ];
    const first = hexLeads({ keywords: ["booking"], subjects });
    const second = hexLeads({ keywords: ["booking"], subjects });
    expect(first.map((lead) => lead.startShape)).toEqual(second.map((lead) => lead.startShape));
  });
});

describe("the brief's Hex section", () => {
  const context = {
    index: 1,
    nameFinding: null,
    question: "who is affected beyond fifteen days",
    recalled: [],
    reportPath: "/tmp/report-1.md",
    total: 2,
  };

  it("prints the Hex ladder and the never-ingest rule for a Hex lead", () => {
    const brief = renderBrief({
      context,
      lead: { keyword: "booking", rows: 4000, source: "hex", startShape: "p1", why: "the Hex atlas holds it" },
    });
    expect(brief).toContain("slopweaver hex output");
    expect(brief).toContain("Hex is never ingested into the corpus");
    expect(brief).toContain("fifteen days");
  });

  it("tells a Hex detective to open on its project and read the SQL first", () => {
    const brief = renderBrief({
      context,
      lead: { keyword: "booking", rows: 4000, source: "hex", startShape: "p1", why: "the Hex atlas holds it" },
    });
    expect(brief).toContain("slopweaver hex project --project p1 --tables");
  });

  it("sends a connection-wide Hex lead to the project list rather than to a project", () => {
    const brief = renderBrief({
      context,
      lead: { keyword: "bigquery", rows: 1001, source: "hex", startShape: null, why: "a warehouse" },
    });
    expect(brief).toContain("slopweaver hex projects");
  });

  it("prints NO Hex section for a store lead", () => {
    const brief = renderBrief({
      context,
      lead: { keyword: "booking", rows: 12, source: "slack", startShape: "exact", why: "12 slack record(s)" },
    });
    expect(brief).not.toContain("## Hex —");
  });

  it("prints NO Hex section for a Datadog lead, whose own section is there instead", () => {
    const brief = renderBrief({
      context,
      lead: { keyword: "cal", rows: 4000, source: "datadog", startShape: "svc", why: "the catalogue names svc" },
    });
    expect(brief).not.toContain("## Hex —");
    expect(brief).toContain("## Datadog —");
  });
});
