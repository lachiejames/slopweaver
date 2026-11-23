/*
 * `classifyRawCommand` on a gh watch or poll shape: a `--watch` or a hand-rolled poll loop is blocked and pointed at
 * the checks verb, a one-shot read passes, and a run-id watch admits that no governed verb covers it yet.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand, RAW_ESCAPE } from "../../../../admit/rawTools.js";
import { blockedMessage, isBlocked } from "./harness.js";

describe("classifyRawCommand", () => {
  describe("gh watch/poll shapes route to the checks verb", () => {
    it("blocks `gh pr checks --watch`, naming the governed verb", () => {
      const message = blockedMessage({ command: "gh pr checks 392 --watch --interval 15" });
      expect(message).toContain("slopweaver github checks --number <n> --wait");
      expect(message).toContain(RAW_ESCAPE);
    });

    it("blocks a hand-rolled `until gh pr checks …` poll loop, with or without --watch", () => {
      expect(
        blockedMessage({ command: "until gh pr checks 15786 --json state -q '.[].bucket'; do sleep 15; done" }),
      ).toContain("slopweaver github checks --number <n> --wait");
      expect(isBlocked({ command: "while ! gh pr checks 15786; do sleep 15; done" })).toBe(true);
    });

    it("blocks the loop condition even with an intervening pipe inside the condition itself", () => {
      expect(
        isBlocked({
          command: "until gh pr checks 1 --json bucket -q '.[]|.bucket' | grep -q pass; do sleep 10; done",
        }),
      ).toBe(true);
    });

    it("allows a plain one-shot `gh pr checks <n>` — no loop, no --watch", () => {
      expect(isBlocked({ command: "gh pr checks 392" })).toBe(false);
    });

    it("allows `gh pr checks -w` — that flag opens the web browser, not watch mode", () => {
      expect(isBlocked({ command: "gh pr checks 392 -w" })).toBe(false);
    });

    it("blocks `gh run watch`, honestly admitting no governed verb covers a run id yet", () => {
      const message = blockedMessage({ command: "gh run watch 123456 --exit-status" });
      expect(message).not.toContain("slopweaver github checks");
      expect(message).toContain("no governed verb covers a workflow-run watch yet");
      expect(message).toContain(RAW_ESCAPE);
    });

    it("blocks `gh run view --watch` the same honest way", () => {
      const message = blockedMessage({ command: "gh run view 123456 --watch" });
      expect(message).not.toContain("slopweaver github checks");
      expect(message).toContain("no governed verb covers a workflow-run watch yet");
    });

    it("allows a plain `gh run view` with no --watch", () => {
      expect(isBlocked({ command: "gh run view 123456" })).toBe(false);
    });

    it("admits a watch shape under the escape hatch", () => {
      const verdict = classifyRawCommand({ allowRaw: true, command: "gh pr checks 392 --watch" });
      expect(verdict.blocked).toBe(false);
      expect(verdict.tool).toBe("gh");
    });

    it("admits a poll loop under a segment-scoped inline override", () => {
      const verdict = classifyRawCommand({
        allowRaw: false,
        command: "SLOPWEAVER_ALLOW_RAW=1 until gh pr checks 1; do sleep 5; done",
      });
      expect(verdict.blocked).toBe(false);
    });
  });
});
