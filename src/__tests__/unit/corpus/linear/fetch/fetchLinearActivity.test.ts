/**
 * `fetchLinearActivity` over the injected seam: each lane paged to exhaustion, the page-size cap, the window it
 * threads, a failing lane named incomplete, and a cursor that repeats or an empty page that still carries one.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { fetchLinearActivity, type LinearApi } from "../../../../../corpus/linear/fetch.js";
import { collectLinearIssues, collectLinearProjects } from "../../../../../corpus/linear/fetchCollect.js";
import { issue, issuesPage } from "./harness.js";

describe("fetchLinearActivity", () => {
  it("pages issues + projects to exhaustion via the injected seam", async () => {
    const api: LinearApi = {
      issues: async ({ cursor }) =>
        cursor === undefined
          ? issuesPage({ identifiers: ["ENG-1"], nextCursor: "c2" })
          : issuesPage({ identifiers: ["ENG-2"] }),
      projects: async () => ({
        projects: [{ id: "p1", name: "Quality", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }],
      }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.issues.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(result.projects.map((p) => p.id)).toEqual(["p1"]);
  });

  it("carries the history rows out of the issues lane, accumulated across pages", async () => {
    const row = ({ eventId, tsIso }: { eventId: string; tsIso: string }) => ({
      changes: {},
      container: "linear/ENG",
      eventId,
      source: "linear" as const,
      stream: "history" as const,
      subjectId: "ENG-1",
      tsIso,
      version: 1 as const,
    });
    const api: LinearApi = {
      issues: async ({ cursor }) =>
        cursor === undefined
          ? {
              historyRows: [row({ eventId: "h1", tsIso: "2026-05-01T00:00:00.000Z" })],
              issues: [issue({ identifier: "ENG-1" })],
              nextCursor: "c2",
            }
          : {
              historyRows: [row({ eventId: "h2", tsIso: "2026-05-02T00:00:00.000Z" })],
              issues: [issue({ identifier: "ENG-2" })],
            },
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.historyRows.map((r) => r.eventId)).toEqual(["h1", "h2"]);
  });

  it("folds each page's nested-walk warnings in page order, and a page omitting the field adds none", async () => {
    const lanes: LinearApi = {
      issues: async ({ cursor }) =>
        cursor === undefined
          ? { ...issuesPage({ identifiers: ["ENG-1"], nextCursor: "c2" }), warnings: ["issue comments overflowed"] }
          : issuesPage({ identifiers: ["ENG-2"] }),
      projects: async ({ cursor }) =>
        cursor === undefined
          ? { nextCursor: "p2", projects: [{ id: "p1", name: "Quality", tsIso: "", url: "u" }] }
          : { projects: [{ id: "p2", name: "Speed", tsIso: "", url: "u" }], warnings: ["project teams overflowed"] },
      users: async () => ({ nodes: [] }),
    };
    const window = { since: "2026-01-01" };
    const issues = await collectLinearIssues({ api: lanes, since: window.since });
    expect(issues.warnings).toEqual(["issue comments overflowed"]);
    const projects = await collectLinearProjects({ api: lanes, since: window.since });
    expect(projects.warnings).toEqual(["project teams overflowed"]);
    const silent = await collectLinearIssues({
      api: { ...lanes, issues: async () => issuesPage({ identifiers: ["ENG-3"] }) },
      since: window.since,
    });
    expect(silent.warnings).toEqual([]);
  });

  it("caps each lane at maxItems and requests it as the page size", async () => {
    const seenIssuePageSizes: (number | undefined)[] = [];
    const api: LinearApi = {
      issues: async ({ pageSize }) => {
        seenIssuePageSizes.push(pageSize);
        return issuesPage({ identifiers: ["ENG-1", "ENG-2", "ENG-3"] });
      },
      projects: async () => ({
        projects: [
          { id: "p1", name: "Quality", tsIso: "", url: "u" },
          { id: "p2", name: "Speed", tsIso: "", url: "u" },
          { id: "p3", name: "Trust", tsIso: "", url: "u" },
        ],
      }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(
      await fetchLinearActivity({ api, maxItems: 2, window: { since: "2026-01-01", until: "2026-06-01" } }),
    );
    expect(result.issues.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(result.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(seenIssuePageSizes).toEqual([2]);
  });

  it("collects the best-effort initiatives lane when present, and stays empty when absent", async () => {
    const withInitiatives: LinearApi = {
      initiatives: async () => ({
        initiatives: [{ id: "i1", name: "North star", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }],
      }),
      issues: async () => issuesPage({ identifiers: [] }),
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const withResult = unwrap(
      await fetchLinearActivity({ api: withInitiatives, window: { since: "2026-01-01", until: "2026-06-01" } }),
    );
    expect(withResult.initiatives.map((i) => i.id)).toEqual(["i1"]);

    const noLane: LinearApi = {
      issues: async () => issuesPage({ identifiers: [] }),
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const noResult = unwrap(
      await fetchLinearActivity({ api: noLane, window: { since: "2026-01-01", until: "2026-06-01" } }),
    );
    expect(noResult.initiatives).toEqual([]);
    expect(noResult.warnings).toEqual([]);
    expect(noResult.incomplete).toEqual([]);
  });

  // A failing lane used to be a WARNING, which changes nothing about a cursor — so Linear stamped fresh with
  // the whole lane missing. It is now named in `incomplete`, which the refresh turns into a coverage gap.
  it("names a failing curated lane as incomplete without aborting the crawl", async () => {
    const api: LinearApi = {
      documents: async () => {
        throw new Error("documents not enabled");
      },
      issues: async () => issuesPage({ identifiers: ["ENG-1"] }),
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.documents).toEqual([]);
    expect(result.issues.map((item) => item.identifier)).toEqual(["ENG-1"]);
    expect(result.incomplete).toEqual(["linear documents lane unavailable: documents not enabled"]);
    expect(result.warnings).toEqual([]);
  });

  it("names a failing bulk-entity lane as incomplete", async () => {
    const api: LinearApi = {
      issues: async () => issuesPage({ identifiers: [] }),
      projectMilestones: async () => {
        throw new Error("schema drift");
      },
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.incomplete).toEqual(["linear projectMilestones lane unavailable: schema drift"]);
  });

  it("threads the window `since` to BOTH issues and projects (projects must not ignore it)", async () => {
    const seenIssueSince: string[] = [];
    const seenProjectSince: string[] = [];
    const api: LinearApi = {
      issues: async ({ since }) => {
        seenIssueSince.push(since);
        return issuesPage({ identifiers: [] });
      },
      projects: async ({ since }) => {
        seenProjectSince.push(since);
        return { projects: [] };
      },
      users: async () => ({ nodes: [] }),
    };
    await fetchLinearActivity({ api, window: { since: "2026-04-01", until: "2026-06-01" } });
    expect(seenIssueSince).toEqual(["2026-04-01"]);
    expect(seenProjectSince).toEqual(["2026-04-01"]);
  });

  it("pages projects to exhaustion, not just the first page", async () => {
    const api: LinearApi = {
      issues: async () => issuesPage({ identifiers: [] }),
      projects: async ({ cursor }) =>
        cursor === undefined
          ? { nextCursor: "p2", projects: [{ id: "p1", name: "A", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }] }
          : { projects: [{ id: "p2", name: "B", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }] },
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("is fatal when the seam throws", async () => {
    const api: LinearApi = {
      issues: async () => {
        throw new Error("rate limited");
      },
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const failure = unwrapErr(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(failure.code).toBe("ACTIVITY_FETCH_FAILED");
    expect(failure.message).toBe("fetch failed: rate limited");
  });
});

describe("fetchLinearActivity paging completeness", () => {
  // A `since`-filtered Relay page can shape down to zero nodes while the connection still has more. The lane
  // used to stop there and report the prefix as the whole crawl.
  it("keeps paging issues past an empty page that still carries a cursor", async () => {
    const pages = [
      issuesPage({ identifiers: ["ENG-1"], nextCursor: "c2" }),
      issuesPage({ identifiers: [], nextCursor: "c3" }),
      issuesPage({ identifiers: ["ENG-2"] }),
    ];
    let call = 0;
    const api: LinearApi = {
      issues: async () => {
        const page = pages[call]!;
        call += 1;
        return page;
      },
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.issues.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
  });

  it("keeps paging projects past an empty page that still carries a cursor", async () => {
    const pages = [
      { nextCursor: "c2", projects: [{ id: "p1", name: "One", tsIso: "2026-05-01T00:00:00.000Z", url: "u" }] },
      { nextCursor: "c3", projects: [] },
      { projects: [{ id: "p2", name: "Two", tsIso: "2026-05-02T00:00:00.000Z", url: "u" }] },
    ];
    let call = 0;
    const api: LinearApi = {
      issues: async () => issuesPage({ identifiers: [] }),
      projects: async () => {
        const page = pages[call]!;
        call += 1;
        return page;
      },
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  // The walk is `updatedAt` DESCENDING, so a truncated one missed the OLDEST of the window — which a cursor moved
  // to the window's end would never ask for again. So the line is a coverage gap, not a warning.
  it("names the issues lane incomplete when its cursor repeats instead of advancing", async () => {
    const api: LinearApi = {
      issues: async () => issuesPage({ identifiers: ["ENG-1"], nextCursor: "loop" }),
      projects: async () => ({ projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.incomplete).toEqual([
      "linear issues may be incomplete: the endpoint repeated pagination cursor loop instead of advancing",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("names the projects lane incomplete when its cursor repeats instead of advancing", async () => {
    const api: LinearApi = {
      issues: async () => issuesPage({ identifiers: [] }),
      projects: async () => ({ nextCursor: "loop", projects: [] }),
      users: async () => ({ nodes: [] }),
    };
    const result = unwrap(await fetchLinearActivity({ api, window: { since: "2026-01-01", until: "2026-06-01" } }));
    expect(result.incomplete).toEqual([
      "linear projects may be incomplete: the endpoint repeated pagination cursor loop instead of advancing",
    ]);
  });
});
