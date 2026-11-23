/**
 * `slopweaver briefing card --open-pages <path> --drop <url> [--settled-by <slug>]` — the one row the owner's ruling
 * overtook, removed atomically, refused rather than guessed at. The decision is
 * `../../../briefing/openPageDrop.ts`; this edge reads the document, the home's lock-in ledger and, when one is
 * named, the settling board row, then writes.
 *
 * It shares `./formEditIo.ts`'s seams with every other briefing edit: atomic, single writer, and a refusal or
 * a dry run leaves the file exactly as it was.
 */
import { lstatSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  dropEvidenceText,
  dropOpenPageRow,
  type OpenPageDrop,
  type OpenPageDropEvidence,
  type SettlingRowReading,
} from "../../../briefing/openPageDrop.js";
import type { OpenPageDropError } from "../../../briefing/openPageDropErrors.js";

import { isSafeSlug, readRunJournal, runJournalPath } from "../../../handover/runStore.js";
import { readExactDoc } from "../../../handover/store.js";
import { slopweaverHome } from "../../../homeDir.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { BriefingCardDropArgs } from "./formEditArgs.js";
import { type BriefingFormEditDeps, formJsonText, readFormJson, writeFormText } from "./formEditIo.js";

/** Everything `briefing card --drop` touches outside itself, injected so a test drives the whole arm. */
export interface BriefingCardDropDeps extends BriefingFormEditDeps {
  /** The raw lock-in ledger of a home, empty when it has none, or why it would not read — never empty for that. */
  readonly readLockInsExact: (args: { home: string }) => Result<string>;
  /** One board row of a home by exact slug, read whole — doc and journal — or the reason it would not read. */
  readonly readBoardRow: (args: { home: string; slug: string }) => SettlingRowReading;
  /** The run's own instant — the caller's clock, never one read in the core. */
  readonly now: () => string;
}

/** What the arm reports once the row is dropped, as `--json` prints it. */
interface CardDropReport {
  readonly action: "dropped";
  readonly url: string;
  /** The dropped row's 1-based position in the document as it was. */
  readonly position: number;
  /** How many rows remain. */
  readonly rows: number;
  readonly evidence: OpenPageDropEvidence;
  readonly path: string;
  readonly written: boolean;
}

/**
 * Run `briefing card --drop` against injected seams.
 *
 * @param args the parsed drop arm
 * @param deps everything the arm touches outside itself
 * @returns the process exit code: error when the document or the drop is refused or the write fails, ok otherwise
 */
export function runBriefingCardDrop({
  args,
  deps,
}: {
  args: BriefingCardDropArgs;
  deps: BriefingCardDropDeps;
}): number {
  const { home = slopweaverHome() } = args;
  const document = readFormJson({ deps, path: args.openPagesPath });
  if (document.isErr()) {
    deps.writeDiagnostic(`briefing card: ${document.error.message}`);
    deps.writeDiagnostic(`briefing card: nothing was written to ${args.openPagesPath}`);
    return EXIT_ERROR;
  }
  const ledgerText = deps.readLockInsExact({ home });
  if (ledgerText.isErr()) {
    deps.writeDiagnostic(
      `briefing card: refused: ${ledgerText.error.join("; ")}, so the owner's last word on the page is unknown`,
    );
    deps.writeDiagnostic(`briefing card: nothing was written to ${args.openPagesPath}`);
    return EXIT_ERROR;
  }
  const settledBy = args.settledBy === undefined ? undefined : deps.readBoardRow({ home, slug: args.settledBy });
  const dropped = dropOpenPageRow({
    document: document.value,
    ledgerText: ledgerText.value,
    nowIso: deps.now(),
    settledBy,
    url: args.url,
  });
  if (dropped.isErr()) {
    refuse({ deps, error: dropped.error, path: args.openPagesPath });
    return EXIT_ERROR;
  }
  const report = reportOf({ args, dropped: dropped.value });
  if (args.dryRun) {
    print({ deps, json: args.json, report });
    return EXIT_OK;
  }
  const text = formJsonText({ form: dropped.value.document });
  if (text.isErr()) {
    deps.writeDiagnostic(`briefing card: ${text.error.message}; nothing was written to ${args.openPagesPath}`);
    return EXIT_ERROR;
  }
  const written = writeFormText({ deps, path: args.openPagesPath, text: text.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`briefing card: ${written.error.message}`);
    return EXIT_ERROR;
  }
  print({ deps, json: args.json, report: { ...report, written: true } });
  return EXIT_OK;
}

