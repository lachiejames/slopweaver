/**
 * `slack poll`'s two steps after the post lands: seeding one clickable ballot chip per option, and reporting
 * what landed. Split out of `./pollRun.ts`, whose write order (peek → door → claim → reserve → post → confirm)
 * is the part that stays there; both steps here run only once Slack already holds the poll.
 */
import { logger } from "../../../lib/logger.js";
import type { PollPlan } from "./pollCore.js";

/**
 * Seed one clickable chip per ballot option.
 *
 * IN BALLOT ORDER and strictly sequential, which is a correctness property rather than caution: Slack orders
 * reaction chips by when they were added, so a concurrent seed would scramble 1..N and the numbers a reader
 * clicks would no longer line up with the numbers in the message.
 *
 * @param seedReaction the injected seam that adds ONE chip and says whether it landed
 * @param plan the fully-decided send, whose ballot order is the seeding order
 * @param posted the confirmed message identity
 * @param token the Slack bot token
 * @returns which chips landed and which did not, so the tally subtracts exactly the ones that did
 */
export async function seedBallot({
  seedReaction,
  plan,
  posted,
  token,
}: {
  seedReaction: (args: { token: string; channel: string; ts: string; name: string }) => Promise<boolean>;
  plan: Pick<PollPlan, "ballot">;
  posted: { channel: string; ts: string };
  token: string;
}): Promise<{ readonly seededEmoji: readonly string[]; readonly failedEmoji: readonly string[] }> {
  const seededEmoji: string[] = [];
  const failedEmoji: string[] = [];
  for (const entry of plan.ballot) {
    const landed = await seedReaction({
      channel: posted.channel,
      name: entry.emojiName,
      token,
      ts: posted.ts,
    });
    (landed ? seededEmoji : failedEmoji).push(entry.emojiName);
  }
  return { failedEmoji, seededEmoji };
}

/**
 * What a successful post tells the operator: where it landed, how the seeding went, and the next two verbs.
 *
 * @param emit the injected stdout sink every report line goes through
 * @param ballotSize how many chips the ballot asked for, the denominator of the seeded line
 */
export function reportPosted({
  emit,
  posted,
  seededEmoji,
  failedEmoji,
  ballotSize,
}: {
  emit: (line: string) => void;
  posted: { channel: string; ts: string };
  seededEmoji: readonly string[];
  failedEmoji: readonly string[];
  ballotSize: number;
}): void {
  emit(`posted poll to ${posted.channel} as ts ${posted.ts}`);
  emit(`seeded ${String(seededEmoji.length)}/${String(ballotSize)} clickable ballot chips`);
  if (failedEmoji.length > 0) {
    // Never silent: an unseeded option is one people must add the emoji for themselves, so it will be
    // under-represented and the operator needs to know that before reading the result.
    logger.error({
      msg:
        `these ballot chips did NOT seed: ${failedEmoji.map((name) => `:${name}:`).join(", ")}. Voters must add ` +
        "those themselves, so those options may be under-counted.",
    });
  }
  emit("read the votes back with:");
  emit(`  slopweaver slack poll results --channel ${posted.channel} --ts ${posted.ts}`);
  emit("delete it with:");
  emit(`  slopweaver slack delete --channel ${posted.channel} --ts ${posted.ts}`);
}
