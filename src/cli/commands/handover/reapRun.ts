/**
 * `slopweaver handover reap` — close the run cycles whose session died holding them.
 *
 * ## Why this WRITES by default, and why a report-only version would have been the defect
 *
 * The finding this verb answers is that the board already DETECTS every one of these and writes nothing:
 * `classifyWriterLiveness` returns `dead` and its three callers only render it into a message. A reaper that
 * printed a list and stopped would reproduce that exact shape one layer up — another correct verdict nobody
 * acts on — so `--dry-run` is the opt-in and applying is the default.
 *
 * MEASURED: 63 of 84 open cycles were held by a session the live-session registry proved dead, the
 * oldest untouched for 17 days, while the board went on reporting that work as in flight with nobody behind it.
 *
 * ## What it will not do
 *
 * It reaps a `dead` verdict and nothing else. `unknown` is skipped and COUNTED — `sessionLiveness` answers
 * `unknown` whenever any registry file will not decode, because a refusal names a file rather than a session,
 * so reaping there could close a run out from under a session still working in it. The summary states the
 * skipped count rather than printing "0 reaped" identically for a clean board and an unreadable registry.
 *
 * The decision itself is pure and lives in {@link ../../../handover/reap.ts}; everything here is the shell that
 * reads journals, reads the registry, and appends.
 */

import { readdirSync } from "node:fs";

import { planReap, type ReapCandidate, type ReapPlan, reapCandidateOf, reapSummary } from "../../../handover/reap.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { codexThreadObserver } from "../../../measurement/codexOpenFiles.js";
import type { CodexThreadObservation } from "../../../measurement/codexSessions.js";
import { isAlive } from "../../../measurement/measure.js";
import { defaultSessionsDir, discoverSessions, sessionLiveness } from "../../../measurement/sessions.js";
import type { Measured } from "../../../measurement/status.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { productionMonitorDeps } from "../monitor/deps.js";

import { fireSteerAtRiskIfSteered } from "./steerRiskCard.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover reap` accepts. */
const REAP_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["home", "now"],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_REAP_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: REAP_FLAGS }),
  ...booleanFlagsOf({ spec: REAP_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover reap`'s own flags, exported so the help-truth gate can exercise the REAL parser rather
 * than a restatement of it.
 *
 * @param rest the verb's own arguments, with the noun and verb already stripped
 * @returns the parsed flags, or the reasons the parse failed
 */
export function parseHandoverReapArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: REAP_FLAGS });
}

export const HANDOVER_REAP_USAGE = "usage: slopweaver handover reap [--dry-run] [--json] [--now <iso>] [--home <dir>]";

/**
 * The three liveness edges a reap decision reads, with the live-session registry read ONCE so every journal in
 * one pass is judged against the same instant's registry, and Codex's open files scanned at most once, and only
 * when a Codex writer is asked about.
 *
 * @returns the pid probe, the registry lookup and the Codex thread observer {@link reapCandidateOf} takes
 */
export function reapLivenessSeams(): {
  readonly processAlive: (args: { pid: number }) => boolean;
  readonly sessionLive: (args: { sessionId: string }) => Measured<boolean>;
  readonly codexThread: (args: { threadId: string }) => CodexThreadObservation;
} {
  const roster = discoverSessions({ sessionsDir: defaultSessionsDir() });
  return {
    codexThread: codexThreadObserver(),
    processAlive: isAlive,
    sessionLive: ({ sessionId }) => sessionLiveness({ roster, sessionId }),
  };
}

/**
 * Every run journal in the runs directory, by slug.
 *
 * A journal that will not decode is deliberately not reaped and not reported as a candidate: its disposition
 * is `unreadable`, which {@link planReap} skips by name, so the accounting stays complete.
 */
function candidatesFrom({ runsDir }: { runsDir: string }): readonly ReapCandidate[] {
  const seams = reapLivenessSeams();
  const selfSessionIds = currentSessionIds({ env: process.env });
  const slugs = readdirSync(runsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.slice(0, -".jsonl".length))
    .toSorted();
  const candidates: ReapCandidate[] = [];
  for (const slug of slugs) {
    const read = readRunJournal({ runsDir, slug });
    if (read.isErr()) {
      continue;
    }
    const candidate = reapCandidateOf({
      events: read.value.events,
      selfSessionIds,
      slug,
      unreadableLines: read.value.unreadable,
      ...seams,
    });
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

/**
 * Append one `orphaned` event per reapable cycle, reporting any journal that refused the write. A seat dying on a
 * row the owner explicitly steered is news they want now, so each landed append fires `steer-at-risk` for that row.
 *
 * @param plan the decided pass — only its `reapable` rows are written
 * @param home the state home the journals live under
 * @param nowIso the instant stamped on every `orphaned` event
 * @returns one message per journal that refused the append, empty when every write landed
 */
export async function applyReap({
  plan,
  home,
  nowIso,
}: {
  plan: ReapPlan;
  home: string;
  nowIso: string;
}): Promise<readonly string[]> {
  const runsDir = stateHomePaths({ home }).runs;
  const failures: string[] = [];
  for (const row of plan.reapable) {
    const appended = applyRowEvent({
      event: {
        atIso: nowIso,
        cycleEvents: row.cycleEvents,
        deadSessionId: row.deadSessionId,
        kind: "orphaned",
        lastEventIso: row.lastEventIso,
      },
      runsDir,
      slug: row.slug,
    });
    if (appended.isErr()) {
      failures.push(`${row.slug}: ${appended.error.message}`);
      continue;
    }
    await fireSteerAtRiskIfSteered({ deps: productionMonitorDeps(), home, slug: row.slug, verb: "handover reap" });
  }
  return failures;
}

/**
 * Reap every open run cycle whose writer the live-session registry proves is gone.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverReap(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HANDOVER_REAP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverReapArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: HANDOVER_REAP_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  const resolvedHome = resolveHome({ named: home });
  const runsDir = stateHomePaths({ home: resolvedHome }).runs;
  const nowIso = typeof values["now"] === "string" ? values["now"] : new Date().toISOString();
  const dryRun = values["dry-run"] === true;

  const plan = planReap({ candidates: candidatesFrom({ runsDir }) });

  // Applied before any receipt, in either output shape, so an output channel that fails cannot stop the write, nor
  // the steer-at-risk note it owes on a steered row.
  const failures = dryRun ? [] : await applyReap({ home: resolvedHome, nowIso, plan });

  if (values["json"] === true) {
    logger.out({ line: JSON.stringify({ ...plan, applied: !dryRun, failures, nowIso }, null, 2) });
    return failures.length === 0 ? EXIT_OK : EXIT_ERROR;
  }

  plan.reapable.forEach((row) => {
    logger.out({
      line: `  ${dryRun ? "would reap" : "reaped"} ${row.slug} — ${row.deadSessionId} died after ${row.lastEventIso}`,
    });
  });

  if (dryRun) {
    logger.out({ line: `handover reap (dry run): ${reapSummary({ applied: false, plan })}; nothing was written` });
    return EXIT_OK;
  }

  failures.forEach((failure) => {
    logger.error({ msg: `handover reap: ${failure}` });
  });
  logger.out({ line: `handover reap: ${reapSummary({ plan })}` });
  return failures.length === 0 ? EXIT_OK : EXIT_ERROR;
}

export const handoverReapCommand = defineCommand({
  run: (argv) => runHandoverReap(argv),
});
