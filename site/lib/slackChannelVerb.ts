/**
 * The read a channel chip's hover window takes when it opens: the channel as it is NOW, read LIVE through the door
 * by `slack channel-view` (what Slack desktop would show, images included, so the owner never
 * leaves localhost).
 *
 * Same door as `./draftContextVerb.ts`: a literal argv, one slot, and the slot checked against the exact shape of a
 * Slack conversation id before it becomes an argv element — never a flag, never a path.
 */

import { type Pause, timerPause } from "./coalescedRead";
import { spawnSettleBoundMs } from "./spawnVerb";

/** A conversation id as a Slack `/archives/` link carries one: a channel, a private group, or a DM. */
const CHANNEL_ID_SHAPE = /^[CDG][A-Z0-9]+$/;

/**
 * One `auth.test`, one history page, one `conversations.info`, up to sixteen `files.info` lookups and then up to
 * sixteen preview downloads, each four at a time, plus a member-bronze read. The cap matches
 * `DRAFT_CONTEXT_TIMEOUT_MS`: this read shares the machine with the page's own polls exactly as that one does.
 */
export const SLACK_CHANNEL_TIMEOUT_MS = 45_000;

/**
 * How many channels the route reads at once; one more waits. One, because each read is its own CLI child and Slack's
 * 429 block lives inside a process (`src/lib/rateBlock.ts`): with one child at a time, that child's block governs
 * every Slack call this window makes, so the window never has more than four `files.info` calls in flight against a
 * workspace.
 */
const CHANNELS_AT_ONCE = 1;

/**
 * How long a settled read, success or failure, answers a revisit of the same channel without another child. A
 * pointer passing back over a chip costs nothing, and a read that ended on a rate limit is not retried straight into
 * it. The window still says when its reading was taken.
 */
const SETTLED_HOLD_MS = 15_000;

/**
 * Covers what precedes the occupying child's timer being armed — the binary resolved, the child spawned, the hop
 * before `run` — and the ordering between its settle and a waiter's wake-up.
 */
const ADMISSION_MARGIN_MS = 2000;

/**
 * How long a second channel's hover waits for the read ahead of it: that read's settle time under normal scheduling,
 * plus a margin, so ordinarily it has ended before the wait does. Not a wall-clock guarantee —
 * on a stalled or sleeping machine the wait can end first, and the hover is then told to try again.
 */
export const SLACK_CHANNEL_WAIT_MS = spawnSettleBoundMs({ timeoutMs: SLACK_CHANNEL_TIMEOUT_MS }) + ADMISSION_MARGIN_MS;

/** The route's real timer pair, so a pause the route arms is a cleared `setTimeout` once its call returns. */
const ROUTE_PAUSE = timerPause({
  clearTimer: ({ handle }: { handle: ReturnType<typeof setTimeout> }) => {
    clearTimeout(handle);
  },
  setTimer: ({ ms, fire }) => setTimeout(fire, ms),
});

/**
 * The clock the wait's deadline and a held read's age are read off: monotonic, so a wall-clock step cannot end a
 * live wait early or hold an answer past its time.
 *
 * @returns milliseconds since this process's time origin
 */
function monotonicNow(): number {
  return performance.now();
}

/**
 * The admission policy `/api/slack-channel` reads under: one channel at a time, a settled read held briefly, a
 * second channel waiting for the first on a monotonic clock, and the request's own abort ending its wait.
 *
 * @param signal the request's abort, which fires when the hover window closes
 * @returns the `coalescedRead` options the route passes
 */
export function slackChannelAdmission({ signal }: { signal: AbortSignal }): {
  readonly holdMs: number;
  readonly limit: number;
  readonly now: () => number;
  readonly pause: Pause;
  readonly signal: AbortSignal;
  readonly waitMs: number;
} {
  return {
    holdMs: SETTLED_HOLD_MS,
    limit: CHANNELS_AT_ONCE,
    now: monotonicNow,
    pause: ROUTE_PAUSE,
    signal,
    waitMs: SLACK_CHANNEL_WAIT_MS,
  };
}

/** What building the argv came to. */
export type SlackChannelArgv =
  | { readonly kind: "argv"; readonly argv: readonly string[]; readonly title: string }
  | { readonly kind: "refused"; readonly why: string };

/** A Slack workspace host, lowercase, the shape the verb's `--workspace` accepts; no label can be `..` or a flag. */
const WORKSPACE_HOST_SHAPE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.slack\.com$/;

/**
 * The `slack channel-view` argv for one channel in the workspace its link named, or the refusal. The verb refuses a
 * token that reads another workspace, since a channel id is only an id within one.
 *
 * @param channel the conversation id off the request
 * @param workspace the lowercase workspace host off the same link
 * @returns the literal argv, or why the id or host was refused
 */
export function slackChannelArgv({ channel, workspace }: { channel: string; workspace: string }): SlackChannelArgv {
  if (!CHANNEL_ID_SHAPE.test(channel)) {
    return { kind: "refused", why: "the channel is not a Slack conversation id (C…, G… or D…)" };
  }
  if (!WORKSPACE_HOST_SHAPE.test(workspace)) {
    return { kind: "refused", why: "the workspace is not a Slack workspace host such as acme.slack.com" };
  }
  const argv = ["slack", "channel-view", channel, "--workspace", workspace, "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}
