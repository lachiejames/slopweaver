import { describe, expect, it } from "vitest";

import {
  atlasProbeLines,
  DEFAULT_ATLAS_PROBE_CELLS,
  parseAtlasProbeArgs,
} from "../../../cli/commands/atlas/probeCore.js";
import { ATLAS_PROBE_USAGE } from "../../../cli/commands/atlas/probeUsage.js";
import { unwrap } from "../../../lib/result.js";
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

describe("parseAtlasProbeArgs", () => {
  it("takes keywords POSITIONALLY, so a two-keyword probe cannot silently become a one-keyword one", () => {
    const parsed = unwrap(parseAtlasProbeArgs({ rest: ["airtable", "sync"] }));
    expect(parsed.terms).toEqual(["airtable", "sync"]);
  });

  it("defaults the cell cap to the one constant the statement itself is capped by", () => {
    expect(unwrap(parseAtlasProbeArgs({ rest: ["airtable"] })).cells).toBe(DEFAULT_ATLAS_PROBE_CELLS);
  });

  it("leaves the platform unset when none is named, which is the whole-estate probe", () => {
    const parsed = unwrap(parseAtlasProbeArgs({ rest: ["airtable"] }));
    expect(parsed.platform).toBe(null);
    expect(parsed.json).toBe(false);
  });

  it("takes a platform, a cell cap and --json together", () => {
    const parsed = unwrap(parseAtlasProbeArgs({ rest: ["airtable", "--platform", "vanta", "--cells", "8", "--json"] }));
    expect(parsed.platform).toBe("vanta");
    expect(parsed.cells).toBe(8);
    expect(parsed.json).toBe(true);
    expect(parsed.terms).toEqual(["airtable"]);
  });

  // No keyword is a MODE, not a mistake — the SCOPE read `src/route/genericCapabilities.ts`'s
  // `atlas-estate` row runs before it has decided on keywords. An earlier draft refused here, which left
  // that row's own `run:` line either a refusal or a whole English sentence fed to an `ilike` filter.
  it("accepts no keyword at all as the SCOPE read, keeping every other option", () => {
    const parsed = parseAtlasProbeArgs({ rest: ["--json"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).terms).toEqual([]);
    expect(unwrap(parsed).json).toBe(true);
  });

  it("drops a whitespace-only keyword rather than probing for a space, which is the same SCOPE read", () => {
    expect(unwrap(parseAtlasProbeArgs({ rest: ["   "] })).terms).toEqual([]);
  });

  it("refuses a --cells that is not a whole number of at least 1, naming what it got", () => {
    const parsed = parseAtlasProbeArgs({ rest: ["airtable", "--cells", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain(`--cells takes a whole number of 1 or more, not "0"`);
  });

  it("refuses a non-numeric --cells", () => {
    const parsed = parseAtlasProbeArgs({ rest: ["airtable", "--cells", "lots"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain(`not "lots"`);
  });

  it("reports the --cells refusal alone, since no keyword is no longer a second one", () => {
    expect(parseAtlasProbeArgs({ rest: ["--cells", "-2"] })._unsafeUnwrapErr()).toEqual([
      `--cells takes a whole number of 1 or more, not "-2"`,
    ]);
  });
});

describe("ATLAS_PROBE_USAGE", () => {
  it("advertises the cell default the parser actually applies", () => {
    expect(ATLAS_PROBE_USAGE).toContain(`(default ${String(DEFAULT_ATLAS_PROBE_CELLS)})`);
  });

  it("says a count is of STORED records, where a caller reading --help will see it", () => {
    expect(ATLAS_PROBE_USAGE).toContain("a count is of STORED records and proves nothing about a provider");
  });
});

describe("atlasProbeLines", () => {
  it("closes on the claim boundary, so a cell count is never read as a statement about a provider", () => {
    const lines = atlasProbeLines({ report: report({ rows: [row({ cells: [cell()] })] }) });
    expect(lines.at(-3)).toBe("A count here is of STORED records and proves nothing about what a provider holds.");
    expect(lines.at(-2)).toContain("slopweaver atlas <platform> read --kind <kind> --query <keyword>");
  });

  it("says a keyword reached nothing, rather than printing an empty block", () => {
    expect(atlasProbeLines({ report: report({ rows: [row()] }) })).toContain("  no stored atlas record carries it");
  });

  it("names the store as the cause when the atlas tables were never imported", () => {
    const lines = atlasProbeLines({ report: report({ atlasEntities: 0, rows: [row()] }) });
    expect(lines).toContain("so every zero above is about the STORE rather than about any platform");
  });

  it("stays quiet about import when the tables hold rows — a zero there is a real absence", () => {
    const lines = atlasProbeLines({ report: report({ rows: [row()] }) });
    expect(lines.join("\n")).not.toContain("has never run `slopweaver store import-atlas`");
  });

  it("names the estate in the header when no platform narrowed the probe", () => {
    expect(atlasProbeLines({ report: report() })[0]).toBe(
      "atlas probe over the whole estate — 695759 stored entity row(s), 1700ms",
    );
  });

  it("names the one atlas in the header when the caller narrowed to it", () => {
    expect(atlasProbeLines({ report: report({ platform: "vanta" }) })[0]).toContain("over the vanta atlas");
  });

  // The estate total is the never-imported sentinel rather than the narrowed scope's own size, so under
  // `--platform` the header has to SAY that — the r1 pass read the whole estate's total as the vanta atlas's own rows.
  it("says the entity total is estate-wide whenever the scope is narrower than the estate", () => {
    expect(atlasProbeLines({ report: report({ platform: "vanta" }) })[0]).toBe(
      "atlas probe over the vanta atlas — 695759 stored entity row(s) across all atlases, 1700ms",
    );
  });

  it("leaves that qualifier off the estate header, where there is nothing to qualify", () => {
    expect(atlasProbeLines({ report: report() })[0]).not.toContain("across all atlases");
  });

  it("reports a platform the keyword NAMES separately from the rows it matched", () => {
    const lines = atlasProbeLines({ report: report({ rows: [row({ platformNames: ["airtable"] })] }) });
    expect(lines).toContain("  the keyword names 1 atlas itself: airtable");
  });

  it("rolls the cells up per platform, which is the unit a detective can be sent to", () => {
    const lines = atlasProbeLines({
      report: report({
        rows: [
          row({
            cells: [cell({ entities: 500, kind: "application" }), cell({ entities: 6, kind: "user" })],
          }),
        ],
      }),
    });
    expect(lines).toContain("  platforms: jumpcloud 506 in 2 kind(s)");
  });
});

describe("atlasProbeLines — the keyword-less SCOPE report", () => {
  it("prints one line per platform and never the keyword-report closing lines", () => {
    const lines = atlasProbeLines({
      report: report({
        holdings: [
          { entities: 523_521, kinds: 9, lastSuccessAtIso: "2026-09-20T01:02:03.000Z", platform: "jumpcloud" },
          { entities: 17, kinds: 2, lastSuccessAtIso: null, platform: "braze" },
        ],
      }),
    });
    expect(lines.filter((line) => line.includes("jumpcloud")).length).toBe(1);
    expect(lines.filter((line) => line.includes("braze")).length).toBe(1);
    expect(lines).toContain("2 platform(s) hold stored atlas rows.");
    expect(lines.join("\n")).not.toContain("Open the winner with");
  });

  it("points at the keyword form, because the next act is always a keyword and never another scope read", () => {
    const lines = atlasProbeLines({ report: report({ holdings: [] }) });
    expect(lines.join("\n")).toContain("slopweaver atlas probe <keyword> [<keyword>…]");
    expect(lines).toContain("0 platform(s) hold stored atlas rows.");
  });

  it("still opens on the estate total, so an unimported store is legible from the first line", () => {
    const lines = atlasProbeLines({ report: report({ atlasEntities: 0, holdings: [] }) });
    expect(lines[0]).toContain("0 stored entity row(s)");
  });
});
