/**
 * The builder a publisher calls to put one surface's coverage cell into a kind file it is about to hand to
 * `publishAtlas`.
 *
 * Its own module rather than a helper inside `./store.ts` because it is a pure builder over a platform's own
 * file shape, not part of the generation protocol: it reads no generation, grades nothing, and decides no
 * write order, digest or install. `./store.ts` keeps the read half and its contract, `./publish.ts` the write
 * half, and `./generationSwap.ts` the rename install.
 */

/**
 * One kind's file with a fresh entity list, a replaced coverage cell and this run's stamp — every other
 * surface's cell left exactly as it was.
 *
 * Every walking atlas writes this shape twice per publish, once for its page kind and once for the browser
 * channel of its method kind; only `../trelica/browserSurface.ts` calls this yet. Doing it here makes the ONE thing
 * that must not be got wrong mechanical: the filter is on `surface`, so a publisher replaces its own cell
 * and never another channel's. Filtering on the wrong field is how one channel's publish silently deletes
 * the other's coverage, which is exactly what a two-channel atlas cannot survive.
 *
 * @param stored the file as the store already holds it
 * @param entities the merged entity list this run publishes
 * @param cell the coverage cell this run produced, which replaces the one for its own surface
 * @param gaps the reconciled gap list, or omitted to keep the stored one
 * @param at this run's ISO timestamp
 * @returns the file to publish
 */
export function kindFileWithCell<
  TCell extends { readonly surface: string },
  TEntity,
  TGap,
  TFile extends {
    readonly coverage: TCell[];
    readonly entities: TEntity[];
    readonly gaps: TGap[];
    readonly updatedAt: string;
  },
>({
  stored,
  entities,
  cell,
  gaps,
  at,
}: {
  stored: TFile;
  entities: readonly TEntity[];
  cell: TCell;
  gaps?: readonly TGap[];
  at: string;
}): TFile {
  return {
    ...stored,
    coverage: [...stored.coverage.filter((held) => held.surface !== cell.surface), cell],
    entities: [...entities],
    gaps: gaps === undefined ? stored.gaps : [...gaps],
    updatedAt: at,
  };
}
