/**
 * The decisions every driven-browser walk makes identically, and nothing else.
 *
 * Each atlas's walk is its own — what it visits, how it grades an outcome, what its denominator is — and
 * those genuinely differ. What does not differ is how a screenshot becomes an addressable artifact, whether
 * that screenshot is a picture of anything, and which of a page's captured responses are worth recording at
 * all. Each was written twice before this module existed, and none has a platform-specific half.
 *
 * ## Read the screenshot you just took
 *
 * Owner ruling: a screenshot that was taken is read before the walk trusts it, as a companion to
 * read-before-write (read-after-write and read-after-screenshot). Most screenshots in one set were loading
 * spinners, and the scale was worse than the walk could see: a walk reports
 * `artifactsWritten` and a spinner frame is a written artifact, so every page whose shot was a spinner photographed
 * nothing at all and every count said the walk had gone fine.
 *
 * {@link isUnrenderedScreenshot} is that read, made mechanical — a capture is graded before it may be
 * credited as a picture, and a page whose shot does not survive the grade is a NAMED gap rather than a row
 * that looks complete. {@link visitPhotographed} is what the read is FOR: a loading frame is looked at
 * again after a longer settle before it is written off, so the ruling replaces spinners with pictures rather
 * than replacing them with gaps.
 */
import { createHash } from "node:crypto";

import {
  type BrowserPageTransport,
  type BrowserTransportError,
  isWalkStoppingError,
  type PageCapture,
} from "../../browser/pageTransport.js";
import type { Result } from "../../lib/result.js";

import type { AtlasArtifactWriter } from "./artifactWriter.js";
import type { AtlasArtifactRef } from "./contract.js";

/**
 * The compressed density below which a PNG is a blank page rather than a picture of one, in bytes per pixel.
 *
 * MEASURED over every screenshot this install had taken, across every atlas that photographs.
 * Reproduce it against any home:
 *
 * ```bash
 * find "$SLOPWEAVER_HOME/atlas" -name '*.png' -print0 | xargs -0 -n1 node -e \
 *   'const b=require("fs").readFileSync(process.argv[1]);
 *    console.log((b.length/(b.readUInt32BE(16)*b.readUInt32BE(20))).toFixed(5), process.argv[1])' | sort -n
 * ```
 *
 * The distribution is BIMODAL and this constant sits in the gap, which is why it is a threshold rather than
 * a guess: the CrowdStrike console's spinner captures land between 0.00422 and 0.00442 (one spinner frame, differing
 * only by the arc's rotation), one Xero page at 0.00376 is uniformly blank, and the next density above them
 * anywhere in the corpus is 0.00783 — nearly double. Every capture below the gap was opened and confirmed
 * unrendered, and no page that HAD rendered fell below it, so the measured false-positive count is zero.
 *
 * Density rather than raw bytes because the same blank page is a different file size at a different window
 * size, and every capture in that corpus happened to be 3024x1308 — a coincidence a threshold must not rest
 * on.
 */
export const UNRENDERED_BYTES_PER_PIXEL = 0.005;

/** The PNG signature, and the fixed offsets IHDR puts the dimensions at. */
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_HEADER_BYTES = 24;

/**
 * Whether a captured PNG is a picture of a page or of a page that never finished loading.
 *
 * Reads the IHDR dimensions out of the file's own header rather than decoding it — the question is how much
 * entropy the compressor found per pixel, and the byte count already answers that. A buffer too short to
 * carry a header, or one whose header reads as a zero-area image, is `true`: it is not a picture of the page
 * either, and the caller's job in both cases is the same.
 *
 * @param bytes the PNG as the transport returned it
 * @returns true when the capture must not be credited as a photograph of the page
 */
export function isUnrenderedScreenshot({ bytes }: { bytes: Uint8Array }): boolean {
  if (bytes.byteLength < PNG_HEADER_BYTES) {
    return true;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixels = view.getUint32(PNG_WIDTH_OFFSET) * view.getUint32(PNG_HEIGHT_OFFSET);
  if (pixels === 0) {
    return true;
  }
  return bytes.byteLength / pixels < UNRENDERED_BYTES_PER_PIXEL;
}

/**
 * The artifact reference for one page screenshot, addressed by the digest of its own bytes.
 *
 * Addressed by digest rather than by page name for two reasons that are both about proof: the same bytes
 * are the same artifact however many pages showed them, and a proof cannot be swapped for a different
 * picture under the same path.
 *
 * @param bytes the PNG bytes
 * @param directory the artifact sub-directory, relative to the atlas's own root, so two atlases in one
 *   home cannot collide
 * @returns the reference
 */
export function screenshotArtifact({ bytes, directory }: { bytes: Uint8Array; directory: string }): AtlasArtifactRef {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteLength: bytes.byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: `${directory}/${sha256}.png`,
    sha256,
  };
}

