/**
 * Reading the recipe definitions out of `$SLOPWEAVER_HOME/live/recipe/definitions` — the effectful shell
 * around `./definition.ts`'s pure parse.
 *
 * Two properties are the point of this module rather than incidental to it:
 *
 * - **An absent directory is an empty roster, never a failure.** A fresh installation has registered no
 *   recurring jobs, and that is the ordinary state rather than a fault. Refusing here would make a
 *   scheduler tick fail on a machine that simply has nothing scheduled yet.
 * - **One bad file does not sink the batch.** A definition that names a retired kind, or that somebody
 *   hand-edited into invalid JSON, is reported as its own problem while every other recipe still runs. The
 *   alternative — one malformed row silencing the whole schedule — is exactly the failure mode a
 *   definition store outside code review has to be built against, because nothing gates what lands here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  parseRecipeDefinition,
  type RecipeDefinition,
  type RecipeDefinitionError,
  RecipeDefinitionErrors,
} from "./definition.js";
import { type RecipeBoard, recipeBoardOf, withFindingState } from "./failureHoldStore.js";
import {
  type AutomationRetirementRead,
  type AutomationRetirementStoreError,
  readAutomationRetirements,
  retiredRecipeIds,
} from "./retirementStore.js";

/**
 * One definition file that could not become a runnable recipe, and the file it came from.
 *
 * @internal — {@link RecipeDefinitionRoster} carries it; nothing outside this file names the shape yet.
 */
export interface RejectedRecipeDefinition {
  readonly file: string;
  readonly error: RecipeDefinitionError;
}

/** Everything one read of the definitions directory found — the runnable rows, and the ones that were not. */
export interface RecipeDefinitionRoster {
  readonly definitions: readonly RecipeDefinition[];
  readonly rejected: readonly RejectedRecipeDefinition[];
  /**
   * The file each entry of {@link RecipeDefinitionRoster.definitions} was read from, index-aligned.
   *
   * Required, because a missing list would read as "no file is misnamed" — the fail-open answer. It exists
   * because a definition's recipeId lives INSIDE its file while the file is named separately, and the two
   * can disagree: a Codex pass put a copy of `resync-atlas-airtable` in `zz-copy.json`, the
   * registrar planned from the copy and wrote over the canonical file, and nothing downstream could tell
   * the two apart because this roster dropped the name of every file that parsed.
   */
  readonly definitionFiles: readonly string[];
  /**
   * Why the directory itself could not be listed, or `null` when it was listed or is simply absent.
   *
   * Absent is a fresh install's empty roster; a directory that is there and will not list is NOT, and a reader
   * judging which rows still exist — the sign-in monitor dropping a retired row's walls — must not read it as empty.
   */
  readonly directoryError: string | null;
}

