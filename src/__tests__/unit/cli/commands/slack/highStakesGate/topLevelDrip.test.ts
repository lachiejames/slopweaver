/*
 * `highStakesRefusals` on one send that makes several top-level posts: every post after the first is a second post,
 * so the drip is refused, taking no claim, unless a live second-post grant is held.
 */
import { describe, expect, it } from "vitest";

import { highStakesRefusals } from "../../../../../../cli/commands/slack/highStakesGate.js";
import { grantedEnv } from "../../../../../hatchGrantFixture.js";
import { fakeDeps, freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("highStakesRefusals on a send that makes several top-level posts", () => {
  /** The undefended hatch is always held, so the refusal under test is the second-post one; `hatchIds` adds more. */
  const drip = async ({
    claims,
    extraEnv = {},
    hatchIds,
  }: {
    claims: string[];
    extraEnv?: Record<string, string>;
    hatchIds: readonly string[];
  }): Promise<readonly string[]> => {
    const home = freshHome();
    return highStakesRefusals({
      channel: "C0SYN000003",
      claim: true,
      deps: fakeDeps({ claims, history: { kind: "read", priors: [] }, reads: [] }),
      env: { ...grantedEnv({ hatchIds: ["high-stakes-undefended", ...hatchIds], home }), ...extraEnv },
      formKind: undefined,
      home,
      threadTs: undefined,
      token: "xoxb-test",
      topLevelPosts: 3,
    });
  };

  it("refuses a top-level drip of three into an empty day, taking no claim", async () => {
    const claims: string[] = [];
    const lines = await drip({ claims, hatchIds: [] });
    expect(lines[0]).toContain(
      "this one send would put 3 top-level posts in #defects, and every one after the first is a second post",
    );
    expect(claims).toEqual([]);
  });

  it("lets the drip through under a live second-post grant", async () => {
    expect(await drip({ claims: [], hatchIds: ["high-stakes-second-post"] })).toEqual([]);
  });

  it("still refuses the drip with only the retired second-post variable set, because it opens nothing", async () => {
    const claims: string[] = [];
    const lines = await drip({
      claims,
      extraEnv: { SLOPWEAVER_ALLOW_HIGH_STAKES_SECOND_POST: "1" },
      hatchIds: [],
    });
    expect(lines[0]).toContain(
      "this one send would put 3 top-level posts in #defects, and every one after the first is a second post",
    );
    expect(claims).toEqual([]);
  });
});
