/**
 * The `schema-drift` gaps a child fan-out opens for rows whose field set the published document does not
 * declare, split out of `syncChildren.ts` so that file stays under the file-size cap.
 */
import type { VantaChildDto, VantaChildFamily, VantaChildSurface } from "./childSurface.js";
import { openVantaGap, type VantaGapRecheck } from "./gaps.js";
import type { VantaGap, VantaKindFile } from "./model.js";

/** One row of one child surface, kept beside the parent that answered it. */
export type ChildRow = { parentId: string; dto: VantaChildDto };

/** Where every undeclared-shape gap of one surface is scoped, so a complete walk can find and close them. */
function shapeScopePrefix({ surface }: { surface: VantaChildSurface }): string {
  return `${surface.surface}:undeclared-shape:`;
}

/**
 * One `schema-drift` gap per undeclared FIELD SET this walk read, and a closing recheck for every stored
 * one it did not see again.
 *
 * Per shape rather than per row, because a shape Vanta starts serving arrives on every row of its kind at
 * once and hundreds of identical gaps would bury it. Field NAMES only — never a value — and the parents it
 * was read under, so a reader can go and ask for one. Closing is the half `syncChildFamily` could not do on
 * its own: it passes no rechecks for any other gap, so a gap opened here would otherwise stay open forever
 * after the shape stopped arriving. Only a COMPLETE walk may close one, which `reconcileVantaGaps`'s
 * `runFailed` enforces.
 *
 * @returns the gaps to open and the stored gaps to close
 */
export function undeclaredShapeGaps({
  family,
  surface,
  rows,
  walkedWhole,
  stored,
  at,
}: {
  family: VantaChildFamily;
  surface: VantaChildSurface;
  rows: readonly ChildRow[];
  walkedWhole: boolean;
  stored: VantaKindFile;
  at: string;
}): { gaps: readonly VantaGap[]; rechecks: readonly VantaGapRecheck[] } {
  const shapeOf = surface.undeclaredShape;
  if (shapeOf === undefined) {
    return { gaps: [], rechecks: [] };
  }
  const byShape = new Map<string, { parents: Set<string>; rows: number }>();
  for (const row of rows) {
    const fields = shapeOf(row.dto);
    if (fields === null) {
      continue;
    }
    const shape = fields.join(",");
    const held = byShape.get(shape);
    if (held === undefined) {
      byShape.set(shape, { parents: new Set([row.parentId]), rows: 1 });
    } else {
      held.parents.add(row.parentId);
      held.rows += 1;
    }
  }
  const prefix = shapeScopePrefix({ surface });
  const gaps = [...byShape].map(([shape, held]) =>
    openVantaGap({
      at,
      channel: "manage-api",
      condition: "schema-drift",
      kind: family.kind,
      reason: `${String(held.rows)} ${surface.surface} row(s) under ${[...held.parents].toSorted().join(", ")} match no arm the published document declares; stored as returned. Their fields: ${shape}`,
      scope: `${prefix}${shape}`,
    }),
  );
  const seen = new Set(gaps.map((gap) => gap.scope));
  const rechecks = walkedWhole
    ? stored.gaps
        .filter((gap) => gap.condition === "schema-drift" && gap.scope.startsWith(prefix) && !seen.has(gap.scope))
        .map((gap) => ({ condition: gap.condition, resolved: true, scope: gap.scope }))
    : [];
  return { gaps, rechecks };
}
