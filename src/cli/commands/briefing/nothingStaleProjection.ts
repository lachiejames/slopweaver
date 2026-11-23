/**
 * Gathering everything the Fleet Briefing's "Nothing stale" section reads off this machine — the effectful
 * shell around `../../../briefing/nothingStale.ts`'s pure projection.
 *
 * Every input is a LOCAL document another standing row already wrote: the three hygiene documents and the
 * board census under `live/hygiene/`, the followed-thread read at `live/slack/owed.json`, and the run journal
 * of every landing row's registration — the one input read as it is NOW, because it is a pull request's
 * receipt. Nothing here calls a provider, and nothing here writes — the section reports and never acts
 * (rule 10).
 *
 * A document that cannot be read is CARD DATA, never a refusal of the render: it becomes the section's own
 * "could not see" line naming why. Each document's freshness is judged against its producing row's cadence as
 * this home's INSTALLED definition carries it — the row that actually fires, never a cron literal copied here
 * nor the compiled `GENERIC_STANDING_ROWS` declaration a hand-edited row has moved away from — and a row that is absent,
 * doubled, held or paused makes that document a gap too.
 */
import { projectNothingStale } from "../../../briefing/nothingStale.js";
import {
  parseCycleBriefingDocument,
  parseLandingBriefingDocument,
  parseSweepBriefingDocument,
} from "../../../briefing/nothingStaleDocuments.js";
import type { NothingStaleSectionError } from "../../../briefing/nothingStaleErrors.js";
import { receiptSlugs } from "../../../briefing/nothingStalePullRequests.js";
import type { DocumentInput, LandingRowView, RunReceipt } from "../../../briefing/nothingStaleTypes.js";
import { runStateOf } from "../../../handover/ledger.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { err, type Result } from "../../../lib/result.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { loadLiftedRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { holdStands } from "../../../live/automation/failureHold.js";
import type { HygieneDocumentRead } from "../../../live/hygiene/reportRead.js";
import { readHygieneJson, readHygieneJsonLines } from "../../../live/hygiene/reportRead.js";
import type { HygieneDocumentReadError } from "../../../live/hygiene/reportReadErrors.js";
import { readSlackOwedDocument } from "../../../live/slack/owedStore.js";
import type { BriefingSection } from "../../../outbound/briefing/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { findingsDigest, parseSweepBoardCensus, type SweepBoardCensus } from "../../../sweep/census.js";

/** This home's installed recipe definitions as read, or why the directory would not list. */
type InstalledRows = { readonly definitions: readonly RecipeDefinition[] } | { readonly reason: string };

/**
 * The cadence of the ONE installed row carrying `recipeId` — the row that actually fires, which a paused, held
 * or hand-edited definition can make differ from its `GENERIC_STANDING_ROWS` declaration — or why there is not exactly
 * one live row to judge by. Off is asked the scheduler's way (`../../../live/automation/definitionDue.ts`): a
 * standing hold first, by `holdStands`, then `enabled`.
 *
 * @param installed this home's definitions in their LIFTED view, or why they could not be listed
 * @param recipeId the producing row's id
 * @returns the row's cron cadence, or the sentence naming the missing, doubled, held or paused row
 */
export function installedCadence({
  installed,
  recipeId,
}: {
  readonly installed: InstalledRows;
  readonly recipeId: string;
}): { readonly cadence: string } | { readonly reason: string } {
  if ("reason" in installed) {
    return installed;
  }
  const rows = installed.definitions.filter((definition) => definition.recipeId === recipeId);
  if (rows.length !== 1) {
    return { reason: `${String(rows.length)} installed row(s) carry \`${recipeId}\`, so its cadence is unknown` };
  }
  const row = rows[0]!;
  if (holdStands({ hold: row.hold })) {
    return { reason: `the installed row \`${recipeId}\` is held, so nothing refreshes its document` };
  }
  if (!row.enabled) {
    return { reason: `the installed row \`${recipeId}\` is paused, so nothing refreshes its document` };
  }
  return { cadence: row.cadence };
}

/**
 * One document read, joined to its producing row's cadence, as the section's input.
 *
 * @param read the document with the instant its freshness is judged from, or the reason it could not be read
 * @param installed this home's installed rows, where the producing row's cadence is read
 * @param recipeId the producing row
 * @returns the input, a gap naming the read failure or the cadence failure, whichever came first
 */
function inputOf<T>({
  read,
  installed,
  recipeId,
}: {
  readonly read: Result<{ readonly document: T; readonly observedAtIso: string }, { readonly message: string }>;
  readonly installed: InstalledRows;
  readonly recipeId: string;
}): DocumentInput<T> {
  if (read.isErr()) {
    return { kind: "could-not-see", reason: read.error.message };
  }
  const cadence = installedCadence({ installed, recipeId });
  if ("reason" in cadence) {
    return { kind: "could-not-see", reason: cadence.reason };
  }
  return { kind: "available", value: { ...read.value, cadence: cadence.cadence } };
}

/**
 * A hygiene document read, with its mtime as the instant its freshness is judged from.
 *
 * @param read the reader's result
 * @returns the same result, `writtenIso` carried as `observedAtIso`
 */
function byMtime<T>({
  read,
}: {
  readonly read: Result<HygieneDocumentRead<T>, HygieneDocumentReadError>;
}): Result<{ readonly document: T; readonly observedAtIso: string }, HygieneDocumentReadError> {
  return read.map((value) => ({ document: value.document, observedAtIso: value.writtenIso }));
}

/** A read the section consumes: the document with its freshness instant, or the sentence naming why not. */
type TimedRead<T> = Result<{ readonly document: T; readonly observedAtIso: string }, { readonly message: string }>;

/**
 * The census, only when it is provably from the pass that wrote the findings beside it — its
 * `findingsSha256` matches the digest of the finding lines actually read. Two files replaced one after the
 * other are not one atomic publication, so a census whose pass failed after the findings landed must not be
 * read as today's count (`../../../sweep/census.ts`).
 *
 * @param census the census read
 * @param findings the findings read, with the digest of the lines it parsed
 * @returns the census, or why it cannot be tied to these findings
 */
function pairedCensus({
  census,
  findings,
}: {
  readonly census: TimedRead<SweepBoardCensus>;
  readonly findings: TimedRead<{ readonly digest: string }>;
}): TimedRead<SweepBoardCensus> {
  if (census.isErr()) {
    return census;
  }
  if (findings.isErr()) {
    return err({ message: "the board findings could not be read, so no count can be tied to their pass" });
  }
  if (census.value.document.findingsSha256 !== findings.value.document.digest) {
    return err({
      message:
        "the board's verdict count is not from the pass that wrote the findings beside it — that pass's " +
        "census write did not land",
    });
  }
  return census;
}

/**
 * Every run journal a landing row's receipt could live in, read now: the phase each folds to, an unreadable
 * one with why, and a journal with no events left out — a run that never started is no receipt.
 *
 * A journal with any line this build cannot decode is UNREADABLE rather than folded around the line, because
 * the line it skipped may be the one that closed the run (`.claude/rules/area-handover.md`).
 *
 * @param rows the landing read's rows
 * @param runsDir the run journal directory
 * @returns every receipt, keyed by slug
 */
function readRunReceipts({
  rows,
  runsDir,
}: {
  readonly rows: readonly LandingRowView[];
  readonly runsDir: string;
}): ReadonlyMap<string, RunReceipt> {
  const slugs = [...new Set(rows.flatMap((row) => receiptSlugs({ row })))];
  return new Map(
    slugs.flatMap((slug): (readonly [string, RunReceipt])[] => {
      const journal = readRunJournal({ runsDir, slug });
      if (journal.isErr()) {
        return [[slug, { kind: "unreadable", reason: journal.error.message }]];
      }
      const { events, unreadable } = journal.value;
      if (unreadable.length > 0) {
        const lines = unreadable.map(String).join(", ");
        return [[slug, { kind: "unreadable", reason: `line(s) ${lines} could not be decoded` }]];
      }
      if (events.length === 0) {
        return [];
      }
      return [[slug, { kind: "phase", phase: runStateOf({ events }).phase }]];
    }),
  );
}

/**
 * This home's installed definitions in their LIFTED view — the one the scheduler decides firing by, so a
 * failure hold whose finding is settled reads as lifted here too — or why the directory would not list. A file
 * that does not parse is simply not a row here; the row it held reads as missing, which names it.
 *
 * @param home the state home whose definitions and board are read
 * @returns the definitions, or the reason
 */
function installedRows({ home }: { readonly home: string }): InstalledRows {
  const roster = loadLiftedRecipeDefinitions({ home });
  if (roster.directoryError !== null) {
    return { reason: roster.directoryError };
  }
  return { definitions: roster.definitions };
}

/**
 * Read every document the section needs and project it.
 *
 * @param home the state home to read
 * @param nowIso the instant the section is read at — the page's own ready instant
 * @returns the validated section, or the refusal naming why it could not render whole
 */
export function gatherNothingStaleSection({
  home,
  nowIso,
}: {
  readonly home: string;
  readonly nowIso: string;
}): Result<BriefingSection, NothingStaleSectionError> {
  const homePaths = stateHomePaths({ home });
  const paths = homePaths.live.hygiene;
  const owed = readSlackOwedDocument({ home }).map((document) => ({
    document,
    observedAtIso: document.observedAtIso,
  }));
  const landing = byMtime({
    read: readHygieneJson({ parse: parseLandingBriefingDocument, path: paths.githubLanding }),
  });
  const runs = landing.isOk()
    ? readRunReceipts({ rows: landing.value.document.rows, runsDir: homePaths.runs })
    : new Map<string, RunReceipt>();
  const findings = byMtime({
    read: readHygieneJsonLines({
      parse: ({ lines }) =>
        parseSweepBriefingDocument({ lines }).map((candidates) => ({
          candidates,
          digest: findingsDigest({ lines }),
        })),
      path: paths.sweepBoard,
    }),
  });
  const census = byMtime({ read: readHygieneJson({ parse: parseSweepBoardCensus, path: paths.sweepBoardCensus }) });
  const installed = installedRows({ home });
  return projectNothingStale({
    inputs: {
      board: inputOf({
        installed,
        read: findings.map(({ document, observedAtIso }) => ({ document: document.candidates, observedAtIso })),
        recipeId: "sweep-board-daily",
      }),
      boardCensus: inputOf({ installed, read: pairedCensus({ census, findings }), recipeId: "sweep-board-daily" }),
      followedThreads: inputOf({ installed, read: owed, recipeId: "slack-owed-daily" }),
      linearCycle: inputOf({
        installed,
        read: byMtime({ read: readHygieneJson({ parse: parseCycleBriefingDocument, path: paths.cycleReconcile }) }),
        recipeId: "linear-briefing-daily",
      }),
      pullRequests: inputOf({ installed, read: landing, recipeId: "hygiene-sweep" }),
      runs,
    },
    nowIso,
  });
}
