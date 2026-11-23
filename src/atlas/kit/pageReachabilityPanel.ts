/**
 * The exists-versus-hit panel of an atlas page, in the three forms its denominator can take.
 *
 * `./pageReachability.ts` decides the verdict; this module only prints it, so that a reader who expands nothing
 * still sees whether this atlas can say what it never hit.
 */
import { cell, codeCell, details, linkCell, scrollTable } from "./pageMarkup.js";
import type { AtlasPageModel } from "./pageModel.js";
import { escapeHtml } from "./pageTable.js";

/**
 * The exists-versus-hit panel — the question the owner asked for by name, answered above the fold.
 *
 * Three verdicts, three panels, and the middle one is the correction a Codex diff review forced:
 * rendering `partial` down the numeric path, so an atlas that could measure one
 * kind and nothing else printed "0 declared and never reached" — a zero reading as coverage over kinds
 * nothing had ever declared, which is the exact failure this whole projection exists to prevent, arrived at
 * from inside.
 *
 * @returns the panel's HTML
 */
export function reachabilityPanel({ model }: { model: AtlasPageModel }): string {
  const reach = model.reachability;
  if (reach.denominator === "absent") {
    return absentPanel({ model });
  }
  const rows = reach.neverHit.map(
    (row) =>
      `<tr>${cell({ value: row.kind })}${codeCell({ value: row.providerId })}${codeCell({ value: row.endpoint })}` +
      `${cell({ value: row.surface })}${linkCell({ href: row.deepLink })}</tr>`,
  );
  const shown = reach.neverHit.length;
  const truncated =
    shown < reach.neverHitCount
      ? `<p class="muted">Showing ${String(shown)} of ${String(reach.neverHitCount)} — raise <code>--never-hit-cap</code> for the rest.</p>`
      : "";
  const table = scrollTable({ head: ["kind", "provider id", "endpoint", "declared by", "link"], rows });
  const disclosure = details({
    body: `${truncated}${table}`,
    open: reach.neverHitCount > 0,
    summary: `the ${String(reach.neverHitCount)} it can name`,
  });
  if (reach.denominator === "partial") {
    return partialPanel({ disclosure, model });
  }
  return (
    '<section class="panel"><h2>What exists but was never hit</h2>' +
    `<p class="verdict">${String(reach.neverHitCount)} declared and never reached · ` +
    `${String(reach.corroboratedCount)} declared and reached · ` +
    `${String(reach.undeclaredFindCount)} reached but never declared.</p>` +
    `${disclosure}</section>`
  );
}

/** The panel for an atlas nothing declares the surface of: a refusal to count, and why. */
function absentPanel({ model }: { model: AtlasPageModel }): string {
  const reach = model.reachability;
  return (
    '<section class="panel bad-panel"><h2>What exists but was never hit</h2>' +
    '<p class="verdict">UNKNOWN — and that is not the same as none.</p>' +
    `<p>${escapeHtml({ value: reach.unknownBecause! })}.</p>` +
    `<p class="muted">Everything else on this page is measured against what this atlas declares, never ` +
    `against what ${escapeHtml({ value: model.platform })} has. It cannot be read as a coverage figure.</p>` +
    `<p class="muted">${String(reach.undeclaredFindCount)} entities were found by visiting. None of them ` +
    `is evidence that nothing else exists.</p></section>`
  );
}

/**
 * The panel for an atlas that can measure some kinds and not others.
 *
 * The count leads with the SCOPE it covers rather than standing alone, and the kinds outside that scope are
 * named in the same breath — because the number is true of them in no sense at all, zero included.
 */
function partialPanel({ disclosure, model }: { disclosure: string; model: AtlasPageModel }): string {
  const reach = model.reachability;
  const named = reach.undeterminedKinds
    .slice(0, 12)
    .map((kind) => escapeHtml({ value: kind }))
    .join(", ");
  const more = reach.undeterminedKinds.length > 12 ? ` and ${String(reach.undeterminedKinds.length - 12)} more` : "";
  return (
    '<section class="panel bad-panel"><h2>What exists but was never hit</h2>' +
    `<p class="verdict">PARTLY UNKNOWN — this atlas can answer for some of what it holds and not for ` +
    `${String(reach.undeterminedKinds.length)} of its kinds.</p>` +
    `<p>Where it CAN answer: ${String(reach.neverHitCount)} declared and never reached, ` +
    `${String(reach.corroboratedCount)} declared and reached. That figure covers those kinds and no others ` +
    `— including when it is zero.</p>` +
    `<p class="muted">Nothing declares what exists for ${named}${more}. ` +
    `${String(reach.undeclaredFindCount)} entities were found by visiting alone; none of them is evidence ` +
    "that nothing else exists.</p>" +
    `${disclosure}</section>`
  );
}