/** The report a run prints, before the write is known to have happened. */
function reportOf({ args, dropped }: { args: BriefingCardDropArgs; dropped: OpenPageDrop }): CardDropReport {
  return {
    action: "dropped",
    evidence: dropped.evidence,
    path: args.openPagesPath,
    position: dropped.position,
    rows: dropped.rows,
    url: args.url,
    written: false,
  };
}

/**
 * Say why nothing was written: the message, then — for a refusal that carries them — one line per reason.
 *
 * The branch on `code` is the one this arm takes: an unsettled page and a refused document are LISTS, and a
 * list joined into one line is the wall of text every gate here exists to refuse.
 */
function refuse({ deps, error, path }: { deps: BriefingCardDropDeps; error: OpenPageDropError; path: string }): void {
  deps.writeDiagnostic(`briefing card: ${error.message}`);
  if (error.code === "UNSETTLED") {
    for (const reason of error.reasons) {
      deps.writeDiagnostic(`  ${reason}`);
    }
  }
  if (error.code === "DOCUMENT_REFUSED") {
    for (const defect of error.defects) {
      deps.writeDiagnostic(`  ${defect}`);
    }
  }
  deps.writeDiagnostic(`briefing card: nothing was written to ${path}`);
}

/** Print the report: one JSON object, or one line. */
function print({ deps, json, report }: { deps: BriefingCardDropDeps; json: boolean; report: CardDropReport }): void {
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "briefing card drop report", value: report }));
    return;
  }
  const outcome = report.written ? `wrote ${report.path}` : `dry run, nothing written to ${report.path}`;
  deps.writeOut(
    `briefing card: dropped ${report.url} from row ${String(report.position)}; ${String(report.rows)} row(s) ` +
      `remain; settled by ${dropEvidenceText({ evidence: report.evidence })}; ${outcome}`,
  );
}

/** Whether an entry sits at the path itself while what it points at does not: a dangling link. */
function existsWithoutTarget({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
  } catch {
    return false;
  }
  try {
    statSync(path);
    return false;
  } catch {
    return true;
  }
}

/**
 * One board row of a home by exact slug, live or archived, with its whole run journal — or why it would not
 * read. Partial evidence is never handed on: a journal line that did not decode makes the row unreadable, so a
 * settlement is never read around a line that might have said something else.
 *
 * @param home the state home whose `handovers/` and `runs/` are read
 * @param slug the `--settled-by` value
 * @returns the row whole, or the reason it is not
 */
export function boardRowOnDisk({ home, slug }: { home: string; slug: string }): SettlingRowReading {
  if (!isSafeSlug({ slug })) {
    return { kind: "unreadable", slug, why: "the slug is not one the run store can open" };
  }
  const paths = stateHomePaths({ home });
  // A live doc that is a link to nothing reads as absent, so its archived predecessor would answer for it.
  const livePath = join(paths.handovers, `${slug}.md`);
  if (existsWithoutTarget({ path: livePath })) {
    return { kind: "unreadable", slug, why: `its doc ${livePath} is a link to nothing` };
  }
  const found = readExactDoc({ handoverDir: paths.handovers, slug });
  if (found.isErr()) {
    return { kind: "unreadable", slug, why: found.error.message };
  }
  if (found.value === undefined) {
    return { kind: "unreadable", slug, why: "no doc carries that board row, live or archived" };
  }
  // The run store reads a link to nothing as no journal; here that is a journal that exists and did not read.
  const journalPath = runJournalPath({ runsDir: paths.runs, slug });
  if (existsWithoutTarget({ path: journalPath })) {
    return { kind: "unreadable", slug, why: `its run journal ${journalPath} is a link to nothing` };
  }
  const journal = readRunJournal({ runsDir: paths.runs, slug });
  if (journal.isErr()) {
    return { kind: "unreadable", slug, why: `its run journal would not read — ${journal.error.message}` };
  }
  if (journal.value.unreadable.length > 0) {
    const lines = String(journal.value.unreadable.length);
    return { kind: "unreadable", slug, why: `${lines} line(s) of its run journal did not decode` };
  }
  return { doc: found.value.doc, events: journal.value.events, kind: "read", slug };
}
