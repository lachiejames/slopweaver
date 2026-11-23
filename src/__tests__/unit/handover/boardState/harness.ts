/*
 * What the board-state test files share: a blank handover doc, a probe state, a readable journal, one instant, and
 * the `compose` call every file places its rows with. They moved here when `boardState.test.ts` was split by
 * behaviour.
 */
import { composeBoardModels } from "../../../../handover/boardState.js";
import type { BoardModel } from "../../../../handover/boardTypes.js";
import type { DocProbeState, HandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { doc as blankDoc } from "../doc/harness.js";

/**
 * A handover doc with every field blank, overridden by whatever the test names. The blank is `doc/harness.ts`'s
 * own `ready` doc with no dependencies, so the two literals cannot drift apart.
 *
 * @returns the doc, at `/h/<slug>.md`
 */
export function doc(over: Partial<HandoverDoc> & { slug: string }): HandoverDoc {
  return { ...blankDoc({ slug: over.slug }), ...over };
}

/**
 * A doc's probe state with no commits ahead, no computed verdict and no results, overridden by the test.
 *
 * @returns the probe state
 */
export function probe(over: Partial<DocProbeState>): DocProbeState {
  return { commitsAhead: 0, computed: undefined, results: [], ...over };
}

/**
 * A run journal holding these events, every line readable.
 *
 * @returns the journal as the board composer reads it
 */
export function journal({ events }: { events: readonly RunEvent[] }): {
  events: readonly RunEvent[];
  unreadableLines: readonly number[];
} {
  return { events, unreadableLines: [] };
}

export const NOW = "2026-08-20T00:00:00.000Z";

/**
 * Compose the board over these roots, resolving dependencies against the roots unless told otherwise, with no
 * probe state and no journal unless the test passes them.
 *
 * @returns one board model per root, in root order
 */
export function compose({
  roots,
  resolutionDocs = roots,
  probeStates = new Map<string, DocProbeState>(),
  journals = new Map<string, { events: readonly RunEvent[]; unreadableLines: readonly number[] }>(),
}: {
  roots: readonly HandoverDoc[];
  resolutionDocs?: readonly HandoverDoc[];
  probeStates?: ReadonlyMap<string, DocProbeState>;
  journals?: ReadonlyMap<string, { events: readonly RunEvent[]; unreadableLines: readonly number[] }>;
}): readonly BoardModel[] {
  return composeBoardModels({ journals, probeStates, resolutionDocs, roots });
}
