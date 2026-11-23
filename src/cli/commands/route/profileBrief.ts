/**
 * `slopweaver route profile-brief` — scan named private sources into a bounded, hashed mining brief.
 *
 * Sources are named via `--sources <manifest.json>` (a plain `[{"label", "path"}, …]` array) rather than a
 * repeated flag, because this repo's flag parser has no `multiple` support and a versionable file is a more
 * stable interface than fragile repeated CLI flags anyway. Held-out routing-eval case texts (never invoked
 * as production readers; consumers pass whatever `eval/routing.cases.json` shape they have) are hashed by
 * this verb, never compared as raw text, so the brief itself never carries eval answers verbatim.
 */
import { readFileSync } from "node:fs";
import { buildJudgementMiningBrief, type JudgementSourceSample } from "../../../judgement/miningBrief.js";
import { writeJudgementMiningBrief } from "../../../judgement/miningStore.js";
import type { JudgementSourceScanError } from "../../../judgement/sourceScan.errors.js";
import { scanJudgementSource } from "../../../judgement/sourceScan.js";
import { sha256Text } from "../../../lib/hash.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { type RouteCommandError, RouteCommandErrors, routeCommandErrorLines } from "./errors.js";

export const ROUTE_PROFILE_BRIEF_USAGE =
  "usage: slopweaver route profile-brief --sources <manifest.json> [--held-out <cases.json>] [--home <dir>] --json";

export const ROUTE_PROFILE_BRIEF_FLAG_NAMES = ["--sources", "--held-out", "--home", "--json"] as const;

const VERB_ARG_OFFSET = 4;

interface ProfileBriefRequest {
  readonly sourcesPath: string;
  readonly heldOutPath?: string;
  readonly home?: string;
}

/**
 * Parse the profile-brief argv tail without performing I/O.
 *
 * @param rest the argv tail after `route profile-brief`
 * @returns parsed flags or their syntax errors
 */
export function parseRouteProfileBriefArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: ["json"], string: ["sources", "held-out", "home"] } });
}

/** Turn parsed flags into the required request. */
function requestFromFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<ProfileBriefRequest> {
  const sourcesPath = values["sources"];
  const heldOutPath = values["held-out"];
  const home = values["home"];
  const errors = [
    typeof sourcesPath !== "string" || sourcesPath.trim().length === 0 ? "--sources is required" : undefined,
    values["json"] !== true ? "--json is required" : undefined,
  ].filter((problem): problem is string => problem !== undefined);
  if (errors.length > 0 || typeof sourcesPath !== "string") {
    return err(errors);
  }
  return ok({
    sourcesPath,
    ...(typeof heldOutPath === "string" ? { heldOutPath } : {}),
    ...(typeof home === "string" ? { home } : {}),
  });
}

/** One `{label, path}` row from a sources manifest file. */
interface SourceManifestRow {
  readonly label: string;
  readonly path: string;
}

/** Read and validate a `[{label, path}, …]` sources manifest. */
function readSourcesManifest({ path }: { path: string }): Result<readonly SourceManifestRow[], RouteCommandError> {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "route.readSourcesManifest", path });
  if (read.isErr()) {
    return err(RouteCommandErrors.fileUnreadable({ detail: read.error.message, label: "sources manifest", path }));
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(read.value);
  } catch {
    return err(RouteCommandErrors.fileNotJson({ label: "sources manifest", path }));
  }
  if (!Array.isArray(decoded)) {
    return err(RouteCommandErrors.sourcesNotArray({ path }));
  }
  const rows: SourceManifestRow[] = [];
  for (const [index, entry] of decoded.entries()) {
    if (!isRecord(entry) || typeof entry["label"] !== "string" || typeof entry["path"] !== "string") {
      return err(RouteCommandErrors.sourceRowInvalid({ index, path }));
    }
    rows.push({ label: entry["label"], path: entry["path"] });
  }
  return ok(rows);
}

/** Read and hash a `["case text", …]` held-out file into `sha256:<hex>` hashes. */
function readHeldOutHashes({ path }: { path: string }): Result<readonly string[], RouteCommandError> {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "route.readHeldOut", path });
  if (read.isErr()) {
    return err(RouteCommandErrors.fileUnreadable({ detail: read.error.message, label: "held-out cases", path }));
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(read.value);
  } catch {
    return err(RouteCommandErrors.fileNotJson({ label: "held-out cases", path }));
  }
  if (!Array.isArray(decoded) || decoded.some((entry) => typeof entry !== "string")) {
    return err(RouteCommandErrors.heldOutNotStrings({ path }));
  }
  return ok(decoded.map((text: string) => sha256Text({ text })));
}

/** Scan every manifest row; an empty or absent root is left out, an unreadable one refuses the whole brief. */
function scanSources({
  rows,
}: {
  rows: readonly SourceManifestRow[];
}): Result<readonly JudgementSourceSample[], JudgementSourceScanError> {
  const sources: JudgementSourceSample[] = [];
  for (const row of rows) {
    const scanned = scanJudgementSource({ label: row.label, root: row.path });
    if (scanned.isErr()) {
      return err(scanned.error);
    }
    if (scanned.value !== undefined) {
      sources.push(scanned.value);
    }
  }
  return ok(sources);
}

/**
 * Run the profile-brief verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runRouteProfileBrief(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ROUTE_PROFILE_BRIEF_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRouteProfileBriefArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_PROFILE_BRIEF_USAGE });
    return EXIT_USAGE;
  }
  const request = requestFromFlags({ values: parsed.value.values });
  if (request.isErr()) {
    request.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_PROFILE_BRIEF_USAGE });
    return EXIT_USAGE;
  }
  const manifest = readSourcesManifest({ path: request.value.sourcesPath });
  if (manifest.isErr()) {
    routeCommandErrorLines({ error: manifest.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const heldOut =
    request.value.heldOutPath === undefined
      ? ok<readonly string[], RouteCommandError>([])
      : readHeldOutHashes({ path: request.value.heldOutPath });
  if (heldOut.isErr()) {
    routeCommandErrorLines({ error: heldOut.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const sources = scanSources({ rows: manifest.value });
  if (sources.isErr()) {
    logger.error({ msg: sources.error.message });
    return EXIT_ERROR;
  }
  const brief = buildJudgementMiningBrief({ heldOutSourceHashes: heldOut.value, sources: sources.value });
  if (brief.isErr()) {
    logger.error({ msg: brief.error.message });
    return EXIT_ERROR;
  }
  writeJudgementMiningBrief({
    brief: brief.value,
    ...(request.value.home === undefined ? {} : { home: request.value.home }),
  });
  logger.out({ line: JSON.stringify(brief.value, null, 2) });
  return EXIT_OK;
}

export const routeProfileBriefCommand = defineCommand({ run: runRouteProfileBrief });
