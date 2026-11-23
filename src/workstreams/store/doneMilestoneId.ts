/**
 * The definition of done's one stable id, a leaf so the definitions ledger (`../definitions.ts`) can name it without
 * importing `./doneMilestone.ts`, which imports that ledger back.
 */

/** The id every workstream's definition of done carries, whatever it is renamed to. */
export const DONE_MILESTONE_ID = "done";
