/**
 * `github pr`'s remaining sub-commands, driven end-to-end through `runGithubPr` against a real temp ledger.
 *
 * The create-side suites this file used to hold now live in `stackPushCreation.test.ts`: `github stack push`
 * is the one verb that opens a pull request since the ruling, and this file covers the redirect
 * that says so plus the description-write paths that stayed here.
 *
 * A `mkdtempSync` home is the sanctioned exception in `.claude/rules/testing.md`: the thing under test IS the
 * on-disk description ledger, which `prLedger.test.ts` exercises directly and this file exercises through the
 * verb.
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import { parseGithubPrArgs } from "../../../../../cli/commands/github/core.js";
import { type GithubPrDeps, runGithubPr } from "../../../../../cli/commands/github/run.js";
import { postSelfReview } from "../../../../../cli/commands/github/selfReviewFlow.js";
import { runPull } from "../../../../../cli/commands/github/updatePull.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap } from "../../../../../lib/result.js";
import { renderAuthoringFile } from "../../../../../outbound/github/authoringFile.js";
import { renderContent } from "../../../../../outbound/github/authoringInline.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { parsePrBody } from "../../../../../outbound/github/parse.js";
import { bodyHash } from "../../../../../outbound/github/prLedger.js";
import { renderPrBody } from "../../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../../outbound/github/stamp.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";
import { PR_VOICE_BRIEF_HEADER } from "../../../../../outbound/github/voiceBrief.js";
import { fakeApi, harnessDeps } from "../../../../githubPrHarness.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "github-pr-run-home-" });
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
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "1111111111111111111111111111111111111111" },
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

const TARGET = { base: "main", head: "feature", owner: "o", repo: "r" };

/** The example draft on this file's pull request, its problem seen before the harness clock's day. */
const DRAFT: PrFormDraft = {
  ...EXAMPLE_PR_FORM,
  problemSeen: { by: "unrecorded", kind: "seen", on: "2026-08-01", what: "an exported report was one row short" },
  target: TARGET,
};

/** The day the live description was written, on or after the day its problem was seen. */
const LIVE_WRITTEN_ON = "2026-08-14";

/** `draft` as GitHub holds it: checked for a write on {@link LIVE_WRITTEN_ON} and rendered. */
function liveBodyOf({ draft }: { draft: PrFormDraft }): string {
  return unwrap(renderPrBody({ form: unwrap(stampForWrite({ draft, today: LIVE_WRITTEN_ON })) }));
}

/** The `github pr update` argv for the example pull request, with the mode flags given. */
function updateArgv({ flags, home }: { flags: readonly string[]; home: string }): readonly string[] {
  return ["node", "slopweaver", "github", "pr", "update", ...flags, "--repo", "o/r", "--number", "42", "--home", home];
}

/** A live example pull request carrying `body` under the draft's own title, so an unchanged write is a true no-op. */
function livePr({ body }: { body: string }): WrittenPr {
  return { ...pr({ number: 42 }), body, title: DRAFT.title };
}

/** An `updatePr` that must never be reached — a no-op or a refusal writes nothing to GitHub. */
function updateNeverCalled(): GithubWriteApi["updatePr"] {
  return () => {
    throw new Error("this update must not reach GitHub");
  };
}

