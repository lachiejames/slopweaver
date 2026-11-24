/**
 * The creation door's gates and reservation handling, driven end-to-end through `runGithubStackPush`.
 *
 * These suites used to sit in `run.test.ts` against `github pr create`. A ruling made
 * `github stack push` the one verb that opens a pull request, so they moved here WHOLE rather than being
 * rewritten — the point of the move is that the redirect lost no gate, and a rewritten assertion could not
 * show that.
 *
 * A `mkdtempSync` home is the sanctioned exception in `.claude/rules/testing.md`: the thing under test IS
 * the on-disk reservation, which `prLedger.test.ts` exercises directly and this file exercises through the
 * verb.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { type GithubStackPushDeps } from "../../../../../cli/commands/github/stackPushDeps.js";
import { runGithubStackPush } from "../../../../../cli/commands/github/stackPushRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { renderAuthoringFile } from "../../../../../outbound/github/authoringFile.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { parsePrBody } from "../../../../../outbound/github/parse.js";
import { confirmPr, locusOf, readPrRecord, reservePr } from "../../../../../outbound/github/prLedger.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";
import { PR_VOICE_BRIEF_HEADER } from "../../../../../outbound/github/voiceBrief.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { fakeFileSource } from "../../../../githubPrHarness.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "x" };
const LOCAL_SHA = "1111111111111111111111111111111111111111";
const AMENDED_SHA = "2222222222222222222222222222222222222222";
const PINNED_TREE = "3333333333333333333333333333333333333333";
/** The checked commit's own tree, unlike the pinned one, so every run here has something to amend. */
const HEAD_TREE = "4444444444444444444444444444444444444444";
const BASE_SHA = "5555555555555555555555555555555555555555";
const MEASURED_PATCH_ID = "6666666666666666666666666666666666666666";
const LINEAGE =
  "--no-replace-objects show -s --no-show-signature --encoding=UTF-8 --format=%P%x00%an%x00%ae%x00%ai%x00%B%x00.";
const TARGET = { base: "main", head: "feature", owner: "o", repo: "r" };
const LOCUS = locusOf({ target: TARGET });
const PUSH_ARGS = ["node", "slopweaver", "github", "stack", "push"] as const;
/** The example form on this file's target, its problem seen the day before the harness clock. */
const DRAFT: PrFormDraft = {
  ...EXAMPLE_PR_FORM,
  problemSeen: { by: "agent", kind: "seen", on: "2026-08-14", what: "an exported report was one row short" },
  target: TARGET,
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "github-stack-push-creation-home-" });
  fixtureDirs.push(home);
  return home;
}

function pr({ number, state = "open" }: { number: number; state?: string }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: AMENDED_SHA },
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack: undefined,
    state,
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

/** Every field a fake `GithubWriteApi` must fill; overrides replace the unreachable-by-default stubs. */
function fakeApi(overrides: Partial<GithubWriteApi>): GithubWriteApi {
  return {
    mergeGroupContexts: () => errAsync(HTTP_ERROR),
    requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
    setRequiredStatusChecks: () => errAsync(HTTP_ERROR),
    addToStack: () => errAsync(HTTP_ERROR),
    addIssueLabels: () => errAsync(HTTP_ERROR),
    answerReviewThread: () => errAsync(HTTP_ERROR),
    reopenReviewThread: () => errAsync(HTTP_ERROR),
    authenticatedUserId: () => okAsync(1),
    branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
    canAdmin: () => okAsync(false),
    canPush: () => okAsync(true),
    closePr: () => errAsync(HTTP_ERROR),
    codeScanningAlert: () => errAsync(HTTP_ERROR),
    codeScanningAlerts: () => errAsync(HTTP_ERROR),
    dependabotAlert: () => errAsync(HTTP_ERROR),
    dependabotAlerts: () => errAsync(HTTP_ERROR),
    createIssueComment: () => errAsync(HTTP_ERROR),
    createPr: () => errAsync(HTTP_ERROR),
    createStack: () => errAsync(HTTP_ERROR),
    dequeuePr: () => errAsync(HTTP_ERROR),
    diffFiles: () => errAsync(HTTP_ERROR),
    dismissCodeScanningAlert: () => errAsync(HTTP_ERROR),
    enqueuePr: () => errAsync(HTTP_ERROR),
    enqueueStackPr: () => errAsync(HTTP_ERROR),
    findOpenPrByHead: () => okAsync(undefined),
    getIssueComment: () => errAsync(HTTP_ERROR),
    getPr: () => errAsync(HTTP_ERROR),
    getRepoDescription: () => errAsync(HTTP_ERROR),
    getStack: () => errAsync(HTTP_ERROR),
    issueLabels: () => errAsync(HTTP_ERROR),
    listIssueComments: () => errAsync(HTTP_ERROR),
    listOpenPrs: () => errAsync(HTTP_ERROR),
    listOpenPrsAuthoredByMe: () => errAsync(HTTP_ERROR),
    listPrs: () => okAsync([]),
    listRuns: () => okAsync([]),
    markPrDraft: () => okAsync(undefined),
    markPrReady: () => okAsync(undefined),
    mergePr: () => errAsync(HTTP_ERROR),
    repoLabels: () => errAsync(HTTP_ERROR),
    requestedReviewers: () => errAsync(HTTP_ERROR),
    requestReviewers: () => errAsync(HTTP_ERROR),
    reviewThreadDetails: () => errAsync(HTTP_ERROR),
    reviewThreads: () => errAsync(HTTP_ERROR),
    setRepoDescription: () => errAsync(HTTP_ERROR),
    submitReviewRound: () => errAsync(HTTP_ERROR),
    updateIssueComment: () => errAsync(HTTP_ERROR),
    updatePr: () => errAsync(HTTP_ERROR),
    unstack: () => errAsync(HTTP_ERROR),
    ...overrides,
  };
}

