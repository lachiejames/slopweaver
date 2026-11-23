/**
 * Where the Cloudflare atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own
 * documents.
 *
 * The generation protocol itself — kind files first, manifest last because it names them, a digest per file
 * so a later interrupted publication is detectable rather than silent, and every document validated before
 * the first byte is written — is `kit/store.ts`, which this and the Vanta atlas had each written out at
 * ~350 lines apiece, 155 of them verbatim. What remains here is genuinely Cloudflare's: where the files
 * live, the extra `_sensitive` companion directory, the schemas, the remedies, and the two seams below.
 *
 * ## The two seams this atlas is the reason for
 *
 * `guardPublish` is the selection guard — the kit's header names this atlas as why the seam exists. A token
 * can see more than one account, so once a generation records which account and deep zone it belongs to,
 * changing OR clearing that selection is refused before a single byte is written; an operator who genuinely
 * means it runs `cloudflare reset` first, explicitly.
 *
 * `gradeNeverSucceeded` is the other. `stampKindAttempt` records `lastAttempt` on every run, success or
 * failure, so a kind that has honestly attempted and failed has a file, no `lastSuccessAt`, and a recorded
 * attempt. The kit's default would grade that a half-written first generation; here it is an ordinary
 * first-run failure whose own open gap already explains it, and only a kind the manifest has NO record of
 * ever attempting is a genuine half-write.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import type { Result } from "../../lib/result.js";
import { err, ok } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
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
import {
  CLOUDFLARE_ATLAS_PLATFORM,
  CLOUDFLARE_ATLAS_SCHEMA_VERSION,
  CLOUDFLARE_KINDS,
  type CloudflareKind,
  type CloudflareKindFile,
  type CloudflareManifest,
  cloudflareKindFileSchema,
  cloudflareManifestSchema,
} from "./model.js";
import { CLOUDFLARE_KIND_VOLUMES } from "./volume.js";

/** What to do about a generation published under a schema version this build no longer writes. */
const CLOUDFLARE_SUPERSEDE_REMEDY =
  "run: slopweaver cloudflare reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** What to do when a publish's selection would change the account/deep-zone an already-selected atlas is scoped to. */
const CLOUDFLARE_SELECTION_MISMATCH_REMEDY =
  "run: slopweaver cloudflare reset --confirm archive — this archives the existing generation before selecting a different account or deep zone";

/** Every path the Cloudflare atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface CloudflareAtlasPaths extends AtlasStorePaths<CloudflareKind> {
  /** Companion files for withheld values — never folded into a published kind file. */
  readonly sensitive: string;
}

/** What the Cloudflare atlas holds right now, as the reader sees it. */
export type CloudflareAtlasSnapshot = AtlasSnapshot<CloudflareKind, CloudflareKindFile, CloudflareManifest>;

/**
 * Whether publishing `next` would change the account/deep-zone an atlas already selected for `prior` is
 * scoped to. Once a selection is stamped, changing OR clearing it is exactly the silent re-scoping the
 * manifest's own selection field exists to prevent — see `model.ts`'s header. A fresh, never-selected atlas
 * (`prior === null`) has nothing to protect yet, so any first selection is always allowed.
 */
function guardSelection({ prior, next }: { prior: CloudflareManifest | null; next: CloudflareManifest }): Result<null> {
  const existing = unsetFieldAsNull({ key: "selection", record: prior });
  if (existing === null) {
    return ok(null);
  }
  const selection = next.selection;
  if (
    selection !== null &&
    existing.accountId === selection.accountId &&
    existing.deepZone.id === selection.deepZone.id
  ) {
    return ok(null);
  }
  return err([
    "refusing to publish: this generation's selection does not match the account/deep-zone the atlas is already scoped to",
    CLOUDFLARE_SELECTION_MISMATCH_REMEDY,
  ]);
}

/** Everything the kit needs to read, grade and publish a Cloudflare generation. See this file's header. */
export const CLOUDFLARE_STORE_SPEC: AtlasStoreSpec<CloudflareKind, CloudflareKindFile, CloudflareManifest> = {
  gradeNeverSucceeded: ({ status }) => (status?.lastAttempt == null ? "unpublished" : "agrees"),
  guardPublish: guardSelection,
  kinds: CLOUDFLARE_KINDS,
  kindObligations: {
    exceptions: {
      "api-gateway": {
        rule: "optional",
        why: "a plan-gated surface an account below that plan cannot reach, so no run there can ever acquire it",
      },
      "zone-analytics": {
        rule: "optional",
        why: "a plan-gated surface an account below that plan cannot reach, so no run there can ever acquire it",
      },
    },
  },
  kindVolumes: CLOUDFLARE_KIND_VOLUMES,
  parseKindFile: ({ json }) => cloudflareKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => cloudflareManifestSchema.safeParse(json),
  platform: CLOUDFLARE_ATLAS_PLATFORM,
  schemaVersion: CLOUDFLARE_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: CLOUDFLARE_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Cloudflare atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function cloudflareAtlasPaths({ home }: { home: string }): CloudflareAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.cloudflare;
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
 * Read the manifest, refusing anything it cannot trust. A manifest declaring an older or newer schema
 * version is a loud refusal naming `cloudflare reset` as the remedy, rather than a generic schema error.
 *
 * @param paths the resolved paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 */
export function readCloudflareManifest({ paths }: { paths: CloudflareAtlasPaths }): Result<CloudflareManifest | null> {
  return readManifest({ paths, spec: CLOUDFLARE_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readCloudflareKindFile({
  paths,
  kind,
}: {
  paths: CloudflareAtlasPaths;
  kind: CloudflareKind;
}): Result<CloudflareKindFile | null> {
  return readKindFile({ kind, paths, spec: CLOUDFLARE_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readCloudflareAtlas({ paths }: { paths: CloudflareAtlasPaths }): Result<CloudflareAtlasSnapshot> {
  return readAtlas({ paths, spec: CLOUDFLARE_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes
 * written. Refuses outright, before writing anything, if this would silently re-scope an already-selected
 * atlas to a different account or deep zone.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest this candidate was built ON — the compare-and-swap token, and what
 *   {@link guardSelection} compares the new account and deep zone against. This used to be re-read from
 *   disk here, which made the guard judge a generation the candidate may never have seen.
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishCloudflareAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: CloudflareAtlasPaths;
  files: Readonly<Partial<Record<CloudflareKind, CloudflareKindFile>>>;
  manifest: CloudflareManifest;
  derivedFrom: CloudflareManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: CLOUDFLARE_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 */
export function cloudflareAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
