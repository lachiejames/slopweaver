/**
 * How each image-admission arm is SAID to a reader — three renderers, because the three arms are three
 * different kinds of thing and rendering them alike is what would dissolve the guarantee.
 *
 * - **missing** is POLICY with a working hatch, so it goes through `hatchRefusal` and gets exactly the four
 *   lines `.claude/rules/error-handling.md` specifies, naming `slopweaver hatch open unread-image`.
 * - **known-bad** is a `hold`, so it goes through `doorFindingLines`, which already prints "There is no
 *   escape hatch for this one" for a hold and prints no token. This module never assembles that sentence
 *   itself: one renderer owns it, and a second copy is how a hold would eventually be offered a way out.
 * - **invalid** is a FACT — a record that could not be read — so it gets plain lines and deliberately NOT
 *   the four-line shape. A refusal claiming a rule caught something, when really nothing could be read, is
 *   the `gateOutcome` distinction that same rules file draws between `refused` and `incomplete`.
 *
 * devlint: not-a-refusal -- {@link evidenceUnreadableLines} reports that a record could not be read, which
 * is a fact about the store rather than a policy that caught anything.
 */

import { doorFindingLines } from "../admit/doorRefusal.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import type { ImageAdmissionVerdict } from "./admission.js";

/**
 * The four-line policy refusal for attachments nobody recorded a look at.
 *
 * @param digests the artifact digests with no record
 * @param command what the caller was doing, as the owner would type it
 * @returns the refusal lines
 */
export function unreadImageRefusalLines({
  digests,
  command,
}: {
  digests: readonly string[];
  command: string;
}): readonly string[] {
  const named = digests.length === 1 ? "1 image" : `${String(digests.length)} images`;
  return hatchRefusalLines({
    detail: `${command}: ${named} with no record — ${digests.join(", ")}. Record what you saw with \`slopweaver browser image-record\` first.`,
    hatch: hatchFor({ id: "unread-image" }),
  });
}

/**
 * The hold lines for attachments a session looked at and recorded as unfit.
 *
 * One block per bad image rather than one summary, because each carries its own reason and its own
 * correction and a reader fixing them needs both per file.
 *
 * @param verdict the `known-bad` verdict
 * @param command what the caller was doing
 * @returns the lines, in reading order
 */
export function knownBadImageLines({
  verdict,
  command,
}: {
  verdict: Extract<ImageAdmissionVerdict, { kind: "known-bad" }>;
  command: string;
}): readonly string[] {
  return verdict.findings.flatMap((finding) => doorFindingLines({ command, finding }));
}

/**
 * The plain statement that a record exists and cannot be believed.
 *
 * Not a four-line refusal, on purpose: nothing was caught by a rule here. The store held something this
 * build could not read, or could not match to the bytes in hand, and saying otherwise would claim a policy
 * decision that was never made.
 *
 * @param issues what could not be believed, one per line
 * @returns the lines
 */
export function evidenceUnreadableLines({ issues }: { issues: readonly string[] }): readonly string[] {
  return [
    "the read-back records for this message's images could not be believed, so nothing was sent:",
    ...issues.map((issue) => `  ${issue}`),
    "re-record what you see in each image; a record that does not match its bytes is not evidence about them.",
  ];
}

/**
 * What to say when a DELIVERABLE was filed in the answer form's `images` array.
 *
 * A fact about the form rather than a policy refusal — nothing was judged, the composer named the wrong
 * lane — so it gets one plain sentence and none of the four-line shape, for `evidenceUnreadableLines`'s
 * reason. It lives here rather than at either answer verb so both of them say it identically.
 *
 * devlint: not-a-refusal -- this reports that a file is in the wrong array of a form the caller wrote,
 * which is a fact about the input rather than a rule that caught anything.
 *
 * @param filenames the misplaced attachments, in the order the form named them
 * @returns the one line to report
 */
export function misplacedDocumentLine({ filenames }: { filenames: readonly string[] }): string {
  return (
    `${filenames.join(", ")} is not a picture — move it to the answer form's "documents" array, which is the ` +
    `lane that carries a deliverable; "images" is read back against the visual-evidence store`
  );
}
