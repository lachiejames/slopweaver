/*
 * `highStakesRefusals` on a reply: a reply into a thread Slack confirms goes through reading only the parent, and a
 * `--thread-ts` naming no message, or whose parent could not be read, is judged as the top-level post it becomes.
 */
import { describe, expect, it } from "vitest";

import { highStakesRefusals } from "../../../../../../cli/commands/slack/highStakesGate.js";
import { fakeDeps, freshHome, PRIOR, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("highStakesRefusals on a reply", () => {
  const THREAD = "1790603453.723719";

  it("lets a reply into a thread Slack confirms through, reading nothing but the parent", async () => {
    const reads: string[] = [];
    const lines = await highStakesRefusals({
      channel: "defects",
      claim: false,
      deps: fakeDeps({ history: { kind: "read", priors: [PRIOR] }, reads }),
      env: {},
      formKind: undefined,
      home: freshHome(),
      threadTs: THREAD,
      token: "xoxp-test",
    });
    expect(lines).toEqual([]);
    expect(reads).toEqual([`anchor C0SYN000003:${THREAD}`]);
  });

  it("judges a --thread-ts naming no message as the top-level post it becomes", async () => {
    const reads: string[] = [];
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps: fakeDeps({ anchor: { kind: "absent" }, history: { kind: "read", priors: [] }, reads }),
      env: {},
      formKind: "update",
      home: freshHome(),
      threadTs: THREAD,
      token: "xoxb-test",
    });
    expect(lines[0]).toBe(
      `--thread-ts ${THREAD} in #defects names no top-level message there, so this send is judged as a top-level post`,
    );
    expect(lines[1]).toContain("this is a `update` card to #defects");
  });

  it("judges a reply whose parent could not be read as top-level too, and admits a first finding card", async () => {
    const reads: string[] = [];
    const deps = fakeDeps({
      anchor: { kind: "unread", reason: "ratelimited" },
      history: { kind: "read", priors: [PRIOR] },
      reads,
    });
    const home = freshHome();
    const refused = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps,
      env: {},
      formKind: "finding",
      home,
      threadTs: THREAD,
      token: "xoxb-test",
    });
    expect(refused[0]).toBe(
      `--thread-ts ${THREAD} in #defects could not be read (ratelimited), so this send is judged as a top-level post`,
    );
    expect(refused[1]).toContain(PRIOR.permalink);
  });
});
