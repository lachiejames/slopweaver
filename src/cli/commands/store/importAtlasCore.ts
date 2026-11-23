/**
 * `slopweaver store import-atlas`'s pure half — its arguments, and the lines it prints.
 *
 * No filesystem, no database, no clock. `./importAtlasRun.ts` is the shell that does all three, and the
 * split is what lets the report be tested against a counted result rather than against a live home.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { AtlasImportError } from "../../../store/atlas/errors.js";

/** What the verb was asked to do. */
export interface ImportAtlasArgs {
  /** The state home to read the atlas from. */
  readonly home: string | undefined;
  /** One platform, when the operator named one; every registered platform with a generation otherwise. */
  readonly platform: string | undefined;
  /** Plan and count, write nothing at all — not a row, not a connection. */
  readonly dryRun: boolean;
  /**
   * Re-read and re-write a kind whose stored digest already matches the manifest's.
   *
   * Off by default: the digest is over the exact kind-file bytes on disk (`atlasFile.ts`'s
   * `digestOfKindFile`), so an unchanged one means the slice in the store IS the slice on disk. The flag
   * exists because that reasoning holds only while nothing has written to the tables out of band.
   */
  readonly force: boolean;
  readonly json: boolean;
}

/** What one kind file did. */
export interface KindOutcome {
  readonly platform: string;
  readonly kind: string;
  readonly file: string;
  readonly entities: number;
  readonly channels: number;
  readonly coverage: number;
  readonly gaps: number;
  /** Gap records folded onto one already projected. See `../../../store/atlas/project.ts`'s `collapseGaps`. */
  readonly gapsCollapsed: number;
  /** Entity lines read that did not become rows — a duplicate key, counted rather than absorbed. */
  readonly entitiesCollapsed: number;
  readonly refusalCount: number;
  readonly refusals: readonly AtlasImportError[];
  /** U+0000 characters removed on the way into a jsonb column. See `../../../store/atlas/project.ts`. */
  readonly nulsStripped: number;
  /** Set when the kind was skipped because its stored digest already matched. */
  readonly skipped: boolean;
  /**
   * The database refusal that stopped this kind, when one did.
   *
   * Its own field rather than a refusal count, and the distinction is the one that cost a rehearsal: a
   * slice whose WRITE failed had been logged and then reported as an ordinary zero-row kind, so the verb
   * exited 0 while one Vanta kind existed on disk and not in the store — the exact asymmetry this verb
   * removes. A kind carrying this is counted in the exit code.
   */
  readonly writeFailure: string | undefined;
}

/** One platform that could not be read at all, with the reason. */
export interface PlatformRefusal {
  readonly platform: string;
  readonly file: string;
  readonly error: AtlasImportError;
}

/** The verb's whole result. */
export interface ImportAtlasReport {
  readonly kinds: readonly KindOutcome[];
  readonly refusedFiles: readonly PlatformRefusal[];
  readonly dryRun: boolean;
  readonly platformsPlanned: number;
  readonly filesPlanned: number;
  readonly elapsedMs: number;
}

/**
 * Parse the verb's arguments.
 *
 * Returns the default `Result<T>` — `E = readonly string[]` — rather than a domain union, per
 * `.claude/rules/error-handling.md`: these are display-only messages no caller branches on.
 *
 * @param argv the argument list after the verb itself
 * @returns the parsed arguments, or the refusal lines to print
 */
export function parseImportAtlasArgs({ argv }: { argv: readonly string[] }): Result<ImportAtlasArgs> {
  const acc: TokenAccumulator = {
    dryRun: false,
    force: false,
    home: undefined,
    json: false,
    platform: undefined,
    problems: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    index += applyToken({ acc, token: argv[index]!, value: argv[index + 1] });
  }
  if (acc.problems.length > 0) {
    return err(acc.problems);
  }
  return ok({
    dryRun: acc.dryRun,
    force: acc.force,
    home: acc.home,
    json: acc.json,
    platform: acc.platform,
  });
}

