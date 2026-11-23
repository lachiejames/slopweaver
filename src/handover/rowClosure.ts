/**
 * Which docs ONE board row's placement depends on — the target and every `blockedBy` slug it reaches, found by
 * exact lookup and never by enumerating the board.
 *
 * `handover row` exists because the whole board is too slow for a caller that wants one row: `handover list
 * --json` scanned 733 docs in 7.8 s and printed 3.2 MB (`time slopweaver handover list --json |
 * wc -c`), while a card reading one row wants it the moment the owner selects a step. A row's section still depends on
 * its dependencies — `composeBoardModels` resolves `blockedBy` against their own evidence — so this walks
 * exactly the docs that can change the answer and no others.
 *
 * Pure: the lookup is an injected seam, so the walk (cycles, a missing dependency, an archived one) is tested
 * without a filesystem.
 */

/** What the walk needs of a doc — its slug and the slugs it waits on. */
interface ClosureDoc {
  readonly slug: string;
  readonly blockedBy: readonly string[];
}

/** One exact lookup's answer: the doc, and whether it came from `archive/` rather than the live board. */
export interface LookedUp<T extends ClosureDoc> {
  readonly doc: T;
  readonly archived: boolean;
}

/** The docs one row is composed from. */
export interface RowClosure<T extends ClosureDoc> {
  /** The target, first, then every LIVE dependency — each composed with its own journal and probes. */
  readonly roots: readonly T[];
  /**
   * Every ARCHIVED dependency — used only to resolve `blockedBy`, never composed, exactly as the whole board
   * treats one (`archivedDependencies`, `./assemble.ts`).
   */
  readonly archived: readonly T[];
}

/**
 * What one slug resolves to: nothing, an archived doc the board does not carry, or the docs its row is
 * composed from.
 */
export type RowClosureRead<T extends ClosureDoc> =
  | { readonly kind: "missing" }
  | { readonly kind: "archived"; readonly doc: T }
  | ({ readonly kind: "closure" } & RowClosure<T>);

/**
 * Walk from one slug through its `blockedBy` edges, each resolved by exact lookup.
 *
 * An archived TARGET is `archived`, never composed: `handover list` scans only the live board and reads
 * `archive/` solely to resolve a dependency, so a row composed from an archived doc would be one no board
 * and no console queue carries. A dependency that resolves nowhere is left out,
 * which is what the whole board does too — `composeBoardModels` then reports it as the missing dependency it
 * is.
 *
 * Archived docs are loaded by the board's own rule: only when a live doc names one. The rule is global on the
 * board — a live doc ANYWHERE naming an archived one loads it — and this walk sees only the closure, so the
 * one shape it cannot reproduce is an archived doc named inside the closure only by another archived doc and
 * outside it by an unrelated live one. Stated residue, not measured.
 *
 * @param slug the row asked for
 * @param lookup resolves one slug to its doc, or `undefined` when no readable doc carries it
 * @returns the closure, or which of the two reasons leaves the slug with no board row
 */
export function rowClosure<T extends ClosureDoc>({
  slug,
  lookup,
}: {
  slug: string;
  lookup: (request: { slug: string }) => LookedUp<T> | undefined;
}): RowClosureRead<T> {
  const target = lookup({ slug });
  if (target === undefined) {
    return { kind: "missing" };
  }
  if (target.archived) {
    return { doc: target.doc, kind: "archived" };
  }
  const roots: T[] = [target.doc];
  const archived: T[] = [];
  const included = new Set<string>([slug]);
  const pending = target.doc.blockedBy.map((dependency) => ({ dependency, namedByLive: true }));
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const { dependency, namedByLive } = next;
    if (included.has(dependency)) {
      continue;
    }
    const found = lookup({ slug: dependency });
    // `archivedDependencies` (`./assemble.ts`) loads an archived doc only when a LIVE doc names it, so one
    // named only by another archived doc is left out here too — until a live doc names it.
    if (found === undefined || (found.archived && !namedByLive)) {
      continue;
    }
    included.add(dependency);
    if (found.archived) {
      archived.push(found.doc);
    } else {
      roots.push(found.doc);
    }
    // Every live doc is a root on the board, so a live doc beyond a loaded archived one still counts.
    pending.push(...found.doc.blockedBy.map((named) => ({ dependency: named, namedByLive: !found.archived })));
  }
  return { archived, kind: "closure", roots };
}
