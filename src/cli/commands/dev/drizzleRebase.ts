/**
 * `slopweaver dev drizzle-rebase` — discard the migrations a merge left out of order, so the schema can
 * regenerate one that is in order.
 *
 *   slopweaver dev drizzle-rebase --dry-run   # what would go
 *   slopweaver dev drizzle-rebase             # remove them, then run `slopweaver store push`
 *
 * The reasoning is in {@link ./drizzleRebaseCore}; this file is the filesystem half. It deletes and it
 * never regenerates: running the generator for the caller would hide the one moment worth looking at,
 * which is the diff of the migration that replaces two.
 *
 * **`--dry-run` is the default posture rather than a courtesy.** Deleting a migration that has already
 * been applied to a database is not recoverable by re-running anything, so the verb refuses to remove
 * anything whose entry is not provably a second branch's — see `planRebase`'s note on why the earliest
 * conflicting entry is always kept.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { type Logger, logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, flagValueOr, nonEmptyFlagValue, parseFlagTail } from "../../optionParsers.js";

import { filesOfEntry, planRebase, type RebaseJournalEntry, renderRebasePlan } from "./drizzleRebaseCore.js";

/** What the verb advertises, and the only flags it takes. */
export const DEV_DRIZZLE_REBASE_USAGE = "usage: slopweaver dev drizzle-rebase [--dry-run] [--migrations <dir>]";

/** Every flag `dev drizzle-rebase` knows, so an unknown one — or `--migrations` with no value — is refused by name. */
export const DEV_DRIZZLE_REBASE_FLAGS: FlagTailSpec = { boolean: ["dry-run"], value: ["migrations"] };

/** Where drizzle-kit writes, and so where a rebase looks unless told otherwise. */
const DEFAULT_MIGRATIONS = join("supabase", "migrations");

/**
 * Read the journal's entries, or say why they could not be read.
 *
 * @param dir the migrations directory
 * @returns the entries, or a message naming what failed
 * @internal
 */
function readJournalEntries({ dir }: { dir: string }): readonly RebaseJournalEntry[] | string {
  const path = join(dir, "meta", "_journal.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return `no journal at ${path} — nothing records an apply order, so there is no order to rebase`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${path} is not valid JSON — fix it by hand before rebasing, because a rebase rewrites it`;
  }
  if (typeof parsed !== "object" || parsed === null || !("entries" in parsed)) {
    return `${path} carries no "entries" array`;
  }
  const { entries } = parsed;
  if (!Array.isArray(entries)) {
    return `${path}'s "entries" is not an array`;
  }
  return entries as readonly RebaseJournalEntry[];
}

/**
 * Parse the verb's flag tail — the one parser the verb and its help-truth probe share.
 *
 * `--migrations` with nothing after it, followed by another flag, or given an empty string is a usage error,
 * said as one, rather than silently becoming a path that would then read as "no journal here". Absent, it is
 * the repository's own migrations directory.
 *
 * @param rest the argv tail after `dev drizzle-rebase`
 * @returns the migrations directory and whether this is a dry run, or every reason the tail was refused
 */
export function parseDevDrizzleRebaseArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): Result<{ readonly dir: string; readonly dryRun: boolean }> {
  return parseFlagTail({ rest, spec: DEV_DRIZZLE_REBASE_FLAGS }).andThen((parsed) =>
    nonEmptyFlagValue({
      name: "migrations",
      value: flagValueOr({ fallback: DEFAULT_MIGRATIONS, name: "migrations", parsed }),
    }).map((dir) => ({ dir, dryRun: parsed.flags.has("dry-run") })),
  );
}

/**
 * Run the rebase against an injected logger, so a test drives the real verb.
 *
 * @param argv the full process argv (the verb tail starts at index 4)
 * @param log where lines go
 * @returns the process exit code
 * @internal
 */
export function runDevDrizzleRebaseWithDeps({ argv, log }: { argv: readonly string[]; log: Logger }): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_DRIZZLE_REBASE_USAGE });
    return EXIT_OK;
  }

  const parsed = parseDevDrizzleRebaseArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      log.error({ msg: problem });
    }
    log.error({ msg: DEV_DRIZZLE_REBASE_USAGE });
    return EXIT_USAGE;
  }
  const { dir, dryRun } = parsed.value;

  const entries = readJournalEntries({ dir });
  if (typeof entries === "string") {
    log.error({ msg: entries });
    return EXIT_ERROR;
  }

  const plan = planRebase({ entries });
  for (const line of renderRebasePlan({ dryRun, plan })) {
    log.out({ line });
  }
  if (dryRun || plan.discard.length === 0) {
    return EXIT_OK;
  }

  for (const entry of plan.discard) {
    for (const file of filesOfEntry({ entry })) {
      rmSync(join(dir, file), { force: true });
    }
  }
  // The journal is rewritten to exactly what survived, renumbered from zero so the next generate
  // continues the sequence rather than colliding with an index a discarded entry held.
  const renumbered = plan.keep.map((entry, idx) => ({ ...entry, idx }));
  writeJournal({ dir, entries: renumbered });
  return EXIT_OK;
}

/**
 * Write the surviving entries back, in drizzle's own journal shape.
 *
 * @param dir the migrations directory
 * @param entries what survived, already renumbered
 * @internal
 */
function writeJournal({ dir, entries }: { dir: string; entries: readonly RebaseJournalEntry[] }): void {
  // Key order matches drizzle-kit's own output — version, dialect, entries. A rewrite that reorders them
  // is equivalent to every reader and still shows up as a diff on a file nobody edited, which is exactly
  // the noise that makes a real journal change hard to see in review.
  const document = { version: "7", dialect: "postgresql", entries };
  // Small and bounded by the number of migrations, so a whole-document write is correct here — the
  // `whole-file-json` class is about payloads whose size comes from DATA, and this one's comes from how
  // many times somebody changed the schema.
  writeFileAtomic({ contents: `${JSON.stringify(document, null, 2)}\n`, path: join(dir, "meta", "_journal.json") });
}

/**
 * Run the drizzle-rebase verb.
 *
 * @param argv the full process argv
 * @returns the process exit code — see {@link runDevDrizzleRebaseWithDeps}
 */
export function runDevDrizzleRebase(argv: readonly string[]): number {
  return runDevDrizzleRebaseWithDeps({ argv, log: logger });
}

export const devDrizzleRebaseCommand = defineCommand({ run: runDevDrizzleRebase });
