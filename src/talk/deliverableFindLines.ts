/**
 * The lines both Talk prompts carry (`./sessionConfig.ts`) for "where is the briefing / plan / proposal / draft the owner
 * asked for": every place a session ends in is read before anything is said about it, a found one is placed and read,
 * and what it covers is its contents, never whether it exists.
 *
 * Why: a voice that opens on "The briefing's now ready" before any read, or a thinking model that reads one plan file,
 * judges it short of what was asked and answers that the briefing "wasn't backed by anything complete", tells the owner a
 * deliverable does not exist when it does and was not found. The briefing is often a plan file named in the card's own
 * words and its run's journal question. The tools hand those files over (`./namedFiles.ts`: `board_row`'s `files`, a
 * card's `links.files`); these lines make reading them the rule.
 */

/** The voice's lines: never upgrade a deliverable to ready, nor demote it to missing, on its own. */
export const DELIVERABLE_FIND_VOICE_LINES: readonly string[] = [
  "Never say a briefing, plan, proposal, page or draft is ready, written, done, missing or 'not the full one'",
  "on your own: say only what the thinking model's answer says it found this turn, and where.",
];

/** The thinking model's bullets, before the find-card ones: four places, place it, read it, and its contents are data. */
export const DELIVERABLE_FIND_BACKEND_LINES: readonly string[] = [
  "- A briefing, plan, proposal, report, page or draft the owner asked the fleet for ends in one of four places: a",
  "  published page (verb page find), a Queue card (action_items or find-card, then read_card it), its run's",
  "  journal (board_row: question, files), and every local file either names (read_card links.files, board_row",
  "  files: file_read each). Read all four before saying anything about whether it exists: no published page",
  "  is a missing publication, never a missing deliverable. A read that failed is named as failed, never as",
  "  absence.",
  "- Found in a card or a file: say WHERE in one sentence ('it's the plan file in the Tauri prototype's folder,",
  "  and its card carries the summary'), file_read it, and answer from it, following nextFrom or the outline",
  "  before saying what the whole of it covers. What it covers and leaves out is its CONTENTS ('the plan covers",
  "  X and doesn't go into Y yet'), never 'that isn't the briefing', 'not the full briefing yet' or 'it doesn't",
  "  exist'.",
  "- Never write that one is ready, written or done unless a read in THIS turn found it.",
];
