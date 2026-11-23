/**
 * The consecutive-run counter behind "the doors must refuse a wall" — a thread where every reply so far is
 * ours, unbroken, grows unnoticed one reasonable-looking send at a time, because no single send is the
 * problem. `graphql-review-thread-consolidate-the-wall` deleted 17 consecutive as-me messages built across
 * four separate sends (4, 4, 8, 1) in a `#proj-monitoring` review thread, with no reply from anyone in
 * between and none of the reviewers having read any of it.
 *
 * `WALL_RUN_LIMIT` is measured, not chosen: the same thread's highest HUMAN run was 5, spread over ~28
 * hours. A rule at 5 refuses the sixth message of a wall and never constrains a human-shaped posting
 * cadence.
 *
 * ## Whose run this is
 *
 * The gate's subject is a run SLOPWEAVER built, and the two lanes answer "who are we" differently. The card
 * lane's token is the bot's, so every message under that identity came from this system. The as-me lane's
 * token is the OWNER'S OWN, so a message under that identity is just as likely to be one the owner typed into
 * Slack by hand — and counting those made the gate refuse a drip the owner had explicitly asked for at five.
 * Measured on an acme-admin pull request thread: two earlier replies of the owner's own stood at the tail, the
 * drip asked for was five messages, the gate projected seven, and messages four and five only went out under
 * the `wall` hatch. What the owner asked for is the source of truth and overrides a gate's arithmetic.
 *
 * So {@link existingWallRun} takes the `actor` and, in the `me` lane, treats a message from our identity the
 * way it already treats the thread parent — present, but not part of a run WE built.
 *
 * **What that costs, stated rather than discovered.** In the `me` lane the standing run is 0 by
 * construction, so the gate there reduces to "one send may not post more than {@link WALL_RUN_LIMIT}
 * messages". The 17-message wall in the module note above was built across FOUR separate as-me sends
 * (4, 4, 8, 1), and this gate no longer sees that accumulation — only each send's own count. Nothing else
 * in `src/outbound/slack/` covers it: `duplicateGate.ts` matches identical content, `asMeBumpGate.ts` reads
 * one message's text, `publicCardGate.ts` judges a top-level post's shape. Distinguishing a message
 * slopweaver sent as the owner from one they typed would need a per-`ts` record the send reservations do not keep
 * (`sendReservation.ts` is keyed by a content hash and dated by a 24-hour window, and the incident spanned
 * ~28 hours). That gap is real and is not closed here; refusing the owner is the worse of the
 * two failures.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchIncantation } from "../../hatch/types.js";

/** How many consecutive messages from OUR identity a thread may carry before a further send is refused. */
export const WALL_RUN_LIMIT = 5;

/** The journalled hatch for the caller who has actually decided to append to an existing run. */
const WALL_HATCH = "wall";

/** The command a wall refusal names as its one way past, derived from the register row. */
const WALL_ESCAPE = hatchIncantation({ hatch: hatchFor({ id: WALL_HATCH }) });

/**
 * Which identity a send goes out under, and therefore what a message from that identity means. `bot` is
 * this system's own Slack app; `me` is the owner's own account, which the owner also types into by hand. Same two
 * values as the `--as` flag, deliberately, so the lane is named once in the whole path.
 */
export type WallActor = "bot" | "me";

/**
 * One thread reply (or its parent), reduced to what the run count needs: which side sent it, and where it
 * can be cited from.
 */
export interface ThreadReplyIdentity {
  readonly ts: string;
  /** Whether this message was sent by the SAME identity that is about to send — the bot's, or the user's. */
  readonly ours: boolean;
  readonly permalink: string;
}

/** Our unbroken run at the TAIL of a thread, as it stands before this send. */
export interface WallRun {
  readonly length: number;
  /** The `ts` of the most recent message NOT sent by us, absent when nobody else has ever replied here. */
  readonly lastOtherTs?: string;
  /** The permalink of the oldest message in the run, absent when the run is empty. */
  readonly firstOursPermalink?: string;
}

