/**
 * Progress adaptation for `slopweaver refresh` — the pure translations between the hooks the connectors offer
 * and the rich event stream the terminal renders.
 *
 * Three shapes converge on one stream: GitHub's per-item and per-repo callbacks, the coarse
 * `members`/`structures` hydration events, and — for `--numbers-only` — a rebuild of a rich event with every
 * identifying string withheld. Every function here is pure, which is the reason they live apart from the
 * shell that wires them: the mapping is the part worth asserting exactly.
 */

import { type FetchProgress } from "../../../corpus/github/fetch.js";
import type { OrgRepoProgress } from "../../../corpus/github/orgActivity.js";
import { type SourceProgress, sourceHeartbeat } from "../../../corpus/progress.js";
import { sanitiseEvent } from "../../../lib/numbersOnly.js";
import type { RichProgressEvent } from "../../../lib/progress.js";

/**
 * Adapt the connector progress seam into GitHub's per-item hook (single-repo mode).
 *
 * @param sourceProgress the shared connector sink to forward into
 * @returns the per-item hook GitHub's fetcher expects
 */
export function githubItemProgress({ sourceProgress }: { sourceProgress: SourceProgress }): FetchProgress {
  return ({ number, index, total }) => {
    sourceProgress(
      sourceHeartbeat({
        currentItem: { title: `#${String(number)}` },
        done: index,
        phase: "items",
        source: "github",
        total,
      }),
    );
  };
}

/**
 * Adapt the connector progress seam into GitHub's per-repo hook (org mode) — names the repo + its yield.
 *
 * @param sourceProgress the shared connector sink to forward into
 * @returns the per-repo hook, which reports each repo by name plus how much it yielded
 */
export function githubRepoProgress({ sourceProgress }: { sourceProgress: SourceProgress }): OrgRepoProgress {
  return ({ done, total, repo, recordCount }) => {
    sourceProgress(
      sourceHeartbeat({
        currentItem: { title: repo },
        done,
        metrics: { records: recordCount },
        phase: "repos",
        source: "github",
        total,
      }),
    );
  };
}

/**
 * One rich event with every identifying string withheld, back in the rich event's own type.
 *
 * The cast-free route: `sanitiseEvent` is deliberately typed over a structural subset so it can serve both
 * event shapes, and this rebuilds the rich event from the sanitised parts rather than asserting the subset
 * back up to the whole. Pure.
 *
 * @param event the rich event to withhold the identifying strings from
 * @returns the same event with only its lane, phase, counts and sanitised title retained
 */
export function numbersOnlyEvent({ event }: { event: RichProgressEvent }): RichProgressEvent {
  const sanitised = sanitiseEvent({ event });
  return {
    lane: event.lane,
    phase: sanitised.phase,
    ...(sanitised.done !== undefined ? { done: sanitised.done } : {}),
    ...(sanitised.total !== undefined ? { total: sanitised.total } : {}),
    ...(sanitised.metrics !== undefined ? { metrics: sanitised.metrics } : {}),
    ...(sanitised.currentItem !== undefined ? { currentItem: { title: sanitised.currentItem.title } } : {}),
  };
}

/**
 * Map a coarse hydration event (`members`/`structures`) to a rich heartbeat. Ingest `start`/`done` events
 * are NOT surfaced here — the connector stream already narrates the crawl and the summary reports the
 * written counts, so re-emitting them would just add noise. Pure.
 *
 * @param phase which hydration lane fired (`members` or `structures`)
 * @param label the human label for the thing being hydrated
 * @param done how many are finished
 * @param total how many there are
 * @param written how many rows landed, when the event carries a count
 * @returns the rich event to emit
 */
export function hydrationHeartbeat({
  phase,
  label,
  done,
  total,
  written,
}: {
  phase: string;
  label: string;
  done: number;
  total: number;
  written?: number;
}): RichProgressEvent {
  return {
    currentItem: { title: label },
    done,
    lane: "heartbeat",
    phase,
    total,
    ...(written !== undefined ? { metrics: { written } } : {}),
  };
}
