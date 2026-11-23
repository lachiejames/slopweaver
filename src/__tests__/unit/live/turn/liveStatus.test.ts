/**
 * The screen-scrape heuristic behind the checklist's live in-flight detail — pure, so every case here is a
 * plain string in, a string (or `undefined`) out, with no cmux socket anywhere near it.
 */
import { describe, expect, it } from "vitest";
import { CLAMP_MARKER } from "../../../../live/turn/answer.js";
import { carriesInformation, liveStatusFromScreen } from "../../../../live/turn/liveStatus.js";

describe("liveStatusFromScreen", () => {
  it("is undefined for an empty screen", () => {
    expect(liveStatusFromScreen({ screen: "" })).toBe(undefined);
  });

  it("is undefined for a screen that is only whitespace", () => {
    expect(liveStatusFromScreen({ screen: "   \n\n\t\n  " })).toBe(undefined);
  });

  it("returns the one line a single-line screen has", () => {
    expect(liveStatusFromScreen({ screen: "Reading src/live/turn/answer.ts" })).toBe("Reading src/live/turn/answer.ts");
  });

  it("picks the LAST non-blank line, not the first", () => {
    const screen = ["$ slopweaver turn resume --dispatch abc", "reading the brief…", "checking open PRs now"].join(
      "\n",
    );
    expect(liveStatusFromScreen({ screen })).toBe("checking open PRs now");
  });

  it("ignores trailing blank lines and reads through them to the last real content", () => {
    const screen = "investigating the corpus for open PRs\n\n\n   \n";
    expect(liveStatusFromScreen({ screen })).toBe("investigating the corpus for open PRs");
  });

  it("is undefined when the ENTIRE screen is only a bare shell prompt", () => {
    expect(liveStatusFromScreen({ screen: "$ " })).toBe(undefined);
  });

  it.each(["$", ">", "%", "#", "❯", "›", "$  ", ""])(
    "treats a bare prompt-only line %j as uninformative and reads past it",
    (promptLine) => {
      const screen = `real work happened here\n${promptLine}`;
      expect(liveStatusFromScreen({ screen })).toBe("real work happened here");
    },
  );

  it("clamps a long line to the live-status cap, marking that it happened", () => {
    const long = "x".repeat(200);
    const result = liveStatusFromScreen({ screen: long });
    expect(result!.length).toBe(120);
    expect(result!.endsWith(CLAMP_MARKER)).toBe(true);
  });

  it("leaves a line at or under the cap untouched", () => {
    const exact = "y".repeat(120);
    expect(liveStatusFromScreen({ screen: exact })).toBe(exact);
  });

  it("skips the permission-mode footer chrome and reads through to the real work above it", () => {
    const screen = [
      "resolving the Cloudflare access request now",
      "",
      "⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents",
    ].join("\n");
    expect(liveStatusFromScreen({ screen })).toBe("resolving the Cloudflare access request now");
  });

  it("gives two genuinely different screens genuinely different status, not the same chrome line", () => {
    const chrome = "⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents";
    const cloudflareScreen = ["reading the parent Vanta control thread for context", "", chrome].join("\n");
    const whitelistScreen = ["adding the new responder to responders.json", "", chrome].join("\n");
    expect(liveStatusFromScreen({ screen: cloudflareScreen })).toBe(
      "reading the parent Vanta control thread for context",
    );
    expect(liveStatusFromScreen({ screen: whitelistScreen })).toBe("adding the new responder to responders.json");
  });

  it("skips a standalone agent-count chip line even without the permission-mode phrase", () => {
    const screen = ["still investigating", "→ 2 agents"].join("\n");
    expect(liveStatusFromScreen({ screen })).toBe("still investigating");
  });

  it("is undefined when the whole screen is chrome over a bare prompt", () => {
    const screen = ["$ ", "⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents"].join("\n");
    expect(liveStatusFromScreen({ screen })).toBe(undefined);
  });

  it("skips the horizontal-rule dividers Claude Code draws around its input box and footer", () => {
    const screen = [
      "✢ Incubating… (12m 5s · ↓ 37.6k tokens)",
      "",
      "─".repeat(88),
      "❯ ",
      "─".repeat(88),
      "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3 agents",
    ].join("\n");
    expect(liveStatusFromScreen({ screen })).toBe("✢ Incubating… (12m 5s · ↓ 37.6k tokens)");
  });

  /**
   * The exact screen measured off `workspace:548` (MEASURED DEFECT): a narrow terminal wraps
   * Claude Code's slash-command hint onto its OWN row, right-aligned, below both known chrome lines — the
   * regex the two cases above check does not reach it, so the raw scrape returned the literal string `/rc`
   * instead of the genuinely informative line above it.
   */
  it("skips the trailing slash-command hint row and reads through to the real work above it", () => {
    const screen = [
      "✢ Moonwalking… (5m 12s · ↓ 7.5k tokens · thinking more with high effort)",
      "❯\xa0",
      "─".repeat(83),
      "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3 agents",
      `${" ".repeat(78)}/rc`,
    ].join("\n");
    expect(liveStatusFromScreen({ screen })).toBe(
      "✢ Moonwalking… (5m 12s · ↓ 7.5k tokens · thinking more with high effort)",
    );
  });

  it("is undefined when the whole screen is chrome, including the slash-command hint row, over a bare prompt", () => {
    const screen = [
      "$ ",
      "─".repeat(83),
      "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3 agents",
      `${" ".repeat(78)}/rc`,
    ].join("\n");
    expect(liveStatusFromScreen({ screen })).toBe(undefined);
  });

  /**
   * MEASURED DEFECT (owner's #dev-team screenshot): a fresh-visible-session's last screen
   * line mixed real text with a divider run and its own cmux workspace name, and both rode straight into the
   * progress card — see `answer.test.ts`'s `stripCardNoise` suite for the seam that now catches this.
   */
  it("drops a divider run and an internal ask session key riding along in the last informative line", () => {
    const screen = `attaching the before/after proof image — ${"─".repeat(60)} ask-C_ASK-1788169792.593579`;
    expect(liveStatusFromScreen({ screen })).toBe("attaching the before/after proof image");
  });

  it("is undefined when the last informative line is nothing BUT a divider run and a session key", () => {
    const screen = `${"─".repeat(40)} review-C_REVIEW-1788134088.884069`;
    expect(liveStatusFromScreen({ screen })).toBe(undefined);
  });
});

