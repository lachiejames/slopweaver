/**
 * `github stack push`'s one read of the branch's open pull request, the write it decides, and the two description
 * reviews it feeds.
 *
 * Re-run on a branch whose pull request is already open, the push is an UPDATE of that pull request: `pr update`'s
 * authorship and consent gates run before anything is amended or pushed, both reviews (the early one before the amend,
 * and the update's own before its PATCH) describe that pull request, and the title and body reach it through the
 * PATCH, never a second create. A branch with no open pull request reviews as `new` and creates, exactly as before; a
 * read that fails, or answers another base, refuses before anything is amended or pushed.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { liveLocusFor } from "../../../../../../cli/commands/github/addressRun.js";
import type { DescriptionWrite } from "../../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors } from "../../../../../../cli/commands/github/errors.js";
import type { GithubStackPushDeps } from "../../../../../../cli/commands/github/stackPushDeps.js";
import { runGithubStackPush } from "../../../../../../cli/commands/github/stackPushRun.js";
import { OWN_WRITE_NOTICE } from "../../../../../../cli/commands/github/updateConsent.js";
import { ALLOW_FOREIGN_PR, ALLOW_PR_REPLACE } from "../../../../../../cli/commands/github/updateCore.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../../corpus/github/write.js";
import { unwrap } from "../../../../../../lib/result.js";
import { confirmPr } from "../../../../../../outbound/github/prLedger.js";
import { stampForWrite } from "../../../../../../outbound/github/stamp.js";
import { fakeApi } from "../../../../../githubPrHarness.js";
import { AMENDED_SHA, baseDraft, baseForm, PREFIX, pr } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

/** The target and explainer every push in this file renders: `top` into `main`, the fixture's default text. */
const TOP_INTO_MAIN = { base: "main", explainerText: "An export dropped an entry. This keeps it.", head: "top" };

/** When the door last confirmed a write in a ledger record this file writes. */
const NOW = "2026-08-15T00:00:00.000Z";

/** The line a keyed whole-form replacement prints in place of a refusal. */
const OVERRIDDEN = `OVERRIDDEN via ${ALLOW_PR_REPLACE}=1 — replacing the whole description. Say so in the pull request.`;

/** The refusal a pull request another account opened meets, before any review, amend or push. */
const FOREIGN_REFUSED =
  "refused: this pull request was opened by a different GitHub account from the one this token belongs to, and " +
  `editing other people's descriptions is not what this verb is for. Re-run with ${ALLOW_FOREIGN_PR}=1 if ` +
  "you really mean to";

/**
 * Leave the record this door's own last write to `pr` would leave: the rendered form's title, the live body.
 *
 * @param pr the open pull request whose locus, node id, number and body the record carries
 */
function recordOwnWrite({ home, pr: live }: { home: string; pr: WrittenPr }): void {
  const written = unwrap(stampForWrite({ draft: baseDraft({ ...TOP_INTO_MAIN }), today: "2026-08-15" }));
  const locus = liveLocusFor({ pr: live });
  confirmPr({
    form: written,
    home,
    locus,
    nodeId: live.nodeId,
    number: live.number,
    nowIso: NOW,
    storedBody: live.body,
  });
}

/**
 * A stack push re-run of `top` onto its open pull request, with every review clearing.
 *
 * @param replaceKey whether the environment carries the wholesale-replacement key
 * @returns the exit, the pull requests updated, and every line printed
 */
async function reRun({
  home,
  replaceKey,
}: {
  home: string;
  replaceKey: boolean;
}): Promise<{ code: number; lines: string[]; updates: number[] }> {
  const updates: number[] = [];
  const api = fakeApi({
    getPr: () => okAsync(openPr()),
    updatePr: ({ number }) => {
      updates.push(number);
      return okAsync(openPr());
    },
  });
  const run = recordingRun({ api, clears: 2, openPullRequest: () => okAsync(openPr()), replaceKey });
  const code = await runGithubStackPush({ argv: argvFor({ home }), deps: run.deps });
  return { code, lines: run.lines, updates };
}

