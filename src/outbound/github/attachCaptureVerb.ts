/**
 * Which capture verb's bytes `github attach upload` may send, and under which content type: the half of
 * `./attachEvidence.ts`'s checks that reads only the receipt's verb and the declared type, never the picture.
 *
 * ## Only `browser console-shot` is admitted
 *
 * Its receipt is synthetic by construction: a throwaway store and home holding the `acme` fixtures, never the
 * operator's own. Every other capture verb photographs whatever the session points it at, so its picture can carry a
 * figure read from the operator's own accounts (a count, a total), which none of the attach scans judges. So
 * {@link attachCaptureVerbFindings} holds every other verb's receipt (`attach.capture-verb`) until a figure check
 * exists. A `browser redact` child is held too, even over a console-shot parent: the receipt read is the child's
 * alone, never the parent chain. The other checks still run beside the hold, so every problem is named at once.
 *
 * ## The receipt names the verb, the verb names the type
 *
 * Every picture verb writes a PNG and `proof cassette` an MP4. A file declared as anything else is not what was
 * checked: a GIF, a WebM or a JPEG has no verb that writes it, and a PNG renamed `.mp4` (or the reverse) is not the
 * type its receipt describes.
 */
import type { DoorFinding } from "../../admit/types.js";
import type { CaptureReceipt, CaptureVerb } from "../../visualEvidence/captureRecord.js";

/** The content type each capture verb writes: a PNG for every picture verb, an MP4 for a terminal recording. */
const CAPTURED_CONTENT_TYPES: Readonly<Record<CaptureVerb, string>> = {
  "browser console-shot": "image/png",
  "browser redact": "image/png",
  "browser shot": "image/png",
  "browser terminal-shot": "image/png",
  "proof cassette": "video/mp4",
};

/** Every content type some capture verb writes; anything else (a GIF, a WebM, a JPEG) has no receipt to describe it. */
const ANY_CAPTURED_TYPE = new Set(Object.values(CAPTURED_CONTENT_TYPES));

/** The one capture verb whose receipt attach admits: its `detail.fixture` is the synthetic organisation, always. */
const ADMITTED_CAPTURE_VERB: CaptureVerb = "browser console-shot";

/**
 * One hold finding, the only severity an attach check raises.
 *
 * @param code the finding's code, `attach.<check>`
 * @param summary what is wrong, naming nothing the picture shows
 * @param correction the one act that clears it
 * @returns the finding
 */
export function attachHold({
  code,
  summary,
  correction,
}: {
  code: string;
  summary: string;
  correction: string;
}): DoorFinding {
  return { code, correction, severity: "hold", summary };
}

/**
 * Whether the verb that wrote a receipt may send its bytes at all. Only `browser console-shot` is synthetic by
 * construction — a throwaway store and home holding the `acme` fixtures (`captureRecord.ts`'s console arm) — while
 * every other verb photographs whatever the session points it at, so its picture can carry a figure read from the
 * operator's own accounts, which no attach scan judges. Every other verb is held until a figure check exists. The
 * finding names the verb only, never anything the picture shows.
 *
 * @param verb the capture verb the receipt names
 * @returns one hold for any verb but `browser console-shot`, else nothing
 */
export function attachCaptureVerbFindings({ verb }: { verb: CaptureVerb }): readonly DoorFinding[] {
  if (verb === ADMITTED_CAPTURE_VERB) {
    return [];
  }
  return [
    attachHold({
      code: "attach.capture-verb",
      correction:
        "re-capture it with `slopweaver browser console-shot` over its synthetic `acme` fixtures, or keep this proof " +
        "local until a figure check exists",
      summary: `\`${verb}\` can show figures from the operator's own accounts; only \`browser console-shot\` is synthetic by construction`,
    }),
  ];
}

/**
 * No verb writes a GIF, a WebM or a JPEG, so that type is refused on its own, beside the missing receipt.
 *
 * @param contentType the content type the upload would declare
 * @returns one hold for a type no capture verb writes, else nothing
 */
export function uncapturedTypeFindings({ contentType }: { contentType: string }): readonly DoorFinding[] {
  if (ANY_CAPTURED_TYPE.has(contentType)) {
    return [];
  }
  return [
    attachHold({
      code: "attach.content-type",
      correction: "attach the .png or .mp4 a capture verb wrote; no capture verb writes anything else",
      summary: `the upload would be declared ${contentType}, and no capture verb writes one`,
    }),
  ];
}

/**
 * The receipt names the verb, the verb names the type: a PNG renamed .mp4, or the reverse, is not what was checked.
 *
 * @param contentType the content type the upload would declare
 * @param receipt the receipt the bytes resolved to
 * @returns one hold when the declared type is not the one the receipt's verb writes, else nothing
 */
export function capturedTypeFindings({
  contentType,
  receipt,
}: {
  contentType: string;
  receipt: CaptureReceipt;
}): readonly DoorFinding[] {
  const written = CAPTURED_CONTENT_TYPES[receipt.verb];
  if (contentType === written) {
    return [];
  }
  return [
    attachHold({
      code: "attach.content-type",
      correction: "attach the file under the name the capture verb gave it",
      summary: `the upload would be declared ${contentType}, and \`${receipt.verb}\` wrote an ${written}`,
    }),
  ];
}
