/*
 * `highStakesRefusals` and the channel's claim: peeked before the dry-run branch, taken right before the live send,
 * refused when another send holds it or it cannot be written, and released when the day it read refuses the send.
 */
import { describe, expect, it } from "vitest";

import { highStakesRefusals } from "../../../../../../cli/commands/slack/highStakesGate.js";
import { fakeDeps, freshHome, PRIOR, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("highStakesRefusals and the channel's claim", () => {
  const CLAIMED_ISO = "2026-09-28T20:00:00.000Z";

  it("only looks at the claim before the dry-run branch, and takes it right before the live send", async () => {
    const claims: string[] = [];
    const reads: string[] = [];
    const home = freshHome();
    const ask = async ({ claim }: { claim: boolean }): Promise<readonly string[]> =>
      highStakesRefusals({
        channel: "#defects",
        claim,
        deps: fakeDeps({
          claim: claim ? { claimId: "k1", kind: "held" } : { kind: "free" },
          claims,
          history: { kind: "read", priors: [] },
          reads,
        }),
        env: {},
        formKind: "finding",
        home,
        threadTs: undefined,
        token: "xoxb-test",
      });
    expect(await ask({ claim: false })).toEqual([]);
    expect(await ask({ claim: true })).toEqual([]);
    expect(claims).toEqual(["peek C0SYN000003", "take C0SYN000003"]);
    expect(reads).toEqual(["C0SYN000003:U0OWNER", "C0SYN000003:U0OWNER"]);
  });

  it("refuses a finding card another send has claimed, without reading the day", async () => {
    const reads: string[] = [];
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: true,
      deps: fakeDeps({
        claim: { claimedIso: CLAIMED_ISO, kind: "taken" },
        history: { kind: "read", priors: [] },
        reads,
      }),
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines[0]).toContain(`another fleet send claimed #defects at ${CLAIMED_ISO} and may be posting there now`);
    expect(reads).toEqual([]);
  });

  it("drops the claim it took when the day it read refuses the send, and keeps one the send will use", async () => {
    const refusedClaims: string[] = [];
    const refused = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: true,
      deps: fakeDeps({
        claim: { claimId: "k1", kind: "held" },
        claims: refusedClaims,
        history: { kind: "read", priors: [PRIOR] },
        reads: [],
      }),
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(refused[0]).toContain(PRIOR.permalink);
    expect(refusedClaims).toEqual(["take C0SYN000003", "release C0SYN000003 k1"]);
    const keptClaims: string[] = [];
    await highStakesRefusals({
      channel: "C0SYN000003",
      claim: true,
      deps: fakeDeps({
        claim: { claimId: "k1", kind: "held" },
        claims: keptClaims,
        history: { kind: "read", priors: [] },
        reads: [],
      }),
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(keptClaims).toEqual(["take C0SYN000003"]);
  });

  it("refuses when the claim cannot be written, naming why", async () => {
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: true,
      deps: fakeDeps({
        claim: { kind: "unwritable", reason: "EACCES" },
        history: { kind: "read", priors: [] },
        reads: [],
      }),
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines[0]).toContain("could not be read (the channel's claim could not be taken or read: EACCES)");
  });
});
