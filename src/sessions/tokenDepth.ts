/**
 * How many tokens a live Claude session is currently CARRYING — its context depth, folded out of its own
 * transcript rather than scraped off its screen.
 *
 * ## Depth is not spend, and the difference is the whole point
 *
 * `sessions/sessionCost.ts` answers what a session has SPENT: a sum over every turn, which only ever grows.
 * This answers what one more turn will COST BEFORE it does anything — the size of the prompt the newest turn
 * actually sent. That figure is what a session's own `/clear to save …` hint reports, it is what falls to
 * nothing on a `/clear`, and it is the number the owner was reacting to when asking for the
 * discipline this module exists to make mechanical: a session can be 900k tokens deep and still doing work
 * it does not need that depth for.
 *
 * Depth is therefore the LAST turn's `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` —
 * every token the model was handed, whatever cache tier served it. It is deliberately not a maximum over the
 * tail: a compaction drops depth sharply, and a gauge that kept reporting the pre-compaction peak would
 * recommend respawning a session that had just been made fresh.
 *
 * ## Read from the tail, and never from a partial line
 *
 * Transcripts reach tens of megabytes (41.9 MB, measured), and only the end of one is needed.
 * Measured across the 200 largest transcripts on this machine, a 256 KiB tail contained a
 * complete assistant usage line in 200 of 200 — {@link DEPTH_TAIL_BYTES} keeps a wide margin over that floor
 * and is still bounded. A tail that begins mid-file begins mid-LINE, so {@link latestContextDepth} drops its
 * first line rather than trying to parse it; and a tail with no usage line in it reports that it could not
 * measure, never a zero. A comforting zero on a gauge whose whole job is to say "this session is expensive"
 * would be the worst possible failure.
 *
 * Pure: text in, numbers out. The file reading lives in `./depthStore.ts`.
 */
import { readUsageLine } from "./sessionCost.js";

/**
 * How much of a transcript's tail is read looking for the newest turn.
 *
 * Measured, not guessed — see this module's header. Four times the measured floor, because the thing that
 * moves the floor is one enormous tool result landing between the newest turn and the end of the file, and
 * two screenshot results alone were measured at ~190k characters in a single live loop session.
 */
export const DEPTH_TAIL_BYTES = 1_048_576;

/** One session's context depth, as its newest turn reports it. */
export interface ContextDepth {
  /** Every token the newest turn was handed — fresh input plus both cache tiers. */
  readonly depthTokens: number;
  /** The model that served that turn, e.g. `claude-opus-5`. Empty when the line named none. */
  readonly model: string;
  /** The `message.id` the figure was read from, so a caller can prove which turn it measured. */
  readonly messageId: string;
}

/**
 * The context depth of the newest assistant turn in a transcript tail.
 *
 * @param text the transcript's tail, as read by `./depthStore.ts`
 * @param fromStart whether {@link text} begins at byte 0 of the file — when false its first line may be a
 *   fragment, and is dropped rather than parsed
 * @returns the newest turn's depth, or the reason none could be read
 */
export function latestContextDepth({
  text,
  fromStart,
}: {
  text: string;
  fromStart: boolean;
}): { readonly depth: ContextDepth } | { readonly why: string } {
  const lines = text.split("\n");
  const firstUsable = fromStart ? 0 : 1;
  for (let index = lines.length - 1; index >= firstUsable; index--) {
    const read = readUsageLine({ line: lines[index]! });
    if (read.kind === "usage") {
      const { turn } = read;
      return {
        depth: {
          depthTokens: turn.inputTokens + turn.cacheReadTokens + turn.cacheCreationTokens,
          messageId: turn.messageId,
          model: turn.model,
        },
      };
    }
  }
  return {
    why: `no complete assistant turn was found in the last ${String(DEPTH_TAIL_BYTES)} bytes of the transcript`,
  };
}

/**
 * The depth at which a session earns a supervisor's REVIEW — never an automatic respawn.
 *
 * A policy number rather than a measurement, and the owner named it while declining to treat
 * it as anything sharper: _"is 500-600k tokens something special? I mean, I guess it's a good enough
 * heuristic at the moment."_ It sits one band above the fleet-wide advisory line
 * (`./sessionDepthAwareness.ts`, 500k) on purpose: every session is TOLD at 500k, and a supervisor is asked
 * to LOOK at 600k.
 *
 * The measurement is why the verdict is `review` and not `respawn-candidate`. MEASURED over 822
 * transcripts touched recently: of the 62 sessions that crossed 600k, 41 still had enough work ahead for
 * a restart to repay its pickup and 21 did not — so an action-shaped verdict here would be wrong about a
 * third of the time, on a fact no gauge can see. `sessions/supervisorUsageReport.ts` carries the arithmetic
 * a supervisor decides with. Reproduce: `slopweaver session depth --json`.
 *
 * It replaces a 300k default drawn from the "around 300–400k tokens" band in `skills/supervisor/SKILL.md`
 * § 6 — that band is about when a step-down is worth CONSIDERING and remains true; this constant is about
 * when a gauge should say so out loud, which the owner's ruling put higher. `--threshold` overrides it per call.
 */
export const DEFAULT_DEPTH_REVIEW_THRESHOLD_TOKENS = 600_000;

/** What the gauge says about one session's depth. */
export type DepthVerdict = "review" | "under-threshold";

/**
 * Whether a depth has reached the threshold.
 *
 * @param depthTokens the session's context depth
 * @param thresholdTokens the depth at or past which a session is a respawn candidate
 * @returns the verdict
 */
export function depthVerdict({
  depthTokens,
  thresholdTokens,
}: {
  depthTokens: number;
  thresholdTokens: number;
}): DepthVerdict {
  return depthTokens >= thresholdTokens ? "review" : "under-threshold";
}
