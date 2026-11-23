/**
 * Where the JumpCloud atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its documents.
 *
 * The generation protocol — kind files first, manifest last, a digest per file, every document validated
 * before the first byte is written — is `kit/store.ts`. What is genuinely JumpCloud's is here: the paths,
 * the schemas, the remedy for a superseded generation, and the publish guard.
 *
 * ## The manifest clock is the kit's, not this atlas's
 *
 * This atlas was the first to answer the two-clock defect — MEASURED, a Vanta manifest and a 1Password one
 * each stamped earlier than its own kind files — and it answered it PRIVATELY, with its own
 * stamping function and its own publish check. That was the whole finding restated: a fix that lives in one
 * atlas propagates to none, and three siblings carried the defect while this file described it.
 *
 * So the answer moved. `kit/store.ts`'s `publishAtlas` now DERIVES `updatedAt` from the kind files a
 * generation vouches for, exactly as it derives each digest from the bytes it writes, and no caller can
 * assert one — see `kit/manifestClock.ts` for the measurement and the owner's ruling behind it. What is
 * left here is what is genuinely JumpCloud's: the paths, the schemas, the remedy for a superseded
 * generation, and the two graded-number checks below that are not about time at all.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { stampAtlasManifest } from "../kit/manifestClock.js";
import { publishAtlas } from "../kit/publish.js";
import {
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  atlasJson,
  readAtlas,
  readKindFile,
  readManifest,
} from "../kit/store.js";

import { JumpcloudAtlasErrors, jumpcloudAtlasErrorLines } from "./atlasErrors.js";
import {
  type JumpcloudKindFile,
  type JumpcloudKindStatus,
  type JumpcloudManifest,
  jumpcloudKindFileSchema,
  jumpcloudManifestSchema,
} from "./entities.js";
import { JUMPCLOUD_ATLAS_PLATFORM, JUMPCLOUD_KINDS, JUMPCLOUD_SCHEMA_VERSION, type JumpcloudKind } from "./model.js";
import { JUMPCLOUD_KIND_VOLUMES } from "./volume.js";

/**

 * What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const JUMPCLOUD_SUPERSEDE_REMEDY =
  "run: slopweaver atlas jumpcloud reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the JumpCloud atlas owns. */
export interface JumpcloudAtlasPaths extends AtlasStorePaths<JumpcloudKind> {
  /** Companion files for anything withheld from a kind file. Expected to stay empty: nothing is withheld
   * to a companion here, because a denied field is dropped at the projection rather than relocated. */
  readonly sensitive: string;
}

/**

 * What the JumpCloud atlas holds right now, as the reader sees it.
 * @internal
 */
export type JumpcloudAtlasSnapshot = AtlasSnapshot<JumpcloudKind, JumpcloudKindFile, JumpcloudManifest>;

/**
 * Refuse a manifest whose graded NUMBERS contradict each other.
 *
 * Two incoherences, neither visible to the schema. A kind graded with entities but no digest was never
 * actually written — `publishAtlas` leaves an omitted kind's file untouched, so the count describes a file
 * this generation did not write. A kind whose latest attempt succeeded but which records no success time can
 * never be graded for freshness.
 *
 * A third check stood here and has been DELETED rather than kept as a belt: it refused a manifest whose own
 * `updatedAt` was earlier than a success it graded, and that condition is now unreachable, because
 * `publishAtlas` derives the clock as the maximum over the kind files the generation vouches for and a
 * successful kind's file carries the same instant as its success. A check that cannot fail reports clean
 * forever and tells a later reader the guard is load-bearing when it is not. The invariant it was watching
 * is asserted directly instead — `unit/atlas/kit/manifestClock.test.ts`.
 *
 * @param next the generation about to be written
 * @returns nothing when the manifest is self-consistent, or every incoherence found
 */
export function guardJumpcloudPublish({ next }: { next: JumpcloudManifest }): Result<null> {
  const problems = JUMPCLOUD_KINDS.flatMap((kind) => incoherences({ kind, status: next.kinds[kind] }));
  return problems.length > 0
    ? err(jumpcloudAtlasErrorLines({ error: JumpcloudAtlasErrors.unpublishable({ problems }) }))
    : ok(null);
}

/**
 * Everything incoherent about ONE kind's graded status.
 *
 * @param kind the kind being graded
 * @param status what the manifest says about it — always present, because the manifest schema keys its
 * `kinds` record by the kind enum and Zod refuses a document missing one
 * @returns one line per incoherence, empty when the status is self-consistent
 */
function incoherences({ kind, status }: { kind: JumpcloudKind; status: JumpcloudKindStatus }): readonly string[] {
  const problems: string[] = [];
  if (status.entityCount > 0 && status.digest === null) {
    problems.push(
      `${kind} is graded with ${String(status.entityCount)} entities but carries no file digest — the count describes a file this generation never wrote`,
    );
  }
  if (status.lastAttempt?.outcome === "ok" && status.lastSuccessAt === null) {
    problems.push(`${kind} records a successful attempt but no success time, so its freshness can never be graded`);
  }
  return problems;
}

