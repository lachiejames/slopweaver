/*
 * `sendStackPush`, the locked write `github stack push` runs once its plan is resolved and its lock is held: a
 * clean bottom-of-stack create amends, pushes on the exact lease, creates, and names the walkthrough it still
 * owes; a push the remote does not confirm creates nothing and fails the run.
 */
import { okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { parsePrForm } from "../../../../../cli/commands/github/prFormParse.js";
import { missingWalkthroughLine } from "../../../../../cli/commands/github/selfReviewCore.js";
import {
  type GatedStackPushPlan,
  githubStackPushPlan,
  parseGithubStackPushArgs,
} from "../../../../../cli/commands/github/stackPushCore.js";
import { sendStackPush } from "../../../../../cli/commands/github/stackPushSend.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { GithubWriteApi } from "../../../../../corpus/github/write.js";
import { unwrap } from "../../../../../lib/result.js";
import { locusOf } from "../../../../../outbound/github/prLedger.js";
import { fakeApi } from "../../../../githubPrHarness.js";
import { AMENDED_SHA, baseForm, LOCAL_SHA, PINNED_TREE, pr } from "./stackPushRun/fixtures.js";
import { harness, tempHome, useTempHomes } from "./stackPushRun/harness.js";

useTempHomes();

/** The plan `resolveStackPushPlan` would hand over for the harness's clean push of `top` onto `main`. */
function gatedPlan(): GatedStackPushPlan {
  const planned = githubStackPushPlan({
    facts: {
      amendPin: { kind: "pinned", tree: PINNED_TREE },
      branch: "top",
      defaultBranch: "main",
      headSha: LOCAL_SHA,
      repo: "o/r",
      repoRoot: "/repo",
    },
    form: unwrap(parsePrForm({ raw: baseForm({ base: "main" }) })),
  });
  return { ...unwrap(planned), installationIdentifiers: undefined };
}

describe("sendStackPush", () => {
  it("amends, pushes on the exact lease, creates, and names the walkthrough it still owes", async () => {
    const createCalls: string[] = [];
    const api: GithubWriteApi = fakeApi({
      createPr: ({ head }) => {
        createCalls.push(head);
        return okAsync(pr({ number: 100 }));
      },
    });
    const { deps, lines, writes } = harness({ api });
    let minted = 0;
    const plan = gatedPlan();
    const code = await sendStackPush({
      args: unwrap(parseGithubStackPushArgs({ argv: ["--form", "{}"] })),
      carry: { kind: "clear" },
      deps,
      freshApi: () => {
        minted += 1;
        return api;
      },
      home: tempHome(),
      locus: locusOf({ target: plan.form.target }),
      plan,
      selfReview: undefined,
    });
    expect(code).toBe(EXIT_OK);
    expect(minted).toBe(1);
    expect(createCalls).toEqual(["top"]);
    expect(writes).toEqual([
      ["commit", "--amend", "--no-edit"],
      [
        "push",
        "--set-upstream",
        `--force-with-lease=refs/heads/top:${LOCAL_SHA}`,
        "origin",
        `${AMENDED_SHA}^{commit}:refs/heads/top`,
      ],
    ]);
    expect(lines).toContain("stack: this is the bottom of a fresh stack — no registration needed");
    expect(lines).toContain(missingWalkthroughLine({ number: 100, repoSlug: "o/r" }));
  });

  it("creates nothing and fails when the remote does not confirm the push", async () => {
    const createCalls: string[] = [];
    const api: GithubWriteApi = fakeApi({
      createPr: ({ head }) => {
        createCalls.push(head);
        return okAsync(pr({ number: 100 }));
      },
    });
    const { deps, lines } = harness({ api, postAmendRemoteSha: LOCAL_SHA });
    const plan = gatedPlan();
    const code = await sendStackPush({
      args: unwrap(parseGithubStackPushArgs({ argv: ["--form", "{}"] })),
      carry: { kind: "clear" },
      deps,
      freshApi: () => api,
      home: tempHome(),
      locus: locusOf({ target: plan.form.target }),
      plan,
      selfReview: undefined,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(createCalls).toEqual([]);
    expect(lines).not.toContain(missingWalkthroughLine({ number: 100, repoSlug: "o/r" }));
  });
});
