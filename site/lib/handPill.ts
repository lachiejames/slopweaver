/**
 * The right-hand tags of a hand-step Queue card. Split from `./queueRows.ts`, which sits at its 300-line cap.
 */
import type { HandStep } from "../components/live/read";

/**
 * The tags a hand-step card draws on its row: `integration=<name>`, the system the step touches as the credential
 * register names it (`hand list --json`'s `integration`), else `integration=none`, the way the `platform` tag says
 * `none`; then `workstream=<name>` for each workstream its board rows put it in, where any resolve. Never a word for
 * who acts: "your hands" tells the owner nothing, while which integration and which workstream it relates to is what
 * makes the tag useful and scalable.
 *
 * @param step the open step
 * @param workstreams the workstream tag values the card's rows carry, in any order
 * @returns the pill text
 */
export function handPill({ step, workstreams }: { step: HandStep; workstreams: readonly string[] }): string {
  let pill = "integration=none";
  if (step.integration !== undefined) {
    pill = `integration=${step.integration}`;
  }
  if (workstreams.length === 0) {
    return pill;
  }
  return `${pill} · workstream=${workstreams.toSorted().join(",")}`;
}
