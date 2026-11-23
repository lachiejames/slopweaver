/**
 * `slopweaver atlas backlog` end to end over a registry seam, plus the flag handling beside it.
 *
 * The registry is injected as a plain function handing back real descriptors, so what is exercised is the
 * shipped ordering and rendering rather than a restatement of them. The one property this file exists to
 * pin above every other is the EXIT CODE: the owner ruled these rows a backlog rather than a gate, so a
 * run carrying refused rows still exits 0, and a change that made this verb fail a run fails here first.
 *
 * The second property is the store: without `--deferred` this verb reads no snapshot at all, and the
 * default registry's `readSnapshot` REJECTS so that a change which started reading one unconditionally
 * fails here rather than in a slow sweep. The `--deferred` cases take their own registry, one snapshot
 * carrying a deferred cell and one atlas that cannot be read.
 */
import { describe, expect, it } from "vitest";

import { DATADOG_ATLAS_DESCRIPTOR } from "../../../../../atlas/datadog/descriptor.js";
import { GITHUB_ATLAS_DESCRIPTOR } from "../../../../../atlas/github/descriptor.js";
import { orderAtlasBacklog, refusedRowsOf } from "../../../../../atlas/kit/backlog.js";
import { orderAtlasDeferred } from "../../../../../atlas/kit/deferredBacklog.js";
import { AtlasReadErrors, type AtlasReadSnapshot } from "../../../../../atlas/kit/read.js";
import { VANTA_ATLAS_DESCRIPTOR } from "../../../../../atlas/vanta/descriptor.js";
import {
  ATLAS_BACKLOG_FLAG_NAMES,
  filterAtlasBacklog,
  filterAtlasDeferred,
  parseAtlasBacklogArgs,
  renderAtlasBacklog,
  renderAtlasDeferred,
} from "../../../../../cli/commands/atlas/backlogCore.js";
import { type AtlasBacklogDeps, runAtlasBacklog } from "../../../../../cli/commands/atlas/backlogRun.js";
import { ATLAS_BACKLOG_USAGE } from "../../../../../cli/commands/atlas/backlogUsage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";

/** The three real descriptors this file sweeps, keyed by the platform the registry answers to. */
const DESCRIPTORS = {
  datadog: DATADOG_ATLAS_DESCRIPTOR,
  github: GITHUB_ATLAS_DESCRIPTOR,
  vanta: VANTA_ATLAS_DESCRIPTOR,
} as const;

/** Recording edges over a registry holding three real atlases. */
function deps(): AtlasBacklogDeps & { readonly out: string[]; readonly diag: string[] } {
  const out: string[] = [];
  const diag: string[] = [];
  return {
    diag,
    find: ({ platform }) =>
      platform === "datadog" || platform === "github" || platform === "vanta"
        ? {
            catalogue: { doorRouted: false, example: "slopweaver atlas x read", summary: null },
            platform,
            readDescriptor: () => Promise.resolve(DESCRIPTORS[platform]),
            readSnapshot: () => Promise.reject(new Error("atlas backlog never reads a snapshot")),
            verbs: [],
          }
        : null,
    out,
    platforms: () => ["datadog", "github", "vanta"],
    writeDiagnostic: (line) => diag.push(line),
    writeOut: (line) => out.push(line),
  };
}

/** A snapshot with one kind whose coverage carries one `deferred` cell, and nothing else refused. */
function deferredSnapshot({ platform }: { platform: string }): AtlasReadSnapshot {
  return {
    descriptor: {
      excludes: [],
      kinds: ["page"],
      platform,
      question: "what is reachable here",
      resyncCommand: `slopweaver atlas ${platform} sync`,
      surfaces: [
        {
          acquisition: "driven-browser",
          denominator: { because: "a fixture surface with no provider catalogue", known: false },
          documented: false,
          name: "web-app",
          role: "corroborating",
          status: "declared-unfilled",
          unfilledBecause: "the walk has not finished",
        },
      ],
      visibilityScope: "configured-token-visible",
      writePolicy: "refuse-every-write",
    },
    generation: {
      mismatched: [],
      missing: [],
      platform,
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: "2026-09-15T07:07:53.351Z",
    },
    kinds: [
      {
        coverage: [
          {
            lastSuccessAt: null,
            latestAttemptFailed: false,
            reason: "7 of 8 declared page(s) reached, 6 photographed",
            scope: "declared-pages",
            state: "deferred",
            surface: "web-app",
            unblockedBy: null,
          },
        ],
        entities: [],
        gaps: [],
        kind: "page",
        lastSuccessAt: null,
        latestAttemptFailed: false,
        permissionBlocked: null,
        publishedCount: 0,
      },
    ],
  };
}

/** Edges whose datadog snapshot carries a deferred cell and whose vanta generation was never published. */
function deferredDeps(): AtlasBacklogDeps & { readonly out: string[] } {
  const base = deps();
  return {
    ...base,
    find: ({ platform }) => {
      const registration = base.find({ platform });
      if (registration === null) {
        return null;
      }
      return {
        ...registration,
        readSnapshot: async () =>
          platform === "vanta"
            ? err(AtlasReadErrors.generationUnpublished({ platform }))
            : ok(deferredSnapshot({ platform })),
      };
    },
  };
}

