/**
 * `slopweaver profile harvest` — apply a hash-pinned disposition manifest over the archived profile
 * unit's history files.
 *
 * The history files are harvested into Supabase where their data is useful
 * rather than re-derived, and dropped where it is not. The judgement is the manifest's
 * ({@link ../../../store/profile/harvest}); this is the effectful half that measures the tree, checks the
 * manifest against it and — only under `--apply` — writes the harvested files' records into the store.
 *
 * ## It reads the `self` bronze lane rather than re-scanning
 *
 * 92 of the 114 files are ALREADY bronze records under the `self` source, keyed by the absolute path they
 * were scanned from. Re-scanning would mint new section ids for the same prose and leave both versions
 * retrievable, so the selection joins on `url` instead. A file the manifest harvests that has no bronze
 * record is REPORTED rather than silently skipped — it means the self scan has not seen that file, which
 * is a fact about the corpus a caller needs, not a no-op.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { slopweaverHome } from "../../../config.js";
import { parseRow } from "../../../corpus/corpusRowCore.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";
import { stateHomePaths } from "../../../stateHome.js";
import { openStore, storeUrl } from "../../../store/client.js";
import { ingestRecords } from "../../../store/ingest.js";
import {
  type HarvestPlan,
  harvestedPaths,
  harvestPlanLines,
  type MeasuredFile,
  parseHarvestManifest,
  validateHarvestManifest,
} from "../../../store/profile/harvest.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseProfileHarvestArgs, profileTail } from "./core.js";

const HARVEST_USAGE = "usage: slopweaver profile harvest --manifest <path.json> [--apply] [--json]";

/** Print refusal lines and the usage, and return the usage exit code. */
function refuse({ lines }: { lines: readonly string[] }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: HARVEST_USAGE });
  return EXIT_USAGE;
}

/**
 * Every regular file under the given directories, recursively, relative to `root`.
 *
 * ONE accumulator and an explicit stack rather than recursion that spreads each subdirectory's result
 * into its parent: a spread-append copies the whole collection per element, and the size here comes from
 * the tree rather than from anything bounded. Taking the directories as a list is what lets both covered
 * subtrees share the single pass.
 *
 * @param dirs the directories to walk
 * @param root the directory paths are reported relative to
 * @returns each file's path relative to `root`
 */
function filesUnder({ dirs, root }: { dirs: readonly string[]; root: string }): readonly string[] {
  const out: string[] = [];
  const pending = [...dirs];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) {
      break;
    }
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        pending.push(full);
        continue;
      }
      out.push(relative(root, full));
    }
  }
  return out;
}

/**
 * Measure every file under the directories a manifest claims to cover.
 *
 * @param root the archived profile unit
 * @param covers the subdirectories the manifest claims completely
 * @returns each file's relative path and current sha256
 */
function measureTree({ root, covers }: { root: string; covers: readonly string[] }): readonly MeasuredFile[] {
  return filesUnder({ dirs: covers.map((cover) => join(root, cover)), root }).map((path): MeasuredFile => ({
    path,
    sha256: createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  }));
}

/**
 * Every `self` bronze record whose `url` is one of the harvested files.
 *
 * Decoded by the corpus's own `parseRow` rather than cast: a `self` record's `url` is the absolute path it
 * was scanned from, so `url` is the join key, and a line that does not decode is skipped rather than
 * pushed through as a record-shaped object nothing validated. The harvest's own report then names any
 * harvested file that reached no record at all.
 *
 * @param path the `self` bronze file
 * @param wanted the absolute paths the manifest harvests
 * @returns the records those files produced, in file order
 */
function selectSelfRecords({ path, wanted }: { path: string; wanted: ReadonlySet<string> }): readonly CorpusRecord[] {
  const picked: CorpusRecord[] = [];
  readJsonlLines({
    onLine: ({ line }) => {
      if (line.trim().length === 0) {
        return;
      }
      const row = parseRow({ line });
      if ("record" in row && wanted.has(row.record.url)) {
        picked.push(row.record);
      }
    },
    path,
  });
  return picked;
}

