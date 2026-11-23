/**
 * Rendering an {@link AtlasPageModel} into ONE self-contained page — the owner's visual representation of
 * an atlas.
 *
 * ## What decides the layout
 *
 * Two rules and nothing else. Progressive disclosure matters because an atlas holds a lot of information
 * and the owner must not face a wall of text, so dropdowns and tables are the default. And the purpose: a
 * problem is noticed far sooner when the owner can see what is in the atlas.
 *
 * So the rule this file obeys is: **every defect is visible without expanding anything, and every detail is
 * behind a `<details>`.** A reader who opens nothing must still be able to see an unfilled surface, a kind
 * holding nothing, a refused exclusion, an open gap, a stale generation, and — the one the owner asked for by name
 * — whether this atlas can even say what it never hit.
 *
 * ## Two forms, one body
 *
 * {@link renderAtlasPageBody} emits the page as `<title>`, `<style>` and content with no document wrapper,
 * which is what a Claude Artifact takes. {@link renderAtlasPageDocument} puts the same bytes inside a
 * minimal HTML document for a local file, with the title and stylesheet in the head where they belong.
 * Both are built from {@link renderAtlasPageParts}, so the two forms cannot drift. Neither fetches anything: no script, no font, no CDN, so the page renders
 * identically offline and inside a sandbox that blocks every external host.
 *
 * ## Nothing here judges
 *
 * The model already applied `kit/contract.ts`'s own predicates. This file counts, orders and escapes. A
 * verdict computed at render time would be a second opinion nobody could reproduce from `--json`.
 */
import type { AtlasPageExclusion } from "./pageExclusion.js";
import { cell, codeCell, details, linkCell, scrollTable } from "./pageMarkup.js";
import type { AtlasPageDefect, AtlasPageEntityRow, AtlasPageKind, AtlasPageModel } from "./pageModel.js";
import { reachabilityPanel } from "./pageReachabilityPanel.js";
import { type AtlasPageEmbeddedShot, screenshotsSection } from "./pageScreenshotSection.js";
import { atlasPageStyle } from "./pageStyle.js";
import type { AtlasPageSurface } from "./pageSurfaces.js";
import { detailTablesSection, escapeHtml } from "./pageTable.js";

