/**
 * What `codex status --check` prints when its loop is complete but the second and last review pass left findings
 * standing: each leftover, and the acknowledgement the landing verbs will want for it.
 */
import { leftoverLine, type ReviewLeftover } from "../../../codex/reviewLeftovers.js";

/**
 * Both passes are spent, so each finding is not re-reviewed (the owner's cap). It stays a `codex-loop-incomplete`
 * finding on both landing verbs, landed only with `--acknowledge codex-loop-incomplete --reason "<why>"`. No
 * description carries it.
 *
 * @param leftovers the CURRENT `BROKEN` reviews past the second pass
 * @returns nothing when there are none, else a heading line, one line per leftover, and the acknowledgement
 */
export function leftoverReportLines({ leftovers }: { leftovers: readonly ReviewLeftover[] }): readonly string[] {
  if (leftovers.length === 0) {
    return [];
  }
  return [
    `codex status --check: ${String(leftovers.length)} finding(s) stand after the second and last review pass — ` +
      `the landing verbs raise codex-loop-incomplete for each:`,
    ...leftovers.map((leftover) => `- ${leftoverLine({ leftover })}`),
    `land with them standing only by saying why: --acknowledge codex-loop-incomplete --reason "<why it lands anyway>"`,
  ];
}
