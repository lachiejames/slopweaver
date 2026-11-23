/**
 * `slopweaver route capabilities-merge` — merge a private installation's own capability-profile source
 * file into the installed `$SLOPWEAVER_HOME/capability-profile.json`, additively.
 *
 * This is the fix for a real, measured drift: a private installation (e.g. a work-console-backed one) can
 * commit its OWN source-of-truth capability list in its own repository, edit it freely there, and never
 * have any of that reach a live turn — `turn brief` reads only the installed file, and nothing ever copies
 * one into the other. This verb is the copy step. It knows nothing about what a capability actually does;
 * it only merges one already-validated {@link "../../../route/profile.js".CapabilityProfile} into another,
 * and reports what it added versus what it left alone because the installed file already declared it.
 */
import { readFileSync } from "node:fs";

import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { type CapabilityProfile, mergeCapabilityProfiles, parseCapabilityProfile } from "../../../route/profile.js";
import { loadCapabilityProfile, writeCapabilityProfile } from "../../../route/profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { type RouteCommandError, RouteCommandErrors, routeCommandErrorLines } from "./errors.js";

export const ROUTE_CAPABILITIES_MERGE_USAGE =
  "usage: slopweaver route capabilities-merge --from <capabilities.json> [--home <dir>] [--dry-run] --json";

export const ROUTE_CAPABILITIES_MERGE_FLAG_NAMES = ["--dry-run", "--from", "--home", "--json"] as const;

const VERB_ARG_OFFSET = 4;

interface CapabilitiesMergeRequest {
  readonly fromPath: string;
  readonly dryRun: boolean;
  readonly home: string;
}

/**
 * Parse the capabilities-merge argv tail without performing I/O.
 *
 * @param rest the argv tail after `route capabilities-merge`
 * @returns parsed flags or their syntax errors
 */
export function parseRouteCapabilitiesMergeArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: ["dry-run", "json"], string: ["from", "home"] } });
}

/** Turn parsed flags into the required request. */
function requestFromFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<CapabilitiesMergeRequest> {
  const fromPath = values["from"];
  const home = values["home"];
  const errors = [
    typeof fromPath !== "string" || fromPath.trim().length === 0 ? "--from is required" : undefined,
    values["json"] !== true ? "--json is required" : undefined,
  ].filter((problem): problem is string => problem !== undefined);
  if (errors.length > 0 || typeof fromPath !== "string") {
    return err(errors);
  }
  return ok({ dryRun: values["dry-run"] === true, fromPath, home: typeof home === "string" ? home : slopweaverHome() });
}

/** Read and validate the incoming capability-profile source file. */
function readIncomingProfile({ path }: { path: string }): Result<CapabilityProfile, RouteCommandError> {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "route.readCapabilitiesFrom", path });
  if (read.isErr()) {
    return err(RouteCommandErrors.fileUnreadable({ detail: read.error.message, label: null, path }));
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(read.value);
  } catch {
    return err(RouteCommandErrors.fileNotJson({ label: null, path }));
  }
  const parsed = parseCapabilityProfile({ value: decoded });
  if (parsed.isErr()) {
    return err(RouteCommandErrors.profileInvalid({ label: null, path, problems: parsed.error }));
  }
  return ok(parsed.value);
}

/**
 * Run the capabilities-merge verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runRouteCapabilitiesMerge(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ROUTE_CAPABILITIES_MERGE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRouteCapabilitiesMergeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_CAPABILITIES_MERGE_USAGE });
    return EXIT_USAGE;
  }
  const request = requestFromFlags({ values: parsed.value.values });
  if (request.isErr()) {
    request.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_CAPABILITIES_MERGE_USAGE });
    return EXIT_USAGE;
  }
  const incoming = readIncomingProfile({ path: request.value.fromPath });
  if (incoming.isErr()) {
    routeCommandErrorLines({ error: incoming.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const { home } = request.value;
  const installed = loadCapabilityProfile({ home });
  if (installed.kind === "unreadable") {
    logger.error({ msg: installed.why });
    return EXIT_ERROR;
  }
  const existing = installed.kind === "profile" ? installed.profile : { capabilities: [], schemaVersion: 1 as const };
  const result = mergeCapabilityProfiles({ existing, incoming: incoming.value });
  if (result.added.length === 0) {
    logger.out({
      line: `nothing to add — ${String(result.skipped.length)} already installed: ${result.skipped.join(", ")}`,
    });
    return EXIT_OK;
  }
  if (!request.value.dryRun) {
    writeCapabilityProfile({ home, profile: result.merged });
  }
  const verb = request.value.dryRun ? "would add" : "added";
  logger.out({ line: `${verb} ${String(result.added.length)}: ${result.added.join(", ")}` });
  if (result.skipped.length > 0) {
    logger.out({ line: `already installed, left untouched: ${result.skipped.join(", ")}` });
  }
  return EXIT_OK;
}

export const routeCapabilitiesMergeCommand = defineCommand({ run: runRouteCapabilitiesMerge });