describe("carriesInformation — the criterion that replaced the rule-character class", () => {
  it("refuses Claude Code's own input-box rule, the exact shape that reached a live card", () => {
    // MEASURED on ask C0SYN000009/1789344513.735589: `clampVisible`'s `stripCardNoise` removed
    // the long run at its seam and left the short one, so the card's detail was the single character `─`.
    const screen = ["found the CSM cadence; checking the calendar", `${"─".repeat(120)} ─`].join("\n");
    expect(liveStatusFromScreen({ screen })).toBe("found the CSM cadence; checking the calendar");
  });

  it.each(["─ ─", "· ─", "╭─────╮", "│ > │", "──", "─   ─", "»»", "···"])(
    "reads past the letterless line %j to the content above it",
    (letterless) => {
      expect(liveStatusFromScreen({ screen: `checking the Vanta vendor record\n${letterless}\n` })).toBe(
        "checking the Vanta vendor record",
      );
    },
  );

  it("keeps a line that mixes box-drawing WITH text — the criterion is letterless, not box-drawn", () => {
    expect(carriesInformation({ text: "│ reading the thread │" })).toBe(true);
  });

  it("counts a digit as information, so a bare count line still shows", () => {
    expect(carriesInformation({ text: "── 47 ──" })).toBe(true);
  });

  it("is false for a line of nothing but rules and spaces", () => {
    expect(carriesInformation({ text: "─── ─── " })).toBe(false);
  });
});
