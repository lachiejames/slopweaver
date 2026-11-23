/**
 * Where a stored row's argv names its `--repo`, spelled `--repo <v>` or `--repo=<v>` — the one reader both the drift
 * report (`./standingRowRepositoryDrift.ts`) and the repoint (`./standingRowRepositoryRepoint.ts`) ask, so what a row
 * "names" is decided once.
 *
 * Pure: an argv in, its occurrences out.
 */

/** One `--repo` an argv carries, and where its value sits. */
export interface RepositoryArgvOccurrence {
  /** The index of the token holding the value: the one after `--repo`, or the `--repo=` token itself. */
  readonly index: number;
  readonly repository: string;
  readonly spelling: "inline" | "spaced";
}

/** The prefix an inline `--repo` carries. */
const INLINE_PREFIX = "--repo=";

/**
 * Every `--repo` an argv names, in argv order. A non-array, or a `--repo` with no string after it, names nothing.
 *
 * @param argv a stored row's `params.argv`, as parsed
 * @returns each occurrence, empty when the argv names no repository
 */
export function repositoryArgvOccurrences({ argv }: { readonly argv: unknown }): readonly RepositoryArgvOccurrence[] {
  if (!Array.isArray(argv)) {
    return [];
  }
  const tokens = argv as readonly unknown[];
  return tokens.flatMap((token, at): readonly RepositoryArgvOccurrence[] => {
    if (token === "--repo") {
      const value = tokens[at + 1];
      return typeof value === "string" ? [{ index: at + 1, repository: value, spelling: "spaced" }] : [];
    }
    if (typeof token === "string" && token.startsWith(INLINE_PREFIX)) {
      return [{ index: at, repository: token.slice(INLINE_PREFIX.length), spelling: "inline" }];
    }
    return [];
  });
}

/**
 * The repository a row names for the drift report: its first spaced `--repo`, else its first inline one.
 *
 * @param argv a stored row's `params.argv`, as parsed
 * @returns the slug, or `undefined` when the argv names none
 */
export function namedRepository({ argv }: { readonly argv: unknown }): string | undefined {
  const occurrences = repositoryArgvOccurrences({ argv });
  const spaced = occurrences.find((occurrence) => occurrence.spelling === "spaced");
  if (spaced !== undefined) {
    return spaced.repository;
  }
  return occurrences.find((occurrence) => occurrence.spelling === "inline")?.repository;
}
