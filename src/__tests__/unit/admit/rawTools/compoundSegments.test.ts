/*
 * `classifyRawCommand` on a compound command: every segment is classified on its own, so a dangerous later segment
 * is caught, and an inline override reaches only the segment it sits on.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand } from "../../../../admit/rawTools.js";
import { isBlocked } from "./harness.js";

describe("classifyRawCommand", () => {
  describe("segment-aware compound commands", () => {
    // Regression coverage for the segment-blindness this classifier used to have: it resolved
    // `gitSubcommand`/`toolName` from the WHOLE command's token stream starting at index 0, so a second,
    // later segment's own operation was never independently examined — see `raw-tool-guard-segment-blind-
    // classification` on the handover board.

    it("catches a destructive git push hidden behind an earlier read-only git invocation", () => {
      // The flagship reproduction: the old classifier read `status` as `git push`'s own subcommand and
      // never saw `push` at all, so this passed unblocked regardless of the escape hatch.
      expect(isBlocked({ command: "git status && git push" })).toBe(true);
    });

    it("catches an external request hidden behind a leading cd, not just a leading git", () => {
      // The same shape this module's own header names for `toolName` specifically: `cd` is read as the
      // tool and the real operation past `&&` was never re-examined.
      expect(isBlocked({ command: "cd /tmp && curl -X POST https://api.example.com" })).toBe(true);
    });

    it("still allows an all-read-only compound command", () => {
      expect(isBlocked({ command: "git status && git log --oneline" })).toBe(false);
    });

    it("an inline override on the segment that actually needs it allows the whole command", () => {
      const verdict = classifyRawCommand({ allowRaw: false, command: "git status && SLOPWEAVER_ALLOW_RAW=1 git push" });
      expect(verdict.blocked).toBe(false);
      expect(verdict.tool).toBe("git");
    });

    it("an inline override on a DIFFERENT, harmless segment does not wave through the real dangerous one", () => {
      // The exact regression the segment-blind classifier's whole-command inline-override check risked once
      // relaxed without this fix first: an override scoped to `git status` must never authorise `git push`.
      expect(isBlocked({ command: "SLOPWEAVER_ALLOW_RAW=1 git status && git push" })).toBe(true);
    });

    it("an export override before a pipe does not survive into the piped segment", () => {
      // A pipe's right side runs in its own subshell fork — same rule `mainCheckoutCommandTarget.js`'s own
      // `cwdAfterCd` already encodes for `cd`, applied here to the override's scope instead.
      expect(isBlocked({ command: "export SLOPWEAVER_ALLOW_RAW=1 | git push" })).toBe(true);
    });

    it("an export override before && DOES survive to the next segment", () => {
      const verdict = classifyRawCommand({ allowRaw: false, command: "export SLOPWEAVER_ALLOW_RAW=1 && git push" });
      expect(verdict.blocked).toBe(false);
      expect(verdict.tool).toBe("git");
    });

    it("a real newline inside a quoted gh graphql query is never mistaken for a segment separator", () => {
      // The splitter that makes the above possible must stay quote-aware — a naive whitespace-blind split on
      // `\n` would cut this single read query into two fake segments and misclassify it.
      expect(isBlocked({ command: "gh api graphql -f query='query Read {\n  viewer { login }\n}'" })).toBe(false);
    });
  });
});