/**
 * The injectable edges: a Git fake that answers the exact reads `stack push` makes, plus every creation-gate
 * measurement defaulted to its SKIP arm so a test only ever describes the gate it is about.
 */
function harnessDeps({ api, files = {} }: { api: GithubWriteApi; files?: Readonly<Record<string, string>> }): {
  deps: GithubStackPushDeps;
  door: MemoryDoorLedger;
  lines: string[];
  writes: (readonly string[])[];
} {
  const lines: string[] = [];
  const writes: (readonly string[])[] = [];
  let bareLsRemoteCalls = 0;
  let headReads = 0;
  // The amend keeps parents, author and message, so both commits share one lineage.
  const lineage = `${LOCAL_SHA}\0Test\0test@example.test\0`;
  // Both commits answer the reads keyed by a sha; only their trees differ, which is what the amend changed.
  const perCommitReads = [LOCAL_SHA, AMENDED_SHA].flatMap((sha): [string, string][] => [
    [`--no-replace-objects diff-tree --root --no-commit-id -r --no-renames --name-only -z ${sha}`, ""],
    // `--is-ancestor` answers by exit code; an empty read is the zero exit, so the base is an ancestor.
    [`--no-replace-objects merge-base --is-ancestor ${BASE_SHA}^{commit} ${sha}^{commit}`, ""],
    [`${LINEAGE} ${sha}`, lineage],
  ]);
  const fixedReads = new Map<string, string>([
    ...perCommitReads,
    ["rev-parse --show-toplevel", "/repo"],
    ["symbolic-ref --quiet --short HEAD", "feature"],
    ["remote get-url origin", "git@example.test:o/r.git"],
    // Nothing untracked: the amend adds no path the pull request never touched.
    [`--no-replace-objects ls-tree -r --name-only -z ${PINNED_TREE}`, ""],
    ["--no-replace-objects ls-files --others --exclude-standard -z", ""],
    [`--no-replace-objects ls-files --cached -z`, ""],
    ["add --all", ""],
    // The staged and committed trees are the pinned one: nothing edited the worktree while this push ran.
    ["write-tree", PINNED_TREE],
    [`--no-replace-objects rev-parse ${LOCAL_SHA}^{tree}`, HEAD_TREE],
    [`--no-replace-objects rev-parse ${AMENDED_SHA}^{tree}`, PINNED_TREE],
    ["status --porcelain", ""],
    [
      "ls-remote --symref origin HEAD refs/heads/feature",
      `ref: refs/heads/main\tHEAD\n${LOCAL_SHA}\tHEAD\n${LOCAL_SHA}\trefs/heads/feature`,
    ],
    ["ls-remote origin refs/heads/main", `${BASE_SHA}\trefs/heads/main`],
  ]);
  const readGit = ({ args }: { args: readonly string[] }): string => {
    const command = args.join(" ");
    const fixed = fixedReads.get(command);
    if (fixed !== undefined) return fixed;
    if (command === "rev-parse HEAD") {
      headReads += 1;
      // The fact read and the pre-amend re-check see the checked commit; every read after it, the amended one.
      return headReads <= 2 ? LOCAL_SHA : AMENDED_SHA;
    }
    if (command === "ls-remote origin refs/heads/feature") {
      bareLsRemoteCalls += 1;
      return `${bareLsRemoteCalls === 1 ? LOCAL_SHA : AMENDED_SHA}\trefs/heads/feature`;
    }
    // The head carries no proof output, so the push door passes it.
    if (args.includes("ls-tree")) return "";
    // The commit-message scan's read: one unpublished commit whose message the publication scan passes.
    if (args[0] === "--no-replace-objects" && args[1] === "log") return `\u001e${AMENDED_SHA}\0Add the feature\n`;
    throw new Error(`unexpected Git read: ${command}`);
  };
  const door = memoryDoorLedger();
  return {
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      captureAmendTree: () => ok(PINNED_TREE),
      cwd: () => "/repo",
      descriptionReview: clearDescriptionReview,
      doorLedger: door.port,
      env: () => undefined,
      git: {
        cwd: () => "/repo",
        doorLedger: door.port,
        out: ({ line }) => lines.push(line),
        readGit,
        readPatchId: ({ base, head }) =>
          ok(base === BASE_SHA && [LOCAL_SHA, AMENDED_SHA].includes(head) ? MEASURED_PATCH_ID : null),
        writeGit: ({ args }) => {
          writes.push(args);
          return ok(undefined);
        },
      },
      installationIdentifiers: () => Promise.resolve({ identifiers: undefined, unread: [] }),
      makeApi: () => api,
      measureAlreadyLanded: () => ok({ kind: "skipped", why: "not exercised by this test" }),
      measureBaseFreshness: () => ok({ kind: "skipped", why: "not exercised by this test" }),
      now: () => new Date("2026-08-15T00:00:00Z"),
      out: ({ line }) => lines.push(line),
      readFileSource: fakeFileSource({ files }),
      readForm: ({ source }) => source,
      sleep: () => Promise.resolve(),
      token: () => "fake-test-token",
    },
    door,
    lines,
    writes,
  };
}

