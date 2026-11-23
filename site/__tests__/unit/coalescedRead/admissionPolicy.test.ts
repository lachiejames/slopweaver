import { describe, expect, it } from "vitest";
import { type CoalescedEntry, coalescedRead } from "../../../lib/coalescedRead";
import { SLACK_CHANNEL_TIMEOUT_MS, SLACK_CHANNEL_WAIT_MS, slackChannelAdmission } from "../../../lib/slackChannelVerb";
import { spawnSettleBoundMs } from "../../../lib/spawnVerb";
import { handClock, handPause, heldRead, live } from "./harness";

describe("the channel route's admission policy", () => {
  it("waits past one occupying read's settle under normal scheduling, from the spawn contract's own numbers", () => {
    expect(spawnSettleBoundMs({ timeoutMs: 45_000 })).toBe(46_000);
    expect(SLACK_CHANNEL_WAIT_MS).toBe(48_000);
  });

  it("passes the request's own signal, one channel at a time, a short hold and the real abortable pause", async () => {
    const control = new AbortController();
    const admission = slackChannelAdmission({ signal: control.signal });
    const aborted = new AbortController();
    aborted.abort();

    expect(admission.signal).toBe(control.signal);
    expect(admission.limit).toBe(1);
    expect(admission.holdMs).toBe(15_000);
    expect(admission.waitMs).toBe(SLACK_CHANNEL_WAIT_MS);
    await expect(admission.pause({ ms: SLACK_CHANNEL_WAIT_MS, signal: aborted.signal })).resolves.toBeUndefined();
  });

  it("admits a second channel when the first settles at its worst normal-scheduling instant", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const hand = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const two = heldRead({ answer: "C0TWO read", starts });
    const ask = ({ key, run }: { key: string; run: () => Promise<string> }): Promise<string> =>
      coalescedRead({
        ...slackChannelAdmission({ signal: live() }),
        busy: () => "busy",
        key,
        now: clock.now,
        pause: hand.pause,
        reads,
        run,
      });
    const first = ask({ key: "C0ONE", run: one.run });
    const second = ask({ key: "C0TWO", run: two.run });
    clock.advance({ ms: spawnSettleBoundMs({ timeoutMs: SLACK_CHANNEL_TIMEOUT_MS }) });
    one.release();
    two.release();

    expect(await Promise.all([first, second])).toEqual(["C0ONE read", "C0TWO read"]);
    expect(starts).toEqual(["C0ONE read", "C0TWO read"]);
  });
});
