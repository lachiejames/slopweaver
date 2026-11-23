/**
 * The page walk's photograph: grading one capture's picture and storing it, or recording in words why it was not.
 *
 * `./pageWalk.ts` drives the visit and hands the capture here. Nothing in this module knows about a page, a spec or
 * an observation; both functions take the few facts they need, so the dependency runs one way.
 */
import { createHash } from "node:crypto";

import type { PageCapture } from "../../browser/pageTransport.js";

import type { AtlasArtifactWriter } from "./artifactWriter.js";
import { isUnrenderedScreenshot, UNRENDERED_SCREENSHOT_BECAUSE } from "./browserWalk.js";
import type { AtlasArtifactRef } from "./contract.js";

/**
 * The artifact reference for one page screenshot, addressed by the digest of its own bytes.
 *
 * Addressed by digest rather than by page name so the same bytes are the same artifact, and so a proof
 * cannot be swapped for a different picture under the same path.
 *
 * @param bytes the PNG bytes
 * @param artifactPathFor where this atlas stores a screenshot of that digest
 * @returns the reference, whose `relativePath` is relative to the atlas's own directory
 */
export function screenshotArtifact({
  bytes,
  artifactPathFor,
}: {
  bytes: Uint8Array;
  artifactPathFor: (input: { sha256: string }) => string;
}): AtlasArtifactRef {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteLength: bytes.byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: artifactPathFor({ sha256 }),
    sha256,
  };
}

/**
 * Write one page's screenshot; a missing, refused or unwritten PNG is a recorded incompleteness, never a
 * silence.
 *
 * The policy is consulted FIRST and returns before the bytes are hashed or handed to the writer, so a
 * refused page's picture never reaches disk at all — see `PageWalkSpec.photographPolicy` in `./pageWalk.ts` for the
 * review that made that ordering load-bearing.
 *
 * @returns the stored reference, or an empty list and the sentence saying why there is none
 */
export function writeScreenshot({
  capture,
  writeArtifact,
  artifactPathFor,
  refusedBecause,
  redirected,
}: {
  capture: PageCapture;
  writeArtifact: AtlasArtifactWriter;
  artifactPathFor: (input: { sha256: string }) => string;
  refusedBecause: string | null;
  redirected: boolean;
}): { artifacts: readonly AtlasArtifactRef[]; missingBecause: string | null } {
  // A REDIRECTED page's picture is of somewhere the declaration does not describe, so no declaration's
  // policy governs it — and this check has to come first for that reason rather than as an optimisation.
  //
  // MEASURED by a Codex review as the second and sharper half of the same class the policy
  // below closed: a walk asks for a permitted page, the client answers a permission refusal by silently
  // rewriting the route to a page that is WITHHELD, and the requested page's policy then admits a picture
  // of the withheld one. On an HR atlas that was a screenshot of the employee's own feed written under a
  // settings page's name. It is residue everywhere else too — `isPageHeld` already refuses to credit a
  // redirected page, so the bytes evidenced nothing on any atlas that wrote them.
  if (redirected) {
    return {
      artifacts: [],
      missingBecause:
        "the browser settled somewhere other than this declared page, so any picture would be of a page " +
        "this atlas has not declared and whose own policy it therefore cannot apply",
    };
  }
  if (refusedBecause !== null) {
    return { artifacts: [], missingBecause: refusedBecause };
  }
  if (capture.screenshotPng === null) {
    // The transport's own reason when it has one. It usually does — a capture that failed says so — and
    // the bare sentence below is what a walk records when a page was reached, not photographed, and the
    // browser volunteered nothing at all. Reporting only the bare sentence is what let a Chrome timeout
    // read as an unexplained gap on every walking atlas for a day.
    return {
      artifacts: [],
      missingBecause:
        capture.screenshotBlockedBecause === null
          ? "the page was reached but the browser returned no screenshot for it"
          : `the page was reached but the browser returned no screenshot for it: ${capture.screenshotBlockedBecause}`,
    };
  }
  if (isUnrenderedScreenshot({ bytes: capture.screenshotPng })) {
    return { artifacts: [], missingBecause: UNRENDERED_SCREENSHOT_BECAUSE };
  }
  const ref = screenshotArtifact({ artifactPathFor, bytes: capture.screenshotPng });
  const written = writeArtifact({ bytes: capture.screenshotPng, relativePath: ref.relativePath, sha256: ref.sha256 });
  if (written.isErr()) {
    return { artifacts: [], missingBecause: `the screenshot could not be stored: ${written.error.join("; ")}` };
  }
  return { artifacts: [ref], missingBecause: null };
}
