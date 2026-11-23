/**
 * The two writes inside the door, called directly: a create whose rendered body the PR gate refuses is refused
 * before anything is reserved or sent, and an update whose freshness re-read fails is refused before any PATCH.
 * A `mkdtempSync` home is the sanctioned exception: both writes take the state home their ledger lives in.
 */

import { rmSync } from "node:fs";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import type { DescriptionWrite } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { createdHeadWarning, performCreate } from "../../../../../cli/commands/github/performCreate.js";
import { performUpdate } from "../../../../../cli/commands/github/performWrite.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";
import { fakeApi, harnessDeps } from "../../../../githubPrHarness.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "github-perform-write-home-" });
  homes.push(home);
  return home;
}

// Assembled at runtime, so this file never carries a credential shape of its own.
const TOKEN = `ghp_${"a".repeat(30)}`;
/** The example, seen before the harness clock's day, so the seen-day check lets it through to the review. */
const SEEN_EARLIER: PrFormDraft = {
  ...EXAMPLE_PR_FORM,
  problemSeen: { by: "agent", kind: "seen", on: "2026-08-09", what: "an exported report was one row short" },
};
const LEAKING: PrFormDraft = { ...EXAMPLE_PR_FORM, explainer: [{ kind: "text", text: `rotated ${TOKEN} today` }] };

const LIVE: WrittenPr = {
  authorId: 1,
  baseRef: "main",
  baseRepoFullName: "o/r",
  body: "b",
  commits: 1,
  draft: true,
  head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "a".repeat(40) },
  htmlUrl: "https://example.invalid/pr/7",
  mergedAtIso: undefined,
  nodeId: "PR_7",
  number: 7,
  stack: undefined,
  state: "open",
  title: "t",
  updatedAtIso: "2026-08-10T00:00:00Z",
};

/** One walkthrough comment the same write posts, which the review must be asked about. */
const WALKTHROUGH = { body: "💡 The export now counts the header row once.", line: 3, path: "src/export.ts" };

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "getPr" };

describe("createdHeadWarning", () => {
  it("names both commits when GitHub opened the pull request at a head the review never read", () => {
    expect(createdHeadWarning({ boundHead: "aaa111", createdHead: "bbb222", number: 7 })).toBe(
      "warning: #7 was opened at bbb222, but its description's review bound aaa111. " +
        "Prepare and record a review of it again.",
    );
  });

  it("says nothing when the heads agree", () => {
    expect(createdHeadWarning({ boundHead: "aaa111", createdHead: "aaa111", number: 7 })).toBeUndefined();
  });

  it("says nothing when the check bound no commit", () => {
    expect(createdHeadWarning({ boundHead: undefined, createdHead: "bbb222", number: 7 })).toBeUndefined();
  });
});

describe("performCreate", () => {
  it("refuses a body the PR gate rejects before reserving or creating anything", async () => {
    const creates: string[] = [];
    const api = fakeApi({
      createPr: ({ title }) => {
        creates.push(title);
        return okAsync(LIVE);
      },
    });
    const { deps } = harnessDeps({ api });
    const outcome = await performCreate({
      api,
      comments: [],
      deps,
      draft: LEAKING,
      home: tempHome(),
      installationIdentifiers: undefined,
      locus: "o/r:feature",
    });
    expect(outcome.kind).toBe("refused");
    expect(creates).toStrictEqual([]);
  });

  it("refuses before reserving or creating when no CLEAN description review covers the exact bytes", async () => {
    const creates: string[] = [];
    const api = fakeApi({
      createPr: ({ title }) => {
        creates.push(title);
        return okAsync(LIVE);
      },
    });
    const { deps: baseDeps } = harnessDeps({ api });
    const asked: Pick<DescriptionWrite, "comments" | "headRef" | "pullRequest" | "repoDir">[] = [];
    const deps: GithubPrDeps = {
      ...baseDeps,
      descriptionReview: ({ comments, headRef, pullRequest, repoDir }) => {
        asked.push({ comments, headRef, pullRequest, repoDir });
        return Promise.resolve({
          kind: "refused",
          lines: ["no description review covers packet abc…", "prepare with: x"],
        });
      },
    };
    const outcome = await performCreate({
      api,
      comments: [WALKTHROUGH],
      deps,
      draft: SEEN_EARLIER,
      home: tempHome(),
      installationIdentifiers: undefined,
      locus: "o/r:feature",
    });
    expect(outcome).toStrictEqual({
      kind: "refused",
      reason: "no description review covers packet abc…\nprepare with: x",
    });
    expect(asked).toStrictEqual([
      { comments: [WALKTHROUGH], headRef: "a-branch", pullRequest: { kind: "new" }, repoDir: "/repo" },
    ]);
    expect(creates).toStrictEqual([]);
  });
});

