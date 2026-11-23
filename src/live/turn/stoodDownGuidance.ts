/**
 * What the judge and the worker are told about a tag in a thread that stood the bot down earlier.
 *
 * `slopweaver witness stand-down` records that somebody in the thread told the bot it was in the way; from then
 * on nothing there is witnessed. A later EXPLICIT tag is still an address and still reaches a turn. The owner's
 * rulings: a tag that is actually a question is
 * answered; a steer or extra context gets `:ack:` and no reply; and the
 * bot never apologises for, or narrates, having stood down. Printed once in the judge's brief and once in the
 * worker's `turn resume`, from this one function, so the two cannot drift.
 */

/**
 * The guidance block for a tag in a stood-down thread, or nothing.
 *
 * @param stoodDown whether somebody in the ask's thread stood the bot down earlier
 * @returns the lines to print, ending on a blank one, or none
 */
export function stoodDownLines({ stoodDown }: { stoodDown: boolean }): readonly string[] {
  if (!stoodDown) {
    return [];
  }
  return [
    "STOOD DOWN — earlier in this thread somebody told the bot it was in the way, and it stood down: it reacted,",
    "  said nothing, and stopped witnessing the thread. This message TAGGED the bot, so it is judged — narrowly.",
    "  - A genuine question to the bot: answer it, exactly as any tag.",
    "  - A steer, a correction offered as context, or extra context with no question in it: `no-response`, which",
    "    settles the tag to the acknowledged emoji and posts nothing.",
    "  - Never apologise, never mention having stood down, never offer to stay out of the way.",
    "",
  ];
}
