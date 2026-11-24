/**
 * `github stack push`'s one read of the branch's open pull request, and the two description reviews it feeds.
 *
 * Re-run on a branch whose pull request is already open, the push is an update: it ends at the reservation's
 * duplicate refusal, which names `pr update`. Both reviews (the early one before the amend, and the create's own)
 * must then describe that pull request, so one review covers the packet `pr update` sends too. A branch with no
 * open pull request reviews as `new`, exactly as before; a read that fails, or answers another base, refuses
 * before anything is amended or pushed.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DescriptionWrite } from "../../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors } from "../../../../../../cli/commands/github/errors.js";
import type { GithubStackPushDeps } from "../../../../../../cli/commands/github/stackPushDeps.js";
import { runGithubStackPush } from "../../../../../../cli/commands/github/stackPushRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { confirmPr, locusOf, reservePr } from "../../../../../../outbound/github/prLedger.js";
import { fakeApi } from "../../../../../githubPrHarness.js";
import { baseDraft, baseForm, PREFIX, pr } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

/** The fields of one description review this file asserts on. */
type Asked = Pick<DescriptionWrite, "headRef" | "pullRequest">;

/**
 * The deps over a harness, with a description review that records every write it is asked about and clears the
 * first `clears` of them, refusing the rest.
 *
 * @param clears how many reviews clear before one refuses; the create's own refusal stops the run before it posts
 * @returns the deps, every review asked, and what the harness observed
 */
function recordingRun({
  api,
  clears,
  openPullRequest,
}: {
  api: GithubWriteApi;
  clears: number;
  openPullRequest: GithubWriteApi["findOpenPrByHead"];
}): { asked: Asked[]; deps: GithubStackPushDeps; lines: string[]; openPrReads: string[]; writes: unknown[] } {
  const observed = harness({ api, openPullRequest });
  const asked: Asked[] = [];
  const deps: GithubStackPushDeps = {
    ...observed.deps,
    descriptionReview: ({ headRef, pullRequest }) => {
      asked.push({ headRef, pullRequest });
      if (asked.length <= clears) {
        return Promise.resolve({ boundHead: undefined, kind: "clear", notice: undefined });
      }
      return Promise.resolve({ kind: "refused", lines: ["no description review covers packet abc…"] });
    },
  };
  return { asked, deps, lines: observed.lines, openPrReads: observed.openPrReads, writes: observed.writes };
}

/** A live push of `top` onto `main` against `home`. */
function argvFor({ home }: { home: string }): readonly string[] {
  return [...PREFIX, "--form", baseForm({ base: "main" }), "--home", home];
}

