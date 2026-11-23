/**
 * The CONTRACT of a frontier walk: the closed outcome vocabulary, what one visited route came to, what a platform
 * contributes to a walk, and what the walk produced.
 *
 * Split from `frontierWalk.ts`, which keeps the engine that runs against this. Nothing here does anything: it
 * depends on the transport's types and the kit's artifact reference alone, and never on the engine.
 */
import type { PageCapture, ResponseAccounting } from "../../browser/pageTransport.js";

import type { AtlasArtifactRef } from "./contract.js";

/**
 * How one visited route's outcome is graded.
 *
 * Closed and kit-owned for the same reason the coverage states are: a walk's accounting only means one
 * thing across atlases if every atlas grades into the same vocabulary.
 *
 * @internal
 */
export const FRONTIER_PAGE_OUTCOMES = [
  "failed",
  "landed",
  "not-attempted",
  "redirected",
  "signed-out",
  "unavailable",
  "unphotographed",
] as const;

/** How one visited route's outcome is graded. */
export type FrontierPageOutcome = (typeof FRONTIER_PAGE_OUTCOMES)[number];

/** What one route's visit came to. */
export interface FrontierPageObservation {
  readonly artifacts: readonly AtlasArtifactRef[];
  /** The route whose link found this one, or `null` when it came from the declared list. */
  readonly discoveredFrom: string | null;
  readonly finalUrl: string | null;
  /** Routes this page itself rendered — the next round's frontier. */
  readonly linksRendered: readonly string[];
  readonly outcome: FrontierPageOutcome;
  /**
   * What the transport saw against what it kept, carried through verbatim.
   *
   * Here rather than recomputed downstream because a lost response body is otherwise invisible: the page
   * still has its screenshot, its status and its title, so a walk that silently dropped two of twelve
   * captures looks identical to one that kept them all.
   */
  readonly responseAccounting: ResponseAccounting;
  /** The declared route — this page's provider id. */
  readonly route: string;
  readonly statusCode: number | null;
  readonly title: string | null;
}

/** What one platform contributes to a frontier walk. Everything else the engine already knows. */
export interface FrontierWalkSpec<TCall> {
  /** Where a screenshot's artifact reference points, relative to the atlas's own directory. */
  readonly artifactDirectory: string;
  /** What one of this platform's own responses reduces to on a page. */
  readonly callFrom: (input: { response: PageCapture["responses"][number]; route: string }) => TCall;
  /** The declared list, which is the walk's starting frontier. */
  readonly declaredRoutes: readonly string[];
  /** How this platform grades where the browser settled, given the route that was asked for. */
  readonly gradeOutcome: (input: { capture: PageCapture; route: string }) => FrontierPageOutcome;
  /** Whether one captured response is this platform answering. */
  readonly isFirstParty: (input: { response: { body: unknown; url: string } }) => boolean;
  /**
   * How many frontier rounds the walk may run, the declared list being the first — so `3` visits the
   * declared routes and then two rounds of what they rendered. A route the last round rendered stays on
   * its page's `linksRendered` and is not visited; it is a bound reached, not a stop, so it is not
   * `notAttempted`.
   */
  readonly maxRounds: number;
  /**
   * How many lost sessions with no page loaded between them end the walk. Only a page that loads proves the
   * session came back, so another failure between two losses does not break the run. See `frontierWalk.ts`'s header.
   */
  readonly maxConsecutiveSessionLosses: number;
  /** Called with every capture, so a platform can learn something from where a page settled. */
  readonly observe?: (input: { capture: PageCapture }) => void;
  /** Where a line of progress goes. */
  readonly progress: (input: { line: string }) => void;
  /** Which of a page's rendered links this platform counts as routes. */
  readonly routesRenderedBy: (input: { capture: PageCapture }) => readonly string[];
  /** How long to keep observing one page after it settles, so its own deferred calls are caught. */
  readonly settleMs: number;
  /** The absolute URL one declared route resolves to, now. */
  readonly urlFor: (input: { route: string }) => string;
}

/** What one frontier walk produced. */
export interface FrontierWalkResult<TCall> {
  readonly artifactsWritten: number;
  readonly calls: readonly TCall[];
  /** Pages whose response bodies were not all captured — the walk saw less than it looks like it did. */
  readonly incompletePages: readonly string[];
  /** Routes the walk never attempted, because it stopped before reaching them. */
  readonly notAttempted: readonly string[];
  readonly pages: readonly FrontierPageObservation[];
  /** How many rounds of link expansion ran, so a walk that closed early says so. */
  readonly roundsRun: number;
  /**
   * The route that began the run of lost sessions still standing when the walk ended, or `null` when none
   * is — a loss that a later page recovered from did not end the session. A run ends only at a page that
   * loads; a different failure inside it neither ends it nor renames it.
   */
  readonly sessionEndedAt: string | null;
}
