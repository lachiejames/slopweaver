/**
 * WHICH team repositories this install declares standing rows for — `$SLOPWEAVER_HOME/live/recipe/team-repositories.json`.
 *
 * ## Why a registry, rather than inferring the set from the definition files
 *
 * The file is the declaration of intent. Once a repository is registered, deleting one of its definition files
 * stays loud in `automation due`, because the declaration still names it. Deriving the set from the definitions
 * would recreate the failure `./standingRows.ts` exists to close: deleting a repository's last definition would
 * also delete the evidence that it should exist.
 *
 * ## Why it lives outside the repository
 *
 * Which team repository an install works in is one installation's fact — `AGENTS.md`'s "tools in the codebase,
 * state outside it". Nothing in this tree names one.
 *
 * ## Schema 2 is repository-only; schema 1 still reads
 *
 * Schema 1 also carried an `author` and an optional `renovateAuthor`, which existed only to compile vulnerability-fix
 * top-up rows; those rows are now an installation's own definitions. A schema-1 file is read as a compatibility
 * input and projected to its repositories, its actors validated exactly as before so a broken file is still
 * refused, and the next write lands schema 2.
 *
 * ## Absent is valid; unreadable never reads as absent
 *
 * A fresh home has no file, which declares no team repository. A file that will not read, is not JSON, fails the
 * strict schema, names a repository twice or names two repositories with the same name is a typed error. A
 * reader that took a broken file as "none registered" would stop reporting every registered repository's
 * vanished rows, which is the silence this whole mechanism removes.
 */
import { lstatSync, readFileSync, statSync } from "node:fs";

import { z } from "zod";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type TeamRepositoryRegistration, teamRepositoryName } from "./teamStandingRows.js";

/** The registry's wire format, as this build writes it. */
interface TeamRepositoryFile {
  readonly schemaVersion: 2;
  readonly repositories: readonly TeamRepositoryRegistration[];
}

/** What a read found: no file at all, or a valid registry (which may itself be empty). */
export type TeamRepositoryRead =
  | { readonly kind: "absent"; readonly repositories: readonly [] }
  | { readonly kind: "present"; readonly repositories: readonly TeamRepositoryRegistration[] };

