/**
 * The one effectful step `atlas slack-drive sync` takes on a walk's pictures: copy each screenshot the walk
 * document names into the generation, addressed by the digest of its own bytes, applying the surface map's
 * screenshot policy before anything is written.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { isUnrenderedScreenshot, UNRENDERED_SCREENSHOT_BECAUSE } from "../../../atlas/kit/browserWalk.js";
import type { SlackArtifactRef } from "../../../atlas/slackApi/atlasModel.js";
import { screenshotRefusedBecause } from "../../../atlas/slackApi/atlasSync.js";
import type { DrivenSession } from "../../../atlas/slackApi/drivenSession.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/**
 * Copy every screenshot the walk document names into the generation, addressed by its own digest.
 *
 * ## The digest is computed from the BYTES, never trusted from the document
 *
 * A document names a local path and nothing else. What is stored is hashed from what this process actually
 * read and written through the kit's verified writer, which reads it back before the atlas claims to hold
 * it — a document that could hand in its own digest could hand in any digest, and the whole value of a proof
 * screenshot is that the bytes are provably the ones that were seen.
 *
 * ## A refused page's picture is never written, rather than written and then unreferenced
 *
 * The policy is applied before the write, which is the rule `kit/pageWalk.ts` records the hard way: clearing
 * a reference afterwards left the bytes on disk on another atlas while every count read clean. A refusal is
 * REPORTED rather than swallowed, so a session that photographed a page the surface map refuses finds out.
 *
 * @param directory the atlas's own root, which every artifact path is relative to
 * @param session the parsed walk document
 * @returns the artifact per page, plus a line per refusal, or the reason a file could not be read or written
 */
export function storeSlackScreenshots({
  directory,
  session,
}: {
  directory: string;
  session: DrivenSession;
}): Result<{ stored: ReadonlyMap<string, SlackArtifactRef>; refusals: readonly string[] }, AtlasCommandError> {
  const stored = new Map<string, SlackArtifactRef>();
  const refusals: string[] = [];
  const write = verifiedArtifactWriter({ directory });
  for (const page of session.pages) {
    if (page.screenshotPath === null) {
      continue;
    }
    const one = storeOneScreenshot({ page, write });
    if (one.isErr()) {
      return err(one.error);
    }
    if (one.value.artifact === null) {
      refusals.push(`not storing the picture the walk took of ${page.path} — ${one.value.refusedBecause!}`);
      continue;
    }
    stored.set(page.path, one.value.artifact);
  }
  return ok({ refusals, stored });
}

/**
 * Read, grade and store one page's picture.
 *
 * @param page the walked page, which names a local PNG
 * @param write the kit's verified writer, which reads back what it wrote
 * @returns the artifact, or the reason it was refused, or the reason the file could not be handled at all
 */
function storeOneScreenshot({
  page,
  write,
}: {
  page: DrivenSession["pages"][number];
  write: ReturnType<typeof verifiedArtifactWriter>;
}): Result<{ artifact: SlackArtifactRef | null; refusedBecause: string | null }, AtlasCommandError> {
  const refused = screenshotRefusedBecause({ path: page.path });
  if (refused !== null) {
    return ok({ artifact: null, refusedBecause: refused });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(page.screenshotPath!));
  } catch (cause: unknown) {
    return err(AtlasCommandErrors.screenshotUnreadable({ cause, path: page.path }));
  }
  if (isUnrenderedScreenshot({ bytes })) {
    return ok({ artifact: null, refusedBecause: UNRENDERED_SCREENSHOT_BECAUSE });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const relativePath = `artifacts/pages/${sha256}.png`;
  const written = write({ bytes, relativePath, sha256 });
  if (written.isErr()) {
    return err(AtlasCommandErrors.artifactWriteFailed({ reasons: written.error }));
  }
  return ok({
    artifact: { byteLength: bytes.byteLength, kind: "page-png", mediaType: "image/png", relativePath, sha256 },
    refusedBecause: null,
  });
}
