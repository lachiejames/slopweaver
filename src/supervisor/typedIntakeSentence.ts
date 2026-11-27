/**
 * The typed console half's sentence beside the chair half's intake clause (`./intake.ts`). A leaf importing only types,
 * so the clause can call it without `./typedIntake.ts`, which reads `./intake.ts`'s constants as it loads, ever being
 * loaded first.
 */
import type { TypedIntakeReport } from "./typedIntake.js";

/**
 * The typed half's sentence: a count, never a quote, because those turns are often private. Nothing at all when every
 * typed turn is witnessed and every input read, so a clean read changes no clause.
 *
 * @param report the typed half, absent where a reader never asked for it
 * @returns the sentence, full stop included, or `""`
 */
export function typedIntakeSentence({ report }: { report: TypedIntakeReport | undefined }): string {
  if (report === undefined || report.kind === "excluded") {
    return "";
  }
  if (report.kind === "unavailable") {
    return `Typed console turns unread: ${report.why}.`;
  }
  const { finding } = report;
  const parts: string[] = [];
  if (finding.unwitnessed.length > 0) {
    parts.push(`${String(finding.unwitnessed.length)} typed console turn(s) have no row or card.`);
  }
  if (finding.unreadable.length > 0) {
    parts.push(`Typed console turns may be short: ${String(finding.unreadable.length)} input(s) did not read.`);
  }
  return parts.join(" ");
}
