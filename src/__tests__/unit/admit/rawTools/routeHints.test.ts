/*
 * `classifyRawCommand`'s route hints: a blocked command names the governed verb that really performs it, and names
 * none when no verb does, rather than pointing at one that cannot.
 */
import { describe, expect, it } from "vitest";

import { RAW_ESCAPE } from "../../../../admit/rawTools.js";
import { blockedMessage } from "./harness.js";

describe("classifyRawCommand", () => {
  describe("route hints", () => {
    it("points a raw git push at the github command", () => {
      expect(blockedMessage({ command: "git push origin main" })).toContain("/slopweaver:github");
    });

    it("points a covered gh pr mutation at the github command", () => {
      expect(blockedMessage({ command: "gh pr edit 1 --title new-title" })).toContain("/slopweaver:github");
    });

    it("points gh pr edit --add-reviewer at the real request-review verb, not the title/description one", () => {
      const message = blockedMessage({ command: "gh pr edit 1 --add-reviewer someone" });
      expect(message).toContain("github pr request-review");
      expect(message).not.toContain("/slopweaver:github");
    });

    it("points gh pr edit --base at the real retarget verb, not the title/description one", () => {
      const message = blockedMessage({ command: "gh pr edit 1 --base main" });
      expect(message).toContain("github pr retarget");
      expect(message).not.toContain("/slopweaver:github");
    });

    it("points gh run rerun --failed at the governed rerun verb", () => {
      const message = blockedMessage({ command: "gh run rerun 36945592960 --repo acme/acme-admin --failed" });
      expect(message).toContain("`slopweaver github rerun --repo <owner/name> --run-id <id>`");
      expect(message).not.toContain("this one has none yet");
    });

    it("points gh pr reopen at the governed cycle verb", () => {
      const message = blockedMessage({ command: "gh pr reopen 9876 --repo acme/acme-admin" });
      expect(message).toContain("`slopweaver github cycle --repo <owner/name> --number <n>`");
      expect(message).not.toContain("this one has none yet");
    });

    it("keeps the generic hint for a whole-run or single-job gh run rerun, which github rerun does not do", () => {
      for (const command of ["gh run rerun 1", "gh run rerun 1 --job 2"]) {
        const message = blockedMessage({ command });
        expect(message).not.toContain("slopweaver github rerun");
        expect(message).toContain("this one has none yet");
      }
    });

    it("does NOT point an uncovered gh mutation at the github command — no verb performs it", () => {
      const message = blockedMessage({ command: "gh release delete v1.0.0" });
      expect(message).not.toContain("/slopweaver:github");
      expect(message).toContain(RAW_ESCAPE);
    });

    it("does NOT point gh pr close/comment/review/lock/unlock at the github command — measured false claim, fixed", () => {
      // A cross-session finding: this list previously claimed these six were covered when
      // `slopweaver github pr` has never had an update path for any of them.
      for (const command of [
        "gh pr close 1",
        "gh pr reopen 1",
        "gh pr comment 1 --body hi",
        "gh pr review 1 --approve",
        "gh pr lock 1",
        "gh pr unlock 1",
      ]) {
        const message = blockedMessage({ command });
        expect(message).not.toContain("/slopweaver:github");
        expect(message).toContain(RAW_ESCAPE);
      }
    });

    it("does NOT point a local destructive git op at the github command — no verb performs it", () => {
      const message = blockedMessage({ command: "git reset --hard HEAD~1" });
      expect(message).not.toContain("/slopweaver:github");
      expect(message).toContain(RAW_ESCAPE);
    });

    it("keeps curl/wget provider-neutral", () => {
      const message = blockedMessage({ command: "curl -X POST https://api.example.com" });
      expect(message).not.toContain("/slopweaver:github");
      expect(message).toContain(RAW_ESCAPE);
    });

    it("falls back to the generic hint for a compound command, rather than misnaming a push", () => {
      // A second, unrelated `push` token past a `||` can be misread as this git invocation's own subcommand
      // — the real destructive operation here is `reset --hard`, which `/slopweaver:github` cannot perform.
      const message = blockedMessage({ command: "git --version\npush || true\ngit reset --hard HEAD~1" });
      expect(message).not.toContain("/slopweaver:github");
      expect(message).toContain(RAW_ESCAPE);
    });
  });
});