/** The file is there and could not be read. */
export interface TeamRepositoriesUnreadableError {
  readonly code: "TEAM_REPOSITORIES_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The file read, and is not a registry this build accepts. */
export interface TeamRepositoriesMalformedError {
  readonly code: "TEAM_REPOSITORIES_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly issues: readonly string[];
}

/** Two repositories share the name every one of their recipe ids is keyed on. */
export interface TeamRepositoryIdCollisionError {
  readonly code: "TEAM_REPOSITORY_ID_COLLISION";
  readonly message: string;
  readonly repositoryName: string;
  readonly repositories: readonly string[];
}

/** The registry could not be written. */
export interface TeamRepositoriesWriteFailedError {
  readonly code: "TEAM_REPOSITORIES_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way reading, extending or writing the registry can fail. */
export type TeamRepositoryStoreError =
  | TeamRepositoriesUnreadableError
  | TeamRepositoriesMalformedError
  | TeamRepositoryIdCollisionError
  | TeamRepositoriesWriteFailedError;

/** Build one {@link TeamRepositoryStoreError}. Tests construct fixtures through these, never a hand-built literal. */
export const TeamRepositoryStoreErrors = {
  idCollision: ({
    repositoryName,
    repositories,
  }: {
    repositoryName: string;
    repositories: readonly string[];
  }): TeamRepositoryIdCollisionError => ({
    code: "TEAM_REPOSITORY_ID_COLLISION",
    message:
      `${repositories.join(" and ")} share the name \`${repositoryName}\`, which keys every one of their recipe ids — ` +
      "only one of them can be registered",
    repositories,
    repositoryName,
  }),
  malformed: ({ path, issues }: { path: string; issues: readonly string[] }): TeamRepositoriesMalformedError => ({
    code: "TEAM_REPOSITORIES_MALFORMED",
    issues,
    message: `the team repository registry at ${path} is malformed: ${issues.join("; ")}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): TeamRepositoriesUnreadableError => ({
    cause,
    code: "TEAM_REPOSITORIES_UNREADABLE",
    message: `cannot read the team repository registry at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): TeamRepositoriesWriteFailedError => ({
    cause,
    code: "TEAM_REPOSITORIES_WRITE_FAILED",
    message: `cannot write the team repository registry at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

/** One `owner/name` pair: two non-empty halves, no whitespace, one `/`. */
const REPOSITORY_PATTERN = /^[^\s/]+\/[^\s/]+$/u;

/** A login or app actor: non-empty and whitespace-free — validated on a schema-1 file only. */
const ACTOR_PATTERN = /^\S+$/u;

const repositorySchema = z.string().regex(REPOSITORY_PATTERN, "one `owner/name` pair with no whitespace");

const registrationSchema = z.strictObject({ repository: repositorySchema });

/** Schema 1's registration: the repository plus top-up actors the reader validates and then drops. */
const schemaOneRegistrationSchema = z.strictObject({
  author: z.string().regex(ACTOR_PATTERN, "a non-empty login with no whitespace"),
  renovateAuthor: z.string().regex(ACTOR_PATTERN, "a non-empty login with no whitespace").optional(),
  repository: repositorySchema,
});

const fileSchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({ repositories: z.array(registrationSchema), schemaVersion: z.literal(2) }),
  z.strictObject({ repositories: z.array(schemaOneRegistrationSchema), schemaVersion: z.literal(1) }),
]);

/** A parsed registration of either schema in canonical form: only the repository, lower-cased. */
function canonical({ parsed }: { parsed: { readonly repository: string } }): TeamRepositoryRegistration {
  return { repository: parsed.repository.toLowerCase() };
}

/**
 * Validate one registration a caller typed, canonicalising its repository — what `register-standing` checks before
 * it touches the filesystem.
 *
 * @param registration the repository as typed
 * @returns the canonical registration, or every reason it was refused
 */
export function parseTeamRepositoryRegistration({
  registration,
}: {
  readonly registration: { readonly repository: string };
}): Result<TeamRepositoryRegistration> {
  const parsed = registrationSchema.safeParse(registration);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `--repo: ${issue.message}`));
  }
  return ok(canonical({ parsed: parsed.data }));
}

/** The first two registrations that share a repository's name, if any do. */
function nameCollision({
  repositories,
}: {
  repositories: readonly TeamRepositoryRegistration[];
}): TeamRepositoryIdCollisionError | null {
  const byName = new Map<string, string>();
  for (const registration of repositories) {
    const name = teamRepositoryName({ repository: registration.repository });
    const earlier = byName.get(name);
    if (earlier !== undefined) {
      return TeamRepositoryStoreErrors.idCollision({
        repositories: [earlier, registration.repository],
        repositoryName: name,
      });
    }
    byName.set(name, registration.repository);
  }
  return null;
}

/** Whether anything, a dangling symlink included, sits at the path itself. */
function pathEntryExists({ path }: { readonly path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the registry under one home.
 *
 * Only a definite `ENOENT` is absence; every other read failure, a non-JSON body, a schema failure, a repository
 * registered twice and two repositories sharing a name are each refused.
 *
 * @param home the state home to resolve it under
 * @returns the registry as read, or why it could not be
 */
export function readTeamRepositories({
  home,
}: {
  readonly home: string;
}): Result<TeamRepositoryRead, TeamRepositoryStoreError> {
  const path = stateHomePaths({ home }).live.recipe.teamRepositoriesJson;
  let bytes: Buffer;
  try {
    // A FIFO or a device would block or stream forever under readFileSync, so only a regular file is read.
    const entry = statSync(path, { throwIfNoEntry: false });
    if (entry !== undefined && !entry.isFile()) {
      return err(TeamRepositoryStoreErrors.unreadable({ cause: new Error("not a regular file"), path }));
    }
    bytes = readFileSync(path);
  } catch (cause) {
    // A dangling symlink also reads as ENOENT, but its path exists: that is a registry that cannot be read.
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT" && !pathEntryExists({ path })) {
      return ok({ kind: "absent", repositories: [] });
    }
    return err(TeamRepositoryStoreErrors.unreadable({ cause, path }));
  }
  let decoded: unknown;
  try {
    // A fatal decoder refuses bytes that are not UTF-8, where a lossy one would turn them into U+FFFD and pass.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    decoded = safeJsonParse({ label: "team repositories", text });
  } catch (cause) {
    return err(TeamRepositoryStoreErrors.malformed({ issues: [errorMessage({ error: cause })], path }));
  }
  const parsed = fileSchema.safeParse(decoded);
  if (!parsed.success) {
    return err(
      TeamRepositoryStoreErrors.malformed({
        issues: parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
        path,
      }),
    );
  }
  const repositories = parsed.data.repositories.map((entry) => canonical({ parsed: entry }));
  const repeated = repositories.find(
    (registration, index) => repositories.findIndex((other) => other.repository === registration.repository) !== index,
  );
  if (repeated !== undefined) {
    return err(TeamRepositoryStoreErrors.malformed({ issues: [`${repeated.repository} is registered twice`], path }));
  }
  const collision = nameCollision({ repositories });
  if (collision !== null) {
    return err(collision);
  }
  return ok({ kind: "present", repositories });
}

/**
 * Add one registration to a registry, purely.
 *
 * A repeat is the list unchanged. A different repository sharing the name is refused because every recipe id would
 * collide.
 *
 * @param current the registry as read
 * @param registration the canonical registration to add
 * @returns the registry sorted by repository, or why the registration was refused
 */
export function addTeamRepository({
  current,
  registration,
}: {
  readonly current: readonly TeamRepositoryRegistration[];
  readonly registration: TeamRepositoryRegistration;
}): Result<readonly TeamRepositoryRegistration[], TeamRepositoryStoreError> {
  if (current.some((entry) => entry.repository === registration.repository)) {
    return ok(current);
  }
  const next = [...current, registration].toSorted((left, right) => left.repository.localeCompare(right.repository));
  const collision = nameCollision({ repositories: next });
  if (collision !== null) {
    return err(collision);
  }
  return ok(next);
}

/**
 * Replace the registry under one home atomically: stable two-space JSON, keys in a fixed order, one trailing newline.
 *
 * @param home the state home to write it under
 * @param repositories the whole registry
 * @returns nothing on success, or why the write failed
 */
export function writeTeamRepositories({
  home,
  repositories,
}: {
  readonly home: string;
  readonly repositories: readonly TeamRepositoryRegistration[];
}): Result<void, TeamRepositoryStoreError> {
  const path = stateHomePaths({ home }).live.recipe.teamRepositoriesJson;
  const value: TeamRepositoryFile = {
    schemaVersion: 2,
    repositories: repositories.map((registration) => ({ repository: registration.repository })),
  };
  try {
    writeFileAtomic({ contents: `${safeJsonStringify({ label: "team repositories", space: 2, value })}\n`, path });
  } catch (cause) {
    return err(TeamRepositoryStoreErrors.writeFailed({ cause, path }));
  }
  return ok(undefined);
}
