/**
 * The ONE board row a slug names — the file at the slug's own path first, live then archived, and only when no such
 * file reads, the one doc on the board or in its archive that DECLARES that slug, whatever its file is called.
 *
 * Two verbs resolve a row this way and must agree: `handover quote --add-steer` writes the owner's words onto it, and
 * `supervisor intake-mark` carries an `answered` turn onto the row its witness routes to, naming that quote command
 * when it cannot. With the exact-path lookup alone, a row filed as `an-alias.md` that
 * declares `slug: the-routed-ask` was routed to by nothing, so a mark naming it was written as answered while the
 * row never saw the owner's words. One resolver means the command a refusal names reaches the very row it tried.
 *
 * The scan runs only on an exact miss, so a board that will not list never stands between a caller and a row whose
 * file is named for its slug.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { HandoverDoc } from "./doc.js";
import { lookupDocBySlug, scanBoard } from "./store.js";

/**
 * No doc reads at the slug's own path, and none on the board or in its archive declares it.
 *
 * @internal — a member of {@link RowBySlugError}; callers branch on its `code`.
 */
export interface NoRowError {
  readonly code: "NO_ROW";
  readonly message: string;
  readonly slug: string;
}

/**
 * No file at the slug's own path, and two or more docs declare the slug — so it names no ONE row.
 *
 * @internal — a member of {@link RowBySlugError}; callers branch on its `code`.
 */
export interface SlugDeclaredTwiceError {
  readonly code: "SLUG_DECLARED_TWICE";
  readonly message: string;
  readonly slug: string;
  readonly paths: readonly string[];
}

/**
 * No file at the slug's own path, and the board or its archive would not list, so the scan could not decide.
 *
 * @internal — a member of {@link RowBySlugError}; callers branch on its `code`.
 */
export interface BoardUnlistableError {
  readonly code: "BOARD_UNLISTABLE";
  readonly message: string;
  readonly slug: string;
}

/** Why a slug resolved to no one row. */
export type RowBySlugError = NoRowError | SlugDeclaredTwiceError | BoardUnlistableError;

/** Factories for {@link RowBySlugError}. */
export const RowBySlugErrors = {
  boardUnlistable: ({ slug, cause }: { slug: string; cause: string }): BoardUnlistableError => ({
    code: "BOARD_UNLISTABLE",
    message: `no file reads at ${slug}'s own path, and the board would not list to find a row declaring it — ${cause}`,
    slug,
  }),
  noRow: ({ slug }: { slug: string }): NoRowError => ({
    code: "NO_ROW",
    message: `"${slug}" names no one row on the board`,
    slug,
  }),
  slugDeclaredTwice: ({ slug, paths }: { slug: string; paths: readonly string[] }): SlugDeclaredTwiceError => ({
    code: "SLUG_DECLARED_TWICE",
    message: `"${slug}" names no one row on the board — ${String(paths.length)} files declare it: ${paths.join(", ")}`,
    paths,
    slug,
  }),
} as const;

/**
 * Resolve a slug to its one board row: the file at its own path, live then archived, else the single doc declaring it.
 *
 * @param handoverDir the top-level handovers directory; its `archive/` is read too
 * @param slug the row named
 * @returns the row, or why the slug names no one row
 */
export function rowBySlug({
  handoverDir,
  slug,
}: {
  handoverDir: string;
  slug: string;
}): Result<HandoverDoc, RowBySlugError> {
  const exact = lookupDocBySlug({ handoverDir, slug });
  if (exact !== undefined) {
    return ok(exact);
  }
  const declaring: HandoverDoc[] = [];
  for (const dir of [handoverDir, join(handoverDir, "archive")]) {
    const scan = scanBoard({ handoverDir: dir });
    if (scan.isErr()) {
      return err(RowBySlugErrors.boardUnlistable({ cause: scan.error.message, slug }));
    }
    declaring.push(...scan.value.docs.filter((doc) => doc.slug === slug));
  }
  if (declaring.length === 0) {
    return err(RowBySlugErrors.noRow({ slug }));
  }
  if (declaring.length > 1) {
    return err(RowBySlugErrors.slugDeclaredTwice({ paths: declaring.map((doc) => doc.path), slug }));
  }
  return ok(declaring[0]!);
}