/** The platform's own name as a title reads it — `google-admin` becomes `Google Admin`. */
function titleCase({ platform }: { platform: string }): string {
  return platform
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/** Which of the three tones one defect row prints in. An unmeasurable row is never green. */
function defectTone({ defect }: { defect: AtlasPageDefect }): string {
  if (defect.unknown) {
    return "unknown";
  }
  return defect.count === 0 ? "ok" : "bad";
}

/** What one defect row prints where a count would go — a question mark when there was nothing to count. */
function defectCount({ defect }: { defect: AtlasPageDefect }): string {
  return defect.unknown ? "?" : String(defect.count);
}

/** The defect strip — every class checked, with its count, whether or not it fired. */
function defectStrip({ model }: { model: AtlasPageModel }): string {
  const chips = model.defects.map((defect) => {
    const detail =
      defect.detail === "" ? "" : `<span class="chip-detail">${escapeHtml({ value: defect.detail })}</span>`;
    return (
      `<div class="chip ${defectTone({ defect })}"><span class="chip-count">${defectCount({ defect })}</span>` +
      `<span class="chip-label">${escapeHtml({ value: defect.label })}</span>${detail}</div>`
    );
  });
  return `<div class="chips">${chips.join("")}</div>`;
}

/** One surface row. */
function surfaceRow({ surface }: { surface: AtlasPageSurface }): string {
  const flag = surface.declared ? "" : ' class="bad-row"';
  return (
    `<tr${flag}>${codeCell({ value: surface.name })}${cell({ value: surface.acquisition })}` +
    `${cell({ value: surface.role })}${cell({ value: surface.status })}` +
    `${cell({ value: surface.purpose })}${cell({ value: surface.documented ? "documented" : "undocumented" })}` +
    `<td>${String(surface.distinctEndpoints)}</td><td>${String(surface.entityCount)}</td>` +
    `<td>${String(surface.photographedCount)}</td>` +
    `${cell({ value: surfaceNote({ surface }) })}</tr>`
  );
}

/**
 * What the note column says about one surface. A declared surface carries an `unfilledBecause` only when it
 * is unfilled, so one without a reason is filled and gets a dash.
 */
function surfaceNote({ surface }: { surface: AtlasPageSurface }): string {
  if (!surface.declared) {
    return "NOT DECLARED by this descriptor";
  }
  if (surface.unfilledBecause === null) {
    return "—";
  }
  return surface.unfilledBecause;
}

/** The surfaces table. */
function surfacesSection({ model }: { model: AtlasPageModel }): string {
  const rows = model.surfaces.map((surface) => surfaceRow({ surface }));
  const table = scrollTable({
    head: ["surface", "acquired", "role", "status", "purpose", "published", "endpoints", "entities", "shots", "note"],
    rows,
  });
  return details({ body: table, open: false, summary: `Surfaces (${String(model.surfaces.length)})` });
}

/** One entity row inside a kind. */
function kindEntityRow({ row }: { row: AtlasPageEntityRow }): string {
  return (
    `<tr>${codeCell({ value: row.providerId })}${cell({ value: row.scope })}` +
    `${codeCell({ value: row.seenBy.join("  ·  ") })}${cell({ value: observedWords({ row }) })}` +
    `${cell({ value: row.state })}${cell({ value: row.photographed ? "yes" : "no" })}${linkCell({ href: row.deepLink })}</tr>`
  );
}

/** When an entity was first observed. The model holds no instant for an `unobserved` row, so a dash. */
function observedWords({ row }: { row: AtlasPageEntityRow }): string {
  if (row.observedAt === null) {
    return "—";
  }
  return row.observedAt;
}

/** One kind's own collapsed block. */
function kindSection({ kind }: { kind: AtlasPageKind }): string {
  const truncated =
    kind.rows.length < kind.entityCount
      ? `<p class="muted">Showing ${String(kind.rows.length)} of ${String(kind.entityCount)} — raise <code>--max-rows</code> for the rest.</p>`
      : "";
  const blocked =
    kind.permissionBlockedReason === null
      ? ""
      : `<p class="muted">Permission block: ${escapeHtml({ value: kind.permissionBlockedReason })}</p>`;
  const empty =
    kind.darkWithoutReason && kind.entityCount === 0
      ? '<p class="verdict">This kind holds nothing and no permission block explains why.</p>'
      : "";
  const table = scrollTable({
    head: ["provider id", "scope", "seen by", "observed", "state", "shot", "link"],
    rows: kind.rows.map((row) => kindEntityRow({ row })),
  });
  return details({
    body: `${empty}${blocked}${truncated}${table}`,
    open: false,
    summary: `${kind.kind} — ${String(kind.entityCount)} held, ${String(kind.publishedCount)} published, ${String(kind.openGapCount)} open gap(s)`,
  });
}

/** Every kind, one collapsed block each, inside one collapsed section. */
function kindsSection({ model }: { model: AtlasPageModel }): string {
  const body = model.kinds.map((kind) => kindSection({ kind })).join("");
  return details({
    body,
    open: false,
    summary: `Kinds (${String(model.kinds.length)}) and the ${String(model.entityCount)} entities they hold`,
  });
}

/** The open gaps, and the count of the closed ones. */
function gapsSection({ model }: { model: AtlasPageModel }): string {
  const rows = model.openGaps.map(
    (gap) =>
      `<tr>${codeCell({ value: gap.condition })}${codeCell({ value: gap.scope })}${cell({ value: gap.reason })}` +
      `${cell({ value: gap.lastDetectedAt })}</tr>`,
  );
  const table = scrollTable({ head: ["condition", "scope", "reason", "last detected"], rows });
  const truncated =
    model.openGaps.length < model.openGapCount
      ? `<p class="muted">Showing ${String(model.openGaps.length)} of ${String(model.openGapCount)} — the count beside the heading is the whole figure.</p>`
      : "";
  return details({
    body: `<p class="muted">${String(model.closedGapCount)} further gap(s) have been rechecked and closed.</p>${truncated}${table}`,
    open: false,
    summary: `Open gaps (${String(model.openGapCount)}) — questions this atlas could not answer`,
  });
}

/** What one declared exclusion amounts to, in the three words the contract's own predicates already decided. */
function exclusionVerdict({ exclusion }: { exclusion: AtlasPageExclusion }): string {
  if (exclusion.refused) {
    return "REFUSED by the coverage gate";
  }
  if (exclusion.withholdsRecords) {
    return "withholds records";
  }
  return "bounds what the atlas does";
}

/** Everything the atlas declares it does not hold, refused rows first. */
function exclusionsSection({ model }: { model: AtlasPageModel }): string {
  const ordered = [...model.exclusions].toSorted((left, right) => Number(right.refused) - Number(left.refused));
  const rows = ordered.map((exclusion) => {
    const flag = exclusion.refused ? ' class="bad-row"' : "";
    return `<tr${flag}>${codeCell({ value: exclusion.ground })}${cell({ value: exclusionVerdict({ exclusion }) })}${cell({ value: exclusion.because })}</tr>`;
  });
  const refusedCount = model.exclusions.filter((exclusion) => exclusion.refused).length;
  return details({
    body: scrollTable({ head: ["ground", "verdict", "because"], rows }),
    open: false,
    summary: `Declared exclusions (${String(model.exclusions.length)}, ${String(refusedCount)} refused)`,
  });
}

/** The header block — what this atlas is, and when it was last brought current. */
function headerSection({ model, renderedAt }: { model: AtlasPageModel; renderedAt: string }): string {
  const facts: readonly (readonly [string, string])[] = [
    ["last synced", lastSyncedWords({ model })],
    ["freshness window", freshnessWindowWords({ model })],
    ["resync", model.resyncCommand],
    ["bounded live read", liveReadWords({ model })],
    ["write policy", model.writePolicy],
    ["schema version", String(model.schemaVersion)],
    ["entities held", String(model.entityCount)],
    ["page rendered", renderedAt],
  ];
  const rows = facts.map(
    ([label, value]) => `<tr><th scope="row">${escapeHtml({ value: label })}</th>${codeCell({ value })}</tr>`,
  );
  return (
    `<header><h1>${escapeHtml({ value: titleCase({ platform: model.platform }) })} Atlas</h1>` +
    `<p class="lede">${escapeHtml({ value: model.question })}</p>` +
    `<p class="scope"><strong>Visibility ceiling.</strong> ${escapeHtml({ value: model.visibilityScope })}</p>` +
    `<div class="scroll"><table class="facts"><tbody>${rows.join("")}</tbody></table></div></header>`
  );
}

/** When the atlas last published a generation. The model holds no stamp for an atlas never published, so `never`. */
function lastSyncedWords({ model }: { model: AtlasPageModel }): string {
  if (model.generationUpdatedAt === null) {
    return "never";
  }
  return model.generationUpdatedAt;
}

/**
 * The descriptor's own freshness window. The field is optional in the contract, and an atlas declaring none
 * runs on `kit/freshnessWindow.ts`'s four-hour default, which the page names as the default it is.
 */
function freshnessWindowWords({ model }: { model: AtlasPageModel }): string {
  if (model.freshnessWindow === null) {
    return "4h (the default nobody had to choose)";
  }
  return model.freshnessWindow;
}

/**
 * The descriptor's bounded live read. The contract reads an absent one as "this atlas has no such verb", so
 * the page says what that costs a reader.
 */
function liveReadWords({ model }: { model: AtlasPageModel }): string {
  if (model.liveReadCommand === null) {
    return "none — every question costs a full resync";
  }
  return model.liveReadCommand;
}

/** The generation-integrity block, printed only when the generation disagrees with its own manifest. */
function integritySection({ model }: { model: AtlasPageModel }): string {
  if (model.generationDisagreements.length === 0) {
    return "";
  }
  const items = model.generationDisagreements.map((line) => `<li>${escapeHtml({ value: line })}</li>`);
  return `<section class="panel bad-panel"><h2>This generation disagrees with its own manifest</h2><ul>${items.join("")}</ul></section>`;
}

/**
 * Render the page as `<title>`, `<style>` and content — the form a Claude Artifact takes.
 *
 * @param model the projection to render
 * @param embedded the screenshots whose bytes the shell read, in whatever order the budget allowed
 * @param renderedAt when this render happened, taken from the caller so the function stays pure
 * @returns the page body, with no document wrapper
 */
export function renderAtlasPageBody({
  model,
  embedded,
  renderedAt,
}: {
  model: AtlasPageModel;
  embedded: readonly AtlasPageEmbeddedShot[];
  renderedAt: string;
}): string {
  const parts = renderAtlasPageParts({ embedded, model, renderedAt });
  return `${parts.head}${parts.body}`;
}

/**
 * Render the page as its two halves, so both output forms are built from the same bytes.
 *
 * @param model the projection to render
 * @param embedded the screenshots whose bytes the shell read
 * @param renderedAt when this render happened, taken from the caller so the function stays pure
 * @returns the document head content and the document body content
 */
export function renderAtlasPageParts({
  model,
  embedded,
  renderedAt,
}: {
  model: AtlasPageModel;
  embedded: readonly AtlasPageEmbeddedShot[];
  renderedAt: string;
}): { readonly head: string; readonly body: string } {
  const head = `<title>${escapeHtml({ value: titleCase({ platform: model.platform }) })} Atlas</title>${atlasPageStyle()}`;
  const body = [
    "<main>",
    headerSection({ model, renderedAt }),
    defectStrip({ model }),
    integritySection({ model }),
    reachabilityPanel({ model }),
    surfacesSection({ model }),
    detailTablesSection({ tables: model.detailTables }),
    kindsSection({ model }),
    gapsSection({ model }),
    exclusionsSection({ model }),
    screenshotsSection({ embedded, model }),
    `<footer>Rendered from the ${escapeHtml({ value: model.platform })} atlas on this machine by ` +
      `<code>slopweaver atlas ${escapeHtml({ value: model.platform })} render</code>. ` +
      `Nothing here was fetched from ${escapeHtml({ value: model.platform })} at render time; ` +
      `bring the atlas current with <code>${escapeHtml({ value: model.resyncCommand })}</code> and render again.</footer>`,
    "</main>",
  ].join("");
  return { body, head };
}

/**
 * Render the page as one standalone HTML document, for a file somebody opens locally.
 *
 * @param model the projection to render
 * @param embedded the screenshots whose bytes the shell read
 * @param renderedAt when this render happened
 * @returns one standalone document, with the title and stylesheet in the head where they belong
 */
export function renderAtlasPageDocument({
  model,
  embedded,
  renderedAt,
}: {
  model: AtlasPageModel;
  embedded: readonly AtlasPageEmbeddedShot[];
  renderedAt: string;
}): string {
  const parts = renderAtlasPageParts({ embedded, model, renderedAt });
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `${parts.head}</head><body>${parts.body}</body></html>`
  );
}