function formArg(): string {
  return JSON.stringify(DRAFT);
}

/** Seeds the ledger as a PREVIOUS run left it: reserved, then confirmed against `number`. */
function seedConfirmedReservation({ home, number }: { home: string; number: number }): void {
  reservePr({ home, locus: LOCUS, nowIso: "2026-08-01T00:00:00Z" });
  confirmPr({
    form: { ...DRAFT, draft: true },
    home,
    locus: LOCUS,
    nodeId: `PR_${String(number)}`,
    nowIso: "2026-08-01T00:05:00Z",
    number,
    storedBody: "b",
  });
}

describe("base-freshness gate on stack push", () => {
  it("proceeds to create when freshness is fresh", async () => {
    const api = fakeApi({ createPr: () => okAsync(pr({ number: 1 })) });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      measureBaseFreshness: () =>
        ok({
          baseBranch: "main",
          baseSha: "aaa",
          headSha: "bbb",
          kind: "fresh" as const,
          remote: "origin",
          reverted: [],
        }),
    };
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("base freshness: current"))).toBe(true);
  });

  it("proceeds when freshness is opportunistically skipped, the token-only path", async () => {
    const api = fakeApi({ createPr: () => okAsync(pr({ number: 1 })) });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      measureAlreadyLanded: () => ok({ kind: "skipped" as const, why: "no local checkout" }),
      measureBaseFreshness: () => ok({ kind: "skipped" as const, why: "no local checkout" }),
    };
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("SKIPPED: no local checkout"))).toBe(true);
  });

  it("refuses an unacknowledged base-moved before creating anything", async () => {
    let created = false;
    const api = fakeApi({
      createPr: () => {
        created = true;
        return okAsync(pr({ number: 1 }));
      },
    });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      measureBaseFreshness: () =>
        ok({
          baseBranch: "main",
          baseSha: "aaa",
          behindBy: 3,
          headSha: "bbb",
          kind: "base-moved" as const,
          remote: "origin",
          reverted: [],
        }),
    };
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(created).toBe(false);
    expect(lines.some((line) => line.startsWith("refused: base-moved"))).toBe(true);
  });

  it("proceeds past an acknowledged base-moved and creates", async () => {
    const api = fakeApi({ createPr: () => okAsync(pr({ number: 1 })) });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      measureBaseFreshness: () =>
        ok({
          baseBranch: "main",
          baseSha: "aaa",
          behindBy: 3,
          headSha: "bbb",
          kind: "base-moved" as const,
          remote: "origin",
          reverted: [],
        }),
    };
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome(), "--acknowledge", "base-moved"],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.startsWith("ACKNOWLEDGED (base-moved)"))).toBe(true);
  });

  it("fails closed on an unmeasurable base, distinct from a genuine base-moved", async () => {
    let created = false;
    const api = fakeApi({
      createPr: () => {
        created = true;
        return okAsync(pr({ number: 1 }));
      },
    });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      measureBaseFreshness: () =>
        err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["network unreachable"] })),
    };
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(created).toBe(false);
    expect(lines.some((line) => line.includes("base-unmeasurable"))).toBe(true);
  });

  it("never measures freshness during a dry run", async () => {
    const { deps: baseDeps, lines } = harnessDeps({ api: fakeApi({}) });
    const deps = {
      ...baseDeps,
      measureBaseFreshness: () => {
        throw new Error("dry-run must not measure base freshness");
      },
    };
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--form", formArg(), "--dry-run", "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.at(-1)).toBe("dry run: no git add/amend, no door record, no push, no create, no network.");
  });

  it("never reaches the creation door during a dry run", async () => {
    const created: number[] = [];
    const api = fakeApi({
      createPr: () => {
        created.push(1);
        return okAsync(pr({ number: 1 }));
      },
    });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      captureAmendTree: () => {
        throw new Error("dry-run must not stage anything, not even into a scratch index");
      },
    };
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--form", formArg(), "--dry-run", "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(created).toEqual([]);
    expect(lines.at(-1)).toBe("dry run: no git add/amend, no door record, no push, no create, no network.");
  });
});

