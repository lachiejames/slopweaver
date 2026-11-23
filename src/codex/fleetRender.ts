/**
 * The human shape of a Codex fleet assessment — one line per fact, derived from the same report the
 * `--json` document carries, so the two can never describe different fleets.
 *
 * Pure: an assessment in, lines out. Nothing here recomputes anything; if a number is not on the report it
 * does not appear, which is what stops a renderer quietly inventing a friendlier answer than the data.
 */
import type { CodexFleetAssessment, CodexFleetRow, CodexSpread } from "./fleetAssessment.js";
import { type CodexWindowLabel, codexWindowByLabel } from "./gauge.js";

/** A percentage as a reader sees it, or the honest absence. */
function percentText({ percent }: { percent: number | null }): string {
  if (percent === null) {
    return "unread";
  }
  return `${String(Math.round(percent))}%`;
}

/**
 * One window's percentage, with the instant it resets when the reading carries one — or NOT MEASURED for a
 * `monthly-spend` row, whose allowance no window measures, so it never reads as `0%` or as merely unread.
 *
 * The console voice reads this text to answer "when do the Codex plans come back",
 * and an eligible row used to print a bare percentage, its reset only in `--json`. A reset is printed only beside a
 * percentage the report kept — `reportedPercent` drops a window that has already reopened, and its old reset with it.
 *
 * @param row the destination's report row
 * @param label which window
 * @param percent the row's reported percentage for that window
 * @returns the percentage, and its reset when known
 */
function windowText({
  label,
  percent,
  row,
}: {
  label: CodexWindowLabel;
  percent: number | null;
  row: CodexFleetRow;
}): string {
  if (row.allowance === "monthly-spend") {
    return "NOT MEASURED";
  }
  const used = percentText({ percent });
  if (percent === null || row.gauge === null) {
    return used;
  }
  const resetAtIso = codexWindowByLabel({ gauge: row.gauge, label })?.resetAtIso;
  if (resetAtIso === undefined) {
    return used;
  }
  return `${used} (resets ${resetAtIso})`;
}

/** The spread line, which states what could not be compared rather than printing a bare number. */
function spreadText({ spread }: { spread: CodexSpread }): string {
  if (spread.kind === "not-applicable") {
    return `not applicable — ${spread.reason}`;
  }
  return `${String(Math.round(spread.points))} points across ${String(spread.samples)} of ${String(spread.ofDestinations)} destination(s)`;
}

/** The free resets a row holds unused, as a clause, or nothing when it holds none or the count is unread. */
function resetsText({ row }: { row: CodexFleetRow }): string {
  if (row.resetCreditsAvailable === null || row.resetCreditsAvailable === 0) {
    return "";
  }
  return ` · ${String(row.resetCreditsAvailable)} free reset(s) unused`;
}

/**
 * Who the store's own app-server says is signed in, or why it could not say.
 *
 * Only a live `account/read` may put "signed in as" on this surface; the register's cached email stays
 * labelled unverified beside it, so a reader sees when the two disagree.
 */
function accountText({ row }: { row: CodexFleetRow }): string {
  const resets = resetsText({ row });
  switch (row.liveState) {
    case "signed-in":
      if (row.liveEmail === null) {
        return `signed in to an account with no email (live)${resets}`;
      }
      return `signed in as ${row.liveEmail} (live)${resets}`;
    case "signed-out":
      return "NOT signed in (live)";
    case "store-missing":
      return "store directory missing";
    case "unreadable":
      if (row.liveUnreadableReason === null) {
        return "live read unavailable — no reason given";
      }
      return `live read unavailable — ${row.liveUnreadableReason}`;
    default: {
      const unhandled: never = row.liveState;
      return unhandled;
    }
  }
}

/**
 * The line saying a row's cached address and its store's live one disagree, or nothing when they do not.
 *
 * MEASURED: `~/.codex` was signed into a different account by a plain `codex login`, and the row
 * went on calling it after the old one — both addresses were printed, three lines apart, and nothing said they
 * differed. A claim is made only when BOTH are known: an absent side is not a disagreement.
 *
 * @param row the destination's report row
 * @returns the drift line, or none
 */
function accountDriftLines({ row }: { row: CodexFleetRow }): readonly string[] {
  if (row.emailCached === null || row.liveEmail === null || row.emailCached === row.liveEmail) {
    return [];
  }
  return [
    `      ACCOUNT DRIFT: the row says ${row.emailCached}, the store is signed in as ${row.liveEmail} — run slopweaver plans sync-accounts`,
  ];
}

/**
 * Whether a row names a five-hour window: it reports a five-hour percentage, or its reading carries that window even
 * though nothing current was read from it. The one predicate the row line and the `--full` header both ask, so the
 * header never drops a count for a window a row still prints.
 */
function rowShowsFiveHour({ row }: { row: CodexFleetRow }): boolean {
  if (row.fiveHourUsedPercent !== null) {
    return true;
  }
  return row.gauge !== null && codexWindowByLabel({ gauge: row.gauge, label: "five-hour" }) !== undefined;
}

/**
 * A row's windows, each with its reset when the reading carries one. The week is always named, `unread` when it is
 * absent; the five-hour clause only when the row reports a five-hour percentage or its reading carries that window
 * (one that has reopened prints `unread`, as the week does). Measured, Codex now writes the weekly
 * window alone (`slopweaver codex gauge`), so a standing `5h unread` named a window that does not exist as one nobody
 * looked at. The window stays PARSED and ranked (`./gauge.ts`), so a reading that carries one again prints it.
 */