describe("parsing the verb's arguments", () => {
  it("documents every flag it accepts, so the spec and the usage line cannot drift", () => {
    expect(ATLAS_BACKLOG_FLAG_NAMES).toEqual(["--deferred", "--ground", "--json", "--named-only", "--platform"]);
    expect(ATLAS_BACKLOG_FLAG_NAMES.filter((flag) => !ATLAS_BACKLOG_USAGE.includes(flag))).toEqual([]);
  });

  it("takes the five flags and defaults the rest", () => {
    const options = unwrap(parseAtlasBacklogArgs({ rest: ["--platform", "datadog", "--json"] }));
    expect(options.platform).toBe("datadog");
    expect(options.json).toBe(true);
    expect(options.namedOnly).toBe(false);
    expect(options.deferred).toBe(false);
    expect(options.ground).toBe(undefined);
  });

  it("reads --deferred, the one flag that makes this verb touch the local store", () => {
    expect(unwrap(parseAtlasBacklogArgs({ rest: ["--deferred"] })).deferred).toBe(true);
  });

  it("refuses a ground the gate never refuses, naming the two it does", () => {
    const parsed = parseAtlasBacklogArgs({ rest: ["--ground", "held-elsewhere"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("BACKLOG_GROUND_INVALID");
    expect(parsed._unsafeUnwrapErr().message).toBe(
      "--ground must be one of: not-fetched, shape-index — the gate refuses no other",
    );
  });
});

describe("filtering a register", () => {
  it("recomputes the counts over what survives, so a filtered report never prints a total it did not list", () => {
    const whole = orderAtlasBacklog({
      rows: [
        ...refusedRowsOf({ descriptor: DATADOG_ATLAS_DESCRIPTOR, platform: "datadog" }),
        ...refusedRowsOf({ descriptor: VANTA_ATLAS_DESCRIPTOR, platform: "vanta" }),
      ],
    });
    expect(whole.refusedCount).toBe(4);
    const narrowed = filterAtlasBacklog({
      backlog: whole,
      options: { deferred: false, ground: "not-fetched", json: false, namedOnly: false, platform: undefined },
    });
    expect(narrowed.refusedCount).toBe(3);
    expect(narrowed.unmeasuredCount).toBe(0);
    expect(narrowed.entries.map((entry) => entry.platform)).toEqual(["datadog", "vanta"]);
  });

  it("drops an atlas whose every row the filter removed, rather than printing an empty heading", () => {
    const whole = orderAtlasBacklog({
      rows: refusedRowsOf({ descriptor: GITHUB_ATLAS_DESCRIPTOR, platform: "github" }),
    });
    const narrowed = filterAtlasBacklog({
      backlog: whole,
      options: { deferred: false, ground: "shape-index", json: false, namedOnly: false, platform: undefined },
    });
    expect(narrowed.entries).toEqual([]);
    expect(narrowed.refusedCount).toBe(0);
  });
});

describe("rendering", () => {
  it("says where each atlas sits in the owner's order, and closes with the ruling that keeps this a backlog", () => {
    const lines = renderAtlasBacklog({
      backlog: orderAtlasBacklog({
        rows: refusedRowsOf({ descriptor: GITHUB_ATLAS_DESCRIPTOR, platform: "github" }),
      }),
    });
    expect(lines[0]).toBe("atlas backlog: 1 refused row(s) across 1 atlas(es) — 1 nobody fetched, 0 unweighed");
    expect(lines[2]).toBe("github  (1 refused, #6 in the owner's order)");
    expect(lines.at(-1)).toBe("this verb never fails a run — these are a backlog, not a gate");
  });

  it("prints a deferred cell under its atlas's place in the owner's order, with the generation's own prose", () => {
    const lines = renderAtlasDeferred({
      deferred: orderAtlasDeferred({
        rows: [
          {
            kind: "page",
            platform: "notion",
            reason: "7 of 8 declared page(s) reached",
            scope: "declared-pages",
            surface: "web-app",
          },
        ],
        unread: [],
      }),
    });
    expect(lines[1]).toBe("deferred kinds: 1 cell(s) across 1 atlas(es) — missing coverage wearing a settled word");
    expect(lines[3]).toBe("notion  (1 deferred, #5 in the owner's order)");
    expect(lines[4]).toBe("  page  web-app  declared-pages");
    expect(lines.filter((line) => line.includes("more cell(s) here"))).toEqual([]);
  });

  it("summarises past six cells in one atlas, naming where the rest are — Datadog's 288 would be 576 lines", () => {
    const lines = renderAtlasDeferred({
      deferred: orderAtlasDeferred({
        rows: [...Array(9).keys()].map((index) => ({
          kind: `kind-${String(index)}`,
          platform: "datadog",
          reason: "no call has been made to this organisation for this kind",
          scope: `kind-${String(index)}`,
          surface: "api",
        })),
        unread: [],
      }),
    });
    expect(lines.filter((line) => line.startsWith("  kind-")).length).toBe(6);
    expect(lines.at(-1)).toBe(
      "  … and 3 more cell(s) here — all of them in `slopweaver atlas datadog coverage --state deferred`," +
        " and in this verb's own `--json`",
    );
  });
});

describe("filtering the deferred register", () => {
  it("keeps an unread atlas through --named-only, because not-counted is the row a filter must not lose", () => {
    const whole = orderAtlasDeferred({
      rows: [
        {
          kind: "page",
          platform: "xero",
          reason: "3 of 9 declared page(s) reached",
          scope: "declared-pages",
          surface: "web-app",
        },
      ],
      unread: [{ because: "no vanta generation has been published", platform: "vanta" }],
    });
    const narrowed = filterAtlasDeferred({
      deferred: whole,
      options: { deferred: true, ground: undefined, json: false, namedOnly: true, platform: undefined },
    });
    expect(narrowed.entries).toEqual([]);
    expect(narrowed.deferredCount).toBe(0);
    expect(narrowed.unread.map((atlas) => atlas.platform)).toEqual(["vanta"]);
  });

  it("ignores --ground, which a deferred cell does not have, rather than emptying the half", () => {
    const whole = orderAtlasDeferred({
      rows: [
        {
          kind: "method",
          platform: "datadog",
          reason: "27 operation(s) across 2 of 4 document(s)",
          scope: "declared-operations",
          surface: "published-api",
        },
      ],
      unread: [],
    });
    const narrowed = filterAtlasDeferred({
      deferred: whole,
      options: { deferred: true, ground: "not-fetched", json: false, namedOnly: false, platform: undefined },
    });
    expect(narrowed.deferredCount).toBe(1);
    expect(narrowed.entries.map((entry) => entry.platform)).toEqual(["datadog"]);
  });
});

describe("running the verb", () => {
  it("exits 0 with refused rows on the page, because the owner's ruling makes this a backlog and not a gate", async () => {
    const edges = deps();
    const code = await runAtlasBacklog({ argv: ["node", "slopweaver", "atlas", "backlog"], deps: edges });
    expect(code).toBe(EXIT_OK);
    expect(edges.out[0]).toBe("atlas backlog: 5 refused row(s) across 3 atlas(es) — 4 nobody fetched, 1 unweighed");
  });

  it("orders the three atlases the owner's way — datadog, vanta, github — never densest first", async () => {
    const edges = deps();
    await runAtlasBacklog({ argv: ["node", "slopweaver", "atlas", "backlog", "--json"], deps: edges });
    const report: { entries: { platform: string; namedPosition: number | null }[] } = JSON.parse(edges.out[0]!);
    expect(report.entries.map((entry) => entry.platform)).toEqual(["datadog", "vanta", "github"]);
    expect(report.entries.map((entry) => entry.namedPosition)).toEqual([1, 2, 6]);
  });

  it("refuses an unknown platform as a usage error, listing what this build has", async () => {
    const edges = deps();
    const code = await runAtlasBacklog({
      argv: ["node", "slopweaver", "atlas", "backlog", "--platform", "nope"],
      deps: edges,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(edges.diag[0]).toBe("no atlas for platform nope — this build has: datadog, github, vanta");
  });

  it("sweeps the deferred half only under --deferred, counting cells and naming what it could not read", async () => {
    const edges = deferredDeps();
    const code = await runAtlasBacklog({
      argv: ["node", "slopweaver", "atlas", "backlog", "--deferred"],
      deps: edges,
    });
    expect(code).toBe(EXIT_OK);
    expect(edges.out).toContain(
      "deferred kinds: 2 cell(s) across 2 atlas(es) — missing coverage wearing a settled word",
    );
    expect(edges.out).toContain("NOT COUNTED (1 atlas(es) the sweep could not read — not the same as clear)");
  });

  it("carries the deferred register in the JSON document, beside the refused rows", async () => {
    const edges = deferredDeps();
    await runAtlasBacklog({
      argv: ["node", "slopweaver", "atlas", "backlog", "--deferred", "--json"],
      deps: edges,
    });
    const report: {
      refusedCount: number;
      deferred: { deferredCount: number; unread: { platform: string }[] };
    } = JSON.parse(edges.out[0]!);
    expect(report.refusedCount).toBe(5);
    expect(report.deferred.deferredCount).toBe(2);
    expect(report.deferred.unread.map((atlas) => atlas.platform)).toEqual(["vanta"]);
  });

  it("prints the usage on --help and reads no descriptor", async () => {
    const edges = deps();
    const code = await runAtlasBacklog({ argv: ["node", "slopweaver", "atlas", "backlog", "--help"], deps: edges });
    expect(code).toBe(EXIT_OK);
    expect(edges.out.length).toBe(1);
    expect(edges.out[0]).toContain("usage: slopweaver atlas backlog");
  });
});
