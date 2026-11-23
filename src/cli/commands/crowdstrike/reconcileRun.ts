/**
 * `slopweaver crowdstrike reconcile [--fleet <file>] [--json] [--home <dir>]` — print where this atlas's two
 * surfaces disagree, and where CrowdStrike disagrees with another fleet source about which machines exist.
 *
 * ## It resolves nothing, on purpose
 *
 * When two surfaces disagree the atlas records the disagreement rather than picking a winner — that is the
 * owner's ruling and the reasoning is not about difficulty: sometimes the vendor is simply like that, and
 * VISIBILITY over the gotcha IS the product. Which surface wins is the owner's call, reserved until the owner can see real
 * instances. This verb produces the instances; it changes nothing on disk and makes no network call.
 *
 * ## The two halves answer different questions
 *
 * The SURFACE half needs nothing but the atlas: it names every endpoint the console was observed calling
 * that the closed API inventory has no admitted call for. Each one says Falcon HOLDS that data and this
 * installation cannot ask for it — a lead to take to CrowdStrike, never a capability to offer.
 *
 * The FLEET half needs a second source, supplied as a JSON file of `{providerId, serialNumber, hostname,
 * macAddress, assignedTo}` records — the shape a sibling MDM or directory atlas exports. Without `--fleet`
 * that half is skipped and says so, rather than printing an empty result that reads like agreement.
 */
import { readFileSync } from "node:fs";

import type {
  CrowdstrikeConsoleRequest,
  CrowdstrikeHost,
  CrowdstrikeKindFile,
} from "../../../atlas/crowdstrike/entities.js";
import { CROWDSTRIKE_CALLS } from "../../../atlas/crowdstrike/inventory.js";
import { divergentSurfaces, type ForeignDevice, reconcileFleets } from "../../../atlas/crowdstrike/reconcile.js";
import { crowdstrikeAtlasPaths, readCrowdstrikeKindFile } from "../../../atlas/crowdstrike/store.js";
import { slopweaverHome } from "../../../homeDir.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  CROWDSTRIKE_RECONCILE_USAGE,
  parseCrowdstrikeReconcileOptions,
  renderCrowdstrikeReconciliation,
} from "./core.js";
import { type CrowdstrikeVerbError, CrowdstrikeVerbErrors, crowdstrikeVerbErrorLines } from "./errors.js";

/** One field of a foreign export row, trimmed, or `null` when it is not a non-blank string. */
function foreignText({ raw, field }: { raw: Record<string, unknown>; field: string }): string | null {
  const value = raw[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** A foreign row's id: its `providerId` when it names one, else its plain `id` — exports spell it either way. */
function foreignDeviceId({ raw }: { raw: Record<string, unknown> }): string | null {
  const named = foreignText({ field: "providerId", raw });
  if (named === null) {
    return foreignText({ field: "id", raw });
  }
  return named;
}

/**
 * Read a foreign fleet export, refusing anything that is not a list of joinable records.
 *
 * A record with no join key at all is DROPPED here rather than passed on: it could never match anything, so
 * carrying it would inflate the "not in CrowdStrike" list with rows that say nothing.
 *
 * @param path the JSON file to read
 * @returns the devices, or why the file is unusable
 */
export function readForeignFleet({ path }: { path: string }): Result<readonly ForeignDevice[], CrowdstrikeVerbError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    return err(CrowdstrikeVerbErrors.fleetUnreadable({ cause: errorMessage({ error }), path }));
  }
  const rows = isRecord(parsed) && Array.isArray(parsed["devices"]) ? parsed["devices"] : parsed;
  if (!Array.isArray(rows)) {
    return err(CrowdstrikeVerbErrors.fleetNotAList({ path }));
  }
  return ok(
    rows.flatMap((raw: unknown): readonly ForeignDevice[] => {
      if (!isRecord(raw)) {
        return [];
      }
      const providerId = foreignDeviceId({ raw });
      const device = {
        assignedTo: foreignText({ field: "assignedTo", raw }),
        hostname: foreignText({ field: "hostname", raw }),
        macAddress: foreignText({ field: "macAddress", raw }),
        serialNumber: foreignText({ field: "serialNumber", raw }),
      };
      const joinable = device.hostname !== null || device.macAddress !== null || device.serialNumber !== null;
      return providerId === null || !joinable ? [] : [{ ...device, providerId }];
    }),
  );
}

/** The hosts in a kind file, narrowed by its own discriminant so no cast is needed to reach a serial. */
function hostsOf({ file }: { file: CrowdstrikeKindFile | null }): readonly CrowdstrikeHost[] {
  return file?.kind === "host" ? file.entities : [];
}

/** The console requests in a kind file, narrowed the same way. */
function consoleRequestsOf({ file }: { file: CrowdstrikeKindFile | null }): readonly CrowdstrikeConsoleRequest[] {
  return file?.kind === "console-request" ? file.entities : [];
}

/**
 * Run the `crowdstrike reconcile` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runCrowdstrikeReconcile(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["reconcile"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CROWDSTRIKE_RECONCILE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCrowdstrikeReconcileOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CROWDSTRIKE_RECONCILE_USAGE });
    return EXIT_USAGE;
  }
  const { home, json, fleet: fleetPath } = parsed.value;

  const inputs = readReconcileInputs({ fleetPath, home });
  if (inputs.isErr()) {
    inputs.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const { hosts, consoleRequests, devices } = inputs.value;
  const report = {
    fleet: devices === null ? null : reconcileFleets({ devices, hosts }),
    surfaces: divergentSurfaces({ admittedPaths: CROWDSTRIKE_CALLS.map((call) => call.path), consoleRequests }),
  };
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return EXIT_OK;
  }
  for (const line of renderCrowdstrikeReconciliation({ hostCount: hosts.length, report })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Read everything the reconciliation compares, from local files only.
 *
 * The atlas half reads the STORE rather than the normalized view, because the store's entities are already
 * typed by kind — neither half needs a cast to reach a serial number or a path shape. The fleet half is
 * `null` when no export was named, which is what lets the report say "not run" instead of printing an empty
 * agreement.
 *
 * @param home the state home holding the atlas
 * @param fleetPath a second fleet source to join against, when one was named
 * @returns the hosts, the recorded console endpoints and the foreign devices, or every reason to refuse
 */
function readReconcileInputs({ home, fleetPath }: { home: string; fleetPath: string | undefined }): Result<{
  hosts: readonly CrowdstrikeHost[];
  consoleRequests: readonly CrowdstrikeConsoleRequest[];
  devices: readonly ForeignDevice[] | null;
}> {
  const paths = crowdstrikeAtlasPaths({ home });
  const hostFile = readCrowdstrikeKindFile({ kind: "host", paths });
  const requestFile = readCrowdstrikeKindFile({ kind: "console-request", paths });
  const fleet = fleetPath === undefined ? null : readForeignFleet({ path: fleetPath });
  const problems = [
    ...(hostFile.isErr() ? hostFile.error : []),
    ...(requestFile.isErr() ? requestFile.error : []),
    ...(fleet?.isErr() === true ? crowdstrikeVerbErrorLines({ error: fleet.error }) : []),
  ];
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    consoleRequests: consoleRequestsOf({ file: requestFile.isOk() ? requestFile.value : null }),
    devices: fleet?.isOk() === true ? fleet.value : null,
    hosts: hostsOf({ file: hostFile.isOk() ? hostFile.value : null }),
  });
}

export const crowdstrikeReconcileCommand = defineCommand({ run: runCrowdstrikeReconcile });
