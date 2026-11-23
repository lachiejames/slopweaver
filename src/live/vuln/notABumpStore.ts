/**
 * WHICH packages a vulnerability-fix top-up never batches, because no bump can fix them — one installation's
 * record, each ruling carrying the anchor it came from.
 *
 * ## Why it exists
 *
 * MEASURED: the security top-up for `acme/acme-admin` ranked worst CVSS first and handed its seat
 * `@fastify/reply-from`, which only a fastify 5 migration clears. The owner's standing ruling was to skip the fastify
 * ones and fill the batch, and the fleet had skipped them by hand several times, but that ruling
 * lived only as a prose knowledge row the planner never read — so the seat parked the whole batch asking the owner
 * again, and the post missed the owner's deliver-by. A ruling the planner reads is the fix; a seat that judges a new hard
 * bump records it here with `vulnerability-fix not-a-bump record`, so the next generation does not plan it again.
 *
 * ## Why it lives outside the repository
 *
 * Which packages of which repository are stuck behind a migration is one installation's fact, and it changes
 * when that repository's dependency tree does, so it resolves from `$SLOPWEAVER_HOME` — `AGENTS.md`'s "tools in
 * the codebase, state outside it". Nothing in this tree names a package.
 *
 * ## The two spellings a ruling may use
 *
 * An exact package name, or a whole npm scope as `@scope/*` — "the fastify ones" are `fastify` and every
 * `@fastify/` package. No other wildcard is read: a pattern language is a second place a ruling could quietly
 * cover more than it was meant to.
 */
import { readFileSync } from "node:fs";

import { z } from "zod";

import { acquireOperationLock } from "../../admit/operationLock.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** One package ruled not fixable by a bump in one repository, and where that ruling came from. */
export interface NotABumpRuling {
  /** `owner/name` — a ruling never reaches past the repository it was made about. */
  readonly repo: string;
  /** An exact package name, or `@scope/*` for every package in one npm scope. */
  readonly package: string;
  /** Why no bump fixes it — what a reader needs to know whether the ruling still holds. */
  readonly why: string;
  /** Where the ruling came from: a knowledge row, a transcript turn, a Queue card. */
  readonly anchor: string;
  readonly recordedIso: string;
}

