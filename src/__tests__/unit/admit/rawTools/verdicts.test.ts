/*
 * `classifyRawCommand`'s direct verdicts: which gh, git, curl and wget shapes it blocks, which read-only and
 * self-landing shapes it allows, and that the process-wide escape opens a would-be-blocked command.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand, RAW_ESCAPE } from "../../../../admit/rawTools.js";
import { blockedMessage, isBlocked } from "./harness.js";

describe("classifyRawCommand", () => {
  it("blocks a mutating gh command with the escape in the message", () => {
    expect(blockedMessage({ command: "gh pr close 1" })).toContain(RAW_ESCAPE);
  });

  it("allows `gh pr merge` and `gh pr ready` — an agent may land its own green, gold-proof PR", () => {
    // The policy reversal. Asserted as ALLOWED rather than merely removed from a list, because the
    // list is not the contract — what the classifier decides is. What gates a merge now is CI plus the
    // `proof-commit:` anchor, neither of which this classifier can see.
    expect(isBlocked({ command: "gh pr merge 205 --squash" })).toBe(false);
    expect(isBlocked({ command: "gh pr ready 205" })).toBe(false);
    expect(isBlocked({ command: "FOO=bar gh pr merge 205" })).toBe(false);
  });

  it("still blocks the other pr mutations, so the reversal is scoped rather than a hole", () => {
    expect(isBlocked({ command: "gh pr create --title x" })).toBe(true);
    expect(isBlocked({ command: "gh pr edit 1 --body x" })).toBe(true);
    expect(isBlocked({ command: "gh pr review 1 --approve" })).toBe(true);
  });

  it("blocks gh api with a write method (spaced, attached, and = forms)", () => {
    expect(isBlocked({ command: "gh api -X POST /repos/x/y/issues" })).toBe(true);
    expect(isBlocked({ command: "gh api --method=DELETE /repos/x/y/issues/1" })).toBe(true);
    expect(isBlocked({ command: "gh api -XPATCH /repos/x/y" })).toBe(true);
  });

  it("blocks destructive git (reset --hard, push, branch -D)", () => {
    expect(isBlocked({ command: "git reset --hard HEAD~1" })).toBe(true);
    expect(isBlocked({ command: "git push origin main" })).toBe(true);
    expect(isBlocked({ command: "git branch -D feature" })).toBe(true);
  });

  it("blocks destructive git hidden behind global flags (-C, --git-dir)", () => {
    expect(isBlocked({ command: "git -C /tmp/repo push origin main" })).toBe(true);
    expect(isBlocked({ command: "git --git-dir=.git push origin main" })).toBe(true);
    expect(isBlocked({ command: "git -c user.name=x reset --hard HEAD" })).toBe(true);
  });

  it("allows local rebase lifecycle while leaving destructive cleanup blocked", () => {
    expect(isBlocked({ command: "git rebase origin/main" })).toBe(false);
    expect(isBlocked({ command: "git -c core.editor=true rebase --continue" })).toBe(false);
    expect(isBlocked({ command: "git rebase --abort" })).toBe(false);
    expect(isBlocked({ command: "git clean -fd" })).toBe(true);
    expect(isBlocked({ command: "git filter-branch -- --all" })).toBe(true);
  });

  it("blocks a raw op behind an env/VAR=VAL prefix", () => {
    expect(isBlocked({ command: "env GIT_SSH=x git push origin main" })).toBe(true);
    expect(isBlocked({ command: "FOO=bar gh pr close 1" })).toBe(true);
  });

  it("blocks curl and wget", () => {
    expect(isBlocked({ command: "curl -X POST https://api.example.com" })).toBe(true);
    expect(isBlocked({ command: "wget https://example.com/x" })).toBe(true);
  });

  it("allows read-only git and gh (not heavy-handed)", () => {
    expect(isBlocked({ command: "git status" })).toBe(false);
    expect(isBlocked({ command: "git log --oneline" })).toBe(false);
    expect(isBlocked({ command: "git ls-files" })).toBe(false);
    expect(isBlocked({ command: "git -C /tmp/repo status" })).toBe(false);
    expect(isBlocked({ command: "gh pr view 1" })).toBe(false);
    expect(isBlocked({ command: "gh api /repos/x/y" })).toBe(false);
  });

  it("allows unrecognised commands", () => {
    expect(isBlocked({ command: "node build.js" })).toBe(false);
  });

  it("allows a would-be-blocked command under the SLOPWEAVER_ALLOW_RAW escape", () => {
    const verdict = classifyRawCommand({ allowRaw: true, command: "gh pr close 1" });
    expect(verdict.blocked).toBe(false);
    expect(verdict.tool).toBe("gh");
  });
});
