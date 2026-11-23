/**
 * What the judge and the worker are told about an ask nobody tagged the bot in.
 *
 * `slopweaver witness help` turns a witnessed message into an ask in a thread a person tagged this bot into
 * earlier: 👀, the progress card, then an answer, exactly as a tag would run. The owner's ruling:
 * help where the need is clear and help is welcome, never do work a named person was asked to do, and DO
 * answer a status question a leader asked of somebody else. A further ruling of the owner's
 * adds the one message that is not unprompted at all: the asker
 * supplying what the bot asked for before it could raise the pull request or ticket THEY explicitly asked for.
 * Only the person's own earlier words make it an ask; a ticket the bot proposed is not one. Another ruling of
 * the owner's adds an untagged CORRECTION of the bot's own
 * posted answer: it is revised, superseding the old one. Everything downstream of the card is the tag path
 * unchanged, so the only thing that differs is what the reader is told here — printed once in the judge's
 * brief and once in the worker's `turn resume`, from this one function, so the two cannot drift.
 */

/**
 * The guidance block for an unprompted ask, or nothing for a tagged one.
 *
 * @param unprompted whether `witness help` opened this ask rather than a tag
 * @returns the lines to print, ending on a blank one, or none
 */
export function unpromptedHelpLines({ unprompted }: { unprompted: boolean }): readonly string[] {
  if (!unprompted) {
    return [];
  }
  return [
    "UNPROMPTED — nobody tagged this bot in this message. `witness help` opened it as an ask because the thread,",
    "  which a person tagged the bot into earlier, showed a need it can meet. The card is already up, so the thread",
    "  can see the bot is looking and nobody duplicates the work.",
    "  - Open on what was looked into and what was found, never on 'you asked'.",
    "  - One exception: earlier in this thread the asker EXPLICITLY asked the bot for a PR, a ticket or a fix,",
    "    the bot asked for missing detail, and this message supplies it. Then finish that ask and open on what was raised.",
    "    The bot's own question is never the ask: read the thread for the person's words.",
    "  - A correction of the bot's OWN earlier answer here (\"that's wrong, we changed it to Melbourne\"): check it,",
    "    and if it holds, post the revised answer with the old answer's ts in the form's `supersedes`.",
    "  - Never do work a named person was asked to do. A status question asked of someone else IS answerable.",
    "  - Short, and only what is material: an unprompted answer that is noise costs the next one its welcome.",
    "",
  ];
}
