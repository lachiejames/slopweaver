/**
 * Where the console generation lives, and the kit store bound to it.
 *
 * `atlas/jumpcloud/console/` — a manifest, `page.jsonl`, `method.jsonl` and the page screenshots under
 * `artifacts/pages/`. It sits INSIDE the atlas's own directory, so `atlas jumpcloud reset` archives it with the
 * rest, and beside the API generation's files rather than among them — see `consoleModel.ts` on why that is
 * the one layout where the walk and the sync cannot truncate each other.
 */
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { bindAtlasStore } from "../kit/publish.js";
import type { AtlasSnapshot, AtlasStorePaths, AtlasStoreSpec } from "../kit/store.js";

import {
  JUMPCLOUD_CONSOLE_KINDS,
  JUMPCLOUD_CONSOLE_SCHEMA_VERSION,
  type JumpcloudConsoleKind,
  type JumpcloudConsoleKindFile,
  type JumpcloudConsoleManifest,
  jumpcloudConsoleKindFileSchema,
  jumpcloudConsoleManifestSchema,
} from "./consoleModel.js";
import { JUMPCLOUD_ATLAS_PLATFORM } from "./model.js";

/** Every path the console generation owns. */
export interface JumpcloudConsolePaths extends AtlasStorePaths<JumpcloudConsoleKind> {
  /** `<console>/artifacts/pages` — where a page's proof screenshot is written, named by its own digest. */
  readonly pageArtifacts: string;
}

/**
 * What the console generation holds right now.
 *
 * @internal
 */
export type JumpcloudConsoleSnapshot = AtlasSnapshot<
  JumpcloudConsoleKind,
  JumpcloudConsoleKindFile,
  JumpcloudConsoleManifest
>;

/** Everything the kit needs to read, grade and publish a console generation. */
const JUMPCLOUD_CONSOLE_STORE_SPEC: AtlasStoreSpec<
  JumpcloudConsoleKind,
  JumpcloudConsoleKindFile,
  JumpcloudConsoleManifest
> = {
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  kinds: JUMPCLOUD_CONSOLE_KINDS,
  parseKindFile: ({ json }) => jumpcloudConsoleKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => jumpcloudConsoleManifestSchema.safeParse(json),
  platform: JUMPCLOUD_ATLAS_PLATFORM,
  schemaVersion: JUMPCLOUD_CONSOLE_SCHEMA_VERSION,
  supersedeRemedy:
    "run: slopweaver atlas jumpcloud reset --confirm archive, then slopweaver atlas jumpcloud walk — the reset archives the console generation with the rest of the atlas",
};

const store = bindAtlasStore({ spec: JUMPCLOUD_CONSOLE_STORE_SPEC });

/**
 * The path a page screenshot is stored at, relative to the console directory.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an artifact reference carries
 */
export function jumpcloudConsoleArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every console path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function jumpcloudConsolePaths({ home }: { home: string }): JumpcloudConsolePaths {
  const atlas = stateHomePaths({ home }).atlas.jumpcloud;
  const directory = join(atlas.root, "console");
  return {
    directory,
    home,
    kinds: { method: join(directory, "method.jsonl"), page: join(directory, "page.jsonl") },
    manifest: join(directory, "manifest.json"),
    pageArtifacts: join(directory, "artifacts", "pages"),
    superseded: join(atlas.superseded, "console"),
  };
}

/**
 * Read the whole console generation.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readJumpcloudConsole({ paths }: { paths: JumpcloudConsolePaths }): Result<JumpcloudConsoleSnapshot> {
  return store.readAtlas({ paths });
}

/**
 * Publish a console generation: both kind files, then the manifest, compare-and-swapped against `derivedFrom`.
 *
 * @param paths the resolved paths
 * @param files the kind files to write
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest this run read, or `null` for a first walk
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishJumpcloudConsole({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: JumpcloudConsolePaths;
  files: Readonly<Partial<Record<JumpcloudConsoleKind, JumpcloudConsoleKindFile>>>;
  manifest: JumpcloudConsoleManifest;
  derivedFrom: JumpcloudConsoleManifest | null;
}): Result<readonly string[]> {
  return store.publish({ derivedFrom, files, manifest, paths });
}
