/*
 * What a recurring top-up's generations never infer an edge from: a retired stem, two repositories whose slugs flatten
 * alike, a brief naming no repository or one the slug was not minted for, a slug that is no generation, an undated,
 * unread or untrusted row, a slug two docs carry, a calendar impossibility, and two casings tied on epoch.
 */
import { describe, expect, it } from "vitest";

import { generationSupersessionEdges } from "../../../../sweep/supersession.js";
import { generation } from "./harness.js";

describe("generationSupersessionEdges", () => {
  it("never reads a retired bumpfix-topup slug as a generation", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({ askedIso: "2026-10-01T09:52:36.582Z", slug: "bumpfix-topup-acme-acme-admin-1790848356581" }),
        generation({ askedIso: "2026-10-19T12:06:29.630Z", slug: "bumpfix-topup-acme-acme-admin-1792411589626" }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("never groups two repositories whose slugs flatten to the same prefix", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          repo: "acme-tools/api",
          slug: "vulnerability-fix-topup-acme-tools-api-1790000000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          repo: "acme/tools-api",
          slug: "vulnerability-fix-topup-acme-tools-api-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("infers nothing for a generation whose brief names no repository", () => {
    const edges = generationSupersessionEdges({
      rows: [
        {
          askedIso: "2026-10-01T00:00:00.000Z",
          briefReads: true,
          repo: undefined,
          slug: "vulnerability-fix-topup-acme-acme-admin-1790000000000",
          trusted: true,
        },
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("ignores a slug that is not a generation, and a suffix that is not a 13-digit epoch", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          slug: "the-acme-admin-vulnfix-top-up-raised-nothing-for-a-week",
        }),
        generation({ askedIso: "2026-10-01T00:00:00.000Z", slug: "vulnerability-fix-topup-acme-acme-admin-179000000" }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("never supersedes an undated generation, nor lets one supersede, since neither is provably later", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({ askedIso: undefined, slug: "vulnerability-fix-topup-acme-acme-admin-1799000000000" }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("infers nothing from a row whose brief its family's reader does not read", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790000000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          briefReads: false,
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("infers nothing from an untrusted row, on either side", () => {
    const OLD = "vulnerability-fix-topup-acme-acme-admin-1790000000000";
    const NEW = "vulnerability-fix-topup-acme-acme-admin-1790100000000";
    const untrustedNewer = generationSupersessionEdges({
      rows: [
        generation({ askedIso: "2026-10-01T00:00:00.000Z", slug: OLD }),
        generation({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW, trusted: false }),
      ],
    });
    const untrustedOlder = generationSupersessionEdges({
      rows: [
        generation({ askedIso: "2026-10-01T00:00:00.000Z", slug: OLD, trusted: false }),
        generation({ askedIso: "2026-10-02T00:00:00.000Z", slug: NEW }),
      ],
    });
    expect(untrustedNewer.size).toBe(0);
    expect(untrustedOlder.size).toBe(0);
  });

  it("lets an untrusted copy of a slug still count against its uniqueness, so the clean copy infers nothing", () => {
    const OLD = "vulnerability-fix-topup-acme-acme-admin-1790000000000";
    const edges = generationSupersessionEdges({
      rows: [
        generation({ askedIso: "2026-10-01T00:00:00.000Z", slug: OLD }),
        generation({ askedIso: "2026-10-01T00:00:00.000Z", slug: OLD, trusted: false }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("infers nothing when the brief's repository is not one owner/name", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          repo: "acme/api/extra",
          slug: "vulnerability-fix-topup-acme-api-1790000000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          repo: "acme/api/extra",
          slug: "vulnerability-fix-topup-acme-api-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("infers nothing when the brief names a repository the slug was not minted for", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          repo: "acme/web",
          slug: "vulnerability-fix-topup-acme-api-1790000000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          repo: "acme/web",
          slug: "vulnerability-fix-topup-acme-api-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("infers nothing for a slug two docs carry, even when only one of them is a generation of the newer row", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          repo: "acme-tools/api",
          slug: "vulnerability-fix-topup-acme-tools-api-1790000000000",
        }),
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          repo: "acme/tools-api",
          slug: "vulnerability-fix-topup-acme-tools-api-1790000000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          repo: "acme-tools/api",
          slug: "vulnerability-fix-topup-acme-tools-api-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("treats a calendar impossibility as an absent instant, never rolled into the next month", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({ askedIso: "2026-02-30T00:00:00Z", slug: "vulnerability-fix-topup-acme-acme-admin-1790000000000" }),
        generation({ askedIso: "2026-03-03T00:00:00Z", slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000" }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("never supersedes a slug into itself when two scanned docs carry it", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-01T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("supersedes neither of two casings that tie on epoch", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          repo: "Acme/API",
          slug: "vulnerability-fix-topup-Acme-API-1790100000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          repo: "acme/api",
          slug: "vulnerability-fix-topup-acme-api-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });
});
