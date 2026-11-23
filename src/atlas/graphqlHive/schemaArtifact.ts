/**
 * Writing a target's composed schema into the generation, addressed by the digest of its own bytes.
 *
 * The thin effectful edge, kept out of `projection.ts` so that stays pure. The digest is computed from the
 * SDL text and used as the filename, so publishing the same schema twice writes the same file and a proof
 * cannot be swapped for a different one under the same path — the property `docs/atlas-intent/05-browser-proof.md` asks
 * for when it says the atlas holds the artifact rather than a link to it.
 *
 * A write failure is a `Result` rather than a throw, and the caller turns it into a coverage cell: a target
 * whose schema could not be stored is a target the atlas knows about and cannot prove, which is a state
 * worth publishing rather than a reason to abandon the whole run.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../../lib/result.js";
import { verifiedArtifactWriter } from "../kit/artifactWriter.js";
import type { AtlasArtifactRef } from "../kit/contract.js";

import type { HiveTargetSchemaArtifact } from "./projection.js";
import type { HiveRegistryTarget } from "./registryRead.js";
import { targetPath } from "./registryRead.js";
import { type HiveAtlasPaths, hiveSchemaArtifactPath } from "./store.js";

/**
 * Write every target's composed schema as a content-addressed artifact.
 *
 * @param paths the resolved atlas paths, whose `schemaArtifacts` directory the files land in
 * @param targets this run's registry read
 * @returns one artifact reference per target that published a schema, or why a write failed
 */
export function writeHiveSchemaArtifacts({
  paths,
  targets,
}: {
  paths: HiveAtlasPaths;
  targets: readonly HiveRegistryTarget[];
}): Result<readonly HiveTargetSchemaArtifact[]> {
  const written: HiveTargetSchemaArtifact[] = [];
  for (const target of targets) {
    if (target.sdl === null) {
      continue;
    }
    const stored = writeOne({ paths, sdl: target.sdl });
    if (stored.isErr()) {
      return err(stored.error);
    }
    written.push({ artifact: stored.value, targetPath: targetPath({ target }) });
  }
  return ok(written);
}

/**
 * Write one SDL and describe it.
 *
 * @param paths the resolved atlas paths
 * @param sdl the composed schema's text
 * @returns the artifact reference, or why the write failed
 */
function writeOne({ paths, sdl }: { paths: HiveAtlasPaths; sdl: string }): Result<AtlasArtifactRef> {
  const bytes = new Uint8Array(Buffer.from(sdl, "utf8"));
  const sha256 = digestOf({ bytes });
  const relativePath = hiveSchemaArtifactPath({ sha256 });
  const written = verifiedArtifactWriter({ directory: paths.directory })({ bytes, relativePath, sha256 });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({
    byteLength: bytes.byteLength,
    kind: "page-text",
    mediaType: "application/graphql",
    relativePath,
    sha256,
  });
}

/**
 * The digest an SDL is addressed by.
 *
 * Computed here as well as inside the writer, because the PATH is derived from it and the writer takes a
 * path. That is one hash of the same bytes twice rather than a shared mutable, and it keeps the writer's
 * own verification independent of what a caller claimed the digest was.
 *
 * @param bytes the SDL's own bytes
 * @returns the hex digest
 */
function digestOf({ bytes }: { bytes: Uint8Array }): string {
  return createHash("sha256").update(bytes).digest("hex");
}
