/**
 * The chair's report of the Queue cards a gate WITHHELD: the same registers the Queue page reads, through the same
 * readers, `rowsOf` and `partitionQueueRows` (`./queueWithholding.ts`), so a card the page holds back is a card this
 * report names — never a second copy of any gate.
 *
 * A withheld card no longer reaches the owner, so somebody has to learn about it or it is simply lost. That somebody is the
 * chair: `app/api/queue-refusals/route.ts` serves this report, `slopweaver queue refusals --json` reads it, and the
 * supervisor tick takes that reading so each withheld card is routed to a seat that fixes its source record the same
 * pass (`skills/supervisor/reference/sweep-contract.md`).
 *
 * **An unread register is never zero.** A register the route could not read makes the report `complete: false` and is
 * named with why; the cards the rest DID yield are still listed, as a lower bound. A report claiming "nothing withheld"
 * over a register it never read is the quiet lie this whole surface exists to refuse.
 *
 * Pure: readings in, report out. The route is the effectful shell around it.
 */

import type { Result } from "neverthrow";

import { readBoard, readHandSteps } from "../components/live/read";
import { readImportQuestions } from "../components/live/readImportQuestions";
import { readLandingReading } from "../components/live/readLanding";
import { readParkedReviews } from "../components/live/readReviewDrafts";
import { readReviewers } from "../components/live/readReviewers";
import { readParkedDrafts } from "../components/live/readSlackDrafts";
import { readHeldDrafts } from "../components/live/readThread";
import type { LiveState } from "../components/live/useLive";
import type { LiveResult } from "./liveVerbRun";
import {
  ORGANISATION_SLUG,
  type PlacementOrganisation,
  type PlacementOrganisationError,
} from "./placementOrganisation";
import { rowsOf } from "./queueRows";
import { partitionQueueRows, type WithheldQueueRow } from "./queueWithholding";
import { reasonTextOf } from "./quotedReason";
import { buildWorkspacePlacer } from "./workspacePlacement";

/**
 * Each register `rowsOf` takes that can yield or shape a withheld card, by the allowlist slug the Queue page reads it
 * under (`./liveVerbs.ts`). The autonomy ledger is deliberately absent: it feeds only act cards, which are never
 * withheld, and no other card reads it — so reading its half-megabyte would cost a tick and could never move a count.
 */
export const REFUSAL_REGISTER_SLUGS = {
  hands: "hands",
  board: "board",
  drafts: "drafts",
  posts: "slack-drafts",
  reviews: "review-drafts",
  imports: "import-questions",
  landing: "landing-reading",
  reviewers: "reviewers",
} as const;

/** One register the report reads, by `rowsOf`'s own name for it. */
export type RefusalRegister = keyof typeof REFUSAL_REGISTER_SLUGS;

/** The registers in the order the report names an unread one. */
const REGISTERS: readonly RefusalRegister[] = [
  "hands",
  "board",
  "drafts",
  "posts",
  "reviews",
  "imports",
  "landing",
  "reviewers",
];

/** What the live runner answered for each register. */
export type RefusalResults = { readonly [K in RefusalRegister]: LiveResult };

/** A register the report could not read, and why. */
export interface UnreadRegister {
  /** The allowlist slug, as the Queue page names the register. */
  readonly source: string;
  readonly why: string;
}

/** The report `GET /api/queue-refusals` answers with. */
export interface QueueRefusalReport {
  readonly observedAtIso: string;
  /** False whenever a register went unread: the withheld list is then a lower bound, never a zero. */
  readonly complete: boolean;
  readonly unread: readonly UnreadRegister[];
  /** Every card a gate withheld from the owner's Queue, in the order the Queue ranked them. */
  readonly withheld: readonly {
    readonly key: string;
    readonly kind: string;
    readonly title: string;
    readonly why: string;
  }[];
}

/**
 * One register's reading as the Queue holds it — the shape `../components/live/useLive.ts` turns a wire answer into,
 * through the same reader, so a payload the page would refuse is refused here too.
 *
 * @param slug the allowlist slug, named in a refusal
 * @param result what the runner answered
 * @param read the register's own reader
 * @returns the ready reading, or not-measured with the reason
 */
