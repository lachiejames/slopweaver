/**
 * What `automation repoint` writes over one own-repository row the store holds as REPOSITORY DRIFT
 * (`./standingRowRepositoryDrift.ts`): the same row, its one `--repo` value moved to the declared repository, and
 * nothing else changed.
 *
 * **Why a correction and never a removal.** A drifted row is somebody's edit, and the usual edit is `enabled: false`.
 * Removing the file would have `register-standing` write the DECLARED row back, `enabled: true` with it, turning on an
 * automation the install had off. So the one field the drift is about moves, and every other key — `enabled`, a hold,
 * the cadence, every other flag — is carried over as JSON, in the file's own key order. Formatting is not: the file is
 * written compact, as the store's hold writer writes it (`./failureHoldStore.ts`).
 *
 * **Only what the drift report names.** The row must be a declared own-repository row, stand in exactly one file named
 * `<recipeId>.json`, be reported as drift, and name exactly one `--repo`: rewriting one of two would leave the other
 * deciding the row. A row the store holds in an earlier build's shape is `SUPERSEDED`, never drift, and is
 * `register-standing`'s to bring forward.
 *
 * Pure: the declaration, the roster and the file's text in, the bytes to write out.
 */
import { err, ok, type Result } from "#lib/result.js";
import { isRecord } from "../../lib/parsers.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { parseRecipeDefinition, type RecipeDefinition } from "./definition.js";
import { repositoryArgvOccurrences } from "./repositoryArgv.js";
import type { StandingRow } from "./standingRow.js";
import { standingRowRepositoryDrifts } from "./standingRowRepositoryDrift.js";
import { sameStoredRow } from "./standingRowSupersession.js";

/** The recipe is not one of this install's declared own-repository rows. */
interface RepointNotOwnRowError {
  readonly code: "NOT_OWN_ROW";
  readonly message: string;
  readonly recipeId: string;
}

/** The store holds no row with this id. */
interface RepointRowAbsentError {
  readonly code: "ROW_ABSENT";
  readonly message: string;
  readonly recipeId: string;
}

/** The id stands in more than one file, or under another file's name. */
interface RepointFilesAmbiguousError {
  readonly code: "FILES_AMBIGUOUS";
  readonly message: string;
  readonly recipeId: string;
  readonly files: readonly string[];
}

/** The row is on the declared repository already, or in an earlier build's shape. */
interface RepointNotDriftedError {
  readonly code: "NOT_DRIFTED";
  readonly message: string;
  readonly recipeId: string;
}

/** The row's argv names no `--repo`, or more than one. */
interface RepointRepoFlagUnclearError {
  readonly code: "REPO_FLAG_UNCLEAR";
  readonly message: string;
  readonly recipeId: string;
  readonly count: number;
}

/** The file's text is not the row the roster read. */
interface RepointFileChangedError {
  readonly code: "FILE_CHANGED";
  readonly message: string;
  readonly recipeId: string;
}

/** Every reason a repoint is refused. */
export type RepointError =
  | RepointNotOwnRowError
  | RepointRowAbsentError
  | RepointFilesAmbiguousError
  | RepointNotDriftedError
  | RepointRepoFlagUnclearError
  | RepointFileChangedError;

/** The one factory for every {@link RepointError}. */
const RepointErrors = {
  fileChanged: ({ recipeId }: { recipeId: string }): RepointFileChangedError => ({
    code: "FILE_CHANGED",
    message: `${recipeId}.json no longer parses as the row the store read — nothing changed; run it again`,
    recipeId,
  }),
  filesAmbiguous: ({
    recipeId,
    files,
  }: {
    recipeId: string;
    files: readonly string[];
  }): RepointFilesAmbiguousError => ({
    code: "FILES_AMBIGUOUS",
    files,
    message: `${recipeId} stands in ${files.join(", ")}, not in ${recipeId}.json alone — remove every other copy first`,
    recipeId,
  }),
  notDrifted: ({ recipeId }: { recipeId: string }): RepointNotDriftedError => ({
    code: "NOT_DRIFTED",
    message:
      `${recipeId} is not REPOSITORY DRIFT: it is on the declared repository, or in an earlier build's shape, ` +
      "which `slopweaver automation register-standing` brings forward",
    recipeId,
  }),
  notOwnRow: ({ recipeId }: { recipeId: string }): RepointNotOwnRowError => ({
    code: "NOT_OWN_ROW",
    message:
      `${recipeId} is not an own-repository row this install declares — only bump-drive-slopweaver and ` +
      "bump-fix-slopweaver are repointed, and only while the checkout resolves and neither is retired",
    recipeId,
  }),
  repoFlagUnclear: ({ recipeId, count }: { recipeId: string; count: number }): RepointRepoFlagUnclearError => ({
    code: "REPO_FLAG_UNCLEAR",
    count,
    message: `${recipeId}'s argv names ${String(count)} \`--repo\` flags, not one, so no single value is the row's to move`,
    recipeId,
  }),
  rowAbsent: ({ recipeId }: { recipeId: string }): RepointRowAbsentError => ({
    code: "ROW_ABSENT",
    message: `the store holds no ${recipeId} row — \`slopweaver automation register-standing\` writes the declared one`,
    recipeId,
  }),
} as const;

