/**
 * The falsifier for the generation protocol's atomicity: a publish that fails part-way must leave the
 * PUBLISHED generation byte-identical, not merely detectable as broken.
 *
 * Written against a real filesystem rather than a seam, because the failure being reproduced is a
 * filesystem one — a destination directory the process cannot write into. `chmod 0o500` is the smallest
 * such failure that can be aimed at exactly ONE kind while leaving every other path, and the prior
 * generation's own bytes, readable.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { writeAtomicKindFile } from "../../../../atlas/atlasFile.js";
import { commitGeneration, type GenerationFile, stageGeneration } from "../../../../atlas/kit/generationSwap.js";
import { publishAtlas } from "../../../../atlas/kit/publish.js";
import { atlasPublishErrorLines } from "../../../../atlas/kit/publishErrors.js";
import { type AtlasStorePaths, type AtlasStoreSpec, readAtlas, readManifest } from "../../../../atlas/kit/store.js";
import { isRecord } from "../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-07T00:00:00.000Z";
const KINDS = ["alpha", "beta"] as const;
type Kind = (typeof KINDS)[number];

const statusSchema = z
  .object({
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z.null(),
    lastSuccessAt: z.string().nullable(),
  })
  .strict();

const fileSchema = z
  .object({
    entities: z.array(z.object({ id: z.string().min(1) }).strict()),
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

const SPEC: AtlasStoreSpec<Kind, File, Manifest> = {
  // Every kind optional: this fixture exercises the atomic swap, not the obligation gate.
  kindObligations: {
    exceptions: Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        { rule: "optional", why: "this fixture exercises the atomic swap, not the obligation gate" } as const,
      ]),
    ),
  },
  kindVolumes: { verdicts: [] },
  kinds: KINDS,
  parseKindFile: ({ json }) => fileSchema.safeParse(json),
  parseManifest: ({ json }) => manifestSchema.safeParse(json),
  platform: "example",
  schemaVersion: 1,
  supersedeRemedy: "run: slopweaver atlas example reset",
};

/**
 * The generation the store holds right now, as a publish's derivation basis.
 *
 * `publishAtlas` compare-and-swaps against this, so a test that publishes a second time has to say what the
 * second candidate was built ON — which is exactly what a real caller does by reading before it writes.
 * Passing a literal `null` instead would assert the store was empty, and the publish would rightly refuse.
 */
function live({ paths: resolved }: { paths: AtlasStorePaths<Kind> }): Manifest | null {
  return unwrap(readManifest({ paths: resolved, spec: SPEC }));
}

/** `beta` lives one directory deeper on purpose: that directory is what a test makes unwritable. */
function paths({ root }: { root: string }): AtlasStorePaths<Kind> {
  const directory = join(root, "example");
  return {
    directory,
    home: root,
    kinds: {
      alpha: join(directory, "alpha.jsonl"),
      beta: join(directory, "nested", "beta.jsonl"),
    },
    manifest: join(directory, "manifest.json"),
    superseded: join(root, "_superseded", "example"),
  };
}

function file({ kind, ids }: { kind: Kind; ids: readonly string[] }): File {
  return { entities: ids.map((id) => ({ id })), kind, schemaVersion: 1, updatedAt: AT };
}

/** A manifest cell for every kind, with only the named ones claiming a successful sync. */
function manifestOf({ synced }: { synced: readonly Kind[] }): Manifest {
  const cells: Record<string, z.infer<typeof statusSchema>> = {};
  for (const kind of KINDS) {
    cells[kind] = {
      digest: null,
      entityCount: 0,
      lastAttempt: null,
      lastSuccessAt: synced.includes(kind) ? AT : null,
    };
  }
  return manifestSchema.parse({ kinds: cells, schemaVersion: 1, updatedAt: AT });
}

const roots: string[] = [];

function mintRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-atomic-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      chmodSync(join(root, "example", "nested"), 0o700);
    } catch {
      // The directory a test made unwritable may never have been created; only its removal matters here.
    }
    rmSync(root, { force: true, recursive: true });
  }
});

