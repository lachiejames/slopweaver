/**
 * The pure read-back every `private-terms` edit prints, and the probe counts it reports.
 *
 * An edit counts once it is read back to the owner, and the supervisor relays that read-back to the owner, so it is a
 * message: it names the row by id, class and case, says the meaning and where it is fine only when neither carries
 * a private term, and reports each probe as a count. It never prints a pattern, a source or a probe's text, because
 * a probe is usually the very word the row protects.
 */
import {
  type PrivateTerm,
  type PrivateTermClass,
  printableUnderTerms,
  WITHHELD_REFUSAL_LINE,
} from "../../../hygiene/privateTerms.js";
import type { PrivateTermsEdited } from "../../../hygiene/privateTermsEdit.js";
import type { PrivateTermProbes } from "./core.js";

/** How a probe set came out against one row. */
export interface ProbeOutcome {
  readonly matchedAsExpected: number;
  readonly matchesGiven: number;
  readonly missedAsExpected: number;
  readonly missesGiven: number;
}

/**
 * Pure: run the probes against one row, counting only.
 *
 * @param term the row as the new file parses it
 * @param probes the texts it must match, and must not
 * @returns the counts
 */
export function probeOutcomeOf({ term, probes }: { term: PrivateTerm; probes: PrivateTermProbes }): ProbeOutcome {
  const hits = ({ text }: { text: string }): boolean => new RegExp(term.re.source, term.re.flags).test(text);
  return {
    matchedAsExpected: probes.matches.filter((text) => hits({ text })).length,
    matchesGiven: probes.matches.length,
    missedAsExpected: probes.misses.filter((text) => !hits({ text })).length,
    missesGiven: probes.misses.length,
  };
}

/**
 * Pure: whether every probe came out as the owner said it should.
 *
 * @param outcome the counts
 * @returns true when nothing failed
 */
export function probesHeld({ outcome }: { outcome: ProbeOutcome }): boolean {
  return outcome.matchedAsExpected === outcome.matchesGiven && outcome.missedAsExpected === outcome.missesGiven;
}

/** A cell the read-back says aloud, or the stand-in when it carries a term. */
function spoken({ text, terms }: { text: string | undefined; terms: readonly PrivateTerm[] }): string {
  if (text === undefined) {
    return "(not set)";
  }
  const printed = printableUnderTerms({ line: text, terms });
  return printed === WITHHELD_REFUSAL_LINE ? "(withheld here: it carries a private term)" : printed;
}

/** A class and case, in words. */
function shapeOf({ className, re }: { className: PrivateTermClass; re: RegExp }): string {
  return `${className}, ${re.flags.includes("i") ? "case-insensitive" : "case-sensitive"}`;
}

/**
 * Pure: the read-back one proposal prints: ids, class, case, meaning and where it is fine (each withheld when it
 * carries a term), probe counts and the confirm step. Never a pattern, a source or a probe's text.
 *
 * @param proposalId the proposal the confirm step names
 * @param action what the edit does
 * @param edited the edit, decided
 * @param probes the texts the row was tested against
 * @param home the state home the confirm must name
 * @returns the lines, headline first
 */
export function readBackLines({
  proposalId,
  action,
  edited,
  probes,
  home,
}: {
  proposalId: string;
  action: "add" | "narrow" | "remove";
  edited: PrivateTermsEdited;
  probes: PrivateTermProbes;
  home: string;
}): readonly string[] {
  const { terms } = edited;
  const lines: string[] = [];
  const row = edited.edited;
  if (row === undefined) {
    lines.push(`proposal ${proposalId}: remove ${edited.termId}`);
  } else {
    lines.push(
      `proposal ${proposalId}: ${action} ${row.termId} (${shapeOf({ className: row.className, re: row.re })})`,
    );
    lines.push(`  means: ${spoken({ terms, text: row.meaning })}`);
    lines.push(`  fine where: ${spoken({ terms, text: row.allowedWhere })}`);
    const outcome = probeOutcomeOf({ probes, term: row });
    lines.push(
      `  probes: ${String(outcome.matchedAsExpected)} of ${String(outcome.matchesGiven)} matched as they should, ` +
        `${String(outcome.missedAsExpected)} of ${String(outcome.missesGiven)} missed as they should`,
    );
  }
  const migrated = edited.migrated ? "; this edit also moves the file to the seven-cell form, every row kept" : "";
  lines.push(`  rows: ${String(edited.rowsBefore)} before, ${String(edited.rowsAfter)} after${migrated}`);
  lines.push(
    `  Nothing is written yet. Read this back to the owner; on the owner's yes: slopweaver private-terms confirm ${proposalId} --home ${home}`,
  );
  return lines;
}