/** Everything the kit needs to read, grade and publish a JumpCloud generation. */
export const JUMPCLOUD_STORE_SPEC: AtlasStoreSpec<JumpcloudKind, JumpcloudKindFile, JumpcloudManifest> = {
  gradeNeverSucceeded: ({ status }) =>
    // This atlas stamps `lastAttempt` on every run, success or failure. So a kind file beside a RECORDED
    // failed attempt is the manifest and the file honestly agreeing on "not yet synced", and only a kind
    // the manifest has no record of ever attempting is a genuine half-write.
    status?.lastAttempt === null || status === null ? "unpublished" : "agrees",
  guardPublish: ({ next }) => guardJumpcloudPublish({ next }),
  kinds: JUMPCLOUD_KINDS,
  kindObligations: {
    exceptions: {
      commandresults: {
        rule: "optional",
        why: "voluminous event telemetry that is shape-indexed rather than stored, and not walked at all by ruling — see `plan.ts` and `surfaceFill.ts`",
      },
      events: {
        rule: "optional",
        why: "voluminous event telemetry that is shape-indexed rather than stored, and not walked at all by ruling — see `plan.ts` and `surfaceFill.ts`",
      },
      policyresults: {
        rule: "optional",
        why: "per-device policy-application reports, shape-indexed under the volume rule and not walked — see `volume.ts` for the measurement and `plan.ts` for the walk exclusion",
      },
      systeminsights: {
        rule: "optional",
        why: "per-device osquery telemetry, the family the volume rule names. Shape-indexed and not walked — see `volume.ts` for the measurement and `plan.ts` for the walk exclusion",
      },
    },
  },
  kindVolumes: JUMPCLOUD_KIND_VOLUMES,
  parseKindFile: ({ json }) => jumpcloudKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => jumpcloudManifestSchema.safeParse(json),
  platform: JUMPCLOUD_ATLAS_PLATFORM,
  schemaVersion: JUMPCLOUD_SCHEMA_VERSION,
  supersedeRemedy: JUMPCLOUD_SUPERSEDE_REMEDY,
};

/**
 * Resolve every JumpCloud atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function jumpcloudAtlasPaths({ home }: { home: string }): JumpcloudAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.jumpcloud;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    sensitive: paths.sensitive,
    superseded: paths.superseded,
  };
}

/**
 * Read the manifest — the authority on what this atlas has published.
 *
 * @param paths the resolved atlas paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 * @internal
 */
export function readJumpcloudManifest({ paths }: { paths: JumpcloudAtlasPaths }): Result<JumpcloudManifest | null> {
  return readManifest({ paths, spec: JUMPCLOUD_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved atlas paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 * @internal
 */
export function readJumpcloudKindFile({
  paths,
  kind,
}: {
  paths: JumpcloudAtlasPaths;
  kind: JumpcloudKind;
}): Result<JumpcloudKindFile | null> {
  return readKindFile({ kind, paths, spec: JUMPCLOUD_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved atlas paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readJumpcloudAtlas({ paths }: { paths: JumpcloudAtlasPaths }): Result<JumpcloudAtlasSnapshot> {
  return readAtlas({ paths, spec: JUMPCLOUD_STORE_SPEC });
}

/**
 * Stamp a manifest for publication: this run's per-kind statuses merged onto the stored generation.
 *
 * A thin binding of the kit's `stampAtlasManifest` to this atlas's own kind list and manifest fields. It
 * used to take the instant as an argument and write it; it no longer takes one at all, because
 * `publishAtlas` derives the clock from the files it publishes — see this file's header.
 *
 * @param prior the manifest currently on disk, or `null` when this is a fresh generation
 * @param statuses the per-kind statuses this run produced; a kind absent here keeps what it had
 * @returns the manifest to publish
 */
export function stampJumpcloudManifest({
  prior,
  statuses,
}: {
  prior: JumpcloudManifest | null;
  statuses: Readonly<Partial<Record<JumpcloudKind, JumpcloudKindStatus>>>;
}): JumpcloudManifest {
  return stampAtlasManifest<JumpcloudKind, JumpcloudManifest>({
    base: { platform: JUMPCLOUD_ATLAS_PLATFORM, schemaVersion: JUMPCLOUD_SCHEMA_VERSION },
    kinds: JUMPCLOUD_KINDS,
    prior,
    statuses,
  });
}

/**
 * Publish a generation: every kind file first, then the manifest, with the guard refusing an incoherent one
 * before the first byte is written.
 *
 * @param paths the resolved atlas paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest currently on disk, or `null` when this is a fresh generation
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishJumpcloudAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: JumpcloudAtlasPaths;
  files: Readonly<Partial<Record<JumpcloudKind, JumpcloudKindFile>>>;
  manifest: JumpcloudManifest;
  derivedFrom: JumpcloudManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: JUMPCLOUD_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 * @internal
 */
export function jumpcloudAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