/** The accumulator one pass over the tokens fills. Mutable by construction — see {@link applyToken}. */
interface TokenAccumulator {
  readonly problems: string[];
  home: string | undefined;
  platform: string | undefined;
  dryRun: boolean;
  force: boolean;
  json: boolean;
}

/**
 * Apply one token to the accumulator.
 *
 * @param acc the accumulator, mutated in place
 * @param token the flag itself
 * @param value the token AFTER it, which only a value flag reads
 * @returns how many extra tokens were consumed — 1 for a value flag, 0 for everything else
 */
function applyToken({
  acc,
  token,
  value,
}: {
  acc: TokenAccumulator;
  token: string;
  value: string | undefined;
}): number {
  if (token === "--dry-run") {
    acc.dryRun = true;
    return 0;
  }
  if (token === "--force") {
    acc.force = true;
    return 0;
  }
  if (token === "--json") {
    acc.json = true;
    return 0;
  }
  if (token === "--home") {
    // The flag is consumed either way: a `--home` with nothing after it has still eaten its slot.
    if (value === undefined) {
      acc.problems.push("--home needs a directory");
      return 1;
    }
    acc.home = value;
    return 1;
  }
  if (token === "--platform") {
    if (value === undefined) {
      acc.problems.push("--platform needs a registered atlas platform, e.g. vanta");
      return 1;
    }
    acc.platform = value;
    return 1;
  }
  acc.problems.push(`unexpected argument: ${token}`);
  return 0;
}

/** The usage line, exported so the shell and a test print the same one. */
export const IMPORT_ATLAS_USAGE =
  "usage: slopweaver store import-atlas [--platform <p>] [--force] [--dry-run] [--home <dir>] [--json]\n" +
  "  Projects every registered atlas's published generation into the five atlas tables.\n" +
  "  Re-runnable: one (platform, kind) slice is REPLACED in one transaction, so a re-run converges.\n" +
  "  A kind whose stored digest already matches its manifest is skipped unless --force.\n" +
  "  --dry-run plans and counts the files without opening a connection.";

/**
 * The report, as the lines a human reads.
 *
 * Two counts are printed that a naive report would omit, and both are the point rather than trivia: a
 * COLLAPSED gap or entity is a duplicate key that already existed on disk, and the estate holds 28,949 of
 * the first. A silent fold would hide a defect in whatever writes them that nothing has ever counted.
 *
 * @param report what each kind did
 * @param refusalCap how many refusals to spell before summarising the rest
 * @returns the lines, platform by platform, with a trailing total
 */
export function importAtlasLines({
  report,
  refusalCap = 10,
}: {
  report: ImportAtlasReport;
  refusalCap?: number;
}): readonly string[] {
  const lines: string[] = [];
  if (report.dryRun) {
    lines.push("store import-atlas: DRY RUN — nothing was written and no connection was opened");
  }
  for (const line of platformLines({ kinds: report.kinds })) {
    lines.push(line);
  }
  for (const refusal of report.refusedFiles.slice(0, refusalCap)) {
    lines.push(`refused ${refusal.file}: ${refusal.error.message}`);
  }
  if (report.refusedFiles.length > refusalCap) {
    lines.push(`… and ${String(report.refusedFiles.length - refusalCap)} more unreadable file(s)`);
  }
  lines.push(...totalLines({ report }));
  return lines;
}

/**
 * One line per platform, folding its kinds together.
 *
 * Per platform rather than per kind because the estate has 834 kind files and a line each is a wall of
 * text — rule 7, on every surface. The `--json` document carries the per-kind detail.
 *
 * @param kinds every kind outcome, in read order
 * @returns one line per platform that contributed at least one kind
 */