function windowsText({ row }: { row: CodexFleetRow }): string {
  const week = `week ${windowText({ label: "weekly", percent: row.weeklyUsedPercent, row })}`;
  if (!rowShowsFiveHour({ row })) {
    return week;
  }
  return `${week} / 5h ${windowText({ label: "five-hour", percent: row.fiveHourUsedPercent, row })}`;
}

/**
 * Why a row's reading is less than a live, scanned one, as trailing clauses, or nothing when it is both. A store the
 * live read could not vouch for, and a scan a deadline skipped, are what make its windows read "unread", so they
 * stay on the default line: under `talk verb`'s deadline every row says so without `--full`.
 *
 * A non-zero `filesSkipped` is deliberately NOT here. It counts files the scan stopped before because none of them
 * could hold a current reading of any window (`walkMayStop`, `./gaugeScan.ts`) — an early stop the walk proved
 * safe, never a read that failed — so it is detail, and `--full` prints it.
 */
function degradedText({ row }: { row: CodexFleetRow }): string {
  const live = row.liveState === "signed-in" ? "" : ` · ${accountText({ row })}`;
  const scan = row.scanSkippedReason === undefined ? "" : ` · rollout scan ${row.scanSkippedReason}`;
  return `${live}${scan}`;
}

/**
 * One destination as the default read gives it: its windows, what the fleet read concluded and why, any free resets
 * it holds and why its reading is degraded — the line that decides where a prompt goes — plus the drift line when
 * its account moved, which is a defect to act on rather than detail.
 */
function summaryLines({ row }: { row: CodexFleetRow }): readonly string[] {
  return [
    `  ${row.alias} — ${windowsText({ row })} · ${row.disposition}: ${row.dispositionReason}${resetsText({ row })}${degradedText({ row })}`,
    ...accountDriftLines({ row }),
  ];
}

/** One destination's lines under `--full`: what it is, who is signed in, and what the fleet read concluded about it. */
function rowLines({ row }: { row: CodexFleetRow }): readonly string[] {
  const email = row.emailCached === null ? "no cached email" : `called after ${row.emailCached} (unverified)`;
  const age =
    row.observationAgeSeconds === null ? "no dated reading" : `read ${String(row.observationAgeSeconds)}s ago`;
  let scanned = `scanned ${String(row.filesRead)} file(s), ${String(row.filesSkipped)} beyond the bound`;
  if (row.scanSkippedReason !== undefined) {
    scanned = `rollout scan ${row.scanSkippedReason}`;
  }
  return [
    `  ${row.alias} — ${windowsText({ row })}, ${row.gaugeSource} reading, ${age}`,
    `      ${accountText({ row })}`,
    `      ${row.allowance} allowance, usage limit ${String(row.usageLimitPercent)}%`,
    ...accountDriftLines({ row }),
    `      ${row.disposition}: ${row.dispositionReason}`,
    `      ${row.codexHome} · ${email} · ${scanned}`,
  ];
}

/**
 * Render one fleet assessment for a terminal.
 *
 * By default each destination is ONE summary line — its windows, its disposition and why, its free resets — with an
 * ACCOUNT DRIFT line beneath it only when its account moved; the header is the choice and the counts. `full` adds
 * each destination's signed-in account, allowance, store and scan, and the header's model, spread and ranking basis.
 * MEASURED: 3,267 characters over 36 lines for a five-destination fleet (repro: `slopweaver codex
 * route` against `--full`). Notes, advisories and the instead line print in both.
 *
 * @param assessment the derived report
 * @param full whether to print each destination's detail lines and the whole header
 * @returns the lines to print, in order
 */
export function renderCodexFleet({
  assessment,
  full,
}: {
  assessment: CodexFleetAssessment;
  full: boolean;
}): readonly string[] {
  const chosen =
    assessment.selection.kind === "selected"
      ? `${assessment.selection.destination.alias} (${assessment.selection.destination.codexHome})`
      : `NONE — ${assessment.selection.reason}`;
  const diagnostics = assessment.registerDiagnostics.map(
    (diagnostic) => `  note [${diagnostic.code}]: ${diagnostic.message}`,
  );
  const instead = assessment.insteadDo === null ? [] : [`  instead: ${assessment.insteadDo}`];
  const advisories = assessment.advisories.map((advisory) => `  advisory: ${advisory}`);
  const counts = `${String(assessment.destinations)} destination(s), ${String(assessment.unpaused)} unpaused, ${String(assessment.refusing)} refusing`;
  if (!full) {
    return [
      `codex route: ${chosen}`,
      `  ${counts}, read at ${assessment.readAtIso} (--full for each one's account, allowance, store and scan)`,
      ...assessment.rows.flatMap((row) => summaryLines({ row })),
      ...diagnostics,
      ...advisories,
      ...instead,
    ];
  }
  // The five-hour count is named only when some row names that window (`rowShowsFiveHour`), so `0 of N` still prints
  // for a window a reading carries and nothing current was read from.
  let fiveHourCount = "";
  if (assessment.rows.some((row) => rowShowsFiveHour({ row }))) {
    fiveHourCount = ` · five-hour: ${String(assessment.fiveHourMeasured)} of ${String(assessment.destinations)}`;
  }
  const header = [
    `codex route: ${chosen}`,
    `  requested model: ${assessment.requestedModel}`,
    `  read at: ${assessment.readAtIso}`,
    `  ${counts}`,
    `  weekly readings: ${String(assessment.weeklyMeasured)} of ${String(assessment.destinations)}${fiveHourCount}`,
    `  weekly spread: ${spreadText({ spread: assessment.weeklySpread })}`,
    `  ranked on: ${assessment.ranking.basis}`,
  ];
  const rows = assessment.rows.flatMap((row) => rowLines({ row }));
  return [...header, ...rows, ...diagnostics, ...advisories, ...instead];
}