describe("a stale reservation is released, never a live one", () => {
  it("stays a duplicate refusal while the recorded pull request is still OPEN", async () => {
    const home = tempHome();
    seedConfirmedReservation({ home, number: 15324 });
    const api = fakeApi({ getPr: () => okAsync(pr({ number: 15324, state: "open" })) });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    // Only a duplicate citing the open pull request prints its update, on the form target's own repository.
    expect(lines.includes("  slopweaver github pr update --repo o/r --number 15324 --edit - < edit.json")).toBe(true);
  });

  it("releases the reservation and creates when the recorded pull request is CLOSED", async () => {
    const home = tempHome();
    seedConfirmedReservation({ home, number: 15324 });
    const api = fakeApi({
      createPr: () => okAsync(pr({ number: 200 })),
      getPr: () => okAsync(pr({ number: 15324, state: "closed" })),
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("releasing the reservation") && line.includes("#15324"))).toBe(true);
    expect(lines.some((line) => line.includes("opened #200"))).toBe(true);
  });

  it("does not release when the read itself fails", async () => {
    const home = tempHome();
    seedConfirmedReservation({ home, number: 15324 });
    const api = fakeApi({ getPr: () => errAsync(HTTP_ERROR) });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("already reserved by #15324"))).toBe(true);
    expect(lines.some((line) => line.includes("releasing the reservation"))).toBe(false);
  });

  it("reads the BRANCH PAIR, not the recorded number, when no number was ever confirmed", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-01T00:00:00Z" });
    let getPrCalls = 0;
    const api = fakeApi({
      createPr: () => okAsync(pr({ number: 200 })),
      getPr: () => {
        getPrCalls += 1;
        return okAsync(pr({ number: 1, state: "closed" }));
      },
      listPrs: () => okAsync([]),
    });
    const { deps } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_OK);
    expect(getPrCalls).toBe(0);
  });
});

/**
 * The lost-create-response strand, measured three times (once five times in a row). A create whose POST died leaves `{locus, reservedIso}` and no number, so the recorded-number
 * release path could never reach it and every retry refused as a duplicate of a pull request that did not
 * exist. Recovery was `rm` on a trust ledger. These cases are what make that unreachable again.
 */
