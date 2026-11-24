/**
 * `github stack push` refusals that fire before any push: an unrecordable door decision, an unpinnable worktree,
 * a corrupt profile under a walkthrough, a usage error, a form whose head is not the checked-out branch, and a
 * form carrying the retired review field. Each one sends nothing. Split from `stackPushRun.test.ts` by behaviour.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type GithubStackPushDeps } from "../../../../../../cli/commands/github/stackPushDeps.js";
import { runGithubStackPush } from "../../../../../../cli/commands/github/stackPushRun.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { err } from "../../../../../../lib/result.js";
import { unreachableDoorLedger } from "../../../../../doorLedgerFixture.js";
import { baseDraft, baseForm, PREFIX } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackPush", () => {
  it("performs nothing when the door cannot record its decision", async () => {
    const api = {} as GithubWriteApi;
    const { deps: baseDeps, lines, writes } = harness({ api });
    const deps: GithubStackPushDeps = { ...baseDeps, doorLedger: unreachableDoorLedger() };
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines.some((line) => line.includes("not performed:"))).toBe(true);
  });

  it("refuses before any gate when the worktree cannot be pinned", async () => {
    const api = {} as GithubWriteApi;
    const { deps: baseDeps, lines, writes } = harness({ api });
    const deps: GithubStackPushDeps = { ...baseDeps, captureAmendTree: () => err("git add (scratch index) failed") };
    const code = await runGithubStackPush({ argv: [...PREFIX, "--form", baseForm({ base: "main" })], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines).toEqual(["refused: could not pin the worktree for stack push: git add (scratch index) failed"]);
  });

  it("refuses a walkthrough over a corrupt profile.json with exit 1 before any Git write or API call", async () => {
    // An empty object: any API method the verb reached would throw, so reaching none is the witness.
    const api = {} as GithubWriteApi;
    const { deps, lines, writes } = harness({ api });
    const home = tempHome();
    writeFileSync(join(home, "profile.json"), "{");
    const review = JSON.stringify({
      comments: [{ body: "This explains the stack-specific seam in place.", line: 12, path: "src/a.ts" }],
    });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm(), "--self-review", review, "--home", home],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`refused: the profile at ${join(home, "profile.json")} is there but cannot be trusted`);
    expect(lines[0]).toContain("nothing was pushed, no pull request was opened and no review was posted.");
  });

  it("refuses before the amend and push when no CLEAN description review covers the body, naming the checkout", async () => {
    // An empty object: any API method the verb reached would throw, so reaching none but the harness's own
    // open pull request read (none open) is the witness.
    const api = {} as GithubWriteApi;
    const { deps: baseDeps, lines, openPrReads, writes } = harness({ api });
    const asked: { headRef: string; repoDir: string; body: string; pullRequest: unknown }[] = [];
    const deps: GithubStackPushDeps = {
      ...baseDeps,
      descriptionReview: ({ body, headRef, pullRequest, repoDir }) => {
        asked.push({ body, headRef, pullRequest, repoDir });
        return Promise.resolve({ kind: "refused", lines: ["no description review covers packet abc…"] });
      },
    };
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(openPrReads).toEqual(["o/r:top"]);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.headRef).toBe("HEAD");
    expect(asked[0]!.repoDir).toBe("/repo");
    expect(asked[0]!.pullRequest).toStrictEqual({ kind: "new" });
    expect(asked[0]!.body).toContain("An export dropped");
    expect(lines.slice(-2)).toEqual([
      "refused: no CLEAN description review covers this pull request's description",
      "no description review covers packet abc…",
    ]);
  });

  it("refuses usage errors before any Git read", async () => {
    const api = {} as GithubWriteApi;
    const { deps } = harness({ api });
    const code = await runGithubStackPush({ argv: [...PREFIX], deps });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses when the form's target.head is not the checked-out branch", async () => {
    const api = {} as GithubWriteApi;
    const { deps, lines } = harness({ api, branch: "top" });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ head: "someone-elses-branch" })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual([
      "refused: the form's target.head (someone-elses-branch) must be the checked-out branch (top)",
    ]);
  });

  it("withholds the head refusal when the form's target.head carries a credential shape", async () => {
    // A synthetic token built at runtime, so no credential shape sits in this file's source.
    const token = `ghp_${"a".repeat(30)}`;
    const api = {} as GithubWriteApi;
    const { deps, lines } = harness({ api, branch: "top" });
    const code = await runGithubStackPush({ argv: [...PREFIX, "--form", baseForm({ head: token })], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.filter((line) => line.includes(token))).toEqual([]);
    expect(lines).toEqual([
      "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
        "the secret scan names, and the refusal prints in full",
    ]);
  });

  it("withholds the pin refusal, an exit nobody wrapped by hand, when its reason quotes a credential shape", async () => {
    const token = `ghp_${"a".repeat(30)}`;
    const api = {} as GithubWriteApi;
    const { deps: baseDeps, lines, writes } = harness({ api });
    const deps: GithubStackPushDeps = { ...baseDeps, captureAmendTree: () => err(`scratch index refused ${token}`) };
    const code = await runGithubStackPush({ argv: [...PREFIX, "--form", baseForm({ base: "main" })], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines.filter((line) => line.includes(token))).toEqual([]);
    expect(lines).toEqual([
      "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
        "the secret scan names, and the refusal prints in full",
    ]);
  });

  it("withholds git's own failure text when it quotes a credential shape", async () => {
    const token = `ghp_${"a".repeat(30)}`;
    const api = {} as GithubWriteApi;
    const { deps: baseDeps, lines, writes } = harness({ api });
    const deps: GithubStackPushDeps = {
      ...baseDeps,
      git: {
        ...baseDeps.git,
        readGit: () => {
          throw new Error(`fatal: '${token}' does not appear to be a git repository`);
        },
      },
    };
    const code = await runGithubStackPush({ argv: [...PREFIX, "--form", baseForm({ base: "main" })], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines.filter((line) => line.includes(token))).toEqual([]);
    expect(lines).toEqual([
      "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
        "the secret scan names, and the refusal prints in full",
    ]);
  });

  it("refuses a form carrying a review before any Git read, since no description carries a grade", async () => {
    // An empty object: any API method the verb reached would throw, so reaching none is the witness.
    const api = {} as GithubWriteApi;
    const { deps, lines, writes } = harness({ api });
    const draft = baseDraft({ base: "main", explainerText: "An export dropped an entry. This keeps it.", head: "top" });
    const form = JSON.stringify({ ...draft, review: { grade: "gold" } });
    const code = await runGithubStackPush({ argv: [...PREFIX, "--form", form], deps });
    expect(code).toBe(EXIT_USAGE);
    expect(writes).toEqual([]);
    expect(lines.join("\n")).toContain("review is no longer published");
  });
});
