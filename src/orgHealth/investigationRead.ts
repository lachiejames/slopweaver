/**
 * The effectful half of `./investigation.ts`: list the board's `incident-*` rows, read each one's journal and the
 * row it was raised from, and the hand register's open steps, for `org-health status` to judge each open incident.
 *
 * Never a board scan. `org-health status` is a fast-lane verb, and a whole-board parse costs over a second on this machine (MEASURED, 1193 ms
 * over 5608 docs: `yarn tsx -e 'import {scanBoard} from "./src/handover/store.ts"; const t=performance.now();
 * scanBoard({handoverDir: process.env.HOME+"/.slopweaver/handovers"}); console.log(performance.now()-t)'`), while an
 * Investigating incident stays open for weeks. So only the file listing is read whole, and only the rows whose name
 * starts `incident-` are parsed — four on the same day.
 *
 * Every failure is the reading's, never a "nobody is looking": an unlistable board, an `incident-*` file that will
 * not read, or an unreachable hand register makes every open incident `unmeasured`, naming why. The residue, stated: a
 * single hand-register LINE that will not parse is `hand list`'s to report, not this reading's — an incident note
 * POSTED on such a line reads as its run's own state, and one SETTLED on such a line still reads as up, linking a
 * card the Queue no longer draws, until it is repaired. And a relay's steer still WAITING to land hides its card on
 * the Queue before any landing is written (`site/lib/steeredCards.ts`); that overlay is not read here, so until its
 * landing is written a findings link can open nothing.
 */
import { readdirSync } from "node:fs";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { waitingHandSteps } from "../hand/step.js";
import { readOpenHandSteps } from "../hand/store.js";
import { runDisposition } from "../handover/boardTypes.js";
import { derivedRowState } from "../handover/derivedRowState.js";
import { isTerminalDocStatus } from "../handover/doc.js";
import { ownerWaitOf } from "../handover/ownerWait.js";
import { registeredAskOf } from "../handover/registeredAsk.js";
import { readRunJournal } from "../handover/runStore.js";
import { lookupDocBySlug, readExactDoc } from "../handover/store.js";
import { stateHomePaths } from "../stateHome.js";
import { activeCardLandings } from "../talk/cardLanding.js";
import { readCardLandings } from "../talk/cardLandingStore.js";

import {
  INVESTIGATION_SLUG_PREFIX,
  type Investigation,
  type InvestigationRow,
  incidentInvestigations,
  type RaisedBy,
} from "./investigation.js";
import type { OrgIncident } from "./types.js";

/**
 * Each open incident's investigation, keyed by its reference.
 *
 * @param home the state home the board, the run journals and the hand register live under
 * @param open the open incidents
 * @returns one investigation per open incident — `unmeasured` for all of them when a read failed
 */
export function readInvestigations({
  home,
  open,
}: {
  home: string;
  open: readonly OrgIncident[];
}): ReadonlyMap<string, Investigation> {
  if (open.length === 0) {
    return new Map();
  }
  const rows = readInvestigationRows({ home });
  if (rows.isErr()) {
    return everyUnmeasured({ because: rows.error, open });
  }
  const steps = readOpenHandSteps({ home });
  if (steps.isErr()) {
    return everyUnmeasured({ because: `the hand register would not read: ${steps.error.message}`, open });
  }
  // `waitingHandSteps`, the filter `hand list --json` and so the Queue read: a notice draws no card to link.
  const rowSteps = waitingHandSteps({ steps: steps.value.steps }).flatMap((step) =>
    step.row === undefined ? [] : [{ id: step.id, row: step.row }],
  );
  return incidentInvestigations({ landed: landedCards({ home }), open, rows: rows.value, steps: rowSteps });
}

/**
 * The Queue keys the owner's spoken words are holding off the Queue — `talk cards`, the overlay the Queue itself applies
 * (`site/lib/cardLandings.ts`). A ledger that will not read holds nothing off there, so it holds nothing here
 * either: the two must agree on which cards are drawn, and that is the Queue's own reading of a failure.
 *
 * @param home the state home the card-landing ledger lives under
 * @returns the active landings' card keys
 */
function landedCards({ home }: { home: string }): ReadonlySet<string> {
  const read = readCardLandings({ home });
  if (read.isErr()) {
    return new Set();
  }
  return new Set(activeCardLandings({ rows: read.value.rows }).map((landing) => landing.cardKey));
}

/** The same `unmeasured`, naming why, for every open incident. */
function everyUnmeasured({
  because,
  open,
}: {
  because: string;
  open: readonly OrgIncident[];
}): ReadonlyMap<string, Investigation> {
  const unmeasured: Investigation = { because, state: "unmeasured" };
  return new Map(open.map((incident) => [incident.ref, unmeasured]));
}

