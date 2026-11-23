/*
 * session-start's legs after the board under a deadline already reached: no live leg starts, each reads as empty
 * with its own couldNotSee line, the Slack scan runs in its place between the cycle and mail legs — the order the
 * run read them in before it had a deadline —and the cut names them in that order.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readLiveLegs } from "../../../cli/commands/sessionStart/liveLegs.js";
import type { SlackRead } from "../../../cli/commands/sessionStart/slackRead.js";
import { unwrap } from "../../../lib/result.js";
import { cutShortLine, runDeadline } from "../../../sessionStart/deadline.js";

const DEADLINE_MS = Date.parse("2026-11-06T05:00:00.000Z");
const homes: string[] = [];

/** A Slack read that saw nothing, with or without the deadline having stopped it. */
const slackRead = ({ cut }: { cut: boolean }): SlackRead => ({
  awaitingCandidates: [],
  couldNotSee: [],
  inputs: [],
  movedWithoutOwner: 0,
  movementThreads: [],
  status: "complete",
  taggedWithoutOwner: 0,
  threadsSpokenIn: 0,
  threadsTagging: 0,
  ...(cut ? { cut: true as const } : {}),
});

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** Run the legs over a fresh home under a deadline already reached, with the given Slack read. */
async function legsPastDeadline({ slack }: { slack: SlackRead }): Promise<Awaited<ReturnType<typeof readLiveLegs>>> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-live-legs-"));
  homes.push(home);
  const deadline = runDeadline({ reached: Promise.resolve() });
  await deadline.reached;
  return readLiveLegs({
    deadline,
    deadlineMs: DEADLINE_MS,
    home,
    nowIso: "2026-11-06T04:00:00.000Z",
    scanSlack: () => slack,
    verify: true,
  });
}

describe("readLiveLegs", () => {
  it("starts no live leg once the deadline is reached, and reports each as cut, Slack in its read order", async () => {
    const slack = slackRead({ cut: true });
    const legs = await legsPastDeadline({ slack });

    expect(legs.cut).toEqual(["your Linear cycle", "your Slack threads", "your mail", "your open pull requests"]);
    expect(legs.slack).toBe(slack);
    expect(legs.cycle).toEqual({
      couldNotSee: [cutShortLine({ deadlineMs: DEADLINE_MS, part: "your Linear cycle" })],
      inputs: [],
      proposalsRead: 0,
    });
    expect(legs.mail).toEqual({
      answeredAfterOwner: 0,
      couldNotSee: [cutShortLine({ deadlineMs: DEADLINE_MS, part: "your mail" })],
      inboxRead: 0,
      inputs: [],
    });
    expect(unwrap(legs.github)).toEqual({
      couldNotSee: [cutShortLine({ deadlineMs: DEADLINE_MS, part: "your open pull requests" })],
      inputs: [],
      pullRequestsRead: 0,
      waitingOnSomebodyElse: 0,
    });
  });

  it("does not name Slack as cut when its scan finished", async () => {
    const legs = await legsPastDeadline({ slack: slackRead({ cut: false }) });

    expect(legs.cut).toEqual(["your Linear cycle", "your mail", "your open pull requests"]);
  });
});