describe("`pr update --self-review` over a corrupt profile.json", () => {
  it("refuses with exit 1 before resolving a token or reaching the API", async () => {
    const { deps, lines } = harnessDeps({
      api: fakeApi({
        getPr: () => {
          throw new Error("a corrupt profile must stop the update before any API read");
        },
      }),
    });
    const guarded: GithubPrDeps = {
      ...deps,
      token: () => {
        throw new Error("a corrupt profile must stop the update before a token is resolved");
      },
    };
    const home = tempHome();
    writeFileSync(join(home, "profile.json"), "{");
    const review = JSON.stringify({
      comments: [
        { body: "This keeps the current diff easy to enter.", kind: "explanation", line: 9, path: "src/a.ts" },
      ],
    });
    const code = await runGithubPr({
      argv: [
        "node",
        "slopweaver",
        "github",
        "pr",
        "update",
        "--repo",
        "o/r",
        "--number",
        "42",
        "--self-review",
        review,
        "--home",
        home,
      ],
      deps: guarded,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`refused: the profile at ${join(home, "profile.json")} is there but cannot be trusted`);
    expect(lines[0]).toContain("nothing was updated and no review was posted.");
  });
});

describe("postSelfReview under --expect-head", () => {
  it("refuses, posting nothing, when the head it reads before posting is not the expected one", async () => {
    const { deps, lines } = harnessDeps({ api: fakeApi({ getPr: () => okAsync(pr({ number: 42 })) }) });
    const code = await postSelfReview({
      api: deps.makeApi({ home: tempHome(), token: "t" }),
      deps,
      expectHead: "2".repeat(40),
      form: {
        comments: [
          { body: "This keeps the current diff easy to enter.", kind: "explanation", line: 9, path: "src/a.ts" },
        ],
      },
      home: tempHome(),
      number: 42,
      owner: "o",
      repo: "r",
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual([
      `self-review refused: #42 is at ${"1".repeat(40)}, not the expected head ${"2".repeat(40)}, so nothing was sent. Re-derive the edit from the current head`,
    ]);
  });
});

describe("postSelfReview answers to the description review", () => {
  const ROUND = {
    comments: [
      { body: "This keeps the current diff easy to enter.", kind: "explanation" as const, line: 9, path: "src/a.ts" },
    ],
  };

  it("asks the review about the rendered round beside the live description, and posts nothing on a refusal", async () => {
    const body = liveBodyOf({ draft: DRAFT });
    const api = fakeApi({
      getPr: () => okAsync(livePr({ body })),
      submitReviewRound: () => {
        throw new Error("an unreviewed round must not reach GitHub");
      },
    });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const asked: unknown[] = [];
    const deps: GithubPrDeps = {
      ...baseDeps,
      descriptionReview: ({ body: sent, comments, headRef, pullRequest }) => {
        asked.push({ comments, headRef, pullRequest, sentLiveBody: sent === body });
        return Promise.resolve({ kind: "refused", lines: ["no description review covers packet abc…"] });
      },
    };
    const code = await postSelfReview({
      api: deps.makeApi({ home: tempHome(), token: "t" }),
      deps,
      form: ROUND,
      home: tempHome(),
      number: 42,
      owner: "o",
      repo: "r",
    });
    expect(code).toBe(EXIT_ERROR);
    expect(asked).toStrictEqual([
      {
        comments: [{ body: "💡 This keeps the current diff easy to enter.", line: 9, path: "src/a.ts" }],
        headRef: "1".repeat(40),
        pullRequest: { kind: "existing", number: 42 },
        sentLiveBody: true,
      },
    ]);
    expect(lines).toEqual([
      "self-review refused: no CLEAN description review covers this round beside the live description",
      "no description review covers packet abc…",
    ]);
  });

  it("refuses a round whose live description cannot be read back, without asking the review", async () => {
    const api = fakeApi({ getPr: () => okAsync(pr({ number: 42 })) });
    const { deps: baseDeps, lines } = harnessDeps({ api });
    const asked: number[] = [];
    const deps: GithubPrDeps = {
      ...baseDeps,
      descriptionReview: () => {
        asked.push(1);
        return Promise.resolve({ boundHead: undefined, kind: "clear", notice: undefined });
      },
    };
    const code = await postSelfReview({
      api: deps.makeApi({ home: tempHome(), token: "t" }),
      deps,
      form: ROUND,
      home: tempHome(),
      number: 42,
      owner: "o",
      repo: "r",
    });
    expect(code).toBe(EXIT_ERROR);
    expect(asked).toStrictEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "self-review refused: the round answers to the live description, which cannot be read back: ",
    );
  });
});

describe("`pr create` is refused, and says what opens a pull request instead", () => {
  it("names `github stack push`, touching no token, git or network", async () => {
    const api = fakeApi({
      canPush: () => {
        throw new Error("the redirect must not reach the API");
      },
    });
    const { deps, lines } = harnessDeps({ api });
    const deps2 = {
      ...deps,
      token: () => {
        throw new Error("the redirect must not resolve a token");
      },
    };
    const code = await runGithubPr({
      argv: ["node", "slopweaver", "github", "pr", "create", "--form", JSON.stringify(EXAMPLE_PR_FORM)],
      deps: deps2,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines[0]).toBe(
      "refused: `github pr create` no longer opens pull requests. Use `github stack push` instead.",
    );
    expect(lines.some((line) => line.includes("slopweaver github stack push --form -"))).toBe(true);
  });

  it("refuses the shape printers too — there is one creation door, not one and a half", async () => {
    const { deps, lines } = harnessDeps({ api: fakeApi({}) });
    const code = await runGithubPr({
      argv: ["node", "slopweaver", "github", "pr", "create", "--form-example"],
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines.some((line) => line.includes("--form-example"))).toBe(true);
  });
});

describe("--file / --pull — the authoring-file workflow", () => {
  it("runPull refuses, writing nothing, a retired table-shape description, naming the --convert-c3 pull", async () => {
    const body = "<table><tr><td><strong>Problem</strong></td><td>The pool exhausts.</td></tr></table>";
    const api = fakeApi({ getPr: () => okAsync(livePr({ body })) });
    const { deps, lines, writes } = harnessDeps({ api });
    const args = unwrap(parseGithubPrArgs({ argv: ["update", "--pull", "--repo", "o/r", "--number", "42"] }));
    expect(await runPull({ args, deps, home: tempHome() })).toBe(EXIT_ERROR);
    expect(writes).toStrictEqual({});
    const printed = lines.join("\n");
    expect(printed).toContain("refused: #42's description is a pre-C3 body.");
    expect(printed).toContain("slopweaver github pr update --repo o/r --number 42 --pull --convert-c3");
  });

  it("update --pull writes the live description into an editable file, with its digest", async () => {
    const body = liveBodyOf({ draft: DRAFT });
    const api = fakeApi({ getPr: () => okAsync(livePr({ body })) });
    const { deps, lines, writes } = harnessDeps({ api });
    const code = await runGithubPr({
      argv: updateArgv({ flags: ["--pull", "--out", "/pulled.md"], home: tempHome() }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(writes["/pulled.md"]).toContain(`pulled-body-hash: ${bodyHash({ body })}`);
    expect(lines).toContain(PR_VOICE_BRIEF_HEADER);
    expect(lines.at(-1)).toBe(
      `The explainer a reviewer meets first on this body today: "${renderContent({ content: DRAFT.explainer })}"`,
    );
  });

  it("update --pull refuses when the caller is not the pull request's author", async () => {
    const body = liveBodyOf({ draft: DRAFT });
    const api = fakeApi({
      authenticatedUserId: () => okAsync(2),
      getPr: () => okAsync({ ...livePr({ body }), authorId: 1 }),
    });
    const { deps, lines, writes } = harnessDeps({ api });
    const code = await runGithubPr({ argv: updateArgv({ flags: ["--pull"], home: tempHome() }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(Object.keys(writes)).toEqual([]);
    expect(lines.some((line) => line.startsWith("refused:"))).toBe(true);
  });

  it("update --file refuses when the live description drifted since the file was pulled", async () => {
    const staleHash = bodyHash({ body: "a description that no longer exists" });
    const file = renderAuthoringFile({ form: DRAFT, pulledBodyHash: staleHash });
    const api = fakeApi({
      getPr: () => okAsync(livePr({ body: liveBodyOf({ draft: DRAFT }) })),
      updatePr: updateNeverCalled(),
    });
    const { deps, lines } = harnessDeps({ api, files: { "/pr.md": file } });
    const code = await runGithubPr({ argv: updateArgv({ flags: ["--file", "/pr.md"], home: tempHome() }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("changed since this file was pulled"))).toBe(true);
  });

  it("a --pull then --file round trip with no edits is a no-op: nothing written, the stamp kept", async () => {
    const body = liveBodyOf({ draft: DRAFT });
    const pulled = harnessDeps({ api: fakeApi({ getPr: () => okAsync(livePr({ body })) }) });
    const home = tempHome();
    expect(
      await runGithubPr({ argv: updateArgv({ flags: ["--pull", "--out", "/pulled.md"], home }), deps: pulled.deps }),
    ).toBe(EXIT_OK);
    const file = pulled.writes["/pulled.md"]!;

    const api = fakeApi({ getPr: () => okAsync(livePr({ body })), updatePr: updateNeverCalled() });
    const { deps, lines } = harnessDeps({ api, files: { "/pulled.md": file } });
    const code = await runGithubPr({ argv: updateArgv({ flags: ["--file", "/pulled.md"], home }), deps });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("unchanged #42"))).toBe(true);
  });

  it("update --file with no pulled-body-hash advises that no drift check ran", async () => {
    // No `pulledBodyHash` — an authored-from-scratch file, or one that had its `pulled-body-hash` line lost.
    // It renders to the live body (an "unchanged" write), so the advisory is isolated from the separate
    // `SLOPWEAVER_ALLOW_PR_REPLACE` consent gate a REAL wholesale change would also need to clear.
    const file = renderAuthoringFile({ form: DRAFT });
    const api = fakeApi({
      getPr: () => okAsync(livePr({ body: liveBodyOf({ draft: DRAFT }) })),
      updatePr: updateNeverCalled(),
    });
    const { deps, lines } = harnessDeps({ api, files: { "/pr.md": file } });
    const code = await runGithubPr({ argv: updateArgv({ flags: ["--file", "/pr.md"], home: tempHome() }), deps });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("no pulled-body-hash") && line.includes("NOT checked for drift"))).toBe(
      true,
    );
  });

  it("update --form (never --pull-able) does not print the no-digest advisory", async () => {
    const api = fakeApi({
      getPr: () => okAsync(livePr({ body: liveBodyOf({ draft: DRAFT }) })),
      updatePr: updateNeverCalled(),
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubPr({
      argv: updateArgv({ flags: ["--form", JSON.stringify(DRAFT)], home: tempHome() }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines.some((line) => line.includes("pulled-body-hash"))).toBe(false);
  });
});

describe("the retired grade — no description carries a review", () => {
  it("a whole --form carrying a review is refused by name, sending nothing", async () => {
    const api = fakeApi({
      getPr: () => okAsync(livePr({ body: liveBodyOf({ draft: DRAFT }) })),
      updatePr: updateNeverCalled(),
    });
    const { deps, lines } = harnessDeps({ api });
    const form = JSON.stringify({ ...DRAFT, review: { grade: "gold" } });
    const code = await runGithubPr({ argv: updateArgv({ flags: ["--form", form], home: tempHome() }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(lines.join("\n")).toContain("review is no longer published");
  });

  it("an --edit naming review is refused as a field the form does not have, sending nothing", async () => {
    const api = fakeApi({
      getPr: () => okAsync(livePr({ body: liveBodyOf({ draft: DRAFT }) })),
      updatePr: updateNeverCalled(),
    });
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubPr({
      argv: updateArgv({ flags: ["--edit", JSON.stringify({ review: { grade: "gold" } })], home: tempHome() }),
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines.join("\n")).toContain('unknown field "review" — REFUSED, not ignored.');
  });
});

describe("--edit — a partial change is merged into the live description and sent once", () => {
  it("writes the edited explainer into the description, which reads back carrying it", async () => {
    const written: string[] = [];
    const api = fakeApi({
      getPr: () => okAsync(livePr({ body: liveBodyOf({ draft: DRAFT }) })),
      updatePr: ({ body }) => {
        if (body === undefined) {
          throw new Error("an explainer edit must send the re-rendered body");
        }
        written.push(body);
        return okAsync(livePr({ body }));
      },
    });
    const { deps } = harnessDeps({ api });
    const explainer = [{ kind: "text", text: "Widget export now keeps the last entry of every sheet." }] as const;
    const code = await runGithubPr({
      argv: updateArgv({ flags: ["--edit", JSON.stringify({ explainer })], home: tempHome() }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(written).toHaveLength(1);
    expect(unwrap(parsePrBody({ body: written[0]! })).body.explainer).toStrictEqual(explainer);
  });
});
