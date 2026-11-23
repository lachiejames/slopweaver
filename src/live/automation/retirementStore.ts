/**
 * WHICH standing rows this install has retired — `$SLOPWEAVER_HOME/live/recipe/retirements.json`.
 *
 * ## Why retirement is a registry, not a deleted file
 *
 * A standing row is declared by this build (`./standingRows.ts`), so deleting its definition file alone is the
 * defect `automation due` exists to shout about: it prints `DECLARED … ABSENT` first and `register-standing` writes
 * it back. Retirement is the owner deciding a declared row does not belong on THIS install — an employer's automations
 * can be turned off on one machine while the same build on another machine may want them. So
 * the decision is install state beside the team repository registry (`./teamRepositoryStore.ts`), never a change
 * to the generic declaration, and `./declaredStandingRows.ts` subtracts it.
 *
 * ## Each entry carries ORIGIN, not authority
 *
 * An entry names an owner-words anchor and the exact words read there (`./retirement.ts` checks them against the
 * record), the same bar a journalled grant meets: a wrong one is visible, and a missing one refuses.
 *
 * ## Absent is valid; unreadable never reads as absent
 *
 * A fresh home has no file, which retires nothing. A file that will not read, is not JSON, fails the strict schema
 * or names a recipe twice is a typed error: a reader that took a broken file as "nothing retired" would let
 * `register-standing` resurrect every retired row, which is the act this registry exists to refuse.
 */
import { lstatSync, readFileSync, statSync } from "node:fs";

import { z } from "zod";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** One retired standing row, and the word that retired it. */
export interface AutomationRetirement {
  readonly recipeId: string;
  /** An owner-words anchor (`talk:`, `call:`, `talk-call:`, `transcript:`). */
  readonly anchor: string;
  /** The owner's exact words, a substring of the record the anchor reads. */
  readonly words: string;
  /** Why this row does not belong on this install, in a sentence a reader can judge. */
  readonly why: string;
  /** When the retirement was recorded. */
  readonly retiredAtIso: string;
}

/** What a read found: no file at all, or a valid registry (which may itself be empty). */
export type AutomationRetirementRead =
  | { readonly kind: "absent"; readonly retirements: readonly [] }
  | { readonly kind: "present"; readonly retirements: readonly AutomationRetirement[] };

