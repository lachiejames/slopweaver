/**
 * The pure rules of SWITCHING one automation on or off: which file a switch writes, what the file must say for the
 * switch to mean anything, and what proves the word that asked for it came from the owner's record. The effects — the
 * anchor read, the lock, the one-key write and the journal append — are `../../cli/commands/automation/switch.ts`.
 *
 * `enabled` is one boolean on a definition, and before this the only way to write it was by hand. A switch is the
 * verb that writes it, so the change is previewed, journalled with the owner's words, and refused where it would not
 * do what it says:
 *
 * - **Enabling a HELD row is refused.** A standing hold outranks `enabled` entirely (`./definitionDue.ts`), so the
 *   write would leave the row exactly as OFF as before while the journal said it was turned on.
 * - **Disabling a held row is allowed.** It narrows; the hold still stands, and the row stays off once it lifts.
 * - **A retired row is refused either way.** It has no definition to switch, and `automation retire --undo` is the
 *   reversal.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { RecipeDefinition } from "./definition.js";
import { holdStands } from "./failureHold.js";

/** Which way a switch turns its row. */
export type SwitchDirection = "enable" | "disable";

/** One switch as the journal records it. */
export interface AutomationSwitch {
  readonly recipeId: string;
  /** The state written: `true` for an enable, `false` for a disable. */
  readonly enabled: boolean;
  /** The owner-words anchor the record was read at. */
  readonly anchor: string;
  /** The owner's exact words, byte for byte as the record holds them. */
  readonly words: string;
  /** Why the row is switched, in a sentence the owner can react to. */
  readonly why: string;
  /** When the switch was written. */
  readonly switchedAtIso: string;
}

/** The row has no definition file on this install. */
export interface SwitchDefinitionAbsentError {
  readonly code: "SWITCH_DEFINITION_ABSENT";
  readonly message: string;
  readonly recipeId: string;
}

/** The retirement registry did not read, so whether the row is retired is unknown and nothing is switched. */
export interface SwitchRetirementsUnreadableError {
  readonly code: "SWITCH_RETIREMENTS_UNREADABLE";
  readonly message: string;
}

/** The canonical file is one this build's reader refused, so nothing is written over it unread. */
export interface SwitchDefinitionUnreadableError {
  readonly code: "SWITCH_DEFINITION_UNREADABLE";
  readonly message: string;
  readonly file: string;
}

/** The recipe stands in a file other than its canonical `<recipeId>.json`, which one write cannot switch. */
export interface SwitchDefinitionAmbiguousError {
  readonly code: "SWITCH_DEFINITION_AMBIGUOUS";
  readonly message: string;
  readonly files: readonly string[];
}

/** The row is retired on this install. */
export interface SwitchRetiredError {
  readonly code: "SWITCH_RETIRED";
  readonly message: string;
  readonly recipeId: string;
}

/** An enable asked of a row whose standing hold outranks `enabled`. */
export interface SwitchHeldError {
  readonly code: "SWITCH_HELD";
  readonly message: string;
  readonly recipeId: string;
}

/** The words are not in the record the anchor reads. */
export interface SwitchWordsNotInRecordError {
  readonly code: "SWITCH_WORDS_NOT_IN_RECORD";
  readonly message: string;
  readonly anchor: string;
}

/** A field a reader must be able to check is blank. */
export interface SwitchFieldBlankError {
  readonly code: "SWITCH_FIELD_BLANK";
  readonly message: string;
  readonly field: "words" | "why";
}

