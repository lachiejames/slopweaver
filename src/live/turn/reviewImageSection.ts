/**
 * The review packet's image section, and the example observation it shows the reviewer to write.
 *
 * Pure: `./reviewImages.ts` does the reading, this renders what it found. Its own module rather than another
 * block in `./review.ts` because that file is already at the size the packet lint governs, and because this
 * is the one section whose whole job is to make a reviewer LEAVE the packet and open a file.
 *
 * ## What the incident says this section has to ask for
 *
 * A round-4 reviewer once opened a PNG and wrote a true, supported, `low`-impact claim about it.
 * It asked "does this picture back the claim" and answered correctly. Nobody had asked it the other
 * question — "could a human read this in Slack" — so nobody answered it, and two 4032-pixel-wide full-page
 * screenshots went out. So the section asks for four things a claim cannot carry: what is concretely
 * visible, whether the target had RENDERED, whether the picture reads at PREVIEW size, and whether the
 * context a reader needs is still in frame.
 *
 * Preview size is deliberately not expressed as a pixel threshold. No universal Slack thumbnail width
 * exists to measure against, a scale-free ratio was measured and refuted during PR2 (a 3000x560 strip
 * scores well on density and aspect and still renders its axis labels near two pixels tall), and a number a
 * reviewer could compute would become a number it computes instead of looking. The question asked is the
 * one a reader actually faces.
 */

import type { ReviewedImage } from "../../admit/reviewVerdict.js";
import type { ReviewPacketImage } from "./reviewImages.js";

/** One inventory row: the path the answer names, the bytes found there, and what they decode to. */
function inventoryRow({ image }: { image: ReviewPacketImage }): string {
  if (image.kind === "unavailable") {
    return `- ${image.path} — COULD NOT BE READ: ${image.issues.join("; ")}`;
  }
  const { digest, widthPx, heightPx } = image.artifact;
  return `- ${image.path} — ${String(widthPx)}x${String(heightPx)} px, \`${digest}\``;
}

/** The duties every round owes a PRESENT attachment, whatever else the round has narrowed. */
function dutyLines(): readonly string[] {
  return [
    "OPEN every file listed above — the path is absolute and the picture is on this machine. Verify its",
    "digest is the one printed here; if it is not, the answer's images changed under you, so start again",
    "from the current packet rather than writing about bytes that are no longer being sent.",
    "",
    "For each one, write an entry in `imageObservations` answering FOUR separate questions. The first is",
    "the one a reviewer already asks; the other three are the ones nobody used to ask, which",
    "is how two unreadable full-page screenshots went out after six clean rounds:",
    "",
    "  - `observedContent` — the concrete things actually visible: values, axis labels, the query string,",
    '    the time range, a panel title. Never "looks fine": a reader has to be able to hold your sentence',
    "    against the picture and find it wrong if it is.",
    "  - `targetState` — had the thing the answer's claim rests on RENDERED? `data` when it had,",
    "    `zero-results` when the query legitimately matched nothing (that is evidence, not a defect),",
    "    `unloaded` when the page had not finished, `empty-panel` when the chrome drew and the panel did",
    '    not. The incident\'s picture read "6 service values found" above an empty white panel.',
    "  - `legible` — could a reader check the claim at the size Slack renders the PREVIEW, without opening",
    "    the file or zooming? Judge the preview, not the original you just opened. Dimensions alone do not",
    "    answer this: the incident's images were 4032 px wide and unreadable because of it.",
    "  - `contextRetained` — are the axes, the query and the time range a reader needs to check the claim",
    "    still in frame, or did a crop take them out?",
    "",
    "`legible: false`, `contextRetained: false`, or a `targetState` of `unloaded` or `empty-panel` makes the",
    "picture UNFIT. Name the matching `unfitReason` (`illegible`, `context-lost`, `unloaded`,",
    "`empty-panel`), mark the verdict `broken`, and say in a `high`-impact claim what the reader cannot",
    "see. An unfit observation is durable: the door records it against those exact bytes, and they can",
    "never be attached again, by any verb, with no way past it.",
    "",
    "A producer's own record of a picture is not a substitute for looking. The worker in that incident read",
    "all three of its images back and shipped them anyway; a read-back nobody wrote down is what this field",
    "replaced.",
    "",
  ];
}

