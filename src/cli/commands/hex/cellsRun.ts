/**
 * `slopweaver hex cells --project <id>` — the project's draft cells and their SOURCE.
 *
 * The rung between finding a project and reading a number: a cell's SQL says exactly which table, which
 * filter and which window a notebook is asking about, so a reader can tell whether the number it produces
 * is the one the question needs before spending a read on it. `--sql-only` keeps the SQL cells, which are
 * the only ones `hex output` can read a table from.
 *
 * A cell's source is configuration — somebody wrote it — and is not a result set, which is why this verb
 * exists at all where the atlas's own `disposition.ts` withholds `/output`.
 */
import { listCells } from "../../../hex/reads.js";
import type { HexCell } from "../../../hex/responses.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseHexObjectOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_CELLS_USAGE } from "./usage.js";

/**
 * The one-line source summary a listing shows for one cell.
 *
 * @returns its first source line, or a note that it carries none
 */
export function cellSourceHead({ cell }: { cell: HexCell }): string {
  const { codeCell, markdownCell, sqlCell } = cell.contents;
  const source = sourceOf({ codeCell, markdownCell, sqlCell });
  if (source === null) {
    return "(no source)";
  }
  // `String.split` on any string yields at least one element, so the first is never absent — an honest
  // assertion rather than a coalesce that would print an empty line for a cell whose source is one word.
  return source.split("\n")[0]!;
}

/**
 * The source text one cell carries, whichever of the three arms holds it.
 *
 * @param sqlCell the SQL arm, or `null`
 * @param codeCell the code arm, or `null`
 * @param markdownCell the markdown arm, or `null`
 * @returns the source, or `null` when the cell carries none — an input cell, say
 */
function sourceOf({
  sqlCell,
  codeCell,
  markdownCell,
}: {
  sqlCell: { source: string } | null;
  codeCell: { source: string } | null;
  markdownCell: { source: string } | null;
}): string | null {
  if (sqlCell !== null) {
    return sqlCell.source;
  }
  if (codeCell !== null) {
    return codeCell.source;
  }
  if (markdownCell !== null) {
    return markdownCell.source;
  }
  return null;
}

/**
 * Run the `hex cells` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexCells(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["cells"] });
  if (askedForHelp({ rest, usage: HEX_CELLS_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseHexObjectOptions({
    extraFlag: "sql-only",
    idFlag: "project",
    rest,
    usageHint: "--project 1b0c…, the UUID after `/hex/` in the project's URL",
  });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, usage: HEX_CELLS_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const listed = await listCells({ client: opened.client, limit: options.limit, projectId: options.id });
  if (listed.isErr()) {
    return exitForHexError({ error: listed.error });
  }
  const cells = options.extra ? listed.value.filter((cell) => cell.contents.sqlCell !== null) : listed.value;
  if (options.json) {
    logger.out({ line: safeJsonStringify({ label: "hex cells", value: cells }) });
    return EXIT_OK;
  }
  logger.out({ line: `${String(cells.length)} cell(s)${options.extra ? " (SQL only)" : ""} in ${options.id}` });
  cells.forEach((cell) => {
    logger.out({ line: `  ${cell.cellType}${cell.label === null ? "" : ` — ${cell.label}`}` });
    logger.out({ line: `    ${cellSourceHead({ cell })}` });
    logger.out({ line: `    id ${cell.id}` });
  });
  if (cells.some((cell) => cell.contents.sqlCell !== null)) {
    logger.out({
      line: "read one with `slopweaver hex output --cell <id>` — the draft session's latest preview, never a fresh run",
    });
  }
  return EXIT_OK;
}

export const hexCellsCommand = defineCommand({ run: runHexCells });