/** The file is there and could not be read. */
export interface RetirementsUnreadableError {
  readonly code: "RETIREMENTS_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The file read, and is not a registry this build accepts. */
export interface RetirementsMalformedError {
  readonly code: "RETIREMENTS_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly issues: readonly string[];
}

/** The registry could not be written. */
export interface RetirementsWriteFailedError {
  readonly code: "RETIREMENTS_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way reading or writing the retirement registry can fail. */
export type AutomationRetirementStoreError =
  RetirementsUnreadableError | RetirementsMalformedError | RetirementsWriteFailedError;

/** Build one {@link AutomationRetirementStoreError}. Tests construct fixtures through these. */
export const AutomationRetirementStoreErrors = {
  malformed: ({ path, issues }: { path: string; issues: readonly string[] }): RetirementsMalformedError => ({
    code: "RETIREMENTS_MALFORMED",
    issues,
    message: `the automation retirement registry at ${path} is malformed: ${issues.join("; ")}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): RetirementsUnreadableError => ({
    cause,
    code: "RETIREMENTS_UNREADABLE",
    message: `cannot read the automation retirement registry at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): RetirementsWriteFailedError => ({
    cause,
    code: "RETIREMENTS_WRITE_FAILED",
    message: `cannot write the automation retirement registry at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

/** A recipe id as the definition store names its files: lower-case words joined by single dashes. */
const RECIPE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A field a reader must be able to go and check: at least one non-whitespace character. */
const filledSchema = z.string().regex(/[^\p{White_Space}]/u, "must carry a non-whitespace character");

const retirementSchema = z.strictObject({
  anchor: filledSchema,
  recipeId: z.string().regex(RECIPE_ID_PATTERN, "a recipe id: lower-case words joined by single dashes"),
  retiredAtIso: z.iso.datetime(),
  why: filledSchema,
  words: filledSchema,
});

const fileSchema = z.strictObject({
  retirements: z.array(retirementSchema),
  schemaVersion: z.literal(1),
});

/** Whether anything, a dangling symlink included, sits at the path itself. */
function pathEntryExists({ path }: { readonly path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The registry's file bytes, `null` for a definite absence, or why it could not be read. */
function readRegistryBytes({ path }: { readonly path: string }): Result<Buffer | null, AutomationRetirementStoreError> {
  try {
    // A FIFO or a device would block or stream forever under readFileSync, so only a regular file is read.
    const entry = statSync(path, { throwIfNoEntry: false });
    if (entry !== undefined && !entry.isFile()) {
      return err(AutomationRetirementStoreErrors.unreadable({ cause: new Error("not a regular file"), path }));
    }
    return ok(readFileSync(path));
  } catch (cause) {
    // A dangling symlink also reads as ENOENT, but its path exists: that is a registry that cannot be read.
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT" && !pathEntryExists({ path })) {
      return ok(null);
    }
    return err(AutomationRetirementStoreErrors.unreadable({ cause, path }));
  }
}

/**
 * Read the retirement registry under one home.
 *
 * Only a definite `ENOENT` is absence; every other read failure, a non-UTF-8 or non-JSON body, a schema failure and
 * a recipe retired twice are each refused.
 *
 * @param home the state home to resolve it under
 * @returns the registry as read, or why it could not be
 */
export function readAutomationRetirements({
  home,
}: {
  readonly home: string;
}): Result<AutomationRetirementRead, AutomationRetirementStoreError> {
  const path = stateHomePaths({ home }).live.recipe.retirementsJson;
  const bytes = readRegistryBytes({ path });
  if (bytes.isErr()) {
    return err(bytes.error);
  }
  if (bytes.value === null) {
    return ok({ kind: "absent", retirements: [] });
  }
  let decoded: unknown;
  try {
    // A fatal decoder refuses bytes that are not UTF-8, where a lossy one would turn them into U+FFFD and pass.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.value);
    decoded = safeJsonParse({ label: "automation retirements", text });
  } catch (cause) {
    return err(AutomationRetirementStoreErrors.malformed({ issues: [errorMessage({ error: cause })], path }));
  }
  const parsed = fileSchema.safeParse(decoded);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    return err(AutomationRetirementStoreErrors.malformed({ issues, path }));
  }
  const retirements = parsed.data.retirements;
  const repeated = retirements.find(
    (entry, index) => retirements.findIndex((other) => other.recipeId === entry.recipeId) !== index,
  );
  if (repeated !== undefined) {
    return err(AutomationRetirementStoreErrors.malformed({ issues: [`${repeated.recipeId} is retired twice`], path }));
  }
  return ok({ kind: "present", retirements });
}

/**
 * The recipe ids a registry retires, as a set a filter can ask.
 *
 * @param retirements the registry as read
 * @returns every retired recipe id
 */
export function retiredRecipeIds({
  retirements,
}: {
  readonly retirements: readonly AutomationRetirement[];
}): ReadonlySet<string> {
  return new Set(retirements.map((retirement) => retirement.recipeId));
}

/**
 * Add one retirement to a registry, purely. A recipe already retired keeps its FIRST entry: the word that retired
 * it is the record, and a second retirement changes nothing.
 *
 * @param current the registry as read
 * @param retirement the entry to add
 * @returns the registry sorted by recipe id, and whether the entry was added
 */
export function addAutomationRetirement({
  current,
  retirement,
}: {
  readonly current: readonly AutomationRetirement[];
  readonly retirement: AutomationRetirement;
}): { readonly retirements: readonly AutomationRetirement[]; readonly added: boolean } {
  if (current.some((entry) => entry.recipeId === retirement.recipeId)) {
    return { added: false, retirements: current };
  }
  const retirements = [...current, retirement].toSorted((left, right) => left.recipeId.localeCompare(right.recipeId));
  return { added: true, retirements };
}

/**
 * Remove one recipe's retirement from a registry, purely.
 *
 * @param current the registry as read
 * @param recipeId the recipe to un-retire
 * @returns the registry without it, and the entry removed, or `null` when it was not retired
 */
export function removeAutomationRetirement({
  current,
  recipeId,
}: {
  readonly current: readonly AutomationRetirement[];
  readonly recipeId: string;
}): { readonly retirements: readonly AutomationRetirement[]; readonly removed: AutomationRetirement | null } {
  const removed = current.find((entry) => entry.recipeId === recipeId);
  if (removed === undefined) {
    return { removed: null, retirements: current };
  }
  return { removed, retirements: current.filter((entry) => entry.recipeId !== recipeId) };
}

/**
 * Replace the registry under one home atomically: stable two-space JSON, keys in a fixed order, one trailing newline.
 *
 * @param home the state home to write it under
 * @param retirements the whole registry
 * @returns nothing on success, or why the write failed
 */
export function writeAutomationRetirements({
  home,
  retirements,
}: {
  readonly home: string;
  readonly retirements: readonly AutomationRetirement[];
}): Result<void, AutomationRetirementStoreError> {
  const path = stateHomePaths({ home }).live.recipe.retirementsJson;
  const value = {
    schemaVersion: 1,
    retirements: retirements.map((entry) => ({
      recipeId: entry.recipeId,
      anchor: entry.anchor,
      words: entry.words,
      why: entry.why,
      retiredAtIso: entry.retiredAtIso,
    })),
  };
  try {
    writeFileAtomic({ contents: `${safeJsonStringify({ label: "automation retirements", space: 2, value })}\n`, path });
  } catch (cause) {
    return err(AutomationRetirementStoreErrors.writeFailed({ cause, path }));
  }
  return ok(undefined);
}