describe("a numberless reservation is settled against the branch pair", () => {
  it("releases and creates when GitHub reports NO pull request on the pair", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const api = fakeApi({ createPr: () => okAsync(pr({ number: 200 })), listPrs: () => okAsync([]) });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("GitHub reports no pull request on these branches"))).toBe(true);
    expect(lines.some((line) => line.includes("opened #200"))).toBe(true);
  });

  it("qualifies the head with the owner, because GitHub ignores a bare ref and lists the whole repository", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const heads: string[] = [];
    const api = fakeApi({
      createPr: () => okAsync(pr({ number: 200 })),
      listPrs: ({ head }) => {
        heads.push(head);
        return okAsync([]);
      },
    });
    const { deps } = harnessDeps({ api });
    await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(heads).toStrictEqual(["o:feature"]);
  });

  it("recovers the number and still refuses, when the pair carries ONE OPEN pull request", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    let creates = 0;
    const api = fakeApi({
      createPr: () => {
        creates += 1;
        return okAsync(pr({ number: 200 }));
      },
      listPrs: () => okAsync([pr({ number: 4242, state: "open" })]),
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(creates).toBe(0);
    expect(lines.some((line) => line.includes("recovered #4242 onto the reservation"))).toBe(true);
    // The refusal names that number ONLY because the recovery wrote it — this is that write's witness.
    expect(lines.some((line) => line.includes("already reserved by #4242"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })!.number).toBe(4242);
  });

  it("releases and creates when the pair's ONE pull request is already closed", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    const api = fakeApi({
      createPr: () => okAsync(pr({ number: 200 })),
      listPrs: () => okAsync([pr({ number: 4242, state: "closed" })]),
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("#4242 is closed there"))).toBe(true);
    expect(lines.some((line) => line.includes("opened #200"))).toBe(true);
  });

  it("leaves the reservation standing, and says why, when the pair carries TWO pull requests", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    let creates = 0;
    const api = fakeApi({
      createPr: () => {
        creates += 1;
        return okAsync(pr({ number: 200 }));
      },
      listPrs: () => okAsync([pr({ number: 1, state: "closed" }), pr({ number: 2, state: "open" })]),
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(creates).toBe(0);
    expect(lines.some((line) => line.includes("GitHub reports at least 2 pull requests on these branches"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })!.number).toBeUndefined();
  });

  it("leaves the reservation standing, and says why, when the verifying read itself fails", async () => {
    const home = tempHome();
    reservePr({ home, locus: LOCUS, nowIso: "2026-08-24T02:20:00Z" });
    let creates = 0;
    const api = fakeApi({
      createPr: () => {
        creates += 1;
        return okAsync(pr({ number: 200 }));
      },
      listPrs: () => errAsync(HTTP_ERROR),
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(creates).toBe(0);
    expect(lines.some((line) => line.includes("could not read the pull requests on these branches"))).toBe(true);
    expect(readPrRecord({ home, locus: LOCUS })!.number).toBeUndefined();
  });
});

describe("the write preflight runs AFTER the push, immediately before the create", () => {
  it("runs the retryable preflight between the push and the create, so the create never inherits a dead socket", async () => {
    // MEASURED: the push streams this repository's whole pre-push gate (444s and 1314s on two
    // runs), so any keep-alive socket an earlier GET left behind is dead when the create POST inherits it —
    // `UNCONFIRMED: the create call failed (write EPIPE)` with the branch already on the remote. A fresh
    // GithubWriteApi does not fix it (Octokit shares undici's global dispatcher); ordering does, because
    // `canPush` retries and the create does not. The open pull request read before the push is one such earlier
    // GET; `stackPushRun/pullRequestReview.test.ts` witnesses it ahead of this order.
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
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      git: {
        ...baseDeps.git,
        writeGit: ({ args }: { args: readonly string[] }) => {
          calls.push(`git ${args[0]!}`);
          return ok(undefined);
        },
      },
    };
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()], deps });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["git commit", "git push", "canPush", "createPr"]);
    expect(lines.some((line) => line.includes("opened #400"))).toBe(true);
  });

  it("refuses without creating when the token cannot push, even though the branch already went up", async () => {
    let created = false;
    const api = fakeApi({
      canPush: () => okAsync(false),
      createPr: () => {
        created = true;
        return okAsync(pr({ number: 1 }));
      },
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(created).toBe(false);
    expect(lines.some((line) => line.includes("cannot push to it"))).toBe(true);
  });
});

