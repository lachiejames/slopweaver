/**
 * The references one autonomy act would carry onto the briefing page as plain text — what `slopweaver autonomy
 * record`, `autonomy steer` and `autonomy steer-class` refuse before the words are written.
 *
 * A why citing a five-digit `#` number on an act whose subject is a four-digit pull request is the shape this
 * refuses. The subject attests a four-digit number, so the render leaves the five-digit one as text by
 * `../outbound/linkify/bareRefs.ts`'s magnitude rule, and `briefing check` would refuse the page hours later —
 * with the act already in the register and the session that wrote it gone.
 *
 * The act is RENDERED by the page's own renderer and read by the page check's own traversal, rather than its
 * fields scanned one by one: the page reads the said, the why and the steer as one run of text with every link
 * removed whole, so a field-by-field scan both missed a reference two fields (or a link and its neighbour)
 * only form together, and judged against a context the page does not use. The one deliberate difference is
 * that a reference the act's own links WOULD resolve is refused too: the page it lands on links other
 * repositories, and on a page linking two, no bare number reference resolves at all. So this refuses everything the
 * render leaves as text, which is never less than any page would.
 */
import { AutonomyErrors, type BareReferenceError } from "../autonomy/errors.js";
import type { AutonomyAction } from "../autonomy/types.js";
import { renderAutonomy } from "../outbound/briefing/autonomyRender.js";
import { projectAutonomyRow } from "./autonomy.js";
import { plainTextRefsOf } from "./bareRef.js";

/**
 * Every reference the act's render leaves as plain text, as the error refusing it.
 *
 * @param entry the act as it would stand once written, with the steer being recorded folded in
 * @returns one error per reference, empty when the render links every one
 */
export function bareReferenceErrors({ entry }: { entry: AutonomyAction }): readonly BareReferenceError[] {
  const row = projectAutonomyRow({ entry });
  const html = renderAutonomy({ autonomy: { notShown: 0, rows: [row] } }).join("\n");
  return plainTextRefsOf({ html }).map((ref) => {
    if (ref.refusal !== undefined) {
      return AutonomyErrors.bareReference({ reason: ref.refusal });
    }
    return AutonomyErrors.bareReference({
      reason:
        `${JSON.stringify(ref.raw)} renders as plain text: this act's own links would resolve it, but the ` +
        "briefing links more than one repository, where a bare reference resolves against none.",
    });
  });
}

/**
 * Every reference a word of the owner's — a steer on one act, or a class steer — would carry onto the briefing as
 * plain text, judged with NO act's links behind it. The fold shows one steer on every act sharing its act's
 * kind and plain-words line, whatever their subjects (`../autonomy/query.ts`'s pattern word), and a class
 * steer on every act of its kinds, so no single act's links can vouch for a reference the word carries.
 *
 * @param word the steer text as it would be recorded
 * @returns one error per reference the word leaves as text, empty when every one is written in full
 */
export function standingWordReferenceErrors({ word }: { word: string }): readonly BareReferenceError[] {
  const carrier: AutonomyAction = {
    action: {
      actionId: "-",
      bySession: "-",
      doneIso: "1970-01-01T00:00:00Z",
      kind: "-",
      subject: "-",
      why: "-",
      witness: "-",
    },
    classSteer: undefined,
    latestSteer: { actionId: "-", bySession: "-", steer: word, steeredIso: "1970-01-01T00:00:00Z" },
    patternSteer: undefined,
  };
  return bareReferenceErrors({ entry: carrier });
}
