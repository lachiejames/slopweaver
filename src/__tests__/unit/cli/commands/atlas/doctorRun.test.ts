/**
 * The doctor's shell: which atlases it walks, how a refusal becomes a grade, and what a repair adds.
 *
 * Every edge is an injected plain function rather than a mock — the registry lookup, the repair and the
 * clock — so the sweep is exercised without a home directory or a real generation.
 */
import { describe, expect, it } from "vitest";

import { type AtlasReadError, AtlasReadErrors, type AtlasReadSnapshot } from "../../../../../atlas/kit/read.js";
import { ATLAS_DOCTOR_FLAG_NAMES, ATLAS_DOCTOR_USAGE } from "../../../../../cli/commands/atlas/doctorCore.js";
import { type AtlasDoctorDeps, gradeOneAtlas, runAtlasDoctor } from "../../../../../cli/commands/atlas/doctorRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

/** A snapshot holding one readable entity, so a platform can grade answerable. */
function answerableSnapshot({ platform }: { platform: string }): AtlasReadSnapshot {
  return {
    descriptor: {
      excludes: [],
      kinds: ["control"],
      platform,
      question: "what does this tenant hold",
      resyncCommand: `slopweaver atlas ${platform} sync`,
      surfaces: [],
      visibilityScope: "this tenant",
      writePolicy: "refuse-every-write",
    },
    generation: {
      mismatched: [],
      missing: [],
      platform,
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
    kinds: [
      {
        coverage: [],
        entities: [{ detail: null, id: "e1", kind: "control", observations: [], providerId: "e1", scope: platform }],
        gaps: [],
        kind: "control",
        lastSuccessAt: "2026-09-06T00:00:00.000Z",
        latestAttemptFailed: false,
        permissionBlocked: null,
        publishedCount: 1,
      },
    ],
  };
}

/**
 * Deps whose registry answers from a table of results.
 *
 * @param answers what each platform's read returns
 * @param lines where the rendered output accumulates
 * @param repaired the kinds a repair reports, keyed by platform
 * @returns the injected edges plus the captured streams
 */
function fakeDeps({
  answers,
  lines,
  diagnostics,
  repaired = {},
}: {
  answers: Readonly<Record<string, Result<AtlasReadSnapshot, AtlasReadError>>>;
  lines: string[];
  diagnostics: string[];
  repaired?: Readonly<Record<string, readonly string[]>>;
}): AtlasDoctorDeps {
  const platforms = Object.keys(answers).toSorted();
  return {
    find: ({ platform }) => {
      const answer = answers[platform];
      if (answer === undefined) {
        return null;
      }
      return {
        catalogue: { doorRouted: false, example: "slopweaver atlas x read", summary: null },
        platform,
        readDescriptor: () => Promise.reject(new Error("atlas doctor never reads a descriptor")),
        readSnapshot: () => Promise.resolve(answer),
        verbs: [],
      };
    },
    now: () => "2026-09-06T10:00:00.000Z",
    platforms: () => platforms,
    repair: ({ paths }) => {
      const kinds = repaired[Object.keys(paths.kinds)[0]!];
      if (kinds === undefined) {
        return ok([]); // a platform the case seeds no repair for has nothing to archive
      }
      return ok(
        kinds.map((kind) => ({
          archivedTo: `/archive/${kind}.json`,
          digest: "d",
          entityCount: 1,
          kind,
        })),
      );
    },
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => lines.push(line),
  };
}

describe("ATLAS_DOCTOR_FLAG_NAMES", () => {
  it("names no flag the verb does not accept, and none is a platform in disguise", () => {
    expect(ATLAS_DOCTOR_FLAG_NAMES).toEqual(["--home", "--json", "--repair"]);
  });

  it("is named in full by the usage, so --help cannot advertise less than the parser takes", () => {
    expect(ATLAS_DOCTOR_FLAG_NAMES.filter((flag) => !ATLAS_DOCTOR_USAGE.includes(flag))).toEqual([]);
  });
});

describe("gradeOneAtlas", () => {
  it("grades an atlas that reads back as answerable", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({ answers: { linear: ok(answerableSnapshot({ platform: "linear" })) }, diagnostics, lines });
    const row = await gradeOneAtlas({ deps, home: undefined, platform: "linear", repair: false });
    expect(row.grade).toBe("answerable");
    expect(row.readable).toBe(1);
  });

  it("turns a dark refusal into a dark row carrying the kinds the reader cannot see", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({
      answers: {
        vanta: err(
          AtlasReadErrors.generationDark({
            darkKinds: ["control"],
            platform: "vanta",
            readable: 0,
            supersededKinds: [],
            vouchedFor: 228,
          }),
        ),
      },
      diagnostics,
      lines,
    });
    const row = await gradeOneAtlas({ deps, home: undefined, platform: "vanta", repair: false });
    expect(row.grade).toBe("dark");
    expect(row.darkKinds).toEqual(["control"]);
    expect(row.vouchedFor).toBe(228);
  });

  it("turns an unpublished refusal into an unpublished row rather than an unreadable one", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({
      answers: { figma: err(AtlasReadErrors.generationUnpublished({ platform: "figma" })) },
      diagnostics,
      lines,
    });
    expect((await gradeOneAtlas({ deps, home: undefined, platform: "figma", repair: false })).grade).toBe(
      "unpublished",
    );
  });

  it("grades a store that will not open as unreadable, which a dark grade would have hidden", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({
      answers: { notion: err(AtlasReadErrors.storeUnreadable({ platform: "notion", reasons: ["bad schema"] })) },
      diagnostics,
      lines,
    });
    expect((await gradeOneAtlas({ deps, home: undefined, platform: "notion", repair: false })).grade).toBe(
      "unreadable",
    );
  });
});

