/**
 * The doctor's flag surface, its verdict and its table.
 *
 * The asymmetry between a sweep and a named platform is the behaviour under test: a sweep that went red for
 * every atlas nobody has synced on this install would be red permanently and therefore ignored, while
 * "is the atlas I just shipped usable" has to fail on anything but an answerable one.
 */
import { describe, expect, it } from "vitest";

import {
  type AtlasDoctorRow,
  atlasDoctorFailures,
  atlasDoctorJson,
  parseAtlasDoctorArgs,
  renderAtlasDoctor,
} from "../../../../../cli/commands/atlas/doctorCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/**
 * One graded row, defaulted so a test names only the grade it is about.
 *
 * @param platform which atlas the row is for
 * @param grade how it graded
 * @param over the reachability lists a case is actually exercising
 * @returns the row
 */
function row({
  platform,
  grade,
  over = {},
}: {
  platform: string;
  grade: AtlasDoctorRow["grade"];
  over?: Partial<AtlasDoctorRow>;
}): AtlasDoctorRow {
  return {
    because: `${platform} is ${grade}`,
    darkKinds: [],
    estateNotEstablishedKinds: [],
    gapKinds: [],
    grade,
    notAttemptedKinds: [],
    permissionBlockedKinds: [],
    platform,
    productAbsentKinds: [],
    readable: 0,
    repairedKinds: [],
    vouchedFor: 0,
    ...over,
  };
}

describe("parseAtlasDoctorArgs", () => {
  it("defaults to a sweep with no repair and no json", () => {
    const options = unwrap(parseAtlasDoctorArgs({ rest: [] }));
    expect(options.platform).toBe(undefined);
    expect(options.repair).toBe(false);
    expect(options.json).toBe(false);
    expect(options.home).toBe(undefined);
  });

  it("takes the platform as a positional, not a flag", () => {
    expect(unwrap(parseAtlasDoctorArgs({ rest: ["vanta"] })).platform).toBe("vanta");
  });

  it("reads --repair, --json and --home", () => {
    const options = unwrap(parseAtlasDoctorArgs({ rest: ["--repair", "--json", "--home", "/tmp/h"] }));
    expect(options.repair).toBe(true);
    expect(options.json).toBe(true);
    expect(options.home).toBe("/tmp/h");
  });

  it("refuses two platforms rather than silently grading the first", () => {
    const refused = unwrapErr(parseAtlasDoctorArgs({ rest: ["vanta", "slack"] }));
    expect(refused.code).toBe("DOCTOR_MULTIPLE_PLATFORMS");
    expect(refused.message).toBe("name at most one platform — got: vanta, slack");
  });
});

describe("atlasDoctorFailures", () => {
  it("fails a sweep on a dark atlas", () => {
    const rows = [row({ grade: "answerable", platform: "linear" }), row({ grade: "dark", platform: "vanta" })];
    expect(atlasDoctorFailures({ named: false, rows }).map((entry) => entry.platform)).toEqual(["vanta"]);
  });

  it("fails a sweep on an unreadable store", () => {
    expect(
      atlasDoctorFailures({ named: false, rows: [row({ grade: "unreadable", platform: "notion" })] }),
    ).toHaveLength(1);
  });

  it("does NOT fail a sweep on an atlas nobody has synced on this install", () => {
    expect(atlasDoctorFailures({ named: false, rows: [row({ grade: "unpublished", platform: "figma" })] })).toEqual([]);
  });

  it("DOES fail a named platform that has never been published, because that is the shipping question", () => {
    expect(
      atlasDoctorFailures({ named: true, rows: [row({ grade: "unpublished", platform: "figma" })] }).map(
        (entry) => entry.platform,
      ),
    ).toEqual(["figma"]);
  });

  it("passes a named platform that answers", () => {
    expect(atlasDoctorFailures({ named: true, rows: [row({ grade: "answerable", platform: "linear" })] })).toEqual([]);
  });
});

describe("atlasDoctorJson", () => {
  it("carries the verdict a gate reads rather than making it recompute one", () => {
    const report = atlasDoctorJson({
      named: false,
      rows: [row({ grade: "answerable", platform: "linear" }), row({ grade: "dark", platform: "vanta" })],
    });
    expect(report.ok).toBe(false);
    expect(report.failing).toEqual(["vanta"]);
    expect(report.atlases).toHaveLength(2);
  });
});

