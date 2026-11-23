/**
 * The refusal a session gets when a run journal will not fully decode — and the one that finally names its
 * own fix.
 *
 * ## Why this module exists at all
 *
 * The old text was one sentence: *"the journal has unreadable line(s) 13; ownership cannot be proven, so
 * nothing was written"*. It named no kind, said nothing about staleness, pointed at no command, and carried
 * no escape hatch — so a session that hit it had no next move. MEASURED: a session on a
 * two-day-old worktree hit exactly that on the `ruling` line `handover rule` had just written, and ended up
 * filing a finding instead of doing its work. That is the whole defect `error-handling.md` § "A POLICY
 * refusal is not a domain error" describes, sitting on the verb `AGENTS.md` rule 6 depends on.
 *
 * {@link ../handover/ledger.ownershipAmbiguousLines} removed the common case; this removes the residue's
 * teeth. Every refusal here goes through {@link ../hatch/render.hatchRefusalLines}, so the four lines and
 * the judgement note are the register's rather than this module's — a gate that could word its own refusal
 * would eventually word it as "do not override".
 *
 * Pure: the caller supplies the parsed journal and reads the environment.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import type { ParsedLedger, UnknownKindLine } from "./ledger.js";

/** The register id this module refuses through. */
const STALE_JOURNAL_HATCH = "stale-journal-reader";

/**
 * The environment variable that opens it.
 *
 * Spelled as a LITERAL rather than built from `hatchEnvVar({ suffix })`, and that is the gate's requirement
 * rather than a style choice: `escape-hatch` in `yarn lint` checks that a row's named reader really mentions
 * its own key, and a name assembled at runtime is one no static scan can see. Exported because the verbs
 * that read it are in another module.
 */
export const ALLOW_STALE_JOURNAL_ENV = "SLOPWEAVER_ALLOW_STALE_JOURNAL_READER";

/**
 * Whether the stale-journal escape hatch is open — the caller's own parsed escape, OR the ambient variable.
 *
 * Written as an OR of two arguments rather than as a parameter default, which is the shape
 * `src/devLint/hatchRelease.ts` refuses tree-wide: a default initialiser is skipped the moment a caller
 * passes anything, which is how `SLOPWEAVER_ALLOW_SPENT_PLAN` came to print a refusal telling the operator
 * to set the variable the operator had just set.
 *
 * @param flag the caller's own escape, already parsed — `false` on every verb that has no flag for it
 * @param env the raw value of {@link ALLOW_STALE_JOURNAL_ENV}, or undefined when it is unset
 * @returns true when the verb may write over a journal it could not fully decode
 */
export function staleJournalHatchOpen({ flag, env }: { flag: boolean; env: string | undefined }): boolean {
  return flag || env === "1";
}

/**
 * The distinct kinds this checkout has no case for, in first-seen order, deduplicated.
 *
 * Deduplicated because a journal routinely carries a dozen `dispatched` lines and a refusal listing the word
 * twelve times says nothing the word once does not.
 *
 * @param unknownKind the parsed journal's unknown-kind lines
 * @returns each unknown word once, in the order it first appears
 */
export function unknownKindNames({ unknownKind }: { unknownKind: readonly UnknownKindLine[] }): readonly string[] {
  return [...new Set(unknownKind.map((entry) => entry.kind))];
}

/**
 * The clause that turns "unreadable" into something a session can act on: which words this build could not
 * name, and the two real next moves.
 *
 * Empty when no unknown kind is involved — a truncated line or a `ruling` missing its anchor is genuine
 * damage in the file, and telling that session to pull `main` would send it somewhere the fix is not.
 *
 * @param unknownKind the parsed journal's unknown-kind lines
 * @returns the staleness clause, or the empty string when staleness is not the explanation
 */
export function stalenessClause({ unknownKind }: { unknownKind: readonly UnknownKindLine[] }): string {
  const names = unknownKindNames({ unknownKind });
  if (names.length === 0) {
    return "";
  }
  const words = names.map((name) => `\`${name}\``).join(", ");
  return (
    ` — the word(s) ${words} are ones THIS checkout's decoder has no case for, which means it predates the ` +
    "build that wrote them rather than that the file is damaged. Pull the base branch in this worktree, or " +
    "run the verb from the main checkout"
  );
}

/**
 * The line stating which journal lines a live ruling was recorded beside without reading, or `undefined` on a
 * clean journal.
 *
 * The owner's ruling is never refused over a line this checkout cannot decode (`./rowEventRefusal.ts` § `isLiveRuling`), so
 * every verb writing one STATES the skip instead: the count, the line numbers, and — when the cause is a word
 * this checkout's decoder predates — that word and the pull that makes it legible. A line that is not an
 * unknown kind is damage in the file, and pulling would send the reader somewhere the fix is not.
 *
 * @param skipped the undecodable lines the write went ahead beside, as `applyRowEvent` hands them back
 * @returns the note, or `undefined` when nothing was skipped
 */
export function skippedLinesNote({
  skipped,
}: {
  skipped: Pick<ParsedLedger, "unknownKind" | "unreadable">;
}): string | undefined {
  const lines = skipped.unreadable;
  if (lines.length === 0) {
    return undefined;
  }
  const head =
    `${String(lines.length)} line(s) of this journal (${lines.join(", ")}) did not decode and were skipped; ` +
    "the duplicate check ran over the rest";
  const staleness = stalenessClause({ unknownKind: skipped.unknownKind });
  if (staleness.length > 0) {
    return `${head}${staleness}`;
  }
  return `${head} — no line is a word this checkout lacks, so the file itself is damaged there`;
}

/**
 * The whole refusal for a verb that will not write over a journal it could not fully decode.
 *
 * @param verb the verb refusing, as the operator typed it (`handover answer`, `handover claim`)
 * @param lines the 1-indexed lines that made this refusal fire
 * @param journal the parsed journal, read for the words it could not name
 * @returns the four-line refusal, ready to print line by line
 */
export function staleJournalRefusal({
  verb,
  lines,
  journal,
}: {
  verb: string;
  lines: readonly number[];
  journal: ParsedLedger;
}): readonly string[] {
  // Restricted to the lines that actually made THIS refusal fire. A journal routinely carries forgiven
  // unknown kinds alongside one blocking line, and naming all of them sends the reader after a word that is
  // not the cause — measured on the first end-to-end run of this very refusal, which listed a `vetoed` line
  // the guard had already released.
  const blocking = new Set(lines);
  const causes = journal.unknownKind.filter((entry) => blocking.has(entry.line));
  return hatchRefusalLines({
    detail:
      `${verb} — line(s) ${lines.join(", ")} of this run's journal did not decode` +
      `${stalenessClause({ unknownKind: causes })}`,
    hatch: hatchFor({ id: STALE_JOURNAL_HATCH }),
  });
}
