/**
 * The pure half of `slopweaver store authored-list`, `authored-show` and `authored-restore`: what their
 * flags mean and the lines each prints. No I/O, no store — `./authoredRun.ts` is the shell.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { AuthoredRestorePlan, StoredAuthoredVersion } from "../../../store/fleet/authoredFile.js";
import { parseFlagTail } from "../../optionParsers.js";

/** `authored-list`'s flag tail; `helpTruth.test.ts` holds it to the usage line through the parser. */
const AUTHORED_LIST_FLAG_SPEC = { boolean: ["json"], value: ["directory", "home"] } as const satisfies {
  boolean: readonly string[];
  value: readonly string[];
};

/** `authored-show`'s flag tail. */
const AUTHORED_SHOW_FLAG_SPEC = { boolean: [], value: ["ref", "out", "home"] } as const satisfies {
  boolean: readonly string[];
  value: readonly string[];
};

/** `authored-restore`'s flag tail. */
const AUTHORED_RESTORE_FLAG_SPEC = {
  boolean: ["dry-run", "json"],
  value: ["directory", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** A parsed `authored-list`. */
export interface AuthoredListArgs {
  readonly directory: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `authored-show`. `ref` is checked by the shell, so a missing one is refused as usage. */
export interface AuthoredShowArgs {
  readonly ref: string | undefined;
  readonly out: string | undefined;
  readonly home: string | undefined;
}

/** A parsed `authored-restore`. */
export interface AuthoredRestoreArgs {
  readonly directory: string | undefined;
  readonly home: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
}

/**
 * Parse `authored-list`'s flag tail.
 *
 * @param rest the argv after `store authored-list`
 * @returns the arguments, or the tokeniser's rejections
 */
export function parseAuthoredListArgs({ rest }: { rest: readonly string[] }): Result<AuthoredListArgs> {
  const parsed = parseFlagTail({ rest, spec: AUTHORED_LIST_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({ directory: values["directory"], home: values["home"], json: flags.has("json") });
}

/**
 * Parse `authored-show`'s flag tail.
 *
 * @param rest the argv after `store authored-show`
 * @returns the arguments, or the tokeniser's rejections
 */
export function parseAuthoredShowArgs({ rest }: { rest: readonly string[] }): Result<AuthoredShowArgs> {
  const parsed = parseFlagTail({ rest, spec: AUTHORED_SHOW_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  return ok({ home: values["home"], out: values["out"], ref: values["ref"] });
}

/**
 * Parse `authored-restore`'s flag tail.
 *
 * @param rest the argv after `store authored-restore`
 * @returns the arguments, or the tokeniser's rejections
 */
export function parseAuthoredRestoreArgs({ rest }: { rest: readonly string[] }): Result<AuthoredRestoreArgs> {
  const parsed = parseFlagTail({ rest, spec: AUTHORED_RESTORE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({
    directory: values["directory"],
    dryRun: flags.has("dry-run"),
    home: values["home"],
    json: flags.has("json"),
  });
}

/** One path's line in `authored-list`. */
export interface AuthoredListRow {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly fileModifiedAtIso: string;
  readonly versions: number;
}

/**
 * The list rows: each path at its newest version, with how many versions the store keeps for it.
 *
 * @param newest the newest version at each path
 * @param all every stored version, so the per-path count is real rather than assumed to be one
 * @returns one row per path, in path order
 */
export function authoredListRows({
  newest,
  all,
}: {
  newest: readonly StoredAuthoredVersion[];
  all: readonly StoredAuthoredVersion[];
}): readonly AuthoredListRow[] {
  const counts = new Map<string, number>();
  for (const version of all) {
    const held = counts.get(version.relativePath);
    counts.set(version.relativePath, held === undefined ? 1 : held + 1);
  }
  return newest.map((version) => ({
    byteLength: version.byteLength,
    fileModifiedAtIso: version.fileModifiedAt.toISOString(),
    relativePath: version.relativePath,
    versions: counts.get(version.relativePath)!,
  }));
}

/**
 * One list row as the tab-separated line the data channel prints.
 *
 * @returns `path<TAB>bytes<TAB>written<TAB>versions`
 */
export function authoredListLine({ row }: { row: AuthoredListRow }): string {
  return [row.relativePath, String(row.byteLength), row.fileModifiedAtIso, String(row.versions)].join("\t");
}

/**
 * The lines `authored-restore` prints about its plan and what it did.
 *
 * @param plan the per-path decisions
 * @param dryRun whether anything was written
 * @param failed each path whose write failed, with why
 * @param absent how many stored paths were left out because the last import found them deleted
 * @param differsCap how many differing paths to name before summarising the rest
 * @returns the lines, a summary first
 */
export function authoredRestoreLines({
  plan,
  dryRun,
  failed,
  absent,
  differsCap = 20,
}: {
  plan: AuthoredRestorePlan;
  dryRun: boolean;
  failed: readonly { relativePath: string; why: string }[];
  absent: number;
  differsCap?: number;
}): readonly string[] {
  const lines: string[] = [];
  const verb = dryRun ? "would write" : "wrote";
  lines.push(
    `store authored-restore: ${verb} ${String(plan.write.length - failed.length)}, ` +
      `${String(plan.identical.length)} already identical, ${String(plan.differs.length)} present with other ` +
      `bytes (left alone), ${String(absent)} deleted since stored (left out), ${String(failed.length)} failed`,
  );
  for (const failure of failed) {
    lines.push(`  FAILED ${failure.relativePath}: ${failure.why}`);
  }
  for (const version of plan.differs.slice(0, differsCap)) {
    lines.push(
      `  differs ${version.relativePath} — the home copy was kept; \`store authored-show\` prints the stored one`,
    );
  }
  const hidden = plan.differs.length - differsCap;
  if (hidden > 0) {
    lines.push(`  … and ${String(hidden)} more present with other bytes`);
  }
  return lines;
}
