/**
 * The ONE-CARD gate — a top-level post to a public channel is one message, or the door refuses it.
 *
 * A four-message drip plus its follow-up correction was once deleted from a public channel. Something posted
 * in a very public place often serves as a discussion piece as well, and a discussion is much easier to have
 * when it is only one message, so such a post is one top-level card.
 *
 * **Why this is a refusal and not a raised cap.** The drip form's per-message width bound and
 * `./wallGate.ts` were both tuned for THREAD replies, and in a public top-level post they actively push a
 * caller the wrong way: the cap fragments one thought into several messages, and the wall guard's advice is
 * to post *fewer*, which a caller satisfies by going from eight messages to four. Measured — the
 * `setTaskUrgency` session did exactly that, consolidated 8 to 4, and posted the four-message drip the
 * owner then deleted. A bound that can be complied with by fragmenting less is not a bound on fragmenting.
 * So the shape is REFUSED at the door and the refusal names the target shape rather than a direction. Two
 * forms are compliant (`../artifact/types.ts`), and the refusal names both because naming only the first
 * is its own version of pushing a caller the wrong way: `{"kind":"one-card"}` holds a discussion piece in
 * one message with real line breaks, and `{"kind":"one-list"}` holds a roster or batch ask that would blow
 * the card's line bound — ten open pull requests are ten dot points, and there is no shorter honest way to
 * say them.
 *
 * **Three cases it deliberately leaves alone.** A `--shape thread` send keeps today's drip rules exactly —
 * a parent with its replies beneath it is a thread, not a wall in the channel. A DM keeps them too, because
 * a drip between two people is conversation. And a single-message send is already the target shape, so it
 * never reaches a lookup at all.
 *
 * **It fails CLOSED on an unestablished surface**, matching `conversationSurfaceCall`'s own discipline in
 * `../../corpus/slack/writeApiPoll.ts`: the cost of guessing "private" wrong is a wall of messages under the
 * owner's name in the org's most public channel, which is the exact thing this exists to prevent, while the cost of
 * guessing "public" wrong is one refusal a named override clears.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchIncantation } from "../../hatch/types.js";
import type { ConversationSurface, DripShape } from "./types.js";

/** The journalled hatch for a caller who has actually decided to post several top-level messages in public. */
const PUBLIC_DRIP_HATCH = "public-drip";

/** The command a public-drip refusal names, derived from the register row. */
const PUBLIC_DRIP_ESCAPE = hatchIncantation({ hatch: hatchFor({ id: PUBLIC_DRIP_HATCH }) });

/**
 * The compliant shapes, named the same way everywhere so a refusal and the form's docs cannot drift apart.
 *
 * TWO of them, because naming only the card is how this refusal used to push a caller the wrong way. A
 * ten-PR review ask does not fit `one-card`'s `maxLines`, so a composer reading a refusal that named only
 * that form concluded the door could not express the message and reached for a voice-rule override
 * instead. The list form always held that shape; a refusal must say so.
 */
const TARGET_SHAPE =
  "post it as ONE top-level message instead. A discussion piece is a " +
  '`{"kind":"one-card"}` form, whose `lines` carry the line breaks the drip form gets from message ' +
  'boundaries; a roster or batch ask is a `{"kind":"one-list"}` form, whose `lead` opens it, whose ' +
  "`bullets` are Slack's own single-spaced list and whose `trailing` lines close it";

/**
 * Whether this send even needs a surface lookup — the test the shell uses to avoid a Slack call it cannot
 * act on.
 *
 * @param shape whether the messages land as separate top-level posts or as a thread
 * @param messageCount how many messages this one send would post
 * @returns true when the send could be refused by {@link publicDripRefusal} and the surface decides it
 */
export function needsSurfaceForOneCard({ shape, messageCount }: { shape: DripShape; messageCount: number }): boolean {
  return shape === "top-level" && messageCount > 1;
}

/**
 * Refuse a multi-message top-level as-me send whose channel is one anybody in the org can read.
 *
 * @param shape whether the messages land as separate top-level posts or as a thread
 * @param surface what Slack's own flags say the channel is, or `undefined` when the read could not answer
 * @param messageCount how many messages this one send would post
 * @param allowPublicDrip whether this session holds a live `public-drip` grant
 * @returns one refusal naming the target shape, or empty when the send may proceed
 */
export function publicDripRefusal({
  shape,
  surface,
  messageCount,
  allowPublicDrip,
}: {
  shape: DripShape;
  surface: ConversationSurface | undefined;
  messageCount: number;
  allowPublicDrip: boolean;
}): readonly string[] {
  if (allowPublicDrip || !needsSurfaceForOneCard({ messageCount, shape })) {
    return [];
  }
  if (surface === "direct-message" || surface === "private-channel") {
    return [];
  }
  if (surface === undefined) {
    return [
      `this send would post ${String(messageCount)} separate top-level messages, and Slack could not say ` +
        "whether that channel is public or private — so it is refused rather than guessed at, because the " +
        `case it would guess wrong is the public one. ${TARGET_SHAPE}, or for one deliberate exception ` +
        `run ${PUBLIC_DRIP_ESCAPE}.`,
    ];
  }
  return [
    `this send would post ${String(messageCount)} separate top-level messages into a PUBLIC channel. A ` +
      "post to a very public place serves as a discussion piece, and a discussion is much easier to have " +
      `when it is one message. ${TARGET_SHAPE}, or for one deliberate exception run ${PUBLIC_DRIP_ESCAPE}.`,
  ];
}
