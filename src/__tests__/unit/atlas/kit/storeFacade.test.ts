import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { PLACEHOLDER_CLOCK } from "../../../../atlas/kit/manifestClock.js";
import { AtlasPublishErrors, atlasPublishErrorLines } from "../../../../atlas/kit/publishErrors.js";
import type { AtlasStorePaths, AtlasStoreSpec } from "../../../../atlas/kit/store.js";
import { createAtlasStore } from "../../../../atlas/kit/storeFacade.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";
const KINDS = ["thing"] as const;
type Kind = (typeof KINDS)[number];

const fileSchema = z
  .object({
    entities: z.array(z.object({ id: z.string().min(1) }).strict()),
    kind: z.enum(KINDS),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();

const manifestSchema = z
  .object({
    kinds: z.record(
      z.enum(KINDS),
      z
        .object({
          digest: z.string().min(1).nullable(),
          entityCount: z.number().int().nonnegative(),
          lastAttempt: z.null(),
          lastSuccessAt: z.string().nullable(),
        })
        .strict(),
    ),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();

type File = z.infer<typeof fileSchema>;
type Manifest = z.infer<typeof manifestSchema>;

const SPEC: AtlasStoreSpec<Kind, File, Manifest> = {
  kinds: KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => fileSchema.safeParse(json),
  parseManifest: ({ json }) => manifestSchema.safeParse(json),
  platform: "example",
  schemaVersion: 1,
  supersedeRemedy: "run: slopweaver atlas example reset",
};

const FILE: File = { entities: [{ id: "a" }, { id: "b" }], kind: "thing", schemaVersion: 1, updatedAt: AT };

const MANIFEST: Manifest = {
  kinds: { thing: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: AT } },
  schemaVersion: 1,
  updatedAt: PLACEHOLDER_CLOCK,
};

let root: string;
let paths: AtlasStorePaths<Kind>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "store-facade-"));
  paths = {
    directory: join(root, "example"),
    home: root,
    kinds: { thing: join(root, "example", "thing.jsonl") },
    manifest: join(root, "example", "manifest.json"),
    superseded: join(root, "_superseded", "example"),
  };
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("createAtlasStore", () => {
  it("reads an empty home as no manifest, no kind file and an empty generation", () => {
    const store = createAtlasStore({ spec: SPEC });

    expect(unwrap(store.manifest({ paths }))).toBe(null);
    expect(unwrap(store.kindFile({ kind: "thing", paths }))).toBe(null);
    const snapshot = unwrap(store.snapshot({ paths }));
    expect(snapshot.files).toEqual({ thing: null });
    expect(snapshot.manifest).toBe(null);
    expect([...snapshot.missing, ...snapshot.unpublished, ...snapshot.mismatched, ...snapshot.superseded]).toEqual([]);
  });

  it("publishes kind files then the manifest, and every read door returns what was written", () => {
    const store = createAtlasStore({ spec: SPEC });

    expect(unwrap(store.publish({ derivedFrom: null, files: { thing: FILE }, manifest: MANIFEST, paths }))).toEqual([
      paths.kinds.thing,
      paths.manifest,
    ]);

    expect(unwrap(store.kindFile({ kind: "thing", paths }))).toEqual(FILE);
    const manifest = unwrap(store.manifest({ paths }));
    // The store stamps the count and digest from the bytes it wrote and derives the clock from the kind
    // files, so the read-back is the STAMPED document rather than the one handed in.
    expect(manifest).toEqual({
      kinds: {
        thing: {
          digest: createHash("sha256").update(readFileSync(paths.kinds.thing)).digest("hex"),
          entityCount: 2,
          lastAttempt: null,
          lastSuccessAt: AT,
        },
      },
      schemaVersion: 1,
      updatedAt: AT,
    });
    const snapshot = unwrap(store.snapshot({ paths }));
    expect(snapshot.files).toEqual({ thing: FILE });
    expect(snapshot.manifest).toEqual(manifest);
    expect([...snapshot.missing, ...snapshot.unpublished, ...snapshot.mismatched, ...snapshot.superseded]).toEqual([]);
  });

  it("forwards derivedFrom, so a publish claiming an empty store over a published one is refused", () => {
    const store = createAtlasStore({ spec: SPEC });
    unwrap(store.publish({ derivedFrom: null, files: { thing: FILE }, manifest: MANIFEST, paths }));

    const refused = unwrapErr(store.publish({ derivedFrom: null, files: { thing: FILE }, manifest: MANIFEST, paths }));

    expect(refused).toEqual(
      atlasPublishErrorLines({ error: AtlasPublishErrors.generationMoved({ platform: "example" }) }),
    );
    const held = unwrap(store.manifest({ paths }));
    expect(unwrap(store.publish({ derivedFrom: held, files: { thing: FILE }, manifest: MANIFEST, paths }))).toEqual([
      paths.kinds.thing,
      paths.manifest,
    ]);
  });
});
