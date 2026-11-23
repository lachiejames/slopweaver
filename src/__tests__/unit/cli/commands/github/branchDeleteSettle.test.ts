import { describe, expect, it } from "vitest";

import type { GithubBranchArgs } from "../../../../../cli/commands/github/branchDeleteCore.js";
import { confirmAcceptedWrite, settleErroredWrite } from "../../../../../cli/commands/github/branchDeleteSettle.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { fakeRefsApi, fakeRemote } from "./refsFake.js";

const TIP = "a".repeat(40);

const ARGS: GithubBranchArgs = {
  branch: "old",
  dryRun: false,
  expectTip: TIP,
  home: undefined,
  json: false,
  keepAsTag: "archive/old",
  owner: "o",
  repo: "r",
};

describe("settleErroredWrite", () => {
  it("settles a lost answer as gone, with no author claimed, when the branch is gone and the tag is at the tip", async () => {
    const remote = fakeRemote();
    remote.tags.set("archive/old", TIP);

    const settled = unwrap(
      await settleErroredWrite({
        api: fakeRefsApi({ remote }),
        args: ARGS,
        cause: "lost",
        createTag: undefined,
        tip: TIP,
      }),
    );

    expect(settled).toEqual({ byThisRun: false, keptAs: "archive/old", tip: TIP });
  });

  it("fails naming what each ref reads when the branch is still there", async () => {
    const remote = fakeRemote();
    remote.branches.set("old", TIP);

    const error = unwrapErr(
      await settleErroredWrite({
        api: fakeRefsApi({ remote }),
        args: ARGS,
        cause: "boom",
        createTag: "archive/old",
        tip: TIP,
      }),
    );

    expect(error.message).toContain(`boom; branch old reads back at ${TIP}, tag archive/old reads back absent`);
  });
});

describe("confirmAcceptedWrite", () => {
  it("confirms an accepted delete once the branch reads gone and the tag reads at the tip", async () => {
    const remote = fakeRemote();
    remote.tags.set("archive/old", TIP);

    const confirmed = unwrap(
      await confirmAcceptedWrite({ api: fakeRefsApi({ remote }), args: ARGS, createTag: "archive/old", tip: TIP }),
    );

    expect(confirmed).toEqual({ byThisRun: true, keptAs: "archive/old", tip: TIP });
  });

  it("never claims a kept tag that reads back absent after the branch is gone", async () => {
    const remote = fakeRemote();

    const error = unwrapErr(
      await confirmAcceptedWrite({ api: fakeRefsApi({ remote }), args: ARGS, createTag: "archive/old", tip: TIP }),
    );

    expect(error.code).toBe("REF_UNCONFIRMED");
    expect(error.message).toBe(
      `GitHub accepted the write but tag archive/old (branch old was deleted at ${TIP}) reads back absent, not ${TIP}`,
    );
  });
});