/** The file could not be read, or is not a ruling document. Absence is not this: an absent file is no rulings. */
export interface NotABumpUnreadableError {
  readonly code: "NOT_A_BUMP_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A ruling could not be written: the lock, the read under it, or the replacement failed. */
export interface NotABumpWriteFailedError {
  readonly code: "NOT_A_BUMP_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Every way reading or recording a ruling can fail. */
export type NotABumpError = NotABumpUnreadableError | NotABumpWriteFailedError;

/**
 * Build one {@link NotABumpError}. Tests construct fixtures through these, never a hand-built literal.
 *
 * @internal
 */
export const NotABumpErrors = {
  unreadable: ({ path, why }: { path: string; why: string }): NotABumpUnreadableError => ({
    code: "NOT_A_BUMP_UNREADABLE",
    message: `cannot read the not-a-bump rulings at ${path}: ${why}`,
    path,
  }),
  writeFailed: ({ path, why }: { path: string; why: string }): NotABumpWriteFailedError => ({
    code: "NOT_A_BUMP_WRITE_FAILED",
    message: `cannot record the not-a-bump ruling at ${path}: ${why}`,
    path,
  }),
} as const;

/** `owner/name`, each half GitHub's own character set. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** A whole npm scope: `@scope/*`, and nothing else carrying a `*`. */
const SCOPE_GLOB = /^@[^/*\s]+\/\*$/;

/**
 * Whether a ruling's package spelling is one this store reads: an exact name with no `*` or whitespace, or a whole scope.
 *
 * @param spelling the `package` field as written
 * @returns true for an exact name or `@scope/*`
 */
export function isNotABumpPackageSpelling({ spelling }: { spelling: string }): boolean {
  return SCOPE_GLOB.test(spelling) || /^[^*\s]+$/.test(spelling);
}

const rulingSchema = z.strictObject({
  anchor: z.string().trim().min(1),
  package: z.string().refine((spelling) => isNotABumpPackageSpelling({ spelling }), {
    message: "an exact package name or `@scope/*`, nothing else",
  }),
  recordedIso: z.iso.datetime({ offset: true }),
  repo: z.string().regex(REPO_PATTERN, "an `owner/name` pair"),
  why: z.string().trim().min(1),
});

const documentSchema = z
  .strictObject({ entries: z.array(rulingSchema) })
  .refine(
    (document) =>
      new Set(document.entries.map((entry) => rulingKey({ ruling: entry }))).size === document.entries.length,
    { message: "a (repo, package) pair is ruled twice" },
  );

/** The one identity a ruling has: its repository and its package spelling. */
function rulingKey({ ruling }: { ruling: Pick<NotABumpRuling, "package" | "repo"> }): string {
  return `${ruling.repo} ${ruling.package}`;
}

/**
 * Whether a package is ruled not a bump in a repository.
 *
 * An exact ruling matches only the whole name, so `fastify` never covers `fastify-plugin`; a scope ruling matches
 * only names inside that scope, so `@fastify/*` covers `@fastify/reply-from` and neither `@fastify` nor
 * `@fastifyx/core`.
 *
 * @param packageName the package as the Dependabot alert names it
 * @param repo `owner/name` the alert is in
 * @param rulings every ruling the store holds
 * @returns true when a ruling for this repository covers the package
 */
export function packageIsNotABump({
  packageName,
  repo,
  rulings,
}: {
  packageName: string;
  repo: string;
  rulings: readonly NotABumpRuling[];
}): boolean {
  return rulings.some((ruling) => {
    if (ruling.repo !== repo) {
      return false;
    }
    if (SCOPE_GLOB.test(ruling.package)) {
      return packageName.startsWith(ruling.package.slice(0, -1));
    }
    return ruling.package === packageName;
  });
}

/**
 * Read every ruling an installation holds.
 *
 * An absent file is no rulings — nobody has recorded one yet — and that is the ONE absence read as empty. A file
 * that will not read, is not JSON, or is not a ruling document is refused: a planner that read a broken file as
 * empty would hand a seat the very alert a ruling exists to keep out of the batch.
 *
 * @param home the state home to resolve it under
 * @param readFile the file read, injectable so a unit test can stand in a failing read
 * @returns the rulings, or why the file could not be read
 */
export function readNotABumpRulings({
  home,
  readFile = (path) => readFileSync(path, "utf8"),
}: {
  home: string;
  readFile?: (path: string) => string;
}): Result<readonly NotABumpRuling[], NotABumpUnreadableError> {
  const path = stateHomePaths({ home }).live.vuln.notABumpJson;
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    if (isFileMissing({ error })) {
      return ok([]);
    }
    return err(NotABumpErrors.unreadable({ path, why: describe({ error }) }));
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "not-a-bump rulings", text });
  } catch (error) {
    return err(NotABumpErrors.unreadable({ path, why: describe({ error }) }));
  }
  const parsed = documentSchema.safeParse(decoded);
  if (!parsed.success) {
    return err(NotABumpErrors.unreadable({ path, why: z.prettifyError(parsed.error) }));
  }
  return ok(parsed.data.entries);
}

/**
 * Record one ruling: upserted by `(repo, package)` under the store's lock, the whole file replaced atomically.
 *
 * Recording the same ruling twice changes nothing but its `recordedIso`; a changed `why` or `anchor` replaces the
 * earlier one, because the newer word about the same package is the one that holds.
 *
 * @param ruling the ruling to record, stamped by the caller
 * @param home the state home the file and its lock live under
 * @returns every ruling the file holds after the write, or why it could not be written
 */
export function recordNotABumpRuling({
  home,
  ruling,
}: {
  home: string;
  ruling: NotABumpRuling;
}): Result<readonly NotABumpRuling[], NotABumpError> {
  const path = stateHomePaths({ home }).live.vuln.notABumpJson;
  const checked = rulingSchema.safeParse(ruling);
  if (!checked.success) {
    return err(NotABumpErrors.writeFailed({ path, why: z.prettifyError(checked.error) }));
  }
  const lock = acquireOperationLock({ home, key: `not-a-bump:${path}`, nowIso: ruling.recordedIso });
  if (lock.isErr()) {
    return err(NotABumpErrors.writeFailed({ path, why: `another recorder holds the lock: ${lock.error}` }));
  }
  try {
    return readNotABumpRulings({ home }).andThen((current) => {
      const key = rulingKey({ ruling });
      const entries = [...current.filter((entry) => rulingKey({ ruling: entry }) !== key), checked.data];
      try {
        writeFileAtomic({
          contents: `${safeJsonStringify({ label: "not-a-bump rulings", space: 2, value: { entries } })}\n`,
          dirMode: 0o700,
          fileMode: 0o600,
          path,
        });
      } catch (error) {
        return err(NotABumpErrors.writeFailed({ path, why: describe({ error }) }));
      }
      return ok(entries);
    });
  } finally {
    lock.value.release();
  }
}

/** Whether a thrown read error is the file simply not being there. */
function isFileMissing({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** A thrown value as one line. */
function describe({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}
