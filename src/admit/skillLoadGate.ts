/**
 * The gate that refuses to send an answer which loaded NO skill on a subject the catalogue plainly owns.
 *
 * ## Why this is a gate and not only a brief line
 *
 * `../live/turn/skillRouting.ts` now renders the ranked candidates into the worker's brief, which fixes the
 * silence. It does not fix the outcome on its own: a monitor incident's brief carried the answer
 * caps, the visual-evidence default and the core-deliverable pre-flight, and the worker still shipped
 * without the procedure. MEASURED across every dispatched worker turn on this machine, 31 of 43 (72%) held
 * no skill at all — a rate no amount of additional guidance has moved, and doctrine rule 7's shape is that a
 * form REFUSES a violation rather than a reviewer catching it.
 *
 * ## What it fires on, and the floor that decides
 *
 * Exactly one thing, and it is deliberately the weakest useful claim: the answer's
 * `grounding.provenance.skillsLoaded` is EMPTY while the catalogue offered a candidate scoring at least
 * {@link CLEAR_OWNER_SCORE}. Naming ANY skill discharges it — this is not a check that the worker loaded the
 * RIGHT one, because only a reader can say that, and a gate that guessed would refuse correct answers.
 *
 * The floor is measured, not chosen: ranking this machine's 79-entry catalogue against the 163 real ask
 * questions in `$SLOPWEAVER_HOME/briefs` puts 50 of them (31%) at or above 1.25, and the monitor incident's
 * own question at 1.33. A floor of 1.0 would sweep in 109 (67%) — most of a day's asks, which is a gate
 * that is only ever overridden — and 2.0 would take just 17 (10%) and miss the incident that prompted this.
 * Reproduce by ranking `availableSkills` against each brief's `question` and counting the top scores.
 *
 * ## `warn`, like every other gate on this path
 *
 * Block-by-default WITH a break-glass. "I read the candidates, none of them owned this, sending" has to stay
 * representable — and the door records every override it waives, so releasing a skill-less answer on a
 * clearly-owned subject is itself in the audit trail. That is the property that matters, not a hard stop.
 */

import type { CatalogueSkill } from "../live/turn/skillRouting.js";
import { rankSkills } from "../live/turn/skillRouting.js";
import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import type { DoorFinding, DoorGate } from "./types.js";

/**
 * The override token that waives this gate, recorded by the door whenever it is used.
 *
 * @internal — named here so the value has one home; the docs and tests quote it rather than re-spelling it.
 */
export const SKILL_LOAD_OVERRIDE = "answer.skill-load:v1";

/**
 * The rank score at which the catalogue is taken to plainly own a question's subject.
 *
 * See this module's header for the measurement behind the number; change it by re-running that measurement,
 * never by taste.
 *
 * @internal — exported so a test and this module's header can quote the measured floor by name.
 */
export const CLEAR_OWNER_SCORE = 1.25;

/**
 * The finding for an answer that names no skill on a subject the catalogue clearly owns, or none at all.
 *
 * One finding at most, unlike `./coreDeliverableGate.ts`'s list: there is exactly one thing to say here, and
 * it names the best candidate so the correction is a file path rather than a search.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked, tags already stripped
 * @param skills the catalogue the worker's own brief ranked
 * @returns the finding, or none
 *
 * @internal — exported so a test can assert the finding without composing a whole door request.
 */
export function skillLoadFindings({
  answer,
  question,
  skills,
}: {
  answer: AnswerFormAnswer;
  question: string;
  skills: readonly CatalogueSkill[];
}): readonly DoorFinding[] {
  if (answer.grounding.provenance.skillsLoaded.length > 0) {
    return [];
  }
  const best = rankSkills({ limit: 1, question, skills })[0];
  if (best === undefined || best.score < CLEAR_OWNER_SCORE) {
    return [];
  }
  return [
    {
      code: "ANSWER_LOADED_NO_SKILL",
      correction: `read ${best.skill.path} (and any other candidate your brief listed), then name what you read in grounding.provenance.skillsLoaded — or override, having decided none of them owns this ask`,
      override: SKILL_LOAD_OVERRIDE,
      severity: "warn",
      summary: `this ask's subject is owned by \`${best.skill.name}\` and the answer loaded no skill at all — the procedure the owner already wrote down was not read`,
    },
  ];
}

/**
 * The skill-load gate, ready to compose into the door's gate list.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked, tags already stripped
 * @param skills the catalogue the worker's own brief ranked
 * @returns a `DoorGate` reporting an answer that loaded nothing on a clearly-owned subject
 */
export function skillLoadGate({
  answer,
  question,
  skills,
}: {
  answer: AnswerFormAnswer;
  question: string;
  skills: readonly CatalogueSkill[];
}): DoorGate {
  return () => skillLoadFindings({ answer, question, skills });
}
