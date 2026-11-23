import { describe, expect, it } from "vitest";

import {
  type DatadogCoverageCell,
  type DatadogManifest,
  emptyDatadogManifest,
} from "../../../../atlas/datadog/documents.js";
import { DATADOG_KINDS, DATADOG_REGISTRY_KINDS } from "../../../../atlas/datadog/model.js";
import { datadogApiFill, datadogCompiledFill, datadogDescriptorFor } from "../../../../atlas/datadog/surfaceFill.js";

const AT = "2026-09-06T01:00:00.000Z";

/** A manifest in which the named kinds have succeeded and every other kind has not. */
const manifestWith = ({ succeeded }: { succeeded: readonly string[] }): DatadogManifest => {
  const base = emptyDatadogManifest({ updatedAt: AT });
  const kinds = { ...base.kinds };
  for (const kind of succeeded) {
    kinds[kind as (typeof DATADOG_KINDS)[number]] = {
      digest: null,
      entityCount: 1,
      lastAttempt: { at: AT, outcome: "ok", reasons: [] },
      lastSuccessAt: AT,
    };
  }
  return { ...base, kinds };
};

const everyKind = manifestWith({ succeeded: [...DATADOG_KINDS] });

describe("datadogCompiledFill", () => {
  it("is unfilled when nothing has been published at all", () => {
    const fill = datadogCompiledFill({ manifest: null });

    expect(fill.filled).toBe(false);
    expect(fill.succeeded).toBe(0);
    expect(fill.declared).toBe(DATADOG_REGISTRY_KINDS.length);
  });

  // Not "most", not "at least one". An existential grade is what let a sibling atlas report a surface
  // filled while it had reached only one of the destinations it asked for.
  it("stays unfilled when a SINGLE kind is outstanding", () => {
    const short = [...DATADOG_KINDS].filter((kind) => kind !== "monitor");
    const fill = datadogCompiledFill({ manifest: manifestWith({ succeeded: short }) });

    expect(fill.filled).toBe(false);
    expect(fill.outstanding).toStrictEqual(["monitor"]);
    expect(fill.succeeded).toBe(DATADOG_REGISTRY_KINDS.length - 1);
  });

  it("is filled only when every declared kind carries a recorded success", () => {
    const fill = datadogCompiledFill({ manifest: everyKind });

    expect(fill.filled).toBe(true);
    expect(fill.outstanding).toStrictEqual([]);
  });

  // Every Datadog kind exists BECAUSE the registry carries rows for it, so one compile fills all of them.
  // A denominator with an exception in it is a denominator somebody can widen.
  it("counts every declared kind, with no excluded denominator", () => {
    expect(datadogCompiledFill({ manifest: everyKind }).declared).toBe(144);
  });
});

describe("datadogDescriptorFor", () => {
  it("derives the compiled surface's status from the store rather than from the source literal", () => {
    const surfaces = datadogDescriptorFor({ manifest: everyKind }).surfaces;
    const compiled = surfaces.find((surface) => surface.acquisition === "compiled")!;

    expect(compiled.status).toBe("filled");
    expect(compiled.unfilledBecause).toBe(null);
  });

  it("names how far off it is, and the command, while it is short", () => {
    const short = [...DATADOG_KINDS].filter((kind) => kind !== "monitor");
    const surfaces = datadogDescriptorFor({ manifest: manifestWith({ succeeded: short }) }).surfaces;
    const compiled = surfaces.find((surface) => surface.acquisition === "compiled")!;

    expect(compiled.status).toBe("declared-unfilled");
    expect(compiled.unfilledBecause).toContain("143 of 144");
    expect(compiled.unfilledBecause).toContain("slopweaver atlas datadog sync");
  });

  // A compile publishes no evidence for either, so both stay declared-unfilled from the ABSENCE of evidence
  // and keep their own reasons unchanged.
  it("leaves the api and console surfaces exactly as declared, even on a filled compile", () => {
    const surfaces = datadogDescriptorFor({ manifest: everyKind }).surfaces;

    expect(surfaces.find((surface) => surface.name === "api")!.status).toBe("declared-unfilled");
    expect(surfaces.find((surface) => surface.name === "console")!.status).toBe("declared-unfilled");
    expect(surfaces.find((surface) => surface.name === "console")!.unfilledBecause).toContain(
      "slopweaver atlas datadog walk",
    );
  });
});