describe("the authoring-file input modes", () => {
  it("--file parses an authoring file into a valid create", async () => {
    const file = renderAuthoringFile({ form: DRAFT });
    const api = fakeApi({ createPr: () => okAsync(pr({ number: 300 })) });
    const { deps, lines } = harnessDeps({ api, files: { "/pr.md": file } });
    const code = await runGithubStackPush({
      argv: [...PUSH_ARGS, "--file", "/pr.md", "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("opened #300"))).toBe(true);
  });

  it("--file-example prints a complete authoring file, touching no git, token or network", async () => {
    const api = fakeApi({
      createPr: () => {
        throw new Error("--file-example must not construct or call a GitHub client");
      },
    });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const deps = {
      ...baseDeps,
      git: {
        ...baseDeps.git,
        readGit: () => {
          throw new Error("--file-example must not read Git");
        },
      },
    };
    const code = await runGithubStackPush({
      argv: ["node", "slopweaver", "github", "stack", "push", "--file-example"],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines[0]).toBe(PR_VOICE_BRIEF_HEADER);
    expect(lines.some((line) => line.includes("---"))).toBe(true);
    expect(lines.some((line) => line.includes("## Explainer"))).toBe(true);
  });

  it("--form-example prints the exact fixture, touching no git, token or network", async () => {
    const { deps: baseDeps, lines } = harnessDeps({ api: fakeApi({}) });
    const deps = {
      ...baseDeps,
      git: {
        ...baseDeps.git,
        readGit: () => {
          throw new Error("--form-example must not read Git");
        },
      },
    };
    const code = await runGithubStackPush({
      argv: ["node", "slopweaver", "github", "stack", "push", "--form-example"],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines[0]).toBe(PR_VOICE_BRIEF_HEADER);
    expect(lines.join("\n")).toContain(JSON.stringify(EXAMPLE_PR_FORM, null, 2));
  });

  it("creates a C3 description that reads back to the form sent, its top risk the one the badge carries", async () => {
    const bodies: string[] = [];
    const api = fakeApi({
      createPr: ({ body }) => {
        bodies.push(body);
        return okAsync(pr({ number: 500 }));
      },
    });
    const { deps } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()], deps });
    expect(code).toBe(EXIT_OK);
    expect(bodies).toHaveLength(1);
    const { draft: _draft, target: _target, title: _title, ...body } = DRAFT;
    expect(unwrap(parsePrBody({ body: bodies[0]! })).body).toStrictEqual({
      ...body,
      risk: { items: [DRAFT.risk.items[0]!] },
    });
  });
});

describe("no description carries a gold anchor", () => {
  it("refuses a form naming one, before any Git write or create", async () => {
    const api = fakeApi({
      createPr: () => {
        throw new Error("a refused form must not reach the creation door");
      },
    });
    const { deps, lines, writes } = harnessDeps({ api });
    const form = JSON.stringify({ ...DRAFT, goldAnchor: { commit: AMENDED_SHA } });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", form, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_USAGE);
    expect(writes).toEqual([]);
    expect(lines.join("\n")).toContain("goldAnchor is no longer published");
  });

  it("refuses the same form under --dry-run, writing nothing and exiting non-zero", async () => {
    const { deps, lines, writes } = harnessDeps({ api: fakeApi({}) });
    const form = JSON.stringify({ ...DRAFT, goldAnchor: { commit: "9f3c1de" } });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", form, "--dry-run"], deps });
    expect(code).toBe(EXIT_USAGE);
    expect(writes).toEqual([]);
    expect(lines.join("\n")).toContain("goldAnchor is no longer published");
  });
});

/** Writes one board row that a fleet session registered as a FINDING and the owner has not yet ruled on. */
function seedUnruledFinding({ home }: { home: string }): void {
  mkdirSync(join(home, "handovers"), { recursive: true });
  writeFileSync(
    join(home, "handovers", "feature.md"),
    [
      "---",
      "slug: feature",
      "kind: ask",
      'summary: "a row nobody asked for"',
      "status: ready",
      "askedIso: 2026-09-02T06:14:01Z",
      "origin: finding",
      "observedBy: session-40",
      "evidence: [owner/repo#16360]",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("finding gate on stack push — a fleet finding the owner has not ruled on never reaches a team base", () => {
  it("refuses a team-base pull request whose head is an unruled finding row, before any API call", async () => {
    let created = false;
    const api = fakeApi({
      createPr: () => {
        created = true;
        return okAsync(pr({ number: 1 }));
      },
    });
    const home = tempHome();
    seedUnruledFinding({ home });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(created).toBe(false);
    expect(lines.some((line) => line.startsWith("refused: finding-unruled"))).toBe(true);
  });

  it("creates as usual when no finding row claims the head", async () => {
    const api = fakeApi({ createPr: () => okAsync(pr({ number: 1 })) });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubStackPush({ argv: [...PUSH_ARGS, "--form", formArg(), "--home", tempHome()], deps });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("finding"))).toBe(false);
  });
});