/** One repoint, ready to write. */
export interface RepointPlan {
  readonly recipeId: string;
  readonly file: string;
  readonly beforeRepository: string;
  readonly afterRepository: string;
  /** The whole file to write. */
  readonly contents: string;
}

/** The file's JSON object, only when it parses as the very row the roster read. */
function rawRowOf({
  rawText,
  stored,
}: {
  readonly rawText: string;
  readonly stored: RecipeDefinition;
}): Record<string, unknown> | undefined {
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `${stored.recipeId}.json`, text: rawText });
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const parsed = parseRecipeDefinition({ value: decoded });
  return parsed.isOk() && sameStoredRow({ declared: stored, stored: parsed.value }) ? decoded : undefined;
}

/** The argv with the one occurrence's value moved, its spelling kept. */
function movedArgv({
  argv,
  index,
  spelling,
  repository,
}: {
  readonly argv: readonly unknown[];
  readonly index: number;
  readonly spelling: "inline" | "spaced";
  readonly repository: string;
}): readonly unknown[] {
  const value = spelling === "inline" ? `--repo=${repository}` : repository;
  return argv.map((token, at) => (at === index ? value : token));
}

/**
 * Plan the repoint of one drifted own-repository row.
 *
 * @param recipeId the row to repoint
 * @param declared the install's declared own-repository rows, retired ones already subtracted
 * @param definitions every row the store parsed
 * @param definitionFiles the file each entry of `definitions` was read from, index-aligned
 * @param rawText the canonical file's whole text, read under the same lock as the roster
 * @returns the bytes to write and the move they make, or why the row is not one to repoint
 */
export function planRepoint({
  recipeId,
  declared,
  definitions,
  definitionFiles,
  rawText,
}: {
  readonly recipeId: string;
  readonly declared: readonly StandingRow[];
  readonly definitions: readonly RecipeDefinition[];
  readonly definitionFiles: readonly string[];
  readonly rawText: string;
}): Result<RepointPlan, RepointError> {
  const row = declared.find((candidate) => candidate.definition.recipeId === recipeId);
  if (row === undefined) {
    return err(RepointErrors.notOwnRow({ recipeId }));
  }
  const copies = definitions.flatMap((definition, at) =>
    definition.recipeId === recipeId ? [{ definition, file: definitionFiles[at]! }] : [],
  );
  const file = `${recipeId}.json`;
  const [only] = copies;
  if (only === undefined) {
    return err(RepointErrors.rowAbsent({ recipeId }));
  }
  if (copies.length > 1 || only.file !== file) {
    return err(RepointErrors.filesAmbiguous({ files: copies.map((copy) => copy.file), recipeId }));
  }
  const [drift] = standingRowRepositoryDrifts({ declared: [row], existing: [only.definition] });
  if (drift === undefined) {
    return err(RepointErrors.notDrifted({ recipeId }));
  }
  const raw = rawRowOf({ rawText, stored: only.definition });
  if (raw === undefined || !isRecord(raw["params"]) || !Array.isArray(raw["params"]["argv"])) {
    return err(RepointErrors.fileChanged({ recipeId }));
  }
  const argv = raw["params"]["argv"] as readonly unknown[];
  const occurrences = repositoryArgvOccurrences({ argv });
  const [occurrence] = occurrences;
  if (occurrence === undefined || occurrences.length > 1) {
    return err(RepointErrors.repoFlagUnclear({ count: occurrences.length, recipeId }));
  }
  const afterRepository = drift.declaredRepository;
  const moved = movedArgv({
    argv,
    index: occurrence.index,
    repository: afterRepository,
    spelling: occurrence.spelling,
  });
  const params = { ...raw["params"], argv: moved };
  const contents = `${safeJsonStringify({ label: file, value: { ...raw, params } })}\n`;
  return ok({ afterRepository, beforeRepository: occurrence.repository, contents, file, recipeId });
}

/**
 * The line a repoint prints, done or previewed.
 *
 * @param plan the repoint
 * @param dryRun whether nothing was written
 * @returns the line to print
 */
export function repointLine({ plan, dryRun }: { readonly plan: RepointPlan; readonly dryRun: boolean }): string {
  const head = dryRun ? "WOULD REPOINT" : "REPOINTED";
  return (
    `automation repoint · ${head} ${plan.recipeId} · \`${plan.beforeRepository}\` → \`${plan.afterRepository}\` ` +
    `in ${plan.file}, every other field kept`
  );
}