describe("runGithubStackPush — which pull request the description reviews describe", () => {
  it("reviews an already-open pull request as that pull request, in both checks", async () => {
    const run = recordingRun({ api: fakeApi({}), clears: 1, openPullRequest: () => okAsync(pr({ number: 42 })) });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.openPrReads).toStrictEqual(["o/r:top"]);
    expect(run.asked).toStrictEqual([
      { headRef: "HEAD", pullRequest: { kind: "existing", number: 42 } },
      { headRef: "top", pullRequest: { kind: "existing", number: 42 } },
    ]);
  });

  it("reviews a branch with no open pull request as new, in both checks, exactly as before", async () => {
    const run = recordingRun({ api: fakeApi({}), clears: 1, openPullRequest: () => okAsync(undefined) });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.openPrReads).toStrictEqual(["o/r:top"]);
    expect(run.asked).toStrictEqual([
      { headRef: "HEAD", pullRequest: { kind: "new" } },
      { headRef: "top", pullRequest: { kind: "new" } },
    ]);
  });

  it("refuses before any review, amend or push when the open pull request read fails", async () => {
    const run = recordingRun({
      api: fakeApi({}),
      clears: 2,
      openPullRequest: () => errAsync({ kind: "http", message: "socket hang up", operation: "github.pulls.list" }),
    });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.asked).toStrictEqual([]);
    expect(run.writes).toStrictEqual([]);
    const refusal = GithubVerbErrors.stackPushOpenPrUnread({ cause: "socket hang up", head: "top", repo: "o/r" });
    expect(run.lines.at(-1)).toBe(`refused: ${refusal.message}`);
  });

  it("refuses before any review, amend or push when the branch's open pull request has another base", async () => {
    const elsewhere = { ...pr({ number: 42 }), baseRef: "release" };
    const run = recordingRun({ api: fakeApi({}), clears: 2, openPullRequest: () => okAsync(elsewhere) });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.asked).toStrictEqual([]);
    expect(run.writes).toStrictEqual([]);
    const refusal = GithubVerbErrors.stackPushOpenPrBaseMismatch({
      actualBase: "release",
      expectedBase: "main",
      head: "top",
      number: 42,
    });
    expect(run.lines.at(-1)).toBe(`refused: ${refusal.message}`);
  });

  it("still ends an already-open pull request at the duplicate refusal naming its update, creating nothing", async () => {
    const home = tempHome();
    const draft = baseDraft({ base: "main", explainerText: "An export dropped an entry. This keeps it.", head: "top" });
    const locus = locusOf({ target: draft.target });
    reservePr({ home, locus, nowIso: "2026-08-01T00:00:00Z" });
    confirmPr({
      form: draft,
      home,
      locus,
      nodeId: "PR_42",
      nowIso: "2026-08-01T00:05:00Z",
      number: 42,
      storedBody: "b",
    });
    const creates: string[] = [];
    const api = fakeApi({
      createPr: ({ head }) => {
        creates.push(head);
        return okAsync(pr({ number: 99 }));
      },
      getPr: () => okAsync(pr({ number: 42 })),
    });
    const run = recordingRun({ api, clears: 2, openPullRequest: () => okAsync(pr({ number: 42 })) });
    const code = await runGithubStackPush({ argv: argvFor({ home }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.asked.map(({ pullRequest }) => pullRequest)).toStrictEqual([
      { kind: "existing", number: 42 },
      { kind: "existing", number: 42 },
    ]);
    expect(run.writes).toHaveLength(2);
    expect(creates).toStrictEqual([]);
    expect(run.lines).toContain("  slopweaver github pr update --repo o/r --number 42 --edit - < edit.json");
  });

  it("refuses rather than creates when the reviewed open pull request holds no reservation here, releasing the locus", async () => {
    const home = tempHome();
    const draft = baseDraft({ base: "main", explainerText: "An export dropped an entry. This keeps it.", head: "top" });
    const locus = locusOf({ target: draft.target });
    const creates: string[] = [];
    const api = fakeApi({
      createPr: ({ head }) => {
        creates.push(head);
        return okAsync(pr({ number: 43 }));
      },
    });
    const run = recordingRun({ api, clears: 2, openPullRequest: () => okAsync(pr({ number: 42 })) });
    const code = await runGithubStackPush({ argv: argvFor({ home }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.asked).toHaveLength(2);
    expect(creates).toStrictEqual([]);
    expect(run.lines).toContain(
      "refused: both description reviews named open pull request #42, but no reservation here records it, so nothing " +
        "was created. Update #42 with `github push` then `github pr update --number 42`, or re-run if it has closed.",
    );
    expect(reservePr({ home, locus, nowIso: "2026-08-01T00:00:00Z" }).kind).toBe("fresh");
  });

  it("reads the open pull request before the push, and the retryable preflight still runs between push and create", async () => {
    const calls: string[] = [];
    const api = fakeApi({
      canPush: () => {
        calls.push("canPush");
        return okAsync(true);
      },
      createPr: () => {
        calls.push("createPr");
        return okAsync(pr({ number: 400 }));
      },
    });
    const observed = harness({
      api,
      openPullRequest: () => {
        calls.push("findOpenPrByHead");
        return okAsync(undefined);
      },
    });
    const deps: GithubStackPushDeps = {
      ...observed.deps,
      git: {
        ...observed.deps.git,
        writeGit: (input) => {
          calls.push(`git ${input.args[0]!}`);
          return observed.deps.git.writeGit(input);
        },
      },
    };
    await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps });
    expect(calls).toStrictEqual(["findOpenPrByHead", "git commit", "git push", "canPush", "createPr"]);
  });
});
