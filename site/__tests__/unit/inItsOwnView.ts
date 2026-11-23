/*
 * The voice's readings of a row in the view that is its own, so no stopping card is drawn there from another workspace —
 * what every voice test not about that one exception means. The exception's own cases pass a real view filter
 * (`queueWorkspacePlacementRegression.test.ts`).
 */
import { queueLayout as queueLayoutInView } from "../../lib/queueLayout";
import type { QueueRow } from "../../lib/queueRows";
import { queueForVoice as queueForVoiceInView } from "../../lib/queueVoice";
import { type SpokenItem, spokenOf as spokenInView } from "../../lib/talkActionItemsSpoken";

/** Every row is this view's own. */
const OWN_VIEW = (): boolean => true;

/**
 * One row flattened to what the voice says, read in a view that shows it.
 *
 * @returns the spoken item
 */
export function spokenOf({ row }: { row: QueueRow }): SpokenItem {
  return spokenInView({ row, shows: OWN_VIEW });
}

/**
 * The Queue page's reading for the voice, every drawn row read in a view that shows it.
 *
 * @returns the reading
 */
export function queueForVoice(
  input: Omit<Parameters<typeof queueForVoiceInView>[0], "shows">,
): ReturnType<typeof queueForVoiceInView> {
  return queueForVoiceInView({ ...input, shows: OWN_VIEW });
}

/**
 * The Queue page's layout, every row read in a view that shows it.
 *
 * @returns the rows and folds, in draw order
 */
export function queueLayout(
  input: Omit<Parameters<typeof queueLayoutInView>[0], "shows">,
): ReturnType<typeof queueLayoutInView> {
  return queueLayoutInView({ ...input, shows: OWN_VIEW });
}
