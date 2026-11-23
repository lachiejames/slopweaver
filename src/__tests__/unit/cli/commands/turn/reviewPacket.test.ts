/**
 * What a round inherits when there is nothing to inherit — the first round of an ask, read off a home with no
 * outgoing record in it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inheritedRound } from "../../../../../cli/commands/turn/reviewPacket.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("inheritedRound", () => {
  it("is round 1 carrying nothing when no previous round left a record", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-review-packet-"));
    dirs.push(home);
    expect(
      inheritedRound({
        askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
        home,
      }),
    ).toStrictEqual({
      carriedReads: [],
      carriedSettled: [],
      carriedUnresolved: [],
      previousOutcome: undefined,
      previousSettledLiveCount: 0,
      reviewStartedAt: undefined,
      round: 1,
      settledDigest: undefined,
    });
  });
});
