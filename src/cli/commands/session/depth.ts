/**
 * `slopweaver session depth` — how many tokens each live session is carrying, and which ones are worth
 * respawning rather than nursing.
 *
 * The supervisor's sweep could already tell who is idle (`session watch`) and who is live (`session
 * standing`); what it could not tell, without opening every workspace and reading its `/clear to save …`
 * hint off the screen, was how EXPENSIVE each one had become. That gap is what the owner named, and it is the whole reason this verb exists: the sweep reads a number instead of a screen.
 *
 * Effectful edge only. The fold is `sessions/tokenDepth.ts`, the join is `sessions/depthReport.ts`, and both
 * are pure.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { logger } from "../../../lib/logger.js";
import type { Measured } from "../../../measurement/status.js";
import { listLiveCmuxWorkspaces } from "../../../sessionHarness/cmuxHost.js";
import {
  renderSessionDepthRow,
  type SessionDepthRow,
  type SessionUsage,
  type StandingSessions,
  sessionDepthRows,
} from "../../../sessions/depthReport.js";
import { readContextDepth } from "../../../sessions/depthStore.js";
import { scanSessions, transcriptPathFor } from "../../../sessions/liveSessionStore.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { modelWeightedUsage } from "../../../sessions/modelWeight.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { modelUsageTotals } from "../../../sessions/sessionCost.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { renderSupervisorUsageReport, supervisorUsageReport } from "../../../sessions/supervisorUsageReport.js";
import type { ContextDepth } from "../../../sessions/tokenDepth.js";
import { DEFAULT_DEPTH_REVIEW_THRESHOLD_TOKENS } from "../../../sessions/tokenDepth.js";
import { readTranscriptUsage } from "../../../sessions/transcriptUsageStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { boolFlag, numberFlagOr, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { findOpenSession } from "./standingLedger.js";

/** The live cmux inventory, or an empty one with the failure reported — a gauge must not die over a label. */
async function inventory(): Promise<readonly CmuxWorkspaceSummary[]> {
  const listed = await listLiveCmuxWorkspaces();
  if (listed.isErr()) {
    logger.error({
      msg: `session depth: the cmux inventory could not be read (${listed.error.message}) — reporting depths without workspace titles`,
    });
    return [];
  }
  return listed.value;
}

/**
 * What the caller can resolve about the one session the fleet keeps alive on purpose.
 *
 * The loop is resolved the same way `session standing` resolves it — from the ledger key the caller names,
 * never from an assumed naming convention this public repository must not carry.
 *
 * @param ledger the already-folded session ledger
 * @param loopSessionKey the ledger key the caller resolved as the loop's own, or `undefined`
 * @returns what could be resolved; it may stay `undefined`, which marks nothing rather than guessing
 */
function resolveStanding({
  ledger,
  loopSessionKey,
}: {
  ledger: readonly SessionItem[];
  loopSessionKey: string | undefined;
}): StandingSessions {
  const loop =
    loopSessionKey === undefined ? undefined : findOpenSession({ items: ledger, sessionKey: loopSessionKey });
  return { loopCwd: loop?.cwd };
}

/**
 * Scan the live session registry, reporting — never swallowing — every file it could not read.
 *
 * A registry file that will not decode is a session that will not appear, and an absent row on a gauge reads
 * as "nothing to worry about here" exactly the way a zero would.
 *
 * @param claudeHome the resolved `~/.claude`
 * @returns the decoded live sessions
 */
function liveSessionRecords({ claudeHome }: { claudeHome: string }): readonly SessionRecord[] {
  const scan = scanSessions({ sessionsDir: join(claudeHome, "sessions") });
  if (scan.unreadable !== undefined) {
    logger.error({ msg: `session depth: ${scan.unreadable}` });
  }
  scan.refused.forEach((refusal) => {
    logger.error({ msg: `session depth: a registry file was refused — ${refusal}` });
  });
  return scan.records;
}

/**
 * Every live session's depth, keyed by session id.
 *
 * @param claudeHome the resolved `~/.claude`
 * @param records the live sessions to measure
 * @returns each session's measured depth, or the reason it has none
 */