describe("runAtlasDoctor", () => {
  it("exits ok on a sweep whose only non-answerable atlas has never been published", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({
      answers: {
        figma: err(AtlasReadErrors.generationUnpublished({ platform: "figma" })),
        linear: ok(answerableSnapshot({ platform: "linear" })),
      },
      diagnostics,
      lines,
    });
    expect(await runAtlasDoctor({ deps, rest: [] })).toBe(EXIT_OK);
    expect(lines.at(-1)).toBe("2 atlas(es) graded, none broken");
  });

  it("exits non-zero on a sweep holding one dark atlas", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({
      answers: {
        vanta: err(
          AtlasReadErrors.generationDark({
            darkKinds: ["control"],
            platform: "vanta",
            readable: 0,
            supersededKinds: [],
            vouchedFor: 1,
          }),
        ),
      },
      diagnostics,
      lines,
    });
    expect(await runAtlasDoctor({ deps, rest: [] })).toBe(EXIT_ERROR);
  });

  it("exits non-zero for a NAMED platform that has never been published", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({
      answers: { figma: err(AtlasReadErrors.generationUnpublished({ platform: "figma" })) },
      diagnostics,
      lines,
    });
    expect(await runAtlasDoctor({ deps, rest: ["figma"] })).toBe(EXIT_ERROR);
  });

  it("refuses a platform this build has no atlas for, before reading anything", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({ answers: { linear: ok(answerableSnapshot({ platform: "linear" })) }, diagnostics, lines });
    expect(await runAtlasDoctor({ deps, rest: ["stripe"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("no atlas for platform stripe");
  });

  it("carries the verdict in --json so a gate reads it rather than the table", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({
      answers: {
        vanta: err(
          AtlasReadErrors.generationDark({
            darkKinds: ["control"],
            platform: "vanta",
            readable: 0,
            supersededKinds: [],
            vouchedFor: 1,
          }),
        ),
      },
      diagnostics,
      lines,
    });
    await runAtlasDoctor({ deps, rest: ["--json"] });
    expect(JSON.parse(lines[0]!)).toMatchObject({ failing: ["vanta"], ok: false });
  });

  it("prints the usage on --help without grading anything", async () => {
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const deps = fakeDeps({ answers: { linear: ok(answerableSnapshot({ platform: "linear" })) }, diagnostics, lines });
    expect(await runAtlasDoctor({ deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(lines[0]).toContain("usage: slopweaver atlas doctor");
  });
});
