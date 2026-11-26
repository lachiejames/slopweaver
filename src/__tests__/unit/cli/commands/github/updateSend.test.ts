/**
 * `sendDecidedUpdate` directly: bytes that already match the live pull request send nothing and owe no review, and
 * bytes that change it are refused, with no PATCH, when no CLEAN description review covers them.
 * A `mkdtempSync` home is the sanctioned exception: the write takes the state home its ledger lives in.
 */
import { rmSync } from "node:fs";
import { okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import { sendDecidedUpdate } from "../../../../../cli/commands/github/updateSend.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { stampForWrite } from "../../../../../outbound/github/stamp.js";
import { fakeApi, harnessDeps } from "../../../../githubPrHarness.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "github-update-send-home-" });
  homes.push(home);
  return home;
}

/** The example form, accepted for a write. */
const FORM = unwrap(stampForWrite({ draft: EXAMPLE_PR_FORM, today: "2026-09-30" }));

/** The bytes this write decided on. */
const BODY = "<p>the decided description</p>\n";

/** The live pull request, carrying `body` under the form's own title. */
function live({ body }: { body: string }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body,
    commits: 1,
    draft: true,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "a".repeat(40) },
    htmlUrl: "https://example.invalid/pr/7",
    mergedAtIso: undefined,
    nodeId: "PR_7",
    number: 7,
    stack: undefined,
    state: "open",
    title: FORM.title,
    updatedAtIso: "2026-09-30T00:00:00Z",
  };
}

describe("sendDecidedUpdate", () => {
  it("sends nothing and asks for no review when the bytes already match the live pull request", async () => {
    const patches: number[] = [];
    const asked: number[] = [];
    const api = fakeApi({
      updatePr: ({ number }) => {
        patches.push(number);
        return okAsync(live({ body: BODY }));
      },
    });
    const { deps: baseDeps } = harnessDeps({ api });
    const deps: GithubPrDeps = {
      ...baseDeps,
      descriptionReview: () => {
        asked.push(7);
        return Promise.resolve({ kind: "refused", lines: ["never asked"] });
      },
    };
    const current = live({ body: BODY });
    const outcome = await sendDecidedUpdate({
      api,
      body: BODY,
      comments: [],
      current,
      deps,
      form: FORM,
      home: tempHome(),
      locus: "o/r:feature",
    });
    expect(outcome).toStrictEqual({ kind: "unchanged", number: 7, url: "https://example.invalid/pr/7" });
    expect([patches, asked]).toStrictEqual([[], []]);
  });

  it("refuses, and never PATCHes, bytes that change the description when no review covers them", async () => {
    const patches: number[] = [];
    const api = fakeApi({
      updatePr: ({ number }) => {
        patches.push(number);
        return okAsync(live({ body: BODY }));
      },
    });
    const { deps: baseDeps } = harnessDeps({ api });
    const deps: GithubPrDeps = {
      ...baseDeps,
      descriptionReview: () => Promise.resolve({ kind: "refused", lines: ["no description review covers it"] }),
    };
    const outcome = await sendDecidedUpdate({
      api,
      body: BODY,
      comments: [],
      current: live({ body: "<p>an older description</p>\n" }),
      deps,
      form: FORM,
      home: tempHome(),
      locus: "o/r:feature",
    });
    expect(outcome).toStrictEqual({ kind: "refused", reason: "no description review covers it" });
    expect(patches).toStrictEqual([]);
  });
});
