import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGithubPush } from "../../../../../../cli/commands/github/pushRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { privateTermsRefusal } from "../../../../../../hygiene/privateTerms.js";
import { writePrivateTerms } from "../../../../../privateTermsFixture.js";
import { fixtureDirs, harness, LOCAL_SHA, PREFIX, REMOTE_SHA, useFixtureDirCleanup } from "./harness.js";

useFixtureDirCleanup();

/**
 * A throwaway state home with no denylist, so only the always-on rules judge, and a private-terms file carrying
 * `rows` — none by default — or no file at all.
 */
function home({ terms = [] }: { terms?: readonly string[] | "absent" } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "github-push-commit-home-"));
  fixtureDirs.push(dir);
  if (terms !== "absent") writePrivateTerms({ home: dir, rows: terms });
  return dir;
}

describe("runGithubPush commit-message scan", () => {
  it("refuses a first-person commit message before the freshness fetch, the door or the push", async () => {
    const test = harness({ commitMessage: "We fixed the retry" });
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home(), "--force-with-lease"], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    expect(test.door.records()).toEqual([]);
    expect(test.lines).toEqual([
      `would push ${LOCAL_SHA} to owner/repo:feature via origin`,
      `mode: exact force-with-lease against ${REMOTE_SHA}`,
      "refused: 1 commit message(s) cannot be published as written; nothing was sent:",
      `  commit ${LOCAL_SHA.slice(0, 12)}:`,
      '    commit message line 1: "We" is first person — name who acted — "the owner", or "an agent" for a session — or say what the change does',
      "This is a hold, with no override: reword each message (`git commit --amend` for the head commit, a reword " +
        "rebase for an older one), then run the command again.",
    ]);
  });

  it("refuses on a dry run too, so the preview never promises a push the door would hold", async () => {
    const test = harness({ commitMessage: "Clean subject\n\nTested on this Mac." });
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home(), "--dry-run"], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    expect(test.lines).toContain(
      '    commit message line 3: "this Mac" names the host by its make — write "this machine"',
    );
  });

  it("refuses a private term by class, never echoing it, and sends nothing", async () => {
    const test = harness({ commitMessage: "Map the Zorvane office" });
    const argv = [...PREFIX, "--home", home({ terms: ["place\ti\tzorvane\tsynthetic"] }), "--force-with-lease"];
    expect(await runGithubPush({ argv, deps: test.deps })).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    expect(test.lines).toContain(
      "    commit message line 1: a private place term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    );
    expect(test.lines.some((line) => line.toLowerCase().includes("zorvane"))).toBe(false);
  });

  it("refuses with no private-terms file, naming it, before the fetch, the door or the push", async () => {
    const test = harness();
    const dir = home({ terms: "absent" });
    const code = await runGithubPush({ argv: [...PREFIX, "--home", dir, "--force-with-lease"], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    expect(test.door.records()).toEqual([]);
    expect(test.lines.at(-1)).toBe(
      `refused: ${privateTermsRefusal({ load: { kind: "absent", path: join(dir, "hygiene", "private-terms.tsv") } })} nothing was sent.`,
    );
  });

  it("lets a clean message through to the dry-run preview", async () => {
    const test = harness();
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home(), "--dry-run"], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.lines.some((line) => line.includes("commit message"))).toBe(false);
  });
});