/** What to say about an inventory the packet could not read. */
function unavailableLines(): readonly string[] {
  return [
    "At least one attachment above COULD NOT BE READ. That is not an absent screenshot and section 1b does",
    "not cover it: the answer names a picture that is not there, or is not an image. Do not invent an",
    "observation for it and do not mark this verdict `clean` — return `incomplete`, say which path failed,",
    "and let the author repair or remove the attachment and re-open the round.",
    "",
  ];
}

/**
 * What the verdict section says about `imageObservations`, next to what it says about claims.
 *
 * Separate from section 1c because the two answer different questions: 1c is what to go and do, and this is
 * what the file must contain when you come back. A reviewer that read only one of them still learns that the
 * field exists and that coverage is exact.
 *
 * @param images the resolved inventory, which decides whether the field is about anything
 * @returns the block's lines, in order
 */
export function imageObservationVerdictLines({ images }: { images: readonly ReviewPacketImage[] }): readonly string[] {
  if (images.length === 0) {
    return [
      "`imageObservations` is `[]`: this answer attaches no pictures, so there is nothing to have looked at.",
      "",
    ];
  }
  return [
    `\`imageObservations\` carries EXACTLY one entry per attached image — ${String(images.length)} here, no more`,
    "and no fewer. Each names the `path` the answer uses and the `artifactDigest` printed in section 1c, and",
    "the door matches the two TOGETHER against the bytes it is about to upload: an entry naming a reviewed",
    "path whose picture has since been replaced is `stale` and covers nothing, which is the one thing the",
    "answer digest you bind to cannot detect, because `images` are path strings.",
    "",
    "Coverage is a self-correctable warning. An observation you record as UNFIT is not: the door writes it",
    "against those bytes permanently and no token, hatch or later look can release them.",
    "",
  ];
}

/**
 * The example `imageObservations` entries the packet prints, one per readable attachment.
 *
 * Built from the real path and the real digest, with content that is visibly a placeholder, so a reviewer
 * copies the SHAPE and cannot copy a value. The booleans are templates too — a packet that pre-filled
 * `legible: true` would be writing the attestation on the reviewer's behalf, which is the act this whole
 * field exists to stop being silent.
 *
 * @param images the resolved inventory
 * @returns one example observation per ready attachment, in inventory order
 */
export function exampleImageObservations({
  images,
}: {
  images: readonly ReviewPacketImage[];
}): readonly ReviewedImage[] {
  return images.flatMap((image) =>
    image.kind === "ready"
      ? [
          {
            artifactDigest: image.artifact.digest,
            contextRetained: true,
            legible: true,
            observedContent: "REPLACE THIS with what you actually saw after opening the file",
            path: image.path,
            targetState: "data" as const,
          },
        ]
      : [],
  );
}

/**
 * The packet's image section — the inventory, the duties, and what an unreadable attachment means.
 *
 * Renders nothing at all when the answer attaches no images: a section telling a reviewer to open zero
 * files is noise, and the coverage gate already treats "no images, no observations" as exact.
 *
 * @param images the resolved inventory, in attach order
 * @returns the section's lines, in order; empty when there are no attachments
 */
export function reviewImageSectionLines({ images }: { images: readonly ReviewPacketImage[] }): readonly string[] {
  if (images.length === 0) {
    return [];
  }
  const unavailable = images.some((image) => image.kind === "unavailable");
  return [
    "## 1c. Every attached image — OPEN it, and record what you saw",
    "",
    `This answer attaches ${String(images.length)} image(s). This is a standing obligation of EVERY round,`,
    "outside any narrowing a late round applies, and it is not covered by section 1b — that is about a",
    "picture that is ABSENT, and these are present.",
    "",
    ...images.map((image) => inventoryRow({ image })),
    "",
    ...dutyLines(),
    ...(unavailable ? unavailableLines() : []),
  ];
}
