/*
 * What the high-stakes gate test files share: the throwaway homes each case asks from (removed after every case by
 * the `afterEach` that `useFreshHomes()` registers), the prior post a refusal cites, and the plain fake deps whose
 * reads and claims are recorded into lists, so "the live read was never made" rests on a list a stray call would
 * lengthen rather than on the absence of an error. It moved here when `highStakesGate.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { HighStakesDeps } from "../../../../../../cli/commands/slack/highStakesGate.js";
import { ok } from "../../../../../../lib/result.js";
import type { ChannelClaim, FleetHistory, ThreadAnchor } from "../../../../../../outbound/slack/highStakesChannel.js";

const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useFreshHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A throwaway home the registered cleanup removes.
 *
 * @returns the new directory's path, recorded for the registered cleanup
 */
export function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "high-stakes-"));
  fixtureDirs.push(dir);
  return dir;
}

export const PRIOR = {
  permalink: "https://x.slack.com/archives/C0SYN000003/p1790603453723719",
  ts: "1790603453.723719",
};

/**
 * The gate's deps as plain fakes: every channel read and thread-anchor read is pushed onto `reads`, every claim peek,
 * take and release onto `claims`, and the high-stakes list names `#defects` with the owner as the whole fleet.
 *
 * @returns deps that answer with the given history, anchor and claim, recording each call
 */
export function fakeDeps({
  reads,
  history,
  anchor = { kind: "present" },
  claim = { kind: "free" },
  claims = [],
}: {
  reads: string[];
  history: FleetHistory;
  anchor?: ThreadAnchor;
  claim?: ChannelClaim;
  claims?: string[];
}): HighStakesDeps {
  return {
    channelClaim: ({ channel, take }) => {
      claims.push(`${take ? "take" : "peek"} ${channel}`);
      return claim;
    },
    releaseChannelClaim: ({ channel, claimId }) => {
      claims.push(`release ${channel} ${claimId}`);
    },
    fleetHistory: async ({ channel, fleetUserIds }) => {
      reads.push(`${channel}:${fleetUserIds.join(",")}`);
      return history;
    },
    highStakes: () =>
      ok({
        channels: [{ id: "C0SYN000003", name: "#defects" }],
        fleetGap: undefined,
        fleetUserIds: ["U0OWNER"],
        listGap: undefined,
      }),
    threadAnchor: async ({ channel, threadTs }) => {
      reads.push(`anchor ${channel}:${threadTs}`);
      return anchor;
    },
  };
}
