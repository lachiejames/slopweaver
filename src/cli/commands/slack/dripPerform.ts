/**
 * The door's `perform` for an as-me drip (`./asMeSend.ts`): a release's last re-read of its row, then the drip. Split
 * out so the send's gate sequence and the act the door runs can each be read on their own.
 */
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import type { SlackDripOptions } from "./coreTypes.js";
import type { DripOutcome, SlackDripPlan } from "./dripCore.js";
import { dripPacer, runDripSequence } from "./dripRun.js";
import type { SlackWriteDeps } from "./run.js";

/** A release's re-read of its row: the refusal when the row moved, else `undefined`. */
export type DripLastCheck = (() => { readonly message: string } | undefined) | undefined;

/**
 * What the door's `perform` returned: every message's fate, or the release's row re-read refusing the send.
 *
 * @internal exported because {@link dripPerform}'s signature names it; callers read it off the door's result.
 */
export type DripPerformed = { readonly outcomes: readonly DripOutcome[] } | { readonly moved: string };

/**
 * The door's `perform`: the release's last re-read of its row, then the drip. Inside the door, after the media load,
 * so nothing awaits between this read and the first message's claim and send.
 *
 * @param lastCheck the release's re-read, absent on a fresh send
 * @param uploads the media bytes, loaded before the door
 * @param deliberateRepeat whether the duplicate gate's override was given, so a landed message may be sent again
 * @returns the act the door runs once every gate passed
 */
export function dripPerform({
  api,
  lastCheck,
  options,
  plan,
  uploads,
  deliberateRepeat,
}: {
  api: ReturnType<SlackWriteDeps["makeApi"]>;
  lastCheck: DripLastCheck;
  options: SlackDripOptions;
  plan: SlackDripPlan;
  uploads: ReadonlyMap<string, SlackUpload>;
  deliberateRepeat: boolean;
}): () => Promise<DripPerformed> {
  return async () => {
    const moved = lastCheck === undefined ? undefined : lastCheck();
    if (moved !== undefined) {
      return { moved: moved.message };
    }
    const outcomes = await runDripSequence({
      deps: {
        api,
        home: options.home,
        nowIso: () => new Date().toISOString(),
        pace: dripPacer({ intervalMs: plan.intervalMs }),
        readBack: ({ channel, ts }) => api.readOwnMessage({ channel, ts }),
        uploads,
      },
      plan,
      resend: { landed: deliberateRepeat, unconfirmed: options.resendUnconfirmed },
    });
    return { outcomes };
  };
}
