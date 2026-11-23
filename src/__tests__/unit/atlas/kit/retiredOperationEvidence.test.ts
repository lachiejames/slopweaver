/**
 * The witness for the deadlock between the two volume guards, measured on the live JumpCloud atlas.
 *
 * An atlas declares an operation shape-indexed, so a walk may never produce that operation's rows again —
 * while the rows that operation produced BEFORE the declaration are still on disk. The evidence-loss guard
 * compared against them and refused every publish of a kind whose attempt failed, forever. MEASURED on a
 * scheduled resync: `policies` and `assets` each published fewer rows than the file on disk, by the retired
 * operations' rows, with the atlas clock still at its earlier value.
 *
 * A filesystem round trip through the REAL `publishAtlas` rather than a call to `refuseEvidenceLoss`,
 * because the defect was in the WIRING — the pure rule was right on its own terms, and so was the volume
 * declaration. The cases below pin both halves: the retired rows leave the comparison, and every loss of a
 * row a walk may still produce is refused exactly as before.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { publishAtlas } from "../../../../atlas/kit/publish.js";
import { type AtlasStorePaths, type AtlasStoreSpec, readAtlas, readManifest } from "../../../../atlas/kit/store.js";
import type { AtlasVolumeDeclaration } from "../../../../atlas/kit/volume.js";
import { isRecord } from "../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-17T00:00:00.000Z";
const KINDS = ["alpha"] as const;
type Kind = (typeof KINDS)[number];

/** The operation this atlas has retired — the stand-in for `v2-policyresults-list`. */
const RETIRED = "list-history";
/** The operation whose rows a walk may still produce — the stand-in for `v2-get-device-asset`. */
const KEPT = "list-configuration";

const statusSchema = z
  .object({
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: z.iso.datetime(), outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: z.string().nullable(),
  })
  .strict();