describe("publishAtlas is atomic against a part-way filesystem failure", () => {
  it("leaves the published generation byte-identical when a later kind's destination cannot be written", () => {
    const root = mintRoot();
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { alpha: file({ ids: ["a"], kind: "alpha" }), beta: file({ ids: ["a"], kind: "beta" }) },
        manifest: manifestOf({ synced: ["alpha", "beta"] }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const priorAlpha = readFileSync(resolved.kinds.alpha, "utf8");
    const priorBeta = readFileSync(resolved.kinds.beta, "utf8");
    const priorManifest = readFileSync(resolved.manifest, "utf8");

    chmodSync(join(resolved.directory, "nested"), 0o500);
    const failure = unwrapErr(
      publishAtlas({
        files: { alpha: file({ ids: ["a", "b"], kind: "alpha" }), beta: file({ ids: ["a", "b"], kind: "beta" }) },
        manifest: manifestOf({ synced: ["alpha", "beta"] }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(failure[0]).toContain(resolved.kinds.beta);
    chmodSync(join(resolved.directory, "nested"), 0o700);

    expect(readFileSync(resolved.kinds.alpha, "utf8")).toBe(priorAlpha);
    expect(readFileSync(resolved.kinds.beta, "utf8")).toBe(priorBeta);
    expect(readFileSync(resolved.manifest, "utf8")).toBe(priorManifest);

    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.mismatched]).toEqual([]);
    expect([...snapshot.missing]).toEqual([]);
    expect([...snapshot.unpublished]).toEqual([]);
    expect(snapshot.files.alpha!.entities.map((entity) => entity.id)).toEqual(["a"]);
    expect(snapshot.files.beta!.entities.map((entity) => entity.id)).toEqual(["a"]);
  });

  it("rolls the published generation back when a destination becomes unrenameable between the two phases", () => {
    const root = mintRoot();
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { alpha: file({ ids: ["a"], kind: "alpha" }), beta: file({ ids: ["a"], kind: "beta" }) },
        manifest: manifestOf({ synced: ["alpha", "beta"] }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const priorAlpha = readFileSync(resolved.kinds.alpha, "utf8");
    const priorBeta = readFileSync(resolved.kinds.beta, "utf8");

    // The two phases are separated on purpose: what the commit phase defends against is a filesystem that
    // changed after every byte was safely staged, and that is a state only a test standing between them
    // can produce.
    const next: readonly GenerationFile[] = [
      {
        path: resolved.kinds.alpha,
        write: ({ path }) => writeAtomicKindFile({ entities: [{ id: "b" }], envelope: {}, path }),
      },
      {
        path: resolved.kinds.beta,
        write: ({ path }) => writeAtomicKindFile({ entities: [{ id: "b" }], envelope: {}, path }),
      },
    ];
    unwrap(stageGeneration({ files: next }));
    chmodSync(join(resolved.directory, "nested"), 0o500);
    const refusal = unwrapErr(commitGeneration({ files: next }));
    chmodSync(join(resolved.directory, "nested"), 0o700);
    const failure = atlasPublishErrorLines({ error: refusal });

    expect(refusal.code).toBe("INSTALL_ABORTED");
    expect(failure[0]).toContain(`cannot install ${resolved.kinds.beta}`);
    expect(failure[1]).toBe("nothing was installed — the published generation is untouched");
    expect(readFileSync(resolved.kinds.alpha, "utf8")).toBe(priorAlpha);
    expect(readFileSync(resolved.kinds.beta, "utf8")).toBe(priorBeta);
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.mismatched]).toEqual([]);
    expect(snapshot.files.alpha!.entities.map((entity) => entity.id)).toEqual(["a"]);
  });

  it("leaves no staged or rolled-back residue behind a publish that succeeds", () => {
    const root = mintRoot();
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { alpha: file({ ids: ["a"], kind: "alpha" }), beta: file({ ids: ["a"], kind: "beta" }) },
        manifest: manifestOf({ synced: ["alpha", "beta"] }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    unwrap(
      publishAtlas({
        files: { alpha: file({ ids: ["a", "b"], kind: "alpha" }), beta: file({ ids: ["a", "b"], kind: "beta" }) },
        manifest: manifestOf({ synced: ["alpha", "beta"] }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(readdirSync(resolved.directory).toSorted()).toEqual(["alpha.jsonl", "manifest.json", "nested"]);
    expect(readdirSync(join(resolved.directory, "nested"))).toEqual(["beta.jsonl"]);
    expect(unwrap(readManifest({ paths: resolved, spec: SPEC }))!.kinds.alpha.entityCount).toBe(2);
  });
});

/** A guard on the falsifier itself: the unwritable directory really does refuse a write. */
describe("the falsifier's own witness", () => {
  it("cannot write into a 0o500 directory", () => {
    const root = mintRoot();
    const nested = join(root, "example", "nested");
    mkdirSync(nested, { recursive: true });
    chmodSync(nested, 0o500);
    const attempt = ((): string => {
      try {
        writeFileSync(join(nested, "probe.txt"), "x", "utf8");
        return "wrote";
      } catch (error: unknown) {
        return isRecord(error) && typeof error["code"] === "string" ? error["code"] : "unknown";
      }
    })();
    chmodSync(nested, 0o700);
    expect(attempt).toBe("EACCES");
  });
});
