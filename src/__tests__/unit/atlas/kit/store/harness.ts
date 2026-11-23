/*
 * What the atlas kit store test files share: one synthetic platform with a single `thing` kind, its kind-file and
 * manifest schemas, the store spec over them (plain, and one that stamps every attempt), the path layout under a
 * temp root, the live generation a publish derives from, and the manifests and kind files the cases publish.
 * Every case still mints and removes its own temp root.
 */
import { join } from "node:path";

import { z } from "zod";

import { PLACEHOLDER_CLOCK } from "../../../../../atlas/kit/manifestClock.js";
import { type AtlasStorePaths, type AtlasStoreSpec, readManifest } from "../../../../../atlas/kit/store.js";
import { unwrap } from "../../../../../lib/result.js";

/** The instant every fixture here is stamped at. */
export const AT = "2026-08-27T00:00:00.000Z";
const KINDS = ["thing"] as const;
/** The synthetic platform's one kind. */
export type Kind = (typeof KINDS)[number];

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

/** The synthetic platform's kind file. */
export type File = z.infer<typeof fileSchema>;
/** The synthetic platform's manifest, whose statuses never record an attempt. */
export type Manifest = z.infer<typeof manifestSchema>;

/** The synthetic platform's store spec. */
export const SPEC: AtlasStoreSpec<Kind, File, Manifest> = {
  kinds: KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
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
 *
 * @returns the stored manifest, or `null` when nothing is published yet
 */
export function live({ paths: resolved }: { paths: AtlasStorePaths<Kind> }): Manifest | null {
  return unwrap(readManifest({ paths: resolved, spec: SPEC }));
}

/**
 * The synthetic platform's store layout under one temp root.
 *
 * @param root the temp directory standing in for the home
 * @returns the directory, kind-file, manifest and superseded paths
 */
export function paths({ root }: { root: string }): AtlasStorePaths<Kind> {
  return {
    directory: join(root, "example"),
    home: root,
    kinds: { thing: join(root, "example", "thing.jsonl") },
    manifest: join(root, "example", "manifest.json"),
    superseded: join(root, "_superseded", "example"),
  };
}

// Every manifest here carries the epoch, never a plausible instant: `publishAtlas` DERIVES the clock it
// writes from the kind files, so a fixture asserting one would be asserting the value the caller no longer
// controls. A test that wants to see the derived clock reads it back off the published manifest.
/** A manifest recording nothing about its one kind. */
export const EMPTY_MANIFEST: Manifest = {
  kinds: { thing: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null } },
  schemaVersion: 1,
  updatedAt: PLACEHOLDER_CLOCK,
};

/**
 * A manifest recording a success for its one kind at {@link AT}.
 *
 * @returns a fresh manifest, with no digest yet
 */
export function manifestAfterSync(): Manifest {
  return {
    kinds: { thing: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: AT } },
    schemaVersion: 1,
    updatedAt: PLACEHOLDER_CLOCK,
  };
}

/**
 * A `thing` kind file holding one entity per id.
 *
 * @param ids each entity's id, in order
 * @param updatedAt the file's own clock, {@link AT} unless given
 * @returns the kind file
 */
export function file({ ids, updatedAt = AT }: { ids: readonly string[]; updatedAt?: string }): File {
  return { entities: ids.map((id) => ({ id })), kind: "thing", schemaVersion: 1, updatedAt };
}

const attemptedStatusSchema = z
  .object({
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: z.string(), outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: z.string().nullable(),
  })
  .strict();

const attemptedManifestSchema = z
  .object({
    kinds: z.record(z.enum(KINDS), attemptedStatusSchema),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();

/** The manifest of a platform that stamps every attempt. */
export type AttemptedManifest = z.infer<typeof attemptedManifestSchema>;

/** A platform that stamps every attempt, so an honest first-run failure is distinguishable from a half-write. */
export const ATTEMPT_STAMPING_SPEC: AtlasStoreSpec<Kind, File, AttemptedManifest> = {
  gradeNeverSucceeded: ({ status }) => (status?.lastAttempt == null ? "unpublished" : "agrees"),
  kinds: KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => fileSchema.safeParse(json),
  parseManifest: ({ json }) => attemptedManifestSchema.safeParse(json),
  platform: "example",
  schemaVersion: 1,
  supersedeRemedy: "run: slopweaver atlas example reset",
};