function depthsFor({
  claudeHome,
  records,
}: {
  claudeHome: string;
  records: readonly SessionRecord[];
}): Record<string, Measured<ContextDepth>> {
  const projectsDir = join(claudeHome, "projects");
  const depths: Record<string, Measured<ContextDepth>> = {};
  for (const record of records) {
    depths[record.sessionId] = readContextDepth({ projectsDir, sessionId: record.sessionId });
  }
  return depths;
}

/**
 * Every live session's whole-life usage, keyed by session id.
 *
 * Folded per session rather than once over the fleet, because the report needs both halves: a per-row figure
 * for "which of these should I look at" and a fleet figure for "where is the draw going". Both come off the
 * same `message.id`-deduplicated fold, so they cannot disagree.
 *
 * @param claudeHome the resolved `~/.claude`
 * @param records the live sessions to fold
 * @returns each session's usage, or the reason it has none
 */
function usagesFor({
  claudeHome,
  records,
}: {
  claudeHome: string;
  records: readonly SessionRecord[];
}): Record<string, Measured<SessionUsage>> {
  const projectsDir = join(claudeHome, "projects");
  const usages: Record<string, Measured<SessionUsage>> = {};
  for (const record of records) {
    const path = transcriptPathFor({ projectsDir, sessionId: record.sessionId });
    if (path === undefined) {
      usages[record.sessionId] = { known: false, why: "no transcript was found for this session" };
      continue;
    }
    const folded = readTranscriptUsage({ path });
    usages[record.sessionId] = folded.known
      ? {
          known: true,
          value: {
            byModel: modelUsageTotals({ cursor: folded.value }),
            duplicates: folded.value.duplicates,
            totals: folded.value.totals,
            unreadable: folded.value.unreadable,
            weighted: modelWeightedUsage({ usage: modelUsageTotals({ cursor: folded.value }) }),
          },
        }
      : folded;
  }
  return usages;
}

/**
 * Build every row the verb is about to print.
 *
 * @param parsed the verb's parsed flags
 * @param thresholdTokens the already-resolved review threshold
 * @returns one row per live session, deepest first
 */
async function buildRows({
  parsed,
  thresholdTokens,
}: {
  parsed: ParsedFlags;
  thresholdTokens: number;
}): Promise<readonly SessionDepthRow[]> {
  const home = resolveHome({ named: stringFlag({ name: "home", parsed }) });
  const claudeHome = join(homedir(), ".claude");
  const records = liveSessionRecords({ claudeHome });
  const ledger = foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home }) }).events });
  return sessionDepthRows({
    callerSessionId: process.env[CLAUDE_CODE_SESSION_ID_ENV],
    depths: depthsFor({ claudeHome, records }),
    ledger,
    records,
    standing: resolveStanding({ ledger, loopSessionKey: stringFlag({ name: "loop-session-key", parsed }) }),
    thresholdTokens,
    usages: usagesFor({ claudeHome, records }),
    workspaces: await inventory(),
  });
}

/**
 * Run `session depth`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionDepth(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "depth" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "depth" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "depth" }) });
    return EXIT_USAGE;
  }
  const threshold = numberFlagOr({
    fallback: DEFAULT_DEPTH_REVIEW_THRESHOLD_TOKENS,
    name: "threshold",
    parsed: parsed.value,
  });
  if ("error" in threshold) {
    logger.error({ msg: `session depth: ${threshold.error}` });
    return EXIT_USAGE;
  }
  const thresholdTokens = threshold.value;
  const rows = await buildRows({ parsed: parsed.value, thresholdTokens });
  const report = supervisorUsageReport({ observedAtIso: new Date().toISOString(), rows, thresholdTokens });
  if (boolFlag({ name: "json", parsed: parsed.value })) {
    logger.out({ line: JSON.stringify(report) });
    return EXIT_OK;
  }
  if (rows.length === 0) {
    logger.out({ line: "No live Claude sessions on this machine." });
    return EXIT_OK;
  }
  renderSupervisorUsageReport({ renderRow: renderSessionDepthRow, report }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const sessionDepthCommand = defineCommand({ run: runSessionDepth });