describe("renderAtlasDoctor", () => {
  it("names every atlas that cannot answer in the last line", () => {
    const lines = renderAtlasDoctor({
      named: false,
      rows: [row({ grade: "answerable", platform: "linear" }), row({ grade: "dark", platform: "vanta" })],
    });
    expect(lines.at(-1)).toBe("1 of 2 atlas(es) cannot answer: vanta");
  });

  it("says how many were graded when none is broken", () => {
    const lines = renderAtlasDoctor({ named: false, rows: [row({ grade: "answerable", platform: "linear" })] });
    expect(lines.at(-1)).toBe("1 atlas(es) graded, none broken");
  });

  it("says which kinds answer about the platform and not about the estate, with the remedy", () => {
    const lines = renderAtlasDoctor({
      named: true,
      rows: [
        row({
          grade: "answerable",
          over: { estateNotEstablishedKinds: ["dashboard", "monitor", "notebooks"] },
          platform: "datadog",
        }),
      ],
    });
    expect(lines[1]).toBe(
      "  datadog: 3 kind(s) NOT ANSWERABLE ABOUT THE ESTATE — every record they hold was declared by a" +
        " discovery surface, and an authoritative one has never revealed one that a declaration did not" +
        " already carry, so they establish that the platform offers these and nothing about what this" +
        " organisation holds (dashboard, monitor, notebooks); an authoritative pass is what fills them",
    );
  });

  it("samples past eight kinds and counts the remainder, so one class cannot become a wall of text", () => {
    const kinds = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const lines = renderAtlasDoctor({
      named: true,
      rows: [row({ grade: "answerable", over: { estateNotEstablishedKinds: kinds }, platform: "datadog" })],
    });
    expect(lines[1]).toContain("(a, b, c, d, e, f, g, h, and 2 more)");
  });

  it("stays silent about the estate when every non-empty kind has authoritative evidence", () => {
    const lines = renderAtlasDoctor({ named: true, rows: [row({ grade: "answerable", platform: "datadog" })] });
    expect(lines.filter((line) => line.includes("NOT ANSWERABLE ABOUT THE ESTATE"))).toEqual([]);
  });

  it("reports what a repair actually rewrote", () => {
    const repaired: AtlasDoctorRow = {
      ...row({ grade: "answerable", platform: "xero" }),
      repairedKinds: ["family", "method"],
    };
    expect(renderAtlasDoctor({ named: true, rows: [repaired] })).toContain("repaired xero: family, method");
  });

  it("pads the platform column to the widest name so the reasons line up", () => {
    const lines = renderAtlasDoctor({
      named: false,
      rows: [row({ grade: "answerable", platform: "xero" }), row({ grade: "answerable", platform: "google-admin" })],
    });
    expect(lines[0]!.startsWith("xero          ")).toBe(true);
  });

  it("names a permission boundary under its atlas, with the remedy that distinguishes it", () => {
    const lines = renderAtlasDoctor({
      named: true,
      rows: [
        row({
          grade: "answerable",
          over: { permissionBlockedKinds: ["organization-settings", "webhook"] },
          platform: "github",
        }),
      ],
    });
    expect(lines[1]).toBe(
      "  github: 2 kind(s) NOT PERMITTED under the current credential (organization-settings, webhook)" +
        " — a grant would fill them, the atlas is not missing them",
    );
  });

  it("names a product this organisation does not have on its own line, apart from a permission boundary", () => {
    const lines = renderAtlasDoctor({
      named: true,
      rows: [
        row({
          grade: "answerable",
          over: { permissionBlockedKinds: ["webhook"], productAbsentKinds: ["gcep"] },
          platform: "jumpcloud",
        }),
      ],
    });
    expect(lines[2]).toBe(
      "  jumpcloud: 1 kind(s) this organisation has NO SUCH PRODUCT for (gcep) — excluded as unreachable, the" +
        " atlas is not missing them",
    );
  });

  it("gives a gap and an unattempted kind their own lines, so the three never read alike", () => {
    const lines = renderAtlasDoctor({
      named: true,
      rows: [
        row({
          grade: "answerable",
          over: { gapKinds: ["ruleset"], notAttemptedKinds: ["environment"], permissionBlockedKinds: ["webhook"] },
          platform: "github",
        }),
      ],
    });
    expect(lines[2]).toBe(
      "  github: 1 kind(s) attempted and never acquired, with no permission boundary explaining it (ruleset)" +
        " — a fix, not a grant",
    );
    expect(lines[3]).toBe("  github: 1 kind(s) no run has ever attempted (environment) — neither broken nor fenced");
  });

  it("totals the fenced kinds across a sweep, so the boundary is visible without reading every row", () => {
    const lines = renderAtlasDoctor({
      named: false,
      rows: [
        row({ grade: "answerable", over: { permissionBlockedKinds: ["webhook"] }, platform: "github" }),
        row({ grade: "answerable", over: { permissionBlockedKinds: ["billing", "sso"] }, platform: "slack" }),
      ],
    });
    expect(lines).toContain(
      "3 kind(s) across 2 atlas(es) are fenced by permissions, not missing — each names the grant that would lift it",
    );
  });

  it("keeps a fully reachable atlas to one line, so the sweep stays scannable", () => {
    const lines = renderAtlasDoctor({ named: false, rows: [row({ grade: "answerable", platform: "linear" })] });
    expect(lines.length).toBe(2);
  });

  it("does NOT fail a named atlas that is only fenced — a boundary is the atlas working", () => {
    const rows = [row({ grade: "answerable", over: { permissionBlockedKinds: ["webhook"] }, platform: "github" })];
    expect(atlasDoctorFailures({ named: true, rows })).toEqual([]);
    expect(atlasDoctorJson({ named: true, rows }).ok).toBe(true);
  });

  it("publishes the three lists in --json, so a caller reads them rather than recomputing them", () => {
    const report = atlasDoctorJson({
      named: true,
      rows: [
        row({
          grade: "answerable",
          over: { gapKinds: ["ruleset"], notAttemptedKinds: ["environment"], permissionBlockedKinds: ["webhook"] },
          platform: "github",
        }),
      ],
    });
    expect(report.atlases[0]!.permissionBlockedKinds).toEqual(["webhook"]);
    expect(report.atlases[0]!.gapKinds).toEqual(["ruleset"]);
    expect(report.atlases[0]!.notAttemptedKinds).toEqual(["environment"]);
  });
});