/** A stored `api` coverage cell, with only the two fields the fill judgement reads spelled. */
const apiCell = ({ state, lastSuccessAt }: { state: DatadogCoverageCell["state"]; lastSuccessAt: string | null }) =>
  ({
    channel: "api",
    lastSuccessAt,
    latestAttemptFailed: state !== "synced",
    reason: "a reason",
    role: "authoritative",
    scope: "a kind",
    state,
    surface: "api",
    unblockedBy: null,
  }) satisfies DatadogCoverageCell;

/** The same files as `datadogDescriptorFor` reads them: no entities and no gaps beside the cells. */
const withEmptyConsole = ({
  files,
}: {
  files: Record<string, { coverage: readonly DatadogCoverageCell[] }>;
}): Record<string, { coverage: readonly DatadogCoverageCell[]; entities: readonly []; gaps: readonly [] }> =>
  Object.fromEntries(Object.entries(files).map(([kind, file]) => [kind, { ...file, entities: [], gaps: [] }]));

/** Kind files carrying one `api` cell each, for the named kinds only. */
const filesWith = ({
  synced = [],
  deferred = [],
}: {
  synced?: readonly string[];
  deferred?: readonly string[];
}): Record<string, { coverage: readonly DatadogCoverageCell[] }> => {
  const files: Record<string, { coverage: readonly DatadogCoverageCell[] }> = {};
  for (const kind of synced) {
    files[kind] = { coverage: [apiCell({ lastSuccessAt: AT, state: "synced" })] };
  }
  for (const kind of deferred) {
    files[kind] = { coverage: [apiCell({ lastSuccessAt: AT, state: "deferred" })] };
  }
  return files;
};

describe("datadogApiFill — read off the CELLS, because the manifest cannot speak for three channels", () => {
  it("counts a kind with no file at all as unreached rather than as empty", () => {
    const fill = datadogApiFill({ files: {} });
    expect(fill.unreached).toBe(DATADOG_REGISTRY_KINDS.length);
    expect(fill.complete).toBe(0);
    expect(fill.filled).toBe(false);
  });

  it("counts a `synced` cell as complete and a `deferred` one as bounded", () => {
    const fill = datadogApiFill({ files: filesWith({ deferred: ["monitor"], synced: ["hosts"] }) });
    expect(fill.complete).toBe(1);
    expect(fill.bounded).toBe(1);
    expect(fill.unreached).toBe(DATADOG_REGISTRY_KINDS.length - 2);
  });

  it("treats a cell that has never recorded a success as unreached, whatever its state says", () => {
    const files = { monitor: { coverage: [apiCell({ lastSuccessAt: null, state: "deferred" })] } };
    expect(datadogApiFill({ files }).bounded).toBe(0);
  });

  it("refuses `filled` while one kind is still bounded, which is the whole point", () => {
    const every = Object.fromEntries(
      DATADOG_KINDS.map((kind) => [kind, { coverage: [apiCell({ lastSuccessAt: AT, state: "synced" })] }]),
    );
    expect(datadogApiFill({ files: every }).filled).toBe(true);
    const oneBounded = { ...every, monitor: { coverage: [apiCell({ lastSuccessAt: AT, state: "deferred" })] } };
    expect(datadogApiFill({ files: oneBounded }).filled).toBe(false);
  });
});

describe("datadogDescriptorFor — the api surface's reason moves, its status does not", () => {
  const apiSurfaceOf = ({ files }: { files?: Record<string, { coverage: readonly DatadogCoverageCell[] }> }) =>
    datadogDescriptorFor({
      manifest: manifestWith({ succeeded: [...DATADOG_KINDS] }),
      ...(files === undefined ? {} : { files: withEmptyConsole({ files }) }),
    }).surfaces.find((surface) => surface.name === "api")!;

  it("keeps the descriptor's own sentence when no live pass has ever run", () => {
    const surface = apiSurfaceOf({ files: {} });
    expect(surface.status).toBe("declared-unfilled");
    expect(surface.unfilledBecause).toContain("FOUR remainders");
  });

  it("leaves it alone entirely when the caller hands over no files", () => {
    expect(apiSurfaceOf({}).unfilledBecause).toContain("FOUR remainders");
  });

  it("rewrites the reason with the three counts once a pass has run", () => {
    const surface = apiSurfaceOf({ files: filesWith({ deferred: ["monitor"], synced: ["hosts"] }) });
    expect(surface.status).toBe("declared-unfilled");
    expect(surface.unfilledBecause).toContain("a live pass has run");
    expect(surface.unfilledBecause).toContain("1 were read in full");
  });
});
