/**
 * Where an onboarding self-evaluation's own bookkeeping lives — the report history a delta compares
 * against, and the board docs a top finding gets filed as.
 *
 * Deliberately NOT `slopweaverHome()`: an evaluation run exercises `skills/onboard/SKILL.md` against an
 * EMPTY temporary `$SLOPWEAVER_HOME` (a fresh install has no corpus, no secrets), so if this bookkeeping
 * used the same env-driven resolution, every report and every filed finding would vanish along with that
 * temporary home the moment the run ends — exactly the outcome "a delta against the previous run so a
 * regression is visible" and "file the findings ... as board docs" both depend on NOT happening. This
 * store always resolves against the real machine home, `~/.slopweaver` (or an explicit `--eval-home`),
 * regardless of what `$SLOPWEAVER_HOME` is pointed at for the exercise itself.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { userDefaultHome } from "../homeDir.js";
import { appendLines } from "../lib/appendSeparator.js";
import type { IngestError } from "../lib/ingestError.js";
import { isRecord } from "../lib/parsers.js";
import { type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import type { FrictionFinding, FrictionReport, UnprovenStep } from "./frictionReport.js";

/** One report, as recorded in the history file. Not exported: no caller outside this module needs it by name. */
interface StoredReportEntry {
  readonly recordedAt: string;
  readonly report: FrictionReport;
}

/**
 * The real machine home, independent of any `$SLOPWEAVER_HOME` override — see this module's own header.
 *
 * @returns the absolute path to `~/.slopweaver`
 */
export function defaultEvalHome(): string {
  return userDefaultHome();
}

/**
 * The report-history journal path under an eval home.
 *
 * @param evalHome the eval bookkeeping home
 * @returns the absolute path to that home's `onboard-eval/reports.jsonl`
 */
export function reportHistoryPath({ evalHome }: { evalHome: string }): string {
  return join(evalHome, "onboard-eval", "reports.jsonl");
}

/**
 * The real handover board directory under an eval home — filing here puts a finding straight on the board.
 *
 * @param evalHome the eval bookkeeping home
 * @returns the absolute path to that home's `handovers` directory
 */
export function evalHandoversDir({ evalHome }: { evalHome: string }): string {
  return join(evalHome, "handovers");
}

/** Whether a decoded value has the shape of one {@link FrictionFinding}. Positional: a `value is T` predicate. */
function isFrictionFindingShape(value: unknown): value is FrictionFinding {
  return (
    isRecord(value) &&
    typeof value["severity"] === "string" &&
    typeof value["stepId"] === "string" &&
    typeof value["skillRef"] === "string" &&
    typeof value["detail"] === "string" &&
    (value["verb"] === undefined || typeof value["verb"] === "string")
  );
}

/** The {@link UnprovenStep} sibling of {@link isFrictionFindingShape}. */
function isUnprovenStepShape(value: unknown): value is UnprovenStep {
  return (
    isRecord(value) &&
    typeof value["stepId"] === "string" &&
    typeof value["skillRef"] === "string" &&
    typeof value["detail"] === "string" &&
    (value["verb"] === undefined || typeof value["verb"] === "string")
  );
}

/** Whether a decoded value has the shape of one {@link FrictionReport}. Positional: a `value is T` predicate. */
function isFrictionReportShape(value: unknown): value is FrictionReport {
  return (
    isRecord(value) &&
    typeof value["runId"] === "string" &&
    typeof value["totalSteps"] === "number" &&
    typeof value["totalDurationSeconds"] === "number" &&
    Array.isArray(value["findings"]) &&
    value["findings"].every(isFrictionFindingShape) &&
    Array.isArray(value["unprovenSteps"]) &&
    value["unprovenSteps"].every(isUnprovenStepShape)
  );
}

/** Narrow a decoded JSON value to a {@link StoredReportEntry}, or say why it is not one. */
function parseStoredEntry({ value }: { value: unknown }): StoredReportEntry | undefined {
  if (!isRecord(value) || typeof value["recordedAt"] !== "string" || !isFrictionReportShape(value["report"])) {
    return undefined;
  }
  return { recordedAt: value["recordedAt"], report: value["report"] };
}

/**
 * Read every previously recorded report, oldest first. A missing history file is an empty history, not an
 * error — the overwhelmingly common case is the very first run.
 *
 * @param evalHome the eval bookkeeping home (see {@link defaultEvalHome})
 * @returns every readable entry, oldest first; a line that fails to parse is silently skipped rather than
 *   failing the whole read, the same tolerance `handover/ledger.ts` extends to its own journal
 */
export function readReportHistory({
  evalHome,
}: {
  evalHome: string;
}): Result<readonly StoredReportEntry[], IngestError> {
  const path = reportHistoryPath({ evalHome });
  return safeFs({
    execute: (): readonly StoredReportEntry[] => {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (error: unknown) {
        if (isRecord(error) && error["code"] === "ENOENT") {
          return [];
        }
        throw error;
      }
      const entries: StoredReportEntry[] = [];
      for (const line of text.split("\n")) {
        if (line.trim().length === 0) {
          continue;
        }
        let decoded: unknown;
        try {
          decoded = JSON.parse(line);
        } catch {
          continue;
        }
        const entry = parseStoredEntry({ value: decoded });
        if (entry !== undefined) {
          entries.push(entry);
        }
      }
      return entries;
    },
    operation: "onboardEval.readReportHistory",
    path,
  });
}

/**
 * The most recently recorded report, or undefined for a first-ever run. Pure.
 *
 * @param history every previously recorded report, oldest first
 * @returns the last entry's report, or undefined when history is empty
 */
export function mostRecentReport({ history }: { history: readonly StoredReportEntry[] }): FrictionReport | undefined {
  return history.at(-1)?.report;
}

/**
 * Append one report to the history journal, creating the directory on first use.
 *
 * @param evalHome the eval bookkeeping home
 * @param entry the entry to record
 * @returns the journal path written to
 */
export function appendReportEntry({
  evalHome,
  entry,
}: {
  evalHome: string;
  entry: StoredReportEntry;
}): Result<string, IngestError> {
  const path = reportHistoryPath({ evalHome });
  return safeFs({
    execute: (): string => {
      mkdirSync(join(evalHome, "onboard-eval"), { mode: 0o700, recursive: true });
      appendLines({ mode: 0o600, path, text: `${JSON.stringify(entry)}\n` });
      return path;
    },
    operation: "onboardEval.appendReportEntry",
    path,
  });
}

/**
 * Write one finding as a board doc under the real handover directory, so it shows up on `slopweaver
 * handover list` the same as any other doc.
 *
 * @param evalHome the eval bookkeeping home
 * @param slug the finding doc's slug (its filename, minus `.md`)
 * @param markdown the doc's complete text, frontmatter included
 * @returns the path written to
 */
export function writeFindingDoc({
  evalHome,
  slug,
  markdown,
}: {
  evalHome: string;
  slug: string;
  markdown: string;
}): Result<string, IngestError> {
  const dir = evalHandoversDir({ evalHome });
  const path = join(dir, `${slug}.md`);
  return safeFs({
    execute: (): string => {
      writeFileAtomic({ contents: markdown, dirMode: 0o700, fileMode: 0o600, path });
      return path;
    },
    operation: "onboardEval.writeFindingDoc",
    path,
  });
}