function platformLines({ kinds }: { kinds: readonly KindOutcome[] }): readonly string[] {
  const lines: string[] = [];
  for (const [platform, tally] of foldByPlatform({ kinds })) {
    const skipped = tally.skipped === 0 ? "" : `, ${String(tally.skipped)} kind(s) unchanged`;
    const refused = tally.refused === 0 ? "" : `, ${String(tally.refused)} refused`;
    lines.push(
      `${platform}: ${String(tally.entities)} entit(ies), ${String(tally.channels)} channel view(s)${skipped}${refused}`,
    );
  }
  return lines;
}

/** One platform's folded counts. */
interface PlatformTally {
  readonly entities: number;
  readonly channels: number;
  readonly skipped: number;
  readonly refused: number;
}

/**
 * Fold every kind outcome onto its platform, in first-seen order.
 *
 * @param kinds every kind outcome, in read order
 * @returns one tally per platform that contributed at least one kind
 */
function foldByPlatform({ kinds }: { kinds: readonly KindOutcome[] }): ReadonlyMap<string, PlatformTally> {
  const byPlatform = new Map<string, PlatformTally>();
  for (const kind of kinds) {
    // The first kind of a platform opens its tally. Spelled as an if rather than a coalesce or a
    // ternary so the "platform not seen yet" case is a line of code rather than an operator.
    let base: PlatformTally = { channels: 0, entities: 0, refused: 0, skipped: 0 };
    const seen = byPlatform.get(kind.platform);
    if (seen !== undefined) {
      base = seen;
    }
    byPlatform.set(kind.platform, {
      channels: base.channels + kind.channels,
      entities: base.entities + kind.entities,
      refused: base.refused + kind.refusalCount,
      skipped: base.skipped + (kind.skipped ? 1 : 0),
    });
  }
  return byPlatform;
}

/**
 * The trailing totals — what was written, and what the on-disk duplication cost.
 *
 * @param report the whole result
 * @returns the summary lines
 */
function totalLines({ report }: { report: ImportAtlasReport }): readonly string[] {
  const total = report.kinds.reduce(
    (into, kind) => ({
      channels: into.channels + kind.channels,
      coverage: into.coverage + kind.coverage,
      entities: into.entities + kind.entities,
      entitiesCollapsed: into.entitiesCollapsed + kind.entitiesCollapsed,
      gaps: into.gaps + kind.gaps,
      gapsCollapsed: into.gapsCollapsed + kind.gapsCollapsed,
      nulsStripped: into.nulsStripped + kind.nulsStripped,
      refusalCount: into.refusalCount + kind.refusalCount,
    }),
    {
      channels: 0,
      coverage: 0,
      entities: 0,
      entitiesCollapsed: 0,
      gaps: 0,
      gapsCollapsed: 0,
      nulsStripped: 0,
      refusalCount: 0,
    },
  );
  const lines = [
    `${String(report.platformsPlanned)} platform(s), ${String(report.filesPlanned)} kind file(s) planned`,
    `wrote ${String(total.entities)} entit(ies), ${String(total.channels)} channel view(s), ` +
      `${String(total.coverage)} coverage cell(s), ${String(total.gaps)} gap(s) in ${String(report.elapsedMs)}ms`,
  ];
  if (total.gapsCollapsed > 0 || total.entitiesCollapsed > 0) {
    lines.push(
      `on-disk duplicates collapsed: ${String(total.gapsCollapsed)} gap(s), ` +
        `${String(total.entitiesCollapsed)} entit(ies) — these are repeats ALREADY in the atlas files`,
    );
  }
  if (total.nulsStripped > 0) {
    lines.push(
      `${String(total.nulsStripped)} U+0000 character(s) stripped — Postgres jsonb cannot hold one, ` +
        "so the row was kept and the control character was not",
    );
  }
  if (total.refusalCount > 0) {
    lines.push(`${String(total.refusalCount)} line(s) refused — each exists on disk and is NOT in the store`);
  }
  for (const failed of report.kinds.filter((kind) => kind.writeFailure !== undefined)) {
    lines.push(`${failed.platform}/${failed.kind} was NOT written: ${String(failed.writeFailure)}`);
  }
  return lines;
}
