/*
 * The edges a recurring top-up's generations do draw: every older generation of one repository's top-up maps straight
 * to the newest, ordered by the slug's epoch rather than a re-dated asked instant, two casings of one repository group
 * as one top-up, an unparseable instant drops only its own row, and a lone generation answers an empty map.
 */
import { describe, expect, it } from "vitest";

import { generationSupersessionEdges } from "../../../../sweep/supersession.js";
import { generation } from "./harness.js";

describe("generationSupersessionEdges", () => {
  // The measured generations' epochs and instants, minted under the current `slugStem` the reader matches on.
  it("maps the measured generation, and every later one, straight to the newest", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-09-17T08:30:08.901Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1789633808900",
        }),
        generation({
          askedIso: "2026-09-18T21:48:27.381Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1789768107380",
        }),
        generation({
          askedIso: "2026-10-19T12:06:29.630Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1792411589626",
        }),
      ],
    });
    const expected = {
      kind: "generation",
      newerSlug: "vulnerability-fix-topup-acme-acme-admin-1792411589626",
      recipe: "vulnerability-fix-topup-acme-admin",
      registeredIso: "2026-10-19T12:06:29.626Z",
    };
    expect(edges.get("vulnerability-fix-topup-acme-acme-admin-1789633808900")).toEqual(expected);
    expect(edges.get("vulnerability-fix-topup-acme-acme-admin-1789768107380")).toEqual(expected);
    expect(edges.has("vulnerability-fix-topup-acme-acme-admin-1792411589626")).toBe(false);
    expect(edges.size).toBe(2);
  });

  it("orders by the slug's epoch, never by an askedIso a quote re-dated later", () => {
    const edges = generationSupersessionEdges({
      rows: [
        // The older firing, attached to a transcript turn AFTER the newer one registered.
        generation({
          askedIso: "2026-10-05T00:00:00.000Z",
          repo: "acme/api",
          slug: "vulnerability-fix-topup-acme-api-1790000000000",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          repo: "acme/api",
          slug: "vulnerability-fix-topup-acme-api-1790100000000",
        }),
      ],
    });
    expect([...edges]).toEqual([
      [
        "vulnerability-fix-topup-acme-api-1790000000000",
        {
          kind: "generation",
          newerSlug: "vulnerability-fix-topup-acme-api-1790100000000",
          recipe: "vulnerability-fix-topup-api",
          registeredIso: "2026-09-22T18:00:00.000Z",
        },
      ],
    ]);
  });

  it("groups two casings of one repository as one top-up", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-09-21T00:00:00.000Z",
          repo: "Acme/API",
          slug: "vulnerability-fix-topup-Acme-API-1790000000000",
        }),
        generation({
          askedIso: "2026-09-22T00:00:00.000Z",
          repo: "acme/api",
          slug: "vulnerability-fix-topup-acme-api-1790100000000",
        }),
      ],
    });
    expect([...edges]).toEqual([
      [
        "vulnerability-fix-topup-Acme-API-1790000000000",
        {
          kind: "generation",
          newerSlug: "vulnerability-fix-topup-acme-api-1790100000000",
          recipe: "vulnerability-fix-topup-api",
          registeredIso: "2026-09-22T18:00:00.000Z",
        },
      ],
    ]);
  });

  it("treats an asked instant that does not parse exactly as an absent one", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({ askedIso: "not a date", slug: "vulnerability-fix-topup-acme-acme-admin-1799000000000" }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
        generation({
          askedIso: "2026-10-03T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790200000000",
        }),
      ],
    });
    expect(edges.has("vulnerability-fix-topup-acme-acme-admin-1799000000000")).toBe(false);
    expect(edges.get("vulnerability-fix-topup-acme-acme-admin-1790100000000")!.newerSlug).toBe(
      "vulnerability-fix-topup-acme-acme-admin-1790200000000",
    );
    expect(edges.size).toBe(1);
  });

  it("orders two generations whose asked instants tie by the slug's epoch", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000002",
        }),
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000001",
        }),
      ],
    });
    expect(edges.get("vulnerability-fix-topup-acme-acme-admin-1790100000001")!.newerSlug).toBe(
      "vulnerability-fix-topup-acme-acme-admin-1790100000002",
    );
    expect(edges.size).toBe(1);
  });

  it("answers an empty map for a lone generation", () => {
    const edges = generationSupersessionEdges({
      rows: [
        generation({
          askedIso: "2026-10-02T00:00:00.000Z",
          slug: "vulnerability-fix-topup-acme-acme-admin-1790100000000",
        }),
      ],
    });
    expect(edges.size).toBe(0);
  });
});