/**
 * Every live `incident-*` row, with its journal's disposition and the row it was raised from.
 *
 * @param home the state home
 * @returns the rows, or why the board could not be read whole
 */
function readInvestigationRows({ home }: { home: string }): Result<readonly InvestigationRow[], string> {
  const paths = stateHomePaths({ home });
  const slugs = investigationSlugs({ handoverDir: paths.handovers });
  if (slugs.isErr()) {
    return err(slugs.error);
  }
  const rows: InvestigationRow[] = [];
  for (const slug of slugs.value) {
    const row = readInvestigationRow({ handoverDir: paths.handovers, runsDir: paths.runs, slug });
    if (row.isErr()) {
      return err(row.error);
    }
    if (row.value !== undefined) {
      rows.push(row.value);
    }
  }
  return ok(rows);
}

/**
 * One `incident-*` row, with its journal's disposition and the row it was raised from.
 *
 * @param handoverDir the board directory
 * @param runsDir the run journals' directory
 * @param slug the row's slug, off the listing
 * @returns the row, `undefined` when it is gone or archived, or why it would not read
 */
function readInvestigationRow({
  handoverDir,
  runsDir,
  slug,
}: {
  handoverDir: string;
  runsDir: string;
  slug: string;
}): Result<InvestigationRow | undefined, string> {
  const read = readExactDoc({ handoverDir, slug });
  if (read.isErr()) {
    return err(`the investigation row ${slug} would not read: ${read.error.why}`);
  }
  // Gone, or archived between the listing and the read: either way no longer live work.
  if (read.value === undefined || read.value.archived) {
    return ok(undefined);
  }
  const { doc } = read.value;
  if (doc.summary === undefined) {
    return err(`the investigation row ${slug} carries no summary to match an incident against`);
  }
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return err(`${slug}'s run journal would not read: ${journal.error.message}`);
  }
  const { events, unreadable } = journal.value;
  const run = runDisposition({ events, unreadableLines: unreadable });
  const derived = derivedRowState({ doc, events });
  // The board stands a registered ask up as the owner's only once its `doneWhen` probes have placed it nowhere else
  // (`../handover/boardEvidence.ts`: LOOKS SHIPPED, IN FLIGHT) and no `blockedBy` holds it in NOT YET — a probe
  // run and a board scan respectively. So a row declaring either is not read as the owner's ask here: lined up, at worst
  // an under-claim, never a link to a card the Queue does not draw.
  let registered: ReturnType<typeof registeredAskOf>;
  if (doc.blockedBy.length === 0 && doc.doneWhen.length === 0) {
    registered = registeredAskOf({ derived, doc, run });
  }
  return ok({
    lastMovedIso: events.at(-1)?.atIso,
    over: isTerminalDocStatus(derived.status) || derived.settlement !== undefined,
    ownerWait: ownerWaitOf({ derived, registered, run }).kind,
    paused: derived.status === "paused",
    raisedBy: raisedByOf({ handoverDir, run: doc.registeredRun }),
    run,
    slug,
    summary: doc.summary,
  });
}

/**
 * The live board's `incident-*` slugs, off the directory listing alone.
 *
 * @param handoverDir the board directory
 * @returns the slugs, none for a board never written, or why the directory would not list
 */
function investigationSlugs({ handoverDir }: { handoverDir: string }): Result<readonly string[], string> {
  let names: readonly string[];
  try {
    names = readdirSync(handoverDir);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok([]);
    }
    return err(
      `the board directory ${handoverDir} would not list: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
  return ok(
    names
      .filter((name) => name.startsWith(INVESTIGATION_SLUG_PREFIX) && name.endsWith(".md"))
      .map((name) => name.slice(0, -".md".length))
      .toSorted(),
  );
}

/**
 * The row a session was working when it registered this one: a supervisor shift says so, another row quotes its
 * summary. One exact-slug read, never a scan; a run that is no row at all raised nothing this can name.
 *
 * @param handoverDir the board directory
 * @param run the registering run's slug, when the row recorded one
 * @returns where it came from, or `undefined` when nothing names it
 */
function raisedByOf({ handoverDir, run }: { handoverDir: string; run: string | undefined }): RaisedBy | undefined {
  if (run === undefined) {
    return undefined;
  }
  const origin = lookupDocBySlug({ handoverDir, slug: run });
  if (origin === undefined) {
    return undefined;
  }
  if (origin.supervisorState !== undefined) {
    return { kind: "supervisor" };
  }
  if (origin.summary === undefined) {
    return undefined;
  }
  return { kind: "row", summary: origin.summary };
}