const fileSchema = z
  .object({
    entities: z.array(z.object({ id: z.string().min(1), operation: z.string().min(1) }).strict()),
    kind: z.enum(KINDS),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const manifestSchema = z
  .object({ kinds: z.record(z.enum(KINDS), statusSchema), schemaVersion: z.literal(1), updatedAt: z.iso.datetime() })
  .strict();
type File = z.infer<typeof fileSchema>;
type Manifest = z.infer<typeof manifestSchema>;

/**
 * This platform's row-provenance reader, narrowing an `unknown` row with a guard exactly as the kit's own
 * `AtlasRowOperation` contract requires.
 */
function operationOf({ row }: { row: unknown }): string | null {
  if (!isRecord(row)) {
    return null;
  }
  const operation = row["operation"];
  if (typeof operation !== "string") {
    return null;
  }
  return operation;
}

/** A volume declaration retiring one OPERATION of `alpha`, which is the JumpCloud shape. */
const RETIRED_OPERATION_VOLUMES: AtlasVolumeDeclaration<Kind> = {
  operationOf,
  verdicts: [
    {
      because: "a device's change history: one row per recorded transition, never compacted",
      disposition: "shape-index",
      kind: "alpha",
      operation: RETIRED,
      volume: {
        basis: "measured",
        establishedBy: "`seeded()` below, which publishes 15 of them",
        magnitude: "15 of the 20 rows this fixture's store holds",
        unboundedBecause: "a history accrues an entry per change and grows with the clock",
      },
    },
  ],
};

const SPEC: AtlasStoreSpec<Kind, File, Manifest> = {
  kindObligations: { exceptions: { alpha: { rule: "optional", why: "probe" } } },
  kindVolumes: RETIRED_OPERATION_VOLUMES,
  kinds: KINDS,
  parseKindFile: ({ json }) => fileSchema.safeParse(json),
  parseManifest: ({ json }) => manifestSchema.safeParse(json),
  platform: "example",
  schemaVersion: 1,
  supersedeRemedy: "run: slopweaver atlas example reset",
};

/** The same atlas with no row-provenance reader, which is what an atlas that cannot attribute a row gets. */
const BLIND_SPEC: AtlasStoreSpec<Kind, File, Manifest> = {
  ...SPEC,
  kindVolumes: { verdicts: RETIRED_OPERATION_VOLUMES.verdicts },
};

function paths({ root }: { root: string }): AtlasStorePaths<Kind> {
  const directory = join(root, "example");
  return {
    directory,
    home: root,
    kinds: { alpha: join(directory, "alpha.jsonl") },
    manifest: join(directory, "manifest.json"),
    superseded: join(root, "_superseded", "example"),
  };
}

function file({ retired, kept }: { retired: number; kept: number }): File {
  const rows = [
    ...Array.from({ length: retired }, (_, index) => ({ id: `retired-${String(index)}`, operation: RETIRED })),
    ...Array.from({ length: kept }, (_, index) => ({ id: `kept-${String(index)}`, operation: KEPT })),
  ];
  return { entities: rows, kind: "alpha", schemaVersion: 1, updatedAt: AT };
}

function manifestOf({ outcome }: { outcome: "ok" | "failed" }): Manifest {
  return manifestSchema.parse({
    kinds: {
      alpha: { digest: null, entityCount: 0, lastAttempt: { at: AT, outcome, reasons: [] }, lastSuccessAt: AT },
    },
    schemaVersion: 1,
    updatedAt: AT,
  });
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Publish the generation the store held BEFORE the operation was retired: 15 history rows and 5
 * configuration rows, a mostly-retired kind like both JumpCloud ones.
 *
 * Published through a spec declaring no verdict at all, because that is the true order of events and
 * `refuseVoluminousRows` refuses the other one — a generation carrying a retired operation's rows is
 * exactly what that gate exists to stop, and the only reason those rows are on disk in the real store is
 * that they were written before the declaration existed.
 */
function seeded(): { paths: AtlasStorePaths<Kind>; derivedFrom: Manifest | null } {
  const root = mkdtempSync(join(tmpdir(), "retired-op-"));
  roots.push(root);
  const resolved = paths({ root });
  unwrap(
    publishAtlas({
      derivedFrom: null,
      files: { alpha: file({ kept: 5, retired: 15 }) },
      manifest: manifestOf({ outcome: "ok" }),
      paths: resolved,
      spec: { ...SPEC, kindVolumes: { verdicts: [] } },
    }),
  );
  return { derivedFrom: unwrap(readManifest({ paths: resolved, spec: SPEC })), paths: resolved };
}

describe("a retired operation's rows leave the evidence-loss comparison", () => {
  it("publishes a failed run that kept every row a walk may still produce, dropping the retired ones", () => {
    const store = seeded();

    const published = publishAtlas({
      derivedFrom: store.derivedFrom,
      files: { alpha: file({ kept: 5, retired: 0 }) },
      manifest: manifestOf({ outcome: "failed" }),
      paths: store.paths,
      spec: SPEC,
    });

    expect(published.isOk()).toBe(true);
    expect(unwrap(readAtlas({ paths: store.paths, spec: SPEC })).files.alpha?.entities.length).toBe(5);
  });

  it("still refuses a failed run that loses a row the walk may still produce, counting only the kept half", () => {
    const store = seeded();

    const refused = publishAtlas({
      derivedFrom: store.derivedFrom,
      files: { alpha: file({ kept: 3, retired: 0 }) },
      manifest: manifestOf({ outcome: "failed" }),
      paths: store.paths,
      spec: SPEC,
    });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)[0]).toBe(
      "this example run FAILED and would publish less than the store already holds, so it is refused:",
    );
    expect(unwrapErr(refused)[1]).toBe("  alpha (degraded): 3 entities / 0 artifact(s), replacing 5 / 0");
    expect(unwrap(readAtlas({ paths: store.paths, spec: SPEC })).files.alpha?.entities.length).toBe(20);
  });

  it("still refuses a publish that empties the kept half, which the entity half being kept is the point of", () => {
    const store = seeded();

    const refused = publishAtlas({
      derivedFrom: store.derivedFrom,
      files: { alpha: file({ kept: 0, retired: 0 }) },
      manifest: manifestOf({ outcome: "ok" }),
      paths: store.paths,
      spec: SPEC,
    });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)[0]).toBe(
      "this example publish would empty a kind the store already holds, so it is refused:",
    );
    expect(unwrapErr(refused)[1]).toBe("  alpha (emptied): 0 entities / 0 artifact(s), replacing 5 / 0");
  });

  it("keeps every row for an atlas that declares no row-provenance reader, visibly rather than by guess", () => {
    const store = seeded();

    const refused = publishAtlas({
      derivedFrom: store.derivedFrom,
      files: { alpha: file({ kept: 5, retired: 0 }) },
      manifest: manifestOf({ outcome: "failed" }),
      paths: store.paths,
      spec: BLIND_SPEC,
    });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)[1]).toBe("  alpha (degraded): 5 entities / 0 artifact(s), replacing 20 / 0");
  });

  it("refuses retired rows padding an emptied kept half, even with the row-volume hatch open", () => {
    // The review pass's counterexample: measuring only the EXISTING side over kept rows let 5 retired rows
    // in a publish stand in for 5 kept ones, so 5 → 5 read as no loss while every kept row went.
    const store = seeded();
    const previous = process.env["SLOPWEAVER_ALLOW_ATLAS_ROW_VOLUME"];
    process.env["SLOPWEAVER_ALLOW_ATLAS_ROW_VOLUME"] = "1";
    try {
      const refused = publishAtlas({
        derivedFrom: store.derivedFrom,
        files: { alpha: file({ kept: 0, retired: 5 }) },
        manifest: manifestOf({ outcome: "failed" }),
        paths: store.paths,
        spec: SPEC,
      });

      expect(refused.isErr()).toBe(true);
      expect(unwrapErr(refused)[1]).toBe("  alpha (emptied): 0 entities / 0 artifact(s), replacing 5 / 0");
    } finally {
      if (previous === undefined) {
        delete process.env["SLOPWEAVER_ALLOW_ATLAS_ROW_VOLUME"];
      } else {
        process.env["SLOPWEAVER_ALLOW_ATLAS_ROW_VOLUME"] = previous;
      }
    }
    expect(unwrap(readAtlas({ paths: store.paths, spec: SPEC })).files.alpha?.entities.length).toBe(20);
  });
});
