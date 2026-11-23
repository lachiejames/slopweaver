/**
 * `slopweaver secrets status`'s pure half: its flag spec, its parser, and the two renderers.
 *
 * Split from `statusRun.ts` so the whole of what a reader sees can be unit-tested over stated inputs with no
 * filesystem at all — and so `src/__tests__/unit/cli/helpTruth.test.ts` can push every advertised flag
 * through the REAL parser rather than through a restatement of it.
 *
 * Nothing here can render a value: {@link CredentialRow} carries no field a token could be in, and the
 * effectful half never puts one there.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { CredentialRow } from "../../../secrets/status.js";
import { isFinding } from "../../../secrets/status.js";
import { parseFlagTail } from "../../optionParsers.js";
import { SECRETS_STATUS_USAGE } from "./statusUsage.js";

/** Every flag this verb accepts, exported so the help/flag ratchet compares behaviour rather than prose. */
export const SECRETS_STATUS_FLAG_NAMES: readonly string[] = ["--home", "--all", "--json"];

/** The validated `secrets status` request. */
export interface SecretsStatusArgs {
  readonly home?: string;
  /** Show every declared credential; without it, only the ones stored plus the findings. */
  readonly all: boolean;
  readonly json: boolean;
}

/**
 * Parse `secrets status`'s tail. Pure — an unknown flag or a stray positional is an error, so the verb is
 * strict in the way the whole-CLI ratchet checks for.
 *
 * @param rest the tail after `secrets status`
 * @returns the validated request, or the accumulated errors
 */
export function parseSecretsStatusArgs({ rest }: { rest: readonly string[] }): Result<SecretsStatusArgs> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["all", "json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err([...parsed.error, SECRETS_STATUS_USAGE]);
  }
  const homeValue = parsed.value.values["home"];
  return ok({
    all: parsed.value.flags.has("all"),
    json: parsed.value.flags.has("json"),
    ...(homeValue !== undefined ? { home: homeValue } : {}),
  });
}

/**
 * Which rows the default (non-`--all`) report shows: everything stored, plus every finding. A declared
 * credential this install has simply never connected is not news, and a report whose bulk is `absent` rows
 * is one the owner learns to skim — which is how four real states went unseen for a fortnight. The one absent
 * row that IS news — a live row missing beside a stored row it goes with — is still hidden here; the
 * `secret-absent` monitor (`src/monitor/secretAbsent.ts`) is what cards it unasked.
 *
 * @param rows every row
 * @param all whether `--all` was passed
 * @returns the rows to print, in the order given
 */
export function visibleRows({ rows, all }: { rows: readonly CredentialRow[]; all: boolean }): readonly CredentialRow[] {
  if (all) {
    return rows;
  }
  return rows.filter((row) => row.stored || isFinding({ state: row.state }));
}

/** One column's width across the rows that will be printed, floored at the header's own width. */
function widthOf({ header, cells }: { header: string; cells: readonly string[] }): number {
  return Math.max(header.length, ...cells.map((cell) => cell.length), 0);
}

/**
 * Render the findings block — what `secrets status` leads with, unasked. Empty when there are none, so the
 * report says "nothing to decide" by being short rather than by claiming it.
 *
 * @param rows every row, findings included
 * @returns the lines, or an empty array when the store is clean
 */
export function renderFindings({ rows }: { rows: readonly CredentialRow[] }): readonly string[] {
  const findings = rows.filter((row) => isFinding({ state: row.state }));
  if (findings.length === 0) {
    return [];
  }
  const nameWidth = widthOf({ cells: findings.map((row) => row.name), header: "" });
  const stateWidth = widthOf({ cells: findings.map((row) => row.state), header: "" });
  return [
    `${String(findings.length)} finding(s):`,
    ...findings.map((row) => `  ${row.name.padEnd(nameWidth)}  ${row.state.padEnd(stateWidth)}  ${row.detail}`),
    "",
  ];
}

/** The one cell that says when a credential stops working, for a kind that may or may not carry an instant. */
function expiryCell({ row }: { row: CredentialRow }): string {
  if (row.expiryIso === undefined) {
    // The grant carries no instant for this kind, so the kind's own description is the cell.
    return row.expiryKind;
  }
  return row.expiryIso;
}

/** The table's columns, in the order the owner reads them. A value is not among them and cannot become one. */
const HEADERS: readonly string[] = ["SECRET", "PLATFORM", "WHAT", "AT MINT", "EXPIRY", "STATE", "READ BY"];

/** One row's cells, in {@link HEADERS} order. */
function cellsOf({ row }: { row: CredentialRow }): readonly string[] {
  return [row.name, row.platform, row.what, row.mintScope, expiryCell({ row }), row.state, row.readVerbs];
}

/**
 * Render the register as an aligned table: the platform, what it is, its scope at mint, its expiry, which
 * verb reads it, and its state. Never a value — there is no field on a row that could hold one.
 *
 * @param rows the rows to print, already filtered to what the caller wants seen
 * @returns the table lines, or a single line saying the store is empty
 */
export function renderTable({ rows }: { rows: readonly CredentialRow[] }): readonly string[] {
  if (rows.length === 0) {
    return ["no credentials stored, and none declared — run `slopweaver onboard`"];
  }
  // Every row carries exactly HEADERS.length cells, because `cellsOf` builds them in that order — so the
  // index assertions below are honest rather than a coalesce hiding a shape this file controls.
  const matrix: readonly (readonly string[])[] = [HEADERS, ...rows.map((row) => cellsOf({ row }))];
  const widths = HEADERS.map((_unused, index) => Math.max(...matrix.map((cells) => cells[index]!.length)));
  return matrix.map((cells) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join("  ")
      .trimEnd(),
  );
}

/**
 * The whole default report: findings first, then the table, then the one line that says what was hidden.
 *
 * @param rows every row the store and register produced
 * @param all whether `--all` was passed
 * @returns every line to print, in order
 */
export function renderStatus({ rows, all }: { rows: readonly CredentialRow[]; all: boolean }): readonly string[] {
  const shown = visibleRows({ all, rows });
  const hidden = rows.length - shown.length;
  return [
    ...renderFindings({ rows }),
    ...renderTable({ rows: shown }),
    ...(hidden > 0 ? ["", `${String(hidden)} declared credential(s) not stored — \`--all\` to list them`] : []),
  ];
}
