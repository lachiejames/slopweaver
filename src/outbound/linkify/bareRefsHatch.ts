/**
 * The one way past a bare-reference refusal (`./bareRefs.ts`): the journalled `bare-refs` hatch.
 *
 * Lives under `outbound/` rather than in `../../cli/bareRefDoor.ts` because `../assistant/answerForm.ts`
 * honours the SAME hatch for the turn-answer path, and that module cannot depend on `cli/`.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchIncantation } from "../../hatch/types.js";

/**
 * The journalled hatch that sends a body still carrying a bare reference, unchanged — a grant this session
 * takes with `slopweaver hatch open`, never an ambient variable.
 */
export const BARE_REFS_HATCH = "bare-refs";

/**
 * The sentence every bare-reference refusal ends on: the one way past it.
 *
 * @returns the hatch's grant command and what the grant does
 */
export function bareRefsEscapeSentence(): string {
  return (
    `For one deliberate exception run ${hatchIncantation({ hatch: hatchFor({ id: BARE_REFS_HATCH }) })}; ` +
    "the grant sends it unchanged."
  );
}
