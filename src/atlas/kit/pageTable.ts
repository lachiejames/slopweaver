/**
 * A platform's own table on its atlas page — the one place the page prints a platform's vocabulary.
 *
 * The kit's kind sections are generic by construction: an entity's provider id, its surfaces, when it was
 * seen. Some questions an atlas exists to answer need columns only the platform can fill — "every Make
 * scenario: what it does and who made it" is one. A read adapter projects its stored details into an
 * {@link AtlasPageDetailTable} (plain strings, already worded); the kit caps its rows the way it caps a
 * kind's, escapes every cell and draws it collapsed. Nothing here parses a detail, so the kit still depends on
 * no atlas.
 */

/** One platform-authored table, every cell already a display string. */
export interface AtlasPageDetailTable {
  /** Stable within the page, so a test or a reader can name it. */
  readonly id: string;
  readonly title: string;
  /** One sentence printed above the table — what the columns can and cannot claim. */
  readonly note: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** One table as the page carries it: rows capped, with the whole count kept beside them. */
export interface AtlasPageDetailTableView extends AtlasPageDetailTable {
  readonly rowCount: number;
}

/**
 * HTML-escape one value. Every string on an atlas page is provider-authored, so nothing reaches it raw.
 *
 * @param value the text to print
 * @returns the text with every HTML-significant character replaced by its entity
 */
export function escapeHtml({ value }: { value: string }): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Cap every table's rows for the page model, keeping the true count.
 *
 * @param tables what the read adapter projected; absent for every atlas that draws none
 * @param rowCap how many rows each table carries, the same bound a kind's entity rows take
 * @returns each table with its rows capped
 */
export function pageDetailTables({
  tables,
  rowCap,
}: {
  tables: readonly AtlasPageDetailTable[] | undefined;
  rowCap: number;
}): readonly AtlasPageDetailTableView[] {
  if (tables === undefined) {
    return [];
  }
  return tables.map((table) => ({ ...table, rowCount: table.rows.length, rows: table.rows.slice(0, rowCap) }));
}

/** One table, collapsed, its note and any capping said above the rows. */
function detailTableSection({ table }: { table: AtlasPageDetailTableView }): string {
  const header = table.columns.map((label) => `<th>${escapeHtml({ value: label })}</th>`).join("");
  const rows = table.rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml({ value })}</td>`).join("")}</tr>`);
  const capped =
    table.rows.length < table.rowCount
      ? `<p class="muted">Showing ${String(table.rows.length)} of ${String(table.rowCount)}; the atlas holds them all.</p>`
      : "";
  const empty = table.rowCount === 0 ? '<p class="muted">No rows: the atlas holds none.</p>' : "";
  return (
    `<details><summary>${escapeHtml({ value: `${table.title} (${String(table.rowCount)})` })}</summary>` +
    `<p>${escapeHtml({ value: table.note })}</p>${capped}${empty}` +
    `<div class="scroll"><table><thead><tr>${header}</tr></thead><tbody>${rows.join("")}</tbody></table></div></details>`
  );
}

/**
 * Every platform table, one collapsed block each, inside one section — nothing when there are none.
 *
 * @param tables the capped tables the page model carries
 * @returns the section's HTML, or the empty string
 */
export function detailTablesSection({ tables }: { tables: readonly AtlasPageDetailTableView[] }): string {
  if (tables.length === 0) {
    return "";
  }
  return `<section class="panel"><h2>From the platform</h2>${tables.map((table) => detailTableSection({ table })).join("")}</section>`;
}
