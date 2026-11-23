/**
 * The split between the owner's Queue and their Alignment page: which rows are actions for the owner, and which are the
 * fleet asking whether something it already did was the right call.
 *
 * Every was-this-the-right-call question, hypothetical ones included, belongs on a separate page, out of the Queue. The
 * Queue is for actions for the owner, priorities to consider, and unblocking the fleet. The cards move BY KIND, not
 * by wording: an `act` row is the autonomy ledger's account of something the fleet already did, and every one of them
 * is a was-this-the-right-call question. Nothing else is. A hand step posted `--check-in` is a step for the owner's
 * hands (open the app, approve the hooks), and an ask the currency check thinks the owner answered still asks them
 * something, so both stay on the Queue in its last tier — the `check-in` tier (`./waitingRank.ts`) is unchanged, and is not this split.
 *
 * A PARTITION of one projection, never a second register: every row is still built once by `rowsOf`
 * (`./queueRows.ts`) and filtered by work context, tags and settling exactly as before; this only says which page
 * draws it. Imports nothing, so the unit lane loads it alone.
 */

/** The kind every alignment row is: the fleet already did it, and asks whether that was right. */
const ALIGNMENT_KIND = "act";

/**
 * Whether a row belongs on the Alignment page rather than the Queue.
 *
 * @param row the row, as much of it as the split reads
 * @returns true for an act the fleet already took
 */
export function isAlignmentRow({ row }: { row: { readonly kind: string } }): boolean {
  return row.kind === ALIGNMENT_KIND;
}

/**
 * Split rows between the two pages, each side in the order it came.
 *
 * @param rows the rows, already ranked and filtered
 * @returns the Queue's rows and the Alignment page's
 */
export function partitionAlignmentRows<T extends { readonly kind: string }>({
  rows,
}: {
  rows: readonly T[];
}): { readonly queueSide: readonly T[]; readonly alignmentSide: readonly T[] } {
  return {
    alignmentSide: rows.filter((row) => isAlignmentRow({ row })),
    queueSide: rows.filter((row) => !isAlignmentRow({ row })),
  };
}

/** Where alignment stands, as the page's indicator draws it. */
export interface AlignmentStage {
  readonly tone: "rough" | "measured";
  readonly label: string;
}

/**
 * The indicator the page opens on: rough knowledge until the owner's voice has been measured from the Slack messages
 * they sent, then that the voice is measured and nothing wider. It is a visual indicator that the AI knows some stuff
 * but it is rough and not yet aligned with you, until alignment work follows. The voice is never asked, so the stage
 * reads what was measured rather than answers.
 *
 * @param voiceMeasured whether a Slack cohort of the owner's sent messages carries a measured length (`./alignmentVoice.ts`)
 * @returns the tone and the words
 */
export function alignmentStage({ voiceMeasured }: { voiceMeasured: boolean }): AlignmentStage {
  if (!voiceMeasured) {
    return { label: "Rough knowledge · your voice is not yet measured from your sent Slack messages", tone: "rough" };
  }
  return {
    label: "Voice measured from your sent Slack messages · everything else is still rough knowledge",
    tone: "measured",
  };
}

/** The Alignment page's path. */
export const ALIGNMENT_PATH = "/alignment";

/**
 * The page a card key opens on: an act on the Alignment page, an automation on Automations, a proposed workstream on
 * Workstreams, every other card on the Queue. `src/hand/consoleLink.ts` mints the same answer for a floating note's Open.
 *
 * @param key the card's `<kind>:<id>`
 * @returns the console path
 */
export function consoleCardPath({ key }: { key: string }): "/queue" | "/alignment" | "/automations" | "/workstreams" {
  if (key.startsWith(`${ALIGNMENT_KIND}:`) || key.startsWith("align:")) {
    return ALIGNMENT_PATH;
  }
  if (key.startsWith("recipe:")) {
    return "/automations";
  }
  if (key.startsWith("candidate:")) {
    return "/workstreams";
  }
  return "/queue";
}
