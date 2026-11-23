/**
 * A held Slack draft's body as a reader would see it — rendered from the parked PAYLOAD, never from the form, so
 * it cannot disagree with what a release would post.
 *
 * Its own module below the CLI so two readers share one renderer: `slack draft list` prints it, and a seat
 * `session close-done` parks copies it onto the run's checkpoint (`../../handover/parkedEvent.ts`).
 */
import { type ParkedDraftPayload, parkedPayloadShape } from "./draftRegister.js";
import { noFoldPreviewLines, previewBlockLines, previewLines } from "./preview.js";

/**
 * The draft's body as readable lines.
 *
 * @param payload the exact bytes a release would post
 * @returns the message as a reader would see it, one line per rendered line
 */
export function draftBodyLines({ payload }: { payload: ParkedDraftPayload }): readonly string[] {
  const shape = parkedPayloadShape({ payload });
  if (shape.kind === "card") {
    return previewLines({ payload: shape.payload });
  }
  if (shape.kind === "no-fold") {
    return noFoldPreviewLines({ payload: shape.payload });
  }
  if (shape.payload.form === "plain") {
    return shape.payload.text.split("\n");
  }
  return shape.payload.blocks.flatMap((block) => previewBlockLines({ block }));
}
