/**
 * The pure rules of retiring a standing row on one install: which rows may be retired at all, and what proves the
 * word that retired one came from the owner's record. The effects — resolving the anchor, the lock, the registry write and
 * the definition removal — are `../../cli/commands/automation/retire.ts`.
 *
 * Only a DECLARED standing row may be retired, because the reversal is `register-standing` writing the build's
 * own row back: a hand-written or resync row retired here could never be restored by anything.
 *
 * The owner's words are checked BYTE FOR BYTE against the record the anchor reads, never case-folded or matched on
 * a name. That is provenance, not a naming test: a general ruling ("any automation for anything employer related")
 * may retire a row the owner did not name individually, and the entry's own `why` says which row and why, for the
 * owner to read back on the page the retirement ends in.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AutomationRetirement } from "./retirementStore.js";

/** The recipe is not one this install declares as a standing row. */
export interface RetirementNotDeclaredError {
  readonly code: "RETIREMENT_NOT_DECLARED";
  readonly message: string;
  readonly recipeId: string;
}

/** The words are not in the record the anchor reads. */
export interface RetirementWordsNotInRecordError {
  readonly code: "RETIREMENT_WORDS_NOT_IN_RECORD";
  readonly message: string;
  readonly anchor: string;
}

/** A field a reader must be able to check is blank. */
export interface RetirementFieldBlankError {
  readonly code: "RETIREMENT_FIELD_BLANK";
  readonly message: string;
  readonly field: "words" | "why";
}

/** A definition file under the recipe's own id that this build's reader refused — never deleted unread. */
export interface RetirementDefinitionUnreadableError {
  readonly code: "RETIREMENT_DEFINITION_UNREADABLE";
  readonly message: string;
  readonly file: string;
}

/** The recipe stands in a file other than its canonical `<recipeId>.json`, which removing one file cannot retire. */
export interface RetirementDefinitionAmbiguousError {
  readonly code: "RETIREMENT_DEFINITION_AMBIGUOUS";
  readonly message: string;
  readonly files: readonly string[];
}

/** `--undo` named a recipe this install has not retired. */
export interface RetirementNotRetiredError {
  readonly code: "RETIREMENT_NOT_RETIRED";
  readonly message: string;
  readonly recipeId: string;
}

/** Every way a retirement's own rules refuse it. */
export type AutomationRetirementRuleError =
  | RetirementNotDeclaredError
  | RetirementWordsNotInRecordError
  | RetirementFieldBlankError
  | RetirementDefinitionUnreadableError
  | RetirementDefinitionAmbiguousError
  | RetirementNotRetiredError;

/** Build one {@link AutomationRetirementRuleError}. */
export const AutomationRetirementRuleErrors = {
  definitionAmbiguous: ({
    recipeId,
    files,
  }: {
    recipeId: string;
    files: readonly string[];
  }): RetirementDefinitionAmbiguousError => ({
    code: "RETIREMENT_DEFINITION_AMBIGUOUS",
    files,
    message:
      `${recipeId} stands in ${files.join(", ")}, not only its own ${recipeId}.json — removing one file would leave ` +
      "it running; nothing changed",
  }),
  definitionUnreadable: ({ file, why }: { file: string; why: string }): RetirementDefinitionUnreadableError => ({
    code: "RETIREMENT_DEFINITION_UNREADABLE",
    file,
    message: `${file} does not parse (${why}), so it is not removed unread; nothing changed`,
  }),
  notRetired: ({ recipeId }: { recipeId: string }): RetirementNotRetiredError => ({
    code: "RETIREMENT_NOT_RETIRED",
    message: `${recipeId} is not retired on this install, so there is nothing to undo`,
    recipeId,
  }),
  fieldBlank: ({ field }: { field: "words" | "why" }): RetirementFieldBlankError => ({
    code: "RETIREMENT_FIELD_BLANK",
    field,
    message: `--${field} is blank — a retirement must carry something a reader can check`,
  }),
  notDeclared: ({ recipeId }: { recipeId: string }): RetirementNotDeclaredError => ({
    code: "RETIREMENT_NOT_DECLARED",
    message:
      `${recipeId} is not a standing row this install declares, so nothing could restore it once retired — ` +
      "only a row `automation register-standing` writes can be retired",
    recipeId,
  }),
  wordsNotInRecord: ({ anchor }: { anchor: string }): RetirementWordsNotInRecordError => ({
    anchor,
    code: "RETIREMENT_WORDS_NOT_IN_RECORD",
    message:
      `--words is not, byte for byte, in the owner's record at ${anchor} — ` +
      `quote it exactly (\`slopweaver profile words ${anchor}\`)`,
  }),
} as const;