describe("performUpdate", () => {
  it("refuses, naming the failed re-read, and never PATCHes when the freshness re-read fails", async () => {
    const patches: number[] = [];
    const api = fakeApi({
      getPr: () => errAsync(HTTP_ERROR),
      updatePr: ({ number }) => {
        patches.push(number);
        return okAsync(LIVE);
      },
    });
    const { deps } = harnessDeps({ api });
    const outcome = await performUpdate({
      api,
      comments: [],
      deps,
      draft: EXAMPLE_PR_FORM,
      home: tempHome(),
      installationIdentifiers: undefined,
      locus: "o/r:feature",
      previewed: LIVE,
      trailing: "",
    });
    expect(outcome).toStrictEqual({ kind: "refused", reason: "could not re-read #7 before writing: unreachable" });
    expect(patches).toStrictEqual([]);
  });

  it("asks for the review against the live head SHA and never PATCHes when none covers the bytes", async () => {
    const patches: number[] = [];
    const api = fakeApi({
      getPr: () => okAsync(LIVE),
      updatePr: ({ number }) => {
        patches.push(number);
        return okAsync(LIVE);
      },
    });
    const { deps: baseDeps } = harnessDeps({ api });
    const asked: (Pick<DescriptionWrite, "comments" | "headRef" | "pullRequest"> & { title: string })[] = [];
    const deps: GithubPrDeps = {
      ...baseDeps,
      descriptionReview: ({ comments, headRef, form, pullRequest }) => {
        asked.push({ comments, headRef, pullRequest, title: form.title });
        return Promise.resolve({ kind: "refused", lines: ["no description review covers packet abc…"] });
      },
    };
    const outcome = await performUpdate({
      api,
      comments: [WALKTHROUGH],
      deps,
      draft: SEEN_EARLIER,
      home: tempHome(),
      installationIdentifiers: undefined,
      locus: "o/r:feature",
      previewed: LIVE,
      trailing: "",
    });
    expect(outcome).toStrictEqual({ kind: "refused", reason: "no description review covers packet abc…" });
    expect(asked).toStrictEqual([
      {
        comments: [WALKTHROUGH],
        headRef: "a".repeat(40),
        pullRequest: { kind: "existing", number: 7 },
        title: EXAMPLE_PR_FORM.title,
      },
    ]);
    expect(patches).toStrictEqual([]);
  });

  it("refuses, and never PATCHes, when the text it would send again after the description fails the scan", async () => {
    const patches: number[] = [];
    const api = fakeApi({
      getPr: () => okAsync(LIVE),
      updatePr: ({ number }) => {
        patches.push(number);
        return okAsync(LIVE);
      },
    });
    const { deps } = harnessDeps({ api });
    const outcome = await performUpdate({
      api,
      comments: [],
      deps,
      draft: SEEN_EARLIER,
      home: tempHome(),
      installationIdentifiers: undefined,
      locus: "o/r:feature",
      previewed: LIVE,
      trailing: "\n\nWe fixed this on the owner's laptop.\n",
    });
    expect(outcome.kind).toBe("refused");
    expect(JSON.stringify(outcome)).toContain("the text after the description, which this update would send again");
    expect(patches).toStrictEqual([]);
  });

  it("checks the round of an update that changes nothing before any kind label reaches GitHub", async () => {
    const rendered: { title: string; body: string }[] = [];
    const renderApi = fakeApi({
      getPr: () => okAsync(LIVE),
      updatePr: ({ title, body }) => {
        rendered.push({ body: String(body), title: String(title) });
        return okAsync(LIVE);
      },
    });
    const { deps: renderDeps } = harnessDeps({ api: renderApi });
    const common = { draft: SEEN_EARLIER, installationIdentifiers: undefined, locus: "o/r:feature", trailing: "" };
    await performUpdate({
      ...common,
      api: renderApi,
      comments: [],
      deps: renderDeps,
      home: tempHome(),
      previewed: LIVE,
    });
    const same: WrittenPr = { ...LIVE, body: rendered[0]!.body, title: rendered[0]!.title };
    const reached: string[] = [];
    const api = fakeApi({
      addIssueLabels: () => {
        reached.push("addIssueLabels");
        return okAsync([]);
      },
      getPr: () => okAsync(same),
      issueLabels: () => {
        reached.push("issueLabels");
        return okAsync({ htmlUrl: LIVE.htmlUrl, labels: [] });
      },
      repoLabels: () => {
        reached.push("repoLabels");
        return okAsync({ names: [], truncated: false });
      },
    });
    const { deps: baseDeps } = harnessDeps({ api });
    const asked: Pick<DescriptionWrite, "comments" | "pullRequest">[] = [];
    const deps: GithubPrDeps = {
      ...baseDeps,
      descriptionReview: ({ comments, pullRequest }) => {
        asked.push({ comments, pullRequest });
        return Promise.resolve({ kind: "refused", lines: ["no description review covers this round"] });
      },
    };
    const outcome = await performUpdate({
      ...common,
      api,
      comments: [WALKTHROUGH],
      deps,
      home: tempHome(),
      previewed: same,
    });
    expect(outcome).toStrictEqual({ kind: "refused", reason: "no description review covers this round" });
    expect(asked).toStrictEqual([{ comments: [WALKTHROUGH], pullRequest: { kind: "existing", number: 7 } }]);
    expect(reached).toStrictEqual([]);
  });

  it("warns when the PATCH lands on a head other than the one the review bound", async () => {
    const moved = { ...LIVE.head, sha: "b".repeat(40) };
    const api = fakeApi({ getPr: () => okAsync(LIVE), updatePr: () => okAsync({ ...LIVE, head: moved }) });
    const { deps: baseDeps } = harnessDeps({ api });
    const warnings: string[] = [];
    const deps: GithubPrDeps = { ...baseDeps, err: ({ line }) => warnings.push(line) };
    await performUpdate({
      api,
      comments: [],
      deps,
      draft: SEEN_EARLIER,
      home: tempHome(),
      installationIdentifiers: undefined,
      locus: "o/r:feature",
      previewed: LIVE,
      trailing: "",
    });
    expect(warnings).toContain(
      `warning: #7's head moved to ${"b".repeat(40)} while the description was being written; its review bound ` +
        `${"a".repeat(40)}. Prepare and record a review of it again.`,
    );
  });
});
