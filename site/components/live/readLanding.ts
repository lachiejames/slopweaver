/**
 * The narrow reader for `slopweaver github landing --json`, and for the ledger row that records one.
 *
 * Its own module rather than a section of `read.ts` because it is by some distance the largest reader there
 * — six per-row tests, a check list, two thread counts and a selection note, none of which any other page
 * reads — and `read.ts` had grown past the 300-line cap `file-size-ratchet` holds it to. The split is
 * along the ONE register: a landing document and nothing else is read here.
 *
 * Every rule stated at the top of `read.ts` governs this file unchanged, and the one that matters most is
 * that a malformed row refuses the WHOLE reading rather than being dropped from it.
 */

import { type Bag, bags, isBag, num, str, strings, sub } from "../../lib/bag";
import type { SlackPeople, SlackPersonName } from "../../lib/slackPeople";
import {
  censusAgainstSelection,
  censusOf,
  type LandingRepoCensus,
  type LandingSelection,
  selectionOf,
} from "./readLandingCensus";
import { type LandingRow, landingRowOf } from "./readLandingRow";

export type { LandingAsk, LandingBump, LandingShare } from "./readLandingAsks";
export type { LandingCensusPr, LandingRepoCensus, LandingSelection } from "./readLandingCensus";
export type { LandingCheck, LandingCiFailure, LandingTest, LandingThreads, LandingWaiting } from "./readLandingFields";
export type { LandingRow } from "./readLandingRow";

/** One line of the verb's own tally: how many rows carry one action word. */
export interface LandingActionCount {
  readonly action: string;
  readonly count: number;
}

/** What the pull-request page shows: every row, the verb's own tally, and its residue. */
export interface Landing {
  readonly rows: readonly LandingRow[];
  readonly total: number;
  readonly ready: number;
  /** The verb's count per action word — what a group heading prints, so a zero there is the verb's zero. */
  readonly byAction: readonly LandingActionCount[];
  /** What the verb could not decide and why — printed, never dropped, because an absence it names is a fact. */
  readonly residue: readonly string[];
  /**
   * The verb's count of rows whose only red is on advisory checks, which `ci-green` passes so each sits under
   * its own act — `undefined` on a document from before the verb counted them. The CI heading prints it, so a
   * group those rows never enter does not read as "no red builds".
   */
  readonly advisoryRedBypassed: number | undefined;
  /**
   * What the read was taken over, when the document carries it. A document recorded before the verb wrote
   * this field has none, and the page says so rather than guessing; a present one is what lets the Drafts
   * heading tell "the verb found no draft" from "this reading was taken without drafts".
   */
  readonly selection: LandingSelection | undefined;
  /** The names the verb resolved for every Slack id an ask trail names. Empty on a document older than it. */
  readonly people: SlackPeople;
  /**
   * GitHub's own open list per selected repository — every author, drafts in — read on the same run; the part of it
   * `selection.author` matches is the witness that the rows are every open pull request of the owner's
   * (`src/live/github/openCensus.ts`, `site/lib/pullRequestCensus.ts`, `site/lib/pullRequestPopulation.ts`).
   * `undefined` on a document older than the field.
   */
  readonly census: readonly LandingRepoCensus[] | undefined;
}

/**
 * The document's `people`: Slack id to the name the verb's roster resolved. Absent reads as an empty roster
 * (a document older than it, so every id draws as itself); present and malformed refuses the reading.
 *
 * @returns the roster, or `undefined` when it is malformed
 */
function peopleOf({ payload }: { payload: Bag }): SlackPeople | undefined {
  if (payload["people"] === undefined) {
    return new Map();
  }
  const held = sub({ bag: payload, key: "people" });
  if (held === undefined) {
    return undefined;
  }
  const out = new Map<string, SlackPersonName>();
  for (const id of Object.keys(held)) {
    const entry = sub({ bag: held, key: id });
    if (entry === undefined) {
      return undefined;
    }
    const name = str({ bag: entry, key: "name" });
    if (name === undefined) {
      return undefined;
    }
    out.set(id, { handle: undefined, name });
  }
  return out;
}

/**
 * Project `github landing --json` into the pull-request page.
 *
 * The verb already answers "what is the one next act" per row from six tests GitHub published, joins the
 * handover board by declared branch and Slack for who was asked. The page groups rows by that word and
 * prints it; it never decides a row is green. A row that will not parse refuses the whole reading, because
 * a row silently missing from a list of pull requests is the exact wrong answer this page exists to end.
 *
 * @returns the rows with the verb's own tally and residue, or `undefined` when the payload is not the document
 */
export function readLanding(payload: unknown): Landing | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "rows" });
  const tally = sub({ bag: payload, key: "tally" });
  const residue = strings({ bag: payload, key: "residue" });
  if (rows === undefined || tally === undefined || residue === undefined) {
    return undefined;
  }
  const total = num({ bag: tally, key: "total" });
  const ready = num({ bag: tally, key: "ready" });
  const byActionHeld = bags({ bag: tally, key: "byAction" });
  if (total === undefined || ready === undefined || byActionHeld === undefined) {
    return undefined;
  }
  // Absent is an older document; present and not a number is a document this verb did not write.
  const advisoryRedBypassed = num({ bag: tally, key: "advisoryRedBypassed" });
  if (tally.advisoryRedBypassed !== undefined && advisoryRedBypassed === undefined) {
    return undefined;
  }
  const byAction: LandingActionCount[] = [];
  for (const line of byActionHeld) {
    const action = str({ bag: line, key: "action" });
    const count = num({ bag: line, key: "count" });
    if (action === undefined || count === undefined) {
      return undefined;
    }
    byAction.push({ action, count });
  }
  const selection = selectionOf({ bag: payload });
  const people = peopleOf({ payload });
  const census = censusOf({ bag: payload });
  if (selection === null || people === undefined || census === null) {
    return undefined;
  }
  const out: LandingRow[] = [];
  for (const row of rows) {
    const read = landingRowOf({ row });
    if (read === undefined) {
      return undefined;
    }
    out.push(read);
  }
  return {
    advisoryRedBypassed,
    byAction,
    census: censusAgainstSelection({ census, selection }),
    people,
    ready,
    residue,
    rows: out,
    selection,
    total,
  };
}

/** One recorded reading of `github landing`: who took it, when, and the document that run printed. */
export interface LandingReading {
  /** Who appended the reading — a tick label, a session, `sync-now` — printed after "read N ago by". */
  readonly by: string;
  readonly readingId: string;
  /** When the document was true of GitHub — the ledger's own stamp, which the tile ages. */
  readonly observedAtIso: string;
  readonly recordedAtIso: string;
  readonly landing: Landing;
}

/**
 * Read the object `reading last --producer "github landing" --json` prints: the ledger row's fields flat
 * beside a `document` that is the landing document itself, read by {@link readLanding} so the two paths can
 * never disagree about a row.
 *
 * @returns the reading, or `undefined` when the payload is not one
 */
export function readLandingReading(payload: unknown): LandingReading | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const by = str({ bag: payload, key: "by" });
  const readingId = str({ bag: payload, key: "readingId" });
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const recordedAtIso = str({ bag: payload, key: "recordedAtIso" });
  const landing = readLanding(payload.document);
  if (
    by === undefined ||
    readingId === undefined ||
    observedAtIso === undefined ||
    recordedAtIso === undefined ||
    landing === undefined
  ) {
    return undefined;
  }
  return { by, landing, observedAtIso, readingId, recordedAtIso };
}