/**
 * How long the second look at an unrendered page waits before photographing it again.
 *
 * A POLICY choice, stated as one rather than dressed up as a measurement. Every walk's own `settleMs` is
 * tuned for a page that renders — CrowdStrike's is 2.5 seconds — and the pages this retry exists for are
 * exactly the ones that did not manage it in that budget, so the retry has to be generous rather than
 * proportional. Ten seconds is long enough for a console that fetches its own data before painting and short
 * enough that a walk over a few hundred declared pages does not become an overnight job: only a page that
 * ALREADY failed the grade pays it.
 *
 * The re-walk this landed for is what measures whether it was enough — a page that spins through both looks
 * is a named gap carrying {@link UNRENDERED_SCREENSHOT_BECAUSE}, so the count of those is the number to
 * raise this on. Reproduce against any home:
 *
 * ```bash
 * slopweaver atlas crowdstrike walk --json | node -e 'let s="";process.stdin.on("data",c=>s+=c)
 *   .on("end",()=>console.log(JSON.parse(s).unrenderedPages.length))'
 * ```
 */
export const RENDER_RETRY_SETTLE_MS = 10_000;

/**
 * Why a reached page carries no photograph when its capture never finished rendering.
 *
 * One string rather than one per walk, because it is the same finding on every platform and the owner reads
 * these rows across atlases. A walk that phrased it its own way would make the class the owner named, a set of
 * screenshots that are mostly loading spinners, uncountable again.
 */
export const UNRENDERED_SCREENSHOT_BECAUSE =
  "the page was reached but its capture was still a loading frame, on the first look and again after a longer settle";

/**
 * Visit a page, and look again when what came back was a picture of it still loading.
 *
 * This is the read-after-screenshot leg of the owner's ruling, in the one place every driven-browser
 * walk goes through. Reading the shot and then giving up would only convert 97 spinners into 97 gaps; the
 * point of reading it is to be able to act on what it says, and the thing to do about a loading frame is
 * wait longer and take it again.
 *
 * Three outcomes are deliberately NOT retried. A visit that failed has no capture to grade. A capture with
 * no screenshot at all is a different gap, already recorded by every caller, and re-driving the browser
 * would not produce one. A retry that fails on a single address returns the FIRST capture rather than the
 * error, because that capture's responses are real observations and the page's own row will name the missing
 * photograph anyway — but a retry that loses the SESSION propagates, since every page after it is doomed
 * too ({@link isWalkStoppingError}).
 *
 * @param transport the browser seam to drive
 * @param url the absolute page address to visit
 * @param settleMs the walk's own settle budget, used for the first look
 * @param retrySettleMs how long the second look waits; defaults to {@link RENDER_RETRY_SETTLE_MS}
 * @returns the better of the two captures, or why the walk cannot continue
 */
export async function visitPhotographed({
  transport,
  url,
  settleMs,
  retrySettleMs = RENDER_RETRY_SETTLE_MS,
  photograph = true,
}: {
  transport: BrowserPageTransport;
  url: string;
  settleMs: number;
  retrySettleMs?: number;
  /**
   * Whether this page may be photographed at all. `false` asks the transport for no screenshot and skips
   * the re-visit below outright — there is no picture to grade, so a second visit could only be a second
   * chance to render one this atlas has ruled it must not have.
   */
  photograph?: boolean;
}): Promise<Result<PageCapture, BrowserTransportError>> {
  const first = await transport.visit({ photograph, settleMs, url });
  if (first.isErr() || !photograph) {
    return first;
  }
  const shot = first.value.screenshotPng;
  if (shot === null || !isUnrenderedScreenshot({ bytes: shot })) {
    return first;
  }
  const second = await transport.visit({ photograph, settleMs: retrySettleMs, url });
  if (second.isErr()) {
    return isWalkStoppingError({ error: second.error }) ? second : first;
  }
  return second.value.screenshotPng === null ? first : second;
}

/** What writing one page's screenshot came to: the reference, whether bytes landed, and whether it rendered. */
export interface WrittenScreenshot {
  readonly refs: readonly AtlasArtifactRef[];
  readonly written: number;
  /** The capture was a picture of the console mid-load, so nothing was kept. */
  readonly unrendered: boolean;
}

/**
 * Write one page's screenshot, if it has one; a write that fails costs the artifact, never the page.
 *
 * A capture that is a picture of the platform mid-load is graded out here rather than written, so it is
 * counted as a page nobody photographed instead of as a written artifact. Here rather than in each atlas
 * because it stood twice, character for character, in two atlases' walks.
 *
 * @param capture what the transport returned
 * @param writeArtifact where a screenshot is written
 * @param directory the artifact directory this platform files pictures under
 * @returns the reference kept, how many bytes landed, and whether the capture rendered at all
 */
export function writePageScreenshot({
  capture,
  writeArtifact,
  directory,
}: {
  capture: PageCapture;
  writeArtifact: AtlasArtifactWriter;
  directory: string;
}): WrittenScreenshot {
  const bytes = capture.screenshotPng;
  if (bytes === null) {
    return { refs: [], unrendered: false, written: 0 };
  }
  if (isUnrenderedScreenshot({ bytes })) {
    return { refs: [], unrendered: true, written: 0 };
  }
  const ref = screenshotArtifact({ bytes, directory });
  const written = writeArtifact({ bytes, relativePath: ref.relativePath, sha256: ref.sha256 });
  if (written.isErr()) {
    return { refs: [], unrendered: false, written: 0 };
  }
  return { refs: [ref], unrendered: false, written: 1 };
}
