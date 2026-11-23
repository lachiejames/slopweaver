/**
 * The gates `github attach upload` holds one file to, in one place: the dry run previews exactly these
 * findings, the send composes exactly these gates, and `--acknowledge` waives exactly these override tokens —
 * so a gate added to the attachment door cannot reach one of the three and miss another.
 */

import { ANIMATED_GIF_OVERRIDE, animatedGifFindings, animatedGifGate } from "./animatedGifGate.js";
import { type CandidateVisual, VISUAL_HEAD_BYTES } from "./inventedVisual.js";
import { INVENTED_VISUAL_OVERRIDE, inventedVisualFindings, inventedVisualGate } from "./inventedVisualGate.js";
import type { DoorFinding, DoorGate } from "./types.js";

/** Every override token the attachment door's gates carry, comma-joined the way the door reads them. */
export const ATTACHMENT_OVERRIDES = `${INVENTED_VISUAL_OVERRIDE},${ANIMATED_GIF_OVERRIDE}`;

/** One file the attachment door is looking at: its path, its bytes when readable, and its own directory. */
interface AttachmentFile {
  readonly ref: string;
  readonly bytes: Uint8Array | undefined;
  readonly siblings: readonly string[];
}

/**
 * The one candidate visual the invented-visual check reads — the file, its leading bytes and its directory.
 * The attachment seam is the only one holding a real file, which is why it alone can decide
 * `rendered-page-sibling` and `generated-chart` (`./inventedVisual.ts`).
 */
function attachmentVisual({ ref, bytes, siblings }: AttachmentFile): CandidateVisual {
  if (bytes === undefined) {
    return { ref, seam: "attachment", siblings };
  }
  return { head: bytes.slice(0, VISUAL_HEAD_BYTES), ref, seam: "attachment", siblings };
}

/**
 * Every finding the attachment door would raise on one file, for a dry run to print.
 *
 * @param file the file, its bytes (undefined when unreadable) and its sibling entries
 * @returns the invented-visual findings, then the animated-GIF ones
 */
export function attachmentFindings({ file }: { file: AttachmentFile }): readonly DoorFinding[] {
  return [
    ...inventedVisualFindings({ visuals: [attachmentVisual(file)] }),
    ...(file.bytes === undefined ? [] : animatedGifFindings({ files: [{ bytes: file.bytes, ref: file.ref }] })),
  ];
}

/**
 * The attachment door's gates over one file, ready for `throughDoor`.
 *
 * @param file the file, its bytes (undefined when unreadable) and its sibling entries
 * @returns the invented-visual gate and the animated-GIF gate
 */
export function attachmentGates({ file }: { file: AttachmentFile }): readonly DoorGate[] {
  return [
    inventedVisualGate({ visuals: [attachmentVisual(file)] }),
    ...(file.bytes === undefined ? [] : [animatedGifGate({ files: [{ bytes: file.bytes, ref: file.ref }] })]),
  ];
}
