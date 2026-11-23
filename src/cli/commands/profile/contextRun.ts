/**
 * `slopweaver profile context` — the by-hand read a session whose boot load of their profile failed runs to get it in.
 *
 * Its own module rather than a fifth verb in `./run.ts` because it is the one profile verb that never opens the
 * store directly and is the one that writes the load ledger (`../../../context/loadLedger.ts`): its seam is the
 * always-loaded load, not the curation reads beside it. Human report and `--json` both go to stdout, as before.
 */
import { machineNeverConfigured } from "../../../admit/profileFirstBoot.js";
import { slopweaverHome } from "../../../config.js";
import { noProfileIn } from "../../../context/cachedContext.js";
import type { LoadedContext } from "../../../context/load.js";
import { byHandRows, profileBlockLines } from "../../../context/loadLedger.js";
import { appendProfileLoad } from "../../../context/loadLedgerStore.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { loadContextSettlingMarks } from "./contextLoad.js";
import { parseProfileShowArgs, profileTail } from "./core.js";

const CONTEXT_USAGE = "usage: slopweaver profile context [--json]";
/** How long a hand-run `profile context` waits, which is longer because a person is watching it. */
const CONTEXT_BOUND_MS = 10_000;

/**
 * Render the always-loaded context a session receives, live or from the cache, and say which.
 *
 * Records the load against every id the calling session goes by, so a success clears the door's refusal and the
 * chair's note for that session, and a failure is on record exactly as a failed hook would be. It exits non-zero
 * when no profile arrived on a configured machine: a session told to run this before acting as them must not read an
 * exit 0 as permission. A first boot is no failure — there is no profile yet to have lost — so it exits 0 with the
 * `# FIRST BOOT` block (`--json`: `firstBoot: true`) and records nothing ({@link profileContextDisposition}). A failed
 * write of the row is said on stderr and changes nothing else.
 *
 * @param argv the full process argv
 * @returns `EXIT_OK` when their profile arrived (live or cached) or on a first boot, `EXIT_ERROR` when nothing did on a
 *   configured machine
 */
export async function runProfileContext(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CONTEXT_USAGE });
    return EXIT_OK;
  }
  const args = parseProfileShowArgs({ rest });
  if (args.isErr()) {
    for (const msg of [...args.error, CONTEXT_USAGE]) {
      logger.error({ msg });
    }
    return EXIT_USAGE;
  }
  const loaded = await loadContextSettlingMarks({ boundMs: CONTEXT_BOUND_MS });
  const firstBoot = noProfileIn({ loaded }) && machineNeverConfigured({ home: slopweaverHome() });
  for (const line of profileContextReport({ firstBoot, json: args.value.json, loaded })) {
    logger.out({ line });
  }
  const disposition = profileContextDisposition({ firstBoot, loaded });
  if (disposition.recordLoad) {
    recordByHandLoad({ loaded });
  }
  return disposition.exitCode;
}

/**
 * What one by-hand load means for its exit code and the ledger: a first boot loaded nothing and lost nothing, so it
 * is neither a failure to exit on nor a failed load for the `profile-unloaded` monitor to card.
 *
 * @param firstBoot whether no profile loaded on a machine never configured
 * @param loaded what the load produced
 * @returns the exit code, and whether the load is recorded
 */
export function profileContextDisposition({ firstBoot, loaded }: { firstBoot: boolean; loaded: LoadedContext }): {
  readonly exitCode: typeof EXIT_OK | typeof EXIT_ERROR;
  readonly recordLoad: boolean;
} {
  if (firstBoot) {
    return { exitCode: EXIT_OK, recordLoad: false };
  }
  if (loaded.origin !== "none") {
    return { exitCode: EXIT_OK, recordLoad: true };
  }
  return { exitCode: EXIT_ERROR, recordLoad: true };
}

/**
 * The report: the loaded block under a `# STOP` warning when nothing arrived — or the first-boot lines in its place on
 * a never-configured machine — or the whole load as JSON.
 *
 * @param json whether `--json` was passed
 * @param loaded what the load produced
 * @param firstBoot whether no profile loaded on a machine never configured
 * @returns the lines to print
 */
export function profileContextReport({
  json,
  loaded,
  firstBoot,
}: {
  json: boolean;
  loaded: LoadedContext;
  firstBoot: boolean;
}): readonly string[] {
  if (json) {
    return [safeJsonStringify({ label: "profile report", value: { ...loaded, firstBoot } })];
  }
  const origin = loaded.reason === "" ? loaded.origin : `${loaded.origin} — ${loaded.reason}`;
  return [...profileBlockLines({ firstBoot, loaded }), `origin: ${origin}`];
}

/** Record this load against every id the calling session goes by; a failed write is said on stderr, nothing more. */
function recordByHandLoad({ loaded }: { loaded: LoadedContext }): void {
  const rows = byHandRows({
    atIso: new Date().toISOString(),
    cwd: process.cwd(),
    origin: loaded.origin,
    ownerAbsent: loaded.ownerAbsent === true,
    reason: loaded.reason,
    sessionIds: currentSessionIds({ env: process.env }),
  });
  for (const row of rows) {
    const written = appendProfileLoad({ home: slopweaverHome(), row });
    if (written.isErr()) {
      logger.error({ msg: `profile context: this load was not recorded — ${written.error.message}` });
    }
  }
  // No delivery marker, deliberately: the environment names the SESSION, never which of its contexts printed this — a
  // subagent's run would mark its parent's. The cache this load just refreshed is what the `profile-held` hold reads,
  // so the caller's next guarded call is held once, handed their profile, and marks the context that really holds it.
}

export const profileContextCommand = defineCommand({ run: runProfileContext });
