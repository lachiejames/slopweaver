/**
 * Counting a poll — the PURE core over LIVE Slack reactions.
 *
 * ## Why this reads Slack and not the corpus
 *
 * A poll is a live artifact people are still clicking, and the reaction chips ON the message ARE the result —
 * the evergreen record, needing no edit and no second copy. The corpus is a periodic
 * snapshot; counting a running poll from it could only ever answer "as of the last ingest", which is a wrong
 * number that then needs a paragraph of caveats to excuse itself. `reactions.get` answers as of now.
 *
 * ## The count is "who reacted, minus us" — not arithmetic
 *
 * slopweaver seeds one chip per option so voting is a tap rather than an emoji hunt. Each seed is a real
 * reaction BY THE BOT, so the bot appears in the voter list of every option and must be excluded — otherwise a
 * poll nobody has answered reports one vote per option.
 *
 * Excluding it by IDENTITY (drop our own user id from `users`) rather than by subtracting one is deliberate:
 * identity is the actual question being asked, it needs no bookkeeping about what we seeded, and it stays
 * correct when someone removes our chip or reacts in the same instant we are seeding.
 *
 * The one wrinkle is that Slack may TRUNCATE `users` on a heavily-reacted message. That is detectable —
 * `users.length !== count` — and in that case the honest fallback is the count minus our own chip, flagged so
 * the caller can say the voter list was incomplete. Measured on a real message: complete for every reaction.
 */

/** One reaction as Slack reports it live: how many, and who. */
export interface ReactionCount {
  readonly name: string;
  readonly count: number;
  /** Who reacted. May be TRUNCATED by Slack on a busy message — compare against `count`. */
  readonly users: readonly string[];
}

/** One option's result. */
interface PollOptionTally {
  readonly position: number;
  readonly emojiName: string;
  readonly label: string;
  /** Human votes: everyone who reacted, except slopweaver itself. */
  readonly votes: number;
  /** Whether slopweaver's own chip is on this option. */
  readonly seeded: boolean;
  /**
   * True when Slack truncated the voter list, so `votes` came from the count rather than from identities.
   * Surfaced because a number derived a different way should say so.
   */
  readonly voterListTruncated: boolean;
}

/** A poll's whole result, including everything that was NOT counted as a vote. */
export interface PollTally {
  readonly options: readonly PollOptionTally[];
  readonly totalVotes: number;
  /**
   * Reactions that are not on the ballot. Reported rather than discarded: an off-ballot 👀 is not a vote, but
   * silently dropping it leaves the reader unable to tell "nobody reacted" from "people reacted off-ballot".
   */
  readonly ignored: readonly ReactionCount[];
}

/** One option's votes, excluding slopweaver's own chip. */
function votesFor({ reaction, selfUserId }: { reaction: ReactionCount | undefined; selfUserId: string }): {
  readonly votes: number;
  readonly seeded: boolean;
  readonly voterListTruncated: boolean;
} {
  if (reaction === undefined) {
    return { seeded: false, voterListTruncated: false, votes: 0 };
  }
  const seeded = reaction.users.includes(selfUserId);
  if (reaction.users.length === reaction.count) {
    // The voter list is complete, so the answer is simply everyone who is not us.
    return { seeded, voterListTruncated: false, votes: reaction.users.filter((user) => user !== selfUserId).length };
  }
  // Truncated: fall back to the count, less our own chip if it is in the part of the list we can see. Flagged,
  // because this number was derived differently from the others.
  return { seeded, voterListTruncated: true, votes: Math.max(0, reaction.count - (seeded ? 1 : 0)) };
}

/**
 * Tally live reactions against the ballot AS POSTED.
 *
 * `emojiNames` comes from the stored poll record rather than the current palette, so changing the palette can
 * never re-interpret a poll that already went out.
 *
 * @param options the option labels, in ballot order (including the appended escape hatch)
 * @param emojiNames the ballot emoji names, in the same order as `options`
 * @param selfUserId slopweaver's own Slack user id, excluded from every count
 * @param reactions the live reactions from `reactions.get`
 * @returns per-option human votes, the total, and the off-ballot reactions
 */
export function tallyPoll({
  options,
  emojiNames,
  selfUserId,
  reactions,
}: {
  options: readonly string[];
  emojiNames: readonly string[];
  selfUserId: string;
  reactions: readonly ReactionCount[];
}): PollTally {
  const byName = new Map<string, ReactionCount>();
  for (const reaction of reactions) {
    const existing = byName.get(reaction.name);
    byName.set(
      reaction.name,
      existing === undefined
        ? reaction
        : // Slack should not report one name twice; merging rather than overwriting means a repeat cannot
          // silently discard votes.
          {
            count: existing.count + reaction.count,
            name: reaction.name,
            users: [...new Set([...existing.users, ...reaction.users])],
          },
    );
  }
  const ballot = new Set(emojiNames);
  const tallies = options.map((label, index) => {
    // `!` rather than a fallback: the store refuses a record whose options and ballot differ in length, so an
    // index in range is an invariant. Inventing an emoji here would report a real option as zero.
    const emojiName = emojiNames[index]!;
    return { emojiName, label, position: index + 1, ...votesFor({ reaction: byName.get(emojiName), selfUserId }) };
  });
  return {
    ignored: reactions.filter((entry) => !ballot.has(entry.name)),
    options: tallies,
    totalVotes: tallies.reduce((sum, option) => sum + option.votes, 0),
  };
}