/** The fields of one description review this file asserts on. */
type Asked = Pick<DescriptionWrite, "headRef" | "pullRequest">;

/** The branch's open pull request: `top` into `main`, the owner's own, at the commit the push lands. */
function openPr({ authorId = 1 }: { authorId?: number } = {}): WrittenPr {
  const base = pr({ number: 42 });
  return { ...base, authorId, head: { ...base.head, label: "o:top", ref: "top", sha: AMENDED_SHA } };
}

/**
 * The deps over a harness, with a description review that records every write it is asked about and clears the
 * first `clears` of them, refusing the rest.
 *
 * @param clears how many reviews clear before one refuses; the write's own refusal stops the run before it sends
 * @param replaceKey whether the environment carries the wholesale-replacement key an update's consent asks for
 * @returns the deps, every review asked, and what the harness observed
 */
function recordingRun({
  api,
  clears,
  openPullRequest,
  replaceKey = false,
}: {
  api: GithubWriteApi;
  clears: number;
  openPullRequest: GithubWriteApi["findOpenPrByHead"];
  replaceKey?: boolean;
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
    env: ({ name }) => {
      if (replaceKey && name === ALLOW_PR_REPLACE) {
        return "1";
      }
      return undefined;
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
    const api = fakeApi({ getPr: () => okAsync(openPr()) });
    const run = recordingRun({ api, clears: 1, openPullRequest: () => okAsync(openPr()), replaceKey: true });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.openPrReads).toStrictEqual(["o/r:top"]);
    expect(run.asked).toStrictEqual([
      { headRef: "HEAD", pullRequest: { kind: "existing", number: 42 } },
      { headRef: AMENDED_SHA, pullRequest: { kind: "existing", number: 42 } },
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
});

describe("runGithubStackPush — a branch whose pull request is already open", () => {
  it("writes the title and body to that pull request, creating nothing", async () => {
    const creates: string[] = [];
    const updates: { number: number; title: string | undefined }[] = [];
    const api = fakeApi({
      createPr: ({ head }) => {
        creates.push(head);
        return okAsync(pr({ number: 99 }));
      },
      getPr: () => okAsync(openPr()),
      updatePr: ({ number, title }) => {
        updates.push({ number, title });
        return okAsync(openPr());
      },
    });
    const run = recordingRun({ api, clears: 2, openPullRequest: () => okAsync(openPr()), replaceKey: true });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_OK);
    expect(run.writes).toHaveLength(2);
    expect(creates).toStrictEqual([]);
    expect(updates).toStrictEqual([{ number: 42, title: "t" }]);
    expect(run.lines).toContain("updated #42  https://example.invalid/pr/42");
  });

  it("refuses before any review, amend or push when replacing the description lacks its key", async () => {
    const updates: number[] = [];
    const api = fakeApi({
      getPr: () => okAsync(openPr()),
      updatePr: ({ number }) => {
        updates.push(number);
        return okAsync(openPr());
      },
    });
    const run = recordingRun({ api, clears: 2, openPullRequest: () => okAsync(openPr()) });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.asked).toStrictEqual([]);
    expect(run.writes).toStrictEqual([]);
    expect(updates).toStrictEqual([]);
    expect(run.lines.at(-1)).toBe(
      "refused: --form REPLACES the whole description, so anything in the live one that a form cannot carry is " +
        "discarded and GitHub keeps no history of it. The diff above is what would change. To change only some " +
        `fields and keep the rest, use --edit instead. Re-run with ${ALLOW_PR_REPLACE}=1 if a whole replacement is ` +
        "what you want",
    );
  });

  it("updates without the replacement key when the live title and body are this door's last confirmed write", async () => {
    // The same re-run twice: once over this door's own confirmed write with no key, once with no record and the key.
    // Every line the two print must agree but the one consent line, so the whole output is pinned against a run
    // the key already allowed rather than against a transcription of it.
    const confirmedHome = tempHome();
    recordOwnWrite({ home: confirmedHome, pr: openPr() });
    const confirmed = await reRun({ home: confirmedHome, replaceKey: false });
    const keyed = await reRun({ home: tempHome(), replaceKey: true });
    expect([confirmed.code, keyed.code]).toStrictEqual([EXIT_OK, EXIT_OK]);
    expect([confirmed.updates, keyed.updates]).toStrictEqual([[42], [42]]);
    expect(keyed.lines.filter((line) => line === OVERRIDDEN)).toStrictEqual([OVERRIDDEN]);
    // Pinned on their own too, so both paths regressing together cannot keep the comparison below agreeing.
    expect(confirmed.lines.filter((line) => line === OWN_WRITE_NOTICE)).toStrictEqual([OWN_WRITE_NOTICE]);
    expect(confirmed.lines.filter((line) => line === OVERRIDDEN)).toStrictEqual([]);
    expect(confirmed.lines).toStrictEqual(keyed.lines.with(keyed.lines.indexOf(OVERRIDDEN), OWN_WRITE_NOTICE));
  });

  it("still refuses a pull request somebody else opened when its record matches all three fields", async () => {
    const home = tempHome();
    recordOwnWrite({ home, pr: openPr({ authorId: 7 }) });
    const updates: number[] = [];
    const api = fakeApi({
      getPr: () => okAsync(openPr({ authorId: 7 })),
      updatePr: ({ number }) => {
        updates.push(number);
        return okAsync(openPr());
      },
    });
    const run = recordingRun({ api, clears: 2, openPullRequest: () => okAsync(openPr({ authorId: 7 })) });
    const code = await runGithubStackPush({ argv: argvFor({ home }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect([run.asked, run.writes, updates]).toStrictEqual([[], [], []]);
    expect(run.lines.at(-1)).toBe(FOREIGN_REFUSED);
  });

  it("refuses before any review, amend or push when somebody else opened the pull request", async () => {
    const updates: number[] = [];
    const api = fakeApi({
      getPr: () => okAsync(openPr({ authorId: 7 })),
      updatePr: ({ number }) => {
        updates.push(number);
        return okAsync(openPr());
      },
    });
    const opened = () => okAsync(openPr({ authorId: 7 }));
    const run = recordingRun({ api, clears: 2, openPullRequest: opened, replaceKey: true });
    const code = await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps: run.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(run.asked).toStrictEqual([]);
    expect(run.writes).toStrictEqual([]);
    expect(updates).toStrictEqual([]);
    expect(run.lines.at(-1)).toBe(FOREIGN_REFUSED);
  });

  it("reads the pull request before the push, and the retryable preflight still runs between push and update", async () => {
    const calls: string[] = [];
    const api = fakeApi({
      canPush: () => {
        calls.push("canPush");
        return okAsync(true);
      },
      getPr: () => okAsync(openPr()),
      updatePr: () => {
        calls.push("updatePr");
        return okAsync(openPr());
      },
    });
    const opened = () => {
      calls.push("findOpenPrByHead");
      return okAsync(openPr());
    };
    const run = recordingRun({ api, clears: 2, openPullRequest: opened, replaceKey: true });
    const deps: GithubStackPushDeps = {
      ...run.deps,
      git: {
        ...run.deps.git,
        writeGit: (input) => {
          calls.push(`git ${input.args[0]!}`);
          return run.deps.git.writeGit(input);
        },
      },
    };
    await runGithubStackPush({ argv: argvFor({ home: tempHome() }), deps });
    expect(calls).toStrictEqual(["findOpenPrByHead", "git commit", "git push", "canPush", "updatePr"]);
  });
});

describe("runGithubStackPush — a branch with no open pull request", () => {
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
