/**
 * Where a handover question was posted — the link a card cites, read off a `question-posted` journal line.
 *
 * No verb writes one: a question belongs on the console's Queue card and never posted to the owner's DM
 * (`../outbound/slack/dmPurpose.ts`). Journals in the one shared home still carry the lines a delivering
 * build wrote, so the readers stay and a card still links a question that WAS posted.
 *
 * Its own module so the run ledger's decoder and its state fold share one shape without the ledger growing.
 */

/** Where a question was posted: the link a card cites. */
export interface QuestionPost {
  readonly channel: string;
  readonly ts: string;
  /** Absent when the workspace URL could not be resolved when it was posted, and on handles written before it existed. */
  readonly permalink?: string;
}

/**
 * The handle a `question-posted` event names, carrying its permalink only when it has one.
 *
 * Picks the three fields rather than spreading the event, so the question text and instant it also carries
 * never ride along into a handle.
 *
 * @param event the handle event, or anything carrying its channel, ts and optional permalink
 * @returns where the question was posted
 */
export function questionPostOf({ event }: { event: QuestionPost }): QuestionPost {
  return {
    channel: event.channel,
    ...(event.permalink === undefined ? {} : { permalink: event.permalink }),
    ts: event.ts,
  };
}
