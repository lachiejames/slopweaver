/**
 * `slopweaver session spend` — the token-optimisation pass: where the fleet's draw went by seat kind, model and
 * gate over whole UTC days, what each landed change cost, and every drain it can price with the fix.
 *
 * ## Why it exists
 *
 * A token-optimisation pass runs regularly and finds the fifty-percent wins across the fleet, proven by a before/after
 * reading of tokens per landed change, and stands as a recipe that posts a finding only when it has a win to
 * show, never a status. This is that measurement as a verb, and the weekly `token-pass-weekly` row (`../../../live/automation/standingMeasurementRows.ts`)
 * runs it.
 *
 * ## What `--finding` does, and why it exits 0 either way
 *
 * With `--finding`, a pass that has something to show (`sessions/spendSignal.ts`) registers ONE board finding
 * row through `handover register`, and a steady pass registers nothing. It exits 0 in both cases, so the
 * standing row stamps: a quiet week is not a failed row, and `../recipe/rowRunners.ts` reads a verb-run's `3` as
 * "nothing to do" and `4` as "still due", neither of which is what happened. A read that FAILED exits 1.
 *
 * Effectful edge only. The fold, the document, the verdict and the text are pure, under `sessions/spend*.ts`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { declaredMainCheckoutPaths } from "../../../admit/declaredMainCheckouts.js";
import { githubToken, originRepositoryOf } from "../../../config.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { countLandedByDay } from "../../../live/github/landedCount.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { type Measured, measured, unmeasurable } from "../../../measurement/status.js";
import { botSelfHandlesFromProfile } from "../../../profileStore.js";
import { lastReading, recordReading } from "../../../readings/store.js";
import { renderSpendReport } from "../../../sessions/spendRender.js";
import { type LandedDay, type SpendReport, spendReport, windowDays } from "../../../sessions/spendReport.js";
import {
  baselineOf,
  postedKeys,
  type SpendBaseline,
  type SpendSignal,
  spendVerdict,
} from "../../../sessions/spendSignal.js";
import { scanSpend } from "../../../sessions/spendStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { boolFlag, numberFlag, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { findingOutcome } from "./spendFinding.js";

/** The verb line this measurement is recorded and looked up under in the readings ledger. */
export const SPEND_PRODUCER = "session spend";

/** How many whole UTC days the pass reaches when the caller names none — one week. */
export const DEFAULT_SPEND_DAYS = 7;

/** Milliseconds in a day, for the instant the transcript walk is filtered on. */
const DAY_MS = 86_400_000;

/** The baseline the verdict compares against, or `undefined` with the reason said out loud. */
function readBaseline({ home }: { home: string | undefined }): SpendBaseline | undefined {
  const read = lastReading({ producer: SPEND_PRODUCER, ...(home === undefined ? {} : { home }) });
  if (read.isErr()) {
    if (read.error.code !== "NO_READING") {
      logger.error({ msg: `session spend: the readings ledger could not be read — ${read.error.message}` });
    }
    return undefined;
  }
  const baseline = baselineOf({ document: read.value.document });
  if (!baseline.known) {
    logger.error({ msg: `session spend: the last reading is not usable as a baseline — ${baseline.why}` });
    return undefined;
  }
  return baseline.value;
}

/** Append this document to the readings ledger, so the next pass has something to compare against. */
function record({
  by,
  document,
  report,
  home,
}: {
  by: string;
  document: string;
  report: SpendReport;
  home: string | undefined;
}): void {
  const written = recordReading({
    by,
    document,
    nowIso: new Date().toISOString(),
    observedAtIso: report.observedAtIso,
    producer: SPEND_PRODUCER,
    ...(home === undefined ? {} : { home }),
  });
  if (written.isErr()) {
    logger.error({ msg: `session spend: the reading was NOT recorded — ${written.error.message}` });
    return;
  }
  logger.error({ msg: `session spend: reading recorded as ${by} (${written.value.record.readingId})` });
}

/**
 * The repositories whose landings are counted: what `--repos` named, else every declared main checkout's own
 * `origin`, so no repository slug is committed here.
 */