/**
 * The consecutive run WE BUILT at the tail of a thread's replies, right now.
 *
 * The thread's parent message is deliberately excluded whichever side sent it: it is the topic being
 * replied to, not a participant in the reply exchange, so it neither extends our run nor counts as "someone
 * else already replied" the way an actual reply from them would.
 *
 * An `actor` of `me` excludes every earlier message from our identity on exactly the same footing, because
 * in that lane our identity is the owner's own hand — see this module's note for the ruling and its cost.
 * The standing run is therefore always 0 there, and only the messages THIS send is about to post can trip
 * the limit.
 *
 * @param replies every message `conversations.replies` returned for the thread, parent included, in Slack's
 *   order (oldest first)
 * @param threadTs the thread's root `ts`, so its own echo among `replies` can be told apart from a reply
 * @param actor which identity this send goes out under
 * @returns the run standing at the tail, before this send
 */
export function existingWallRun({
  replies,
  threadTs,
  actor,
}: {
  replies: readonly ThreadReplyIdentity[];
  threadTs: string;
  actor: WallActor;
}): WallRun {
  let length = 0;
  let lastOtherTs: string | undefined;
  let firstOursPermalink: string | undefined;
  for (let index = replies.length - 1; index >= 0; index -= 1) {
    const reply = replies[index]!;
    if (reply.ts === threadTs) {
      continue;
    }
    if (reply.ours && actor === "me") {
      continue;
    }
    if (!reply.ours) {
      lastOtherTs = reply.ts;
      break;
    }
    length += 1;
    firstOursPermalink = reply.permalink;
  }
  return {
    length,
    ...(lastOtherTs !== undefined ? { lastOtherTs } : {}),
    ...(firstOursPermalink !== undefined ? { firstOursPermalink } : {}),
  };
}

/**
 * Refuse a send whose own messages would take our run past {@link WALL_RUN_LIMIT}.
 *
 * Counts the run the send would CREATE, not only the one standing before it: a drip of several messages
 * can build a wall in one call exactly as a run of single-message sends did.
 *
 * @param existingRun our run standing at the tail of the thread before this send
 * @param newMessageCount how many messages this one send is about to post, all necessarily consecutive
 * @param allowWall whether this session holds a live `wall` grant
 * @returns one refusal naming the projected count, the last other-party message, and the fix — or empty
 */
export function wallRefusal({
  existingRun,
  newMessageCount,
  allowWall,
}: {
  existingRun: WallRun;
  newMessageCount: number;
  allowWall: boolean;
}): readonly string[] {
  const projected = existingRun.length + newMessageCount;
  if (allowWall || projected <= WALL_RUN_LIMIT) {
    return [];
  }
  const since =
    existingRun.lastOtherTs === undefined
      ? "nobody else has ever replied in this thread"
      : `nobody else has replied since their message at ts ${existingRun.lastOtherTs}`;
  // NAMES THE TARGET SHAPE, never a direction. Measured: this refusal used to end "consolidate
  // it into fewer", and the `setTaskUrgency` session complied by going from eight messages to four and
  // posting those — which the owner then deleted. A refusal that names a direction gets minimum-complied
  // with, because "fewer" is satisfied by any decrease at all. "One message" is not.
  const fix =
    existingRun.firstOursPermalink === undefined
      ? `this send alone posts ${String(newMessageCount)} consecutive messages — rewrite it as ONE message ` +
        "carrying the whole thought, not a smaller number of them"
      : `edit the existing run into ONE message, starting at ${existingRun.firstOursPermalink}, rather than ` +
        "appending to it";
  return [
    `this send would take our unbroken run in this thread to ${String(projected)} consecutive messages — ` +
      `${since}. ${fix}, or for one deliberate append run ${WALL_ESCAPE}.`,
  ];
}