/** At least one character outside Unicode `White_Space`. */
const FILLED = /[^\p{White_Space}]/u;

/**
 * Whether a recipe is one this install declares — the only rows a retirement may name.
 *
 * @param recipeId the row to retire
 * @param declaredIds every standing row's id the install declares, retired ones included
 * @returns the recipe id, or why it may not be retired
 */
export function declaredForRetirement({
  recipeId,
  declaredIds,
}: {
  readonly recipeId: string;
  readonly declaredIds: readonly string[];
}): Result<string, AutomationRetirementRuleError> {
  if (!declaredIds.includes(recipeId)) {
    return err(AutomationRetirementRuleErrors.notDeclared({ recipeId }));
  }
  return ok(recipeId);
}

/**
 * Which file a retirement removes, judged against the definition store as it was read.
 *
 * Only the canonical `<recipeId>.json` is ever removed. A file of that name this build's reader refused is not a row
 * anyone can see the contents of, so it is refused rather than deleted unread; the recipe standing in any OTHER file
 * is refused too, since removing the canonical one would leave that copy running.
 *
 * @param recipeId the row being retired
 * @param definitionIds the recipe id of every row the store parsed, index-aligned with `definitionFiles`
 * @param definitionFiles the file each parsed row came from
 * @param rejected every file the store refused, with why
 * @returns the canonical file to remove, `null` when the row is already absent, or why nothing may be removed
 */
export function retirementTarget({
  recipeId,
  definitionIds,
  definitionFiles,
  rejected,
}: {
  readonly recipeId: string;
  readonly definitionIds: readonly string[];
  readonly definitionFiles: readonly string[];
  readonly rejected: readonly { readonly file: string; readonly why: string }[];
}): Result<string | null, AutomationRetirementRuleError> {
  const canonical = `${recipeId}.json`;
  const refused = rejected.find((rejection) => rejection.file === canonical);
  if (refused !== undefined) {
    return err(AutomationRetirementRuleErrors.definitionUnreadable({ file: refused.file, why: refused.why }));
  }
  const files = definitionFiles.filter((_file, index) => definitionIds[index] === recipeId);
  if (files.some((file) => file !== canonical)) {
    return err(AutomationRetirementRuleErrors.definitionAmbiguous({ files, recipeId }));
  }
  return ok(files.length === 0 ? null : canonical);
}

/**
 * Compose one retirement from the owner's record, refusing words the record does not hold.
 *
 * @param recipeId the declared row being retired
 * @param anchor the owner-words anchor the record was read at
 * @param words the owner's exact words, which must occur in `recordText` unchanged
 * @param why why this row does not belong on this install
 * @param recordText the record's whole text, as the anchor resolved it
 * @param retiredAtIso when the retirement is recorded
 * @returns the entry to write, or why it is refused
 */
export function retirementFromWords({
  recipeId,
  anchor,
  words,
  why,
  recordText,
  retiredAtIso,
}: {
  readonly recipeId: string;
  readonly anchor: string;
  readonly words: string;
  readonly why: string;
  readonly recordText: string;
  readonly retiredAtIso: string;
}): Result<AutomationRetirement, AutomationRetirementRuleError> {
  if (!FILLED.test(words)) {
    return err(AutomationRetirementRuleErrors.fieldBlank({ field: "words" }));
  }
  if (!FILLED.test(why)) {
    return err(AutomationRetirementRuleErrors.fieldBlank({ field: "why" }));
  }
  if (!recordText.includes(words)) {
    return err(AutomationRetirementRuleErrors.wordsNotInRecord({ anchor }));
  }
  return ok({ anchor, recipeId, retiredAtIso, why, words });
}
