/**
 * Two drafts the console voice wrote as the owner that ran past where the owner would end them, and the cut of each
 * the owner took. The words are invented; each keeps its original's shape (one paragraph, its word count, where its
 * ask sits and what follows it). Shared by the shape gate's tests and the running list's verdict tests, so both hold
 * down the same words.
 */

/**
 * The reminder draft. The owner objected to the extra sentences added after a good draft and said "stop" as the
 * reread reached its question: the message ends where the owner says stop.
 */
export const ARI_OFFERED =
  "Hey Sadie, before the last round of training reminders we had [before] people with the module still open, and " +
  "we’re now at [now]. Was thinking of sending another round, but don’t want to keep sending the same nudge if it’s " +
  "not landing. Are you already chasing any of these up? Thought we should line up on what’ll actually get the last " +
  "few done.";

/** The same draft ended where the owner said stop: on its ask. */
export const ARI_CUT =
  "Hey Sadie, before the last round of training reminders we had [before] people with the module still open, and " +
  "we’re now at [now]. Was thinking of sending another round, but don’t want to keep sending the same nudge if it’s " +
  "not landing. Are you already chasing any of these up?";

/**
 * The monitors reply. The owner found it a little too long at the end and cut about the last 20%.
 */
export const MONITORS_OFFERED =
  "Yeah, from memory we kept a few muted because the queue metrics were fresh, so there wasn't enough history to " +
  "judge the thresholds. The plan was to come back and unmute them once we had that. I'd have someone on platform " +
  "check each one's last fortnight: would it have fired when needed and stayed quiet otherwise? If nothing happened, " +
  "replay it against a known outage or test it fires. Then adjust what needs adjusting, raise a PR unmuting the " +
  "useful ones, and watch the channel afterwards. Probably worth putting an owner and date on anything still muted, " +
  "so we don't drop the follow-up again.";

/**
 * The cut the owner took, accepted as sendable. Its question poses the check to run and a sentence follows it, which
 * is why only a question that addresses the reader is an ask.
 */
export const MONITORS_CUT =
  "Yeah, from memory we kept a few muted while the new queue metrics built up enough history. Plan was to come " +
  "back and unmute them. I'd have someone on platform check the available history, especially around outages " +
  "these should've caught: would they have fired when needed and stayed quiet otherwise? Then adjust what needs " +
  "adjusting and raise a PR turning the useful ones on.";