/** Read one file's text, or `undefined` when it cannot be read at all. */
function readTextOrUndefined({ path }: { readonly path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The `.json` entries of a directory, sorted — none when the directory is not there, and why when it will not list. */
function definitionFileNames({ directory }: { readonly directory: string }): {
  readonly names: readonly string[];
  readonly error: string | null;
} {
  try {
    return {
      error: null,
      names: readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .toSorted(),
    };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { error: null, names: [] };
    }
    const why = cause instanceof Error ? cause.message : "it could not be listed";
    return { error: `the recipe definitions directory ${directory} could not be listed: ${why}`, names: [] };
  }
}

/**
 * Load every recipe definition in one directory, keeping the readable ones and reporting the rest.
 *
 * `board` is REQUIRED so every caller chooses its view. The LIFTED view (a board) reads each failure hold's
 * finding and carries what it says, so a row whose fix landed is due again — the view anything deciding
 * whether to FIRE a row takes. The STORED view (`null`) reads the files as written, where every failure hold
 * stands — the view anything that WRITES a definition back takes, since a derived field must never reach a
 * file. Taking the wrong one errs toward holding.
 *
 * @param directory the definitions directory, from `stateHome.ts`'s `live.recipe.definitionsDir`
 * @param board where a failure hold's finding is read for the lifted view, or `null` for the stored view
 * @returns the runnable definitions and, separately, every file that could not become one
 */
export function loadRecipeDefinitions({
  directory,
  board,
}: {
  readonly directory: string;
  readonly board: RecipeBoard | null;
}): RecipeDefinitionRoster {
  const definitions: RecipeDefinition[] = [];
  const definitionFiles: string[] = [];
  const rejected: RejectedRecipeDefinition[] = [];

  const listing = definitionFileNames({ directory });
  for (const file of listing.names) {
    const text = readTextOrUndefined({ path: join(directory, file) });
    if (text === undefined) {
      rejected.push({
        error: RecipeDefinitionErrors.malformed({ issues: ["(root): the file could not be read"] }),
        file,
      });
      continue;
    }

    let decoded: unknown;
    try {
      decoded = safeJsonParse({ label: `recipe definition ${file}`, text });
    } catch (cause) {
      rejected.push({
        error: RecipeDefinitionErrors.malformed({
          issues: [`(root): ${cause instanceof Error ? cause.message : "the file is not JSON"}`],
        }),
        file,
      });
      continue;
    }

    const parsed = parseRecipeDefinition({ value: decoded });
    if (parsed.isOk()) {
      definitions.push(inView({ board, definition: parsed.value }));
      definitionFiles.push(file);
    } else {
      rejected.push({ error: parsed.error, file });
    }
  }

  return { definitionFiles, definitions, directoryError: listing.error, rejected };
}

/** One parsed row in the caller's view: as stored with no board, its hold's finding read against one otherwise. */
function inView({ board, definition }: { board: RecipeBoard | null; definition: RecipeDefinition }): RecipeDefinition {
  if (board === null) {
    return definition;
  }
  return withFindingState({ board, definition });
}

/**
 * Take every row this install retired out of a roster, as a REJECTED file rather than a runnable row.
 *
 * `automation retire` writes the registry before it removes the file, so a crash or a failed removal between the two
 * leaves a retired row's file standing. Rejected, it can never fire and prints loudly until a repeat `automation
 * retire` removes it. A registry that will not read rejects EVERY row: "nothing retired" would fire them all.
 *
 * @param roster the roster as the directory read
 * @param retirements the retirement registry as read
 * @returns the roster without a retired row among its runnable definitions
 */
export function withoutRetiredRows({
  roster,
  retirements,
}: {
  readonly roster: RecipeDefinitionRoster;
  readonly retirements: Result<AutomationRetirementRead, AutomationRetirementStoreError>;
}): RecipeDefinitionRoster {
  if (retirements.isErr()) {
    const issue = `(root): not fired — ${retirements.error.message}`;
    return {
      ...roster,
      definitionFiles: [],
      definitions: [],
      rejected: [
        ...roster.rejected,
        ...roster.definitionFiles.map((file) => ({
          error: RecipeDefinitionErrors.malformed({ issues: [issue] }),
          file,
        })),
      ],
    };
  }
  const retired = retiredRecipeIds({ retirements: retirements.value.retirements });
  const kept = roster.definitions.flatMap((definition, index) =>
    retired.has(definition.recipeId) ? [] : [{ definition, file: roster.definitionFiles[index]! }],
  );
  const residue = roster.definitions.flatMap((definition, index) => {
    if (!retired.has(definition.recipeId)) {
      return [];
    }
    const issue =
      `(root): ${definition.recipeId} is retired on this install, so this file is never fired — ` +
      `\`slopweaver automation retire ${definition.recipeId}\` again removes it`;
    return [{ error: RecipeDefinitionErrors.malformed({ issues: [issue] }), file: roster.definitionFiles[index]! }];
  });
  return {
    ...roster,
    definitionFiles: kept.map((entry) => entry.file),
    definitions: kept.map((entry) => entry.definition),
    rejected: [...roster.rejected, ...residue],
  };
}

/**
 * The LIFTED view of one home's definitions: every failure hold read against that home's board, and every row the
 * install retired taken out — the view anything deciding whether to FIRE a row takes.
 *
 * @param home the state home whose definitions directory, board and retirement registry are read
 * @returns the runnable definitions and, separately, every file that could not become one
 */
export function loadLiftedRecipeDefinitions({ home }: { readonly home: string }): RecipeDefinitionRoster {
  const directory = stateHomePaths({ home }).live.recipe.definitionsDir;
  return withoutRetiredRows({
    retirements: readAutomationRetirements({ home }),
    roster: loadRecipeDefinitions({ board: recipeBoardOf({ home }), directory }),
  });
}