function liveStateOf<T>({
  slug,
  result,
  read,
}: {
  slug: string;
  result: LiveResult;
  read: (payload: unknown) => T | undefined;
}): LiveState<T> {
  if (!result.ok) {
    return { phase: "not-measured", why: result.notMeasured };
  }
  const value = read(result.payload);
  if (value === undefined) {
    return { phase: "not-measured", why: `${slug} answered in a shape the Queue does not read` };
  }
  return {
    fixture: result.fixture,
    observedAtIso: result.observedAtIso,
    phase: "ready",
    stampedByRoute: result.stampedByRoute,
    value,
  };
}

/**
 * The withheld cards the registers yield, and every register that did not read.
 *
 * Every card is placed by the organisation, so with no organisation read there is no card to name: the report says
 * so as an unread source, `organisation`, with the read's own sentence, and lists none — never cards placed against a
 * stand-in.
 *
 * @param results what the runner answered for each register
 * @param organisation the organisation read, or why it could not be
 * @returns the withheld cards, in the Queue's order, and the unread registers, in {@link REGISTERS} order, the
 *   organisation after them
 */
export function queueRefusalsOf({
  organisation,
  results,
}: {
  organisation: Result<PlacementOrganisation, PlacementOrganisationError>;
  results: RefusalResults;
}): {
  withheld: readonly WithheldQueueRow[];
  unread: readonly UnreadRegister[];
} {
  const states = {
    board: liveStateOf({ read: readBoard, result: results.board, slug: REFUSAL_REGISTER_SLUGS.board }),
    drafts: liveStateOf({ read: readHeldDrafts, result: results.drafts, slug: REFUSAL_REGISTER_SLUGS.drafts }),
    hands: liveStateOf({ read: readHandSteps, result: results.hands, slug: REFUSAL_REGISTER_SLUGS.hands }),
    imports: liveStateOf({ read: readImportQuestions, result: results.imports, slug: REFUSAL_REGISTER_SLUGS.imports }),
    landing: liveStateOf({ read: readLandingReading, result: results.landing, slug: REFUSAL_REGISTER_SLUGS.landing }),
    posts: liveStateOf({ read: readParkedDrafts, result: results.posts, slug: REFUSAL_REGISTER_SLUGS.posts }),
    reviewers: liveStateOf({ read: readReviewers, result: results.reviewers, slug: REFUSAL_REGISTER_SLUGS.reviewers }),
    reviews: liveStateOf({ read: readParkedReviews, result: results.reviews, slug: REFUSAL_REGISTER_SLUGS.reviews }),
  };
  // Acts are never withheld (`./queueWithholding.ts`), so the ledger is never read: an unread act register yields none.
  // Nor are the owner's standing asks: a card quoting one is never refused for it (`./queueCardSource.ts` `sourceForm`), and
  // the words it quotes are the owner's, which the machine-id gate never reads, while the line naming a missing ask hides any
  // id in the coverage it prints (`./standingAskSource.ts` `addLine`) — so the register could never move a count.
  const unread = REGISTERS.flatMap((register): UnreadRegister[] => {
    const state: LiveState<unknown> = states[register];
    if (state.phase === "not-measured") {
      return [{ source: REFUSAL_REGISTER_SLUGS[register], why: state.why }];
    }
    if (state.phase === "loading") {
      return [{ source: REFUSAL_REGISTER_SLUGS[register], why: "never read" }];
    }
    return [];
  });
  if (organisation.isErr()) {
    return { unread: [...unread, { source: ORGANISATION_SLUG, why: organisation.error.message }], withheld: [] };
  }
  const placer = buildWorkspacePlacer({ organisation: organisation.value });
  const rows = rowsOf({ ...states, acts: { phase: "loading" }, placer, standing: { phase: "loading" } });
  return { unread, withheld: partitionQueueRows({ rows }).withheld };
}

/**
 * The report the chair reads: whether it is whole, what did not read, and each withheld card by key and the gate's
 * own sentence — never the card itself, and never a register's absence as a zero.
 *
 * @param observedAtIso when the registers were read
 * @param unread every register that did not read
 * @param withheld every card a gate withheld
 * @returns the report
 */
export function queueRefusalReport({
  observedAtIso,
  unread,
  withheld,
}: {
  observedAtIso: string;
  unread: readonly UnreadRegister[];
  withheld: readonly WithheldQueueRow[];
}): QueueRefusalReport {
  return {
    complete: unread.length === 0,
    observedAtIso,
    unread,
    // The report is read by a session, never drawn above a fold, so a quoted read's reason travels as one string.
    withheld: withheld.map((row) => ({
      key: row.key,
      kind: row.kind,
      title: row.title,
      why: reasonTextOf({ reason: row.why }),
    })),
  };
}