function reposOf({ parsed, home }: { parsed: ParsedFlags; home: string | undefined }): readonly string[] {
  const named = stringFlag({ name: "repos", parsed });
  if (named !== undefined) {
    return named
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  const slugs = declaredMainCheckoutPaths(home === undefined ? {} : { home }).flatMap((cwd) => {
    const origin = originRepositoryOf({ cwd });
    if (origin.isErr()) {
      return [];
    }
    return [`${origin.value.owner}/${origin.value.repo}`];
  });
  return [...new Set(slugs)].toSorted();
}

/** Count the window's landings through the GitHub door, or say why they could not be counted. */
async function landingsOf({
  repos,
  days,
  home,
}: {
  repos: readonly string[];
  days: readonly string[];
  home: string | undefined;
}): Promise<Measured<readonly LandedDay[]>> {
  if (repos.length === 0) {
    return unmeasurable({ why: "no repository was named with --repos and no main checkout is declared" });
  }
  const token = githubToken(home === undefined ? {} : { home });
  const counted = await countLandedByDay({ days, graphql: githubReadGraphql({ token }), repos });
  if (counted.isErr()) {
    return unmeasurable({ why: counted.error.message });
  }
  return measured({ value: counted.value });
}

/** Which transcript corpus to walk — the live one, or a directory the caller named (a fixture, another host's). */
function projectsDirOf({ parsed }: { parsed: ParsedFlags }): string {
  const named = stringFlag({ name: "projects-dir", parsed });
  if (named !== undefined) {
    return named;
  }
  return join(homedir(), ".claude", "projects");
}

/** A fraction flag, or the usage problem. */
function fractionFlag({
  parsed,
  name,
}: {
  parsed: ParsedFlags;
  name: string;
}): { readonly value: number | undefined } | { readonly error: string } {
  const raw = stringFlag({ name, parsed });
  if (raw === undefined) {
    return { value: undefined };
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    return { error: `--${name} must be a fraction between 0 and 1, got ${JSON.stringify(raw)}` };
  }
  return { value };
}

/** How many whole days the window reaches: what `--days` named, else {@link DEFAULT_SPEND_DAYS}. */
function windowLengthOf({ days }: { days: number | undefined }): number {
  if (days === undefined) {
    return DEFAULT_SPEND_DAYS;
  }
  return days;
}

/** Build the document and its verdict, or the reason the pass could not run. */
async function measure({
  parsed,
}: {
  parsed: ParsedFlags;
}): Promise<{ readonly report: SpendReport; readonly signal: SpendSignal } | { readonly error: string }> {
  const days = numberFlag({ name: "days", parsed });
  if ("error" in days) {
    return { error: days.error };
  }
  const minShare = fractionFlag({ name: "min-share", parsed });
  if ("error" in minShare) {
    return { error: minShare.error };
  }
  const tolerance = fractionFlag({ name: "tolerance", parsed });
  if ("error" in tolerance) {
    return { error: tolerance.error };
  }
  const home = stringFlag({ name: "home", parsed });
  const observedAtIso = new Date().toISOString();
  const window = windowDays({ days: windowLengthOf({ days: days.value }), observedAtIso });
  const first = window[0];
  if (first === undefined) {
    return { error: "--days must be at least 1" };
  }
  let stateHome = slopweaverHome();
  if (home !== undefined) {
    stateHome = home;
  }
  const scanned = scanSpend({
    botHandles: botSelfHandlesFromProfile({ home: stateHome, reader: "session spend" }),
    projectsDir: projectsDirOf({ parsed }),
    sinceMs: Date.parse(`${first}T00:00:00.000Z`) - DAY_MS,
  });
  if (scanned.isErr()) {
    return { error: scanned.error.message };
  }
  scanned.value.problems.forEach((problem) => {
    logger.error({ msg: `session spend: ${problem} — this pass is INCOMPLETE` });
  });
  const repos = reposOf({ home, parsed });
  const report = spendReport({
    days: window,
    landings: await landingsOf({ days: window, home, repos }),
    observedAtIso,
    repos,
    transcripts: scanned.value.transcripts,
  });
  return {
    report,
    signal: spendVerdict({
      baseline: readBaseline({ home }),
      current: report,
      ...(minShare.value === undefined ? {} : { minShare: minShare.value }),
      ...(tolerance.value === undefined ? {} : { tolerance: tolerance.value }),
    }),
  };
}

/**
 * Run `session spend`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionSpend(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "spend" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "spend" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "spend" }) });
    return EXIT_USAGE;
  }
  if (
    boolFlag({ name: "finding", parsed: parsed.value }) &&
    stringFlag({ name: "record-reading", parsed: parsed.value }) === undefined
  ) {
    // The reading is what tells the NEXT pass a drain was already posted; a finding with no reading behind it
    // would be posted again by the very next pass, which is the weekly status the owner refused.
    logger.error({ msg: "session spend: --finding needs --record-reading <by>, or the next pass posts it again" });
    return EXIT_USAGE;
  }
  const measuredPass = await measure({ parsed: parsed.value });
  if ("error" in measuredPass) {
    logger.error({ msg: `session spend: ${measuredPass.error}` });
    return EXIT_ERROR;
  }
  const { report, signal } = measuredPass;
  const home = stringFlag({ name: "home", parsed: parsed.value });
  const posting = await findingOutcome({
    asked: boolFlag({ name: "finding", parsed: parsed.value }),
    // The reading is recorded AFTER the row, because it records whether the row was written; so the evidence
    // names the reading by its producer and instant, which is how `slopweaver readings` finds it.
    evidence: `reading:${SPEND_PRODUCER}@${report.observedAtIso}`,
    home,
    report,
    signal,
  });
  const document = JSON.stringify({
    ...report,
    posted: postedKeys({ registered: posting === "registered", signal }),
    verdict: signal,
  });
  const by = stringFlag({ name: "record-reading", parsed: parsed.value });
  if (by !== undefined) {
    record({ by, document, home, report });
  }
  if (boolFlag({ name: "json", parsed: parsed.value })) {
    logger.out({ line: document });
  } else {
    renderSpendReport({ report, signal }).forEach((line) => {
      logger.out({ line });
    });
  }
  if (posting === "failed") {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const sessionSpendCommand = defineCommand({ run: runSessionSpend });