/** The definition file, or the journal beside it, could not be read or written. */
export interface SwitchStoreError {
  readonly code: "SWITCH_DEFINITION_NOT_WRITTEN" | "SWITCH_JOURNAL_UNWRITABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** Every way a switch's own rules, or its two writes, refuse it. */
export type AutomationSwitchRuleError =
  | SwitchDefinitionAbsentError
  | SwitchRetirementsUnreadableError
  | SwitchDefinitionUnreadableError
  | SwitchDefinitionAmbiguousError
  | SwitchRetiredError
  | SwitchHeldError
  | SwitchWordsNotInRecordError
  | SwitchFieldBlankError
  | SwitchStoreError;

/** Build one {@link AutomationSwitchRuleError}. */
export const AutomationSwitchRuleErrors = {
  definitionNotWritten: ({ path, detail }: { path: string; detail: string }): SwitchStoreError => ({
    code: "SWITCH_DEFINITION_NOT_WRITTEN",
    detail,
    message: `could not switch ${path}: ${detail}; nothing changed`,
    path,
  }),
  journalUnwritable: ({ path, detail }: { path: string; detail: string }): SwitchStoreError => ({
    code: "SWITCH_JOURNAL_UNWRITABLE",
    detail,
    message: `cannot append to the switch journal ${path}: ${detail}`,
    path,
  }),
  definitionAbsent: ({ recipeId }: { recipeId: string }): SwitchDefinitionAbsentError => ({
    code: "SWITCH_DEFINITION_ABSENT",
    message:
      `${recipeId} has no definition on this install, so there is nothing to switch — a declared row is written by ` +
      "`slopweaver automation register-standing`; nothing changed",
    recipeId,
  }),
  definitionAmbiguous: ({
    recipeId,
    files,
  }: {
    recipeId: string;
    files: readonly string[];
  }): SwitchDefinitionAmbiguousError => ({
    code: "SWITCH_DEFINITION_AMBIGUOUS",
    files,
    message:
      `${recipeId} stands in ${files.join(", ")}, not only its own ${recipeId}.json — switching one file would ` +
      "leave the other as it was; nothing changed",
  }),
  definitionUnreadable: ({ file, why }: { file: string; why: string }): SwitchDefinitionUnreadableError => ({
    code: "SWITCH_DEFINITION_UNREADABLE",
    file,
    message: `${file} does not parse (${why}), so it is not written over unread; nothing changed`,
  }),
  fieldBlank: ({ field }: { field: "words" | "why" }): SwitchFieldBlankError => ({
    code: "SWITCH_FIELD_BLANK",
    field,
    message: `--${field} is blank — a switch must carry something a reader can check`,
  }),
  held: ({ recipeId }: { recipeId: string }): SwitchHeldError => ({
    code: "SWITCH_HELD",
    message:
      `${recipeId} carries a standing hold, which outranks \`enabled\` — enabling it would leave it OFF · HELD, so ` +
      "nothing changed. There is no override: lifting the hold is the route, and `slopweaver automation due` prints " +
      "what lifts it",
    recipeId,
  }),
  retirementsUnreadable: ({ detail }: { detail: string }): SwitchRetirementsUnreadableError => ({
    code: "SWITCH_RETIREMENTS_UNREADABLE",
    message: `${detail} — nothing changed`,
  }),
  retired: ({ recipeId }: { recipeId: string }): SwitchRetiredError => ({
    code: "SWITCH_RETIRED",
    message:
      `${recipeId} is retired on this install, so it has no row to switch — ` +
      `\`slopweaver automation retire ${recipeId} --undo\` gives it back; nothing changed`,
    recipeId,
  }),
  wordsNotInRecord: ({ anchor }: { anchor: string }): SwitchWordsNotInRecordError => ({
    anchor,
    code: "SWITCH_WORDS_NOT_IN_RECORD",
    message:
      `--words is not, byte for byte, in the owner's record at ${anchor} — ` +
      `quote it exactly (\`slopweaver profile words ${anchor}\`)`,
  }),
} as const;

/** At least one character outside Unicode `White_Space`. */
const FILLED = /[^\p{White_Space}]/u;

/**
 * Which file a switch writes, judged against the definition store as it was read.
 *
 * Only the canonical `<recipeId>.json` is ever written. A file of that name the reader refused is not a row anyone
 * can see the contents of, so it is refused rather than written over; the recipe standing in any OTHER file is
 * refused too, since switching the canonical one would leave that copy as it was.
 *
 * @param recipeId the row being switched
 * @param retired whether the install has retired it
 * @param definitionIds the recipe id of every row the store parsed, index-aligned with `definitionFiles`
 * @param definitionFiles the file each parsed row came from
 * @param rejected every file the store refused, with why
 * @returns the canonical file to write, or why nothing may be written
 */
export function switchTarget({
  recipeId,
  retired,
  definitionIds,
  definitionFiles,
  rejected,
}: {
  readonly recipeId: string;
  readonly retired: boolean;
  readonly definitionIds: readonly string[];
  readonly definitionFiles: readonly string[];
  readonly rejected: readonly { readonly file: string; readonly why: string }[];
}): Result<string, AutomationSwitchRuleError> {
  if (retired) {
    return err(AutomationSwitchRuleErrors.retired({ recipeId }));
  }
  const canonical = `${recipeId}.json`;
  const refused = rejected.find((rejection) => rejection.file === canonical);
  if (refused !== undefined) {
    return err(AutomationSwitchRuleErrors.definitionUnreadable({ file: refused.file, why: refused.why }));
  }
  const files = definitionFiles.filter((_file, index) => definitionIds[index] === recipeId);
  if (files.some((file) => file !== canonical)) {
    return err(AutomationSwitchRuleErrors.definitionAmbiguous({ files, recipeId }));
  }
  if (files.length === 0) {
    return err(AutomationSwitchRuleErrors.definitionAbsent({ recipeId }));
  }
  return ok(canonical);
}

/** What a switch would do to the row as it stands. */
export type SwitchPlan =
  | { readonly kind: "already"; readonly enabled: boolean }
  | { readonly kind: "switch"; readonly from: boolean; readonly to: boolean };

/**
 * What switching one row would change, or why it would not do what it says.
 *
 * @param direction which way the caller asked
 * @param definition the row as its canonical file parses now
 * @returns the change to make, `already` when the row is in that state, or why the switch is refused
 */
export function planSwitch({
  direction,
  definition,
}: {
  readonly direction: SwitchDirection;
  readonly definition: RecipeDefinition;
}): Result<SwitchPlan, AutomationSwitchRuleError> {
  const to = direction === "enable";
  const { hold } = definition;
  if (to && hold !== undefined && holdStands({ hold })) {
    return err(AutomationSwitchRuleErrors.held({ recipeId: definition.recipeId }));
  }
  if (definition.enabled === to) {
    return ok({ enabled: to, kind: "already" });
  }
  return ok({ from: definition.enabled, kind: "switch", to });
}

/**
 * Compose one switch from the owner's record, refusing words the record does not hold.
 *
 * Checked BYTE FOR BYTE, never case-folded or matched on a name: provenance, not a naming test. The entry's own `why`
 * says which row and why, for the owner to read back.
 *
 * @param recipeId the row being switched
 * @param enabled the state the switch writes
 * @param anchor the owner-words anchor the record was read at
 * @param words the owner's exact words, which must occur in `recordText` unchanged
 * @param why why the row is switched
 * @param recordText the record's whole text, as the anchor resolved it
 * @param switchedAtIso when the switch is recorded
 * @returns the entry to journal, or why it is refused
 */
export function switchFromWords({
  recipeId,
  enabled,
  anchor,
  words,
  why,
  recordText,
  switchedAtIso,
}: {
  readonly recipeId: string;
  readonly enabled: boolean;
  readonly anchor: string;
  readonly words: string;
  readonly why: string;
  readonly recordText: string;
  readonly switchedAtIso: string;
}): Result<AutomationSwitch, AutomationSwitchRuleError> {
  if (!FILLED.test(words)) {
    return err(AutomationSwitchRuleErrors.fieldBlank({ field: "words" }));
  }
  if (!FILLED.test(why)) {
    return err(AutomationSwitchRuleErrors.fieldBlank({ field: "why" }));
  }
  if (!recordText.includes(words)) {
    return err(AutomationSwitchRuleErrors.wordsNotInRecord({ anchor }));
  }
  return ok({ anchor, enabled, recipeId, switchedAtIso, why, words });
}