/**
 * Check a disposition manifest against the tree, and under `--apply` write the harvested records.
 *
 * Dry by default. A verb whose default writes is a verb somebody runs once by accident, and the whole
 * value of the manifest is that a human reads the plan before anything lands.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfileHarvest(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HARVEST_USAGE });
    return EXIT_OK;
  }
  const parsed = parseProfileHarvestArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: parsed.error });
  }
  const plan = planFrom({ manifestPath: parsed.value.manifest });
  if ("errors" in plan) {
    return refuse({ lines: plan.errors });
  }
  const json = parsed.value.json;
  const lines = [...harvestPlanLines({ plan: plan.value })];
  if (!parsed.value.apply) {
    lines.push("dry run: nothing was written. Re-run with --apply to ingest the harvested files.");
    emit({ json, lines, payload: { applied: false, plan: plan.value } });
    return EXIT_OK;
  }
  return apply({ json, lines, plan: plan.value });
}

/**
 * Read, parse and validate the manifest against the tree it names.
 *
 * @param manifestPath the manifest file
 * @returns the validated plan, or every reason it was refused
 */
function planFrom({ manifestPath }: { manifestPath: string }): { value: HarvestPlan } | { errors: readonly string[] } {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    return { errors: [`could not read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: manifestPath, text: raw });
  } catch (error) {
    return {
      errors: [`${manifestPath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const manifest = parseHarvestManifest({ value });
  if (manifest.isErr()) {
    return { errors: manifest.error };
  }
  let measured: readonly MeasuredFile[];
  try {
    measured = measureTree({ covers: manifest.value.covers, root: manifest.value.root });
  } catch (error) {
    return {
      errors: [`could not read ${manifest.value.root}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const validated = validateHarvestManifest({ manifest: manifest.value, measured });
  if (validated.isErr()) {
    return { errors: validated.error };
  }
  return { value: validated.value };
}

/** Ingest every harvested file's `self` bronze records into the store. */
async function apply({
  json,
  lines,
  plan,
}: {
  json: boolean;
  lines: readonly string[];
  plan: HarvestPlan;
}): Promise<number> {
  const bronze = join(stateHomePaths({ home: slopweaverHome() }).corpus.bronze, "self", "compact.jsonl");
  let records: readonly CorpusRecord[];
  try {
    records = selectSelfRecords({ path: bronze, wanted: harvestedPaths({ plan }) });
  } catch (error) {
    logger.error({ msg: `could not read ${bronze}: ${error instanceof Error ? error.message : String(error)}` });
    return EXIT_ERROR;
  }
  const covered = new Set(records.map((record) => record.url));
  const missing = plan.harvest.filter((entry) => !covered.has(`${plan.root}/${entry.path}`));
  const url = storeUrl();
  if (url.isErr()) {
    logger.error({ msg: url.error.message });
    return EXIT_ERROR;
  }
  const client = openStore({ max: 4, url: url.value });
  try {
    const written = await ingestRecords({ client, records });
    if (written.isErr()) {
      logger.error({ msg: written.error.message });
      return EXIT_ERROR;
    }
    emit({
      json,
      lines: [
        ...lines,
        `applied: ${String(written.value.recordsStored)} record(s) stored from ${String(records.length)} selected`,
        `files the self scan has never seen: ${String(missing.length)}`,
        ...missing.map((entry) => `  - ${entry.path}`),
      ],
      payload: { applied: true, missing: missing.map((entry) => entry.path), plan, written: written.value },
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

/** Emit a report, as JSON on stdout or as lines on stdout, exactly as the store verbs do. */
function emit({ json, lines, payload }: { json: boolean; lines: readonly string[]; payload: unknown }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "harvest report", value: payload }) });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

export const profileHarvestCommand = defineCommand({ run: runProfileHarvest });
