/*
 * The console's semantic tones: every word the CSS used to colour one rule at a time, and the stated fallback
 * for a word the verb has started printing since.
 */
import { describe, expect, it } from "vitest";

import {
  pullRequestActionTone,
  pullRequestCiTone,
  pullRequestWatchTone,
  seatTone,
  toneVariant,
} from "../../lib/consoleTone";

describe("pullRequestCiTone", () => {
  it("draws green as success, red as danger and running as warning", () => {
    expect(pullRequestCiTone({ ci: "green" })).toBe("success");
    expect(pullRequestCiTone({ ci: "red" })).toBe("danger");
    expect(pullRequestCiTone({ ci: "running" })).toBe("warning");
  });

  it("draws a word it does not know as info rather than in no colour", () => {
    expect(pullRequestCiTone({ ci: "queued" })).toBe("info");
  });
});

describe("pullRequestActionTone", () => {
  it("draws press as success", () => {
    expect(pullRequestActionTone({ action: "press" })).toBe("success");
  });

  it("draws every fleet repair as warning", () => {
    expect(pullRequestActionTone({ action: "conflicting" })).toBe("warning");
    expect(pullRequestActionTone({ action: "spawn-ci" })).toBe("warning");
    expect(pullRequestActionTone({ action: "spawn-coderabbit" })).toBe("warning");
  });

  it("draws a move only a human can make as danger", () => {
    expect(pullRequestActionTone({ action: "blocked-on" })).toBe("danger");
    expect(pullRequestActionTone({ action: "answer-threads" })).toBe("danger");
  });

  it("draws a Slack sync as neutral, never the danger of the blocked-on it stands in for", () => {
    expect(pullRequestActionTone({ action: "sync-slack" })).toBe("neutral");
  });

  it("draws a draft as neutral and an unknown act as info", () => {
    expect(pullRequestActionTone({ action: "draft" })).toBe("neutral");
    expect(pullRequestActionTone({ action: "rebase" })).toBe("info");
  });
});

describe("pullRequestWatchTone", () => {
  it("draws each watch state in its own tone", () => {
    expect(pullRequestWatchTone({ watch: "watched" })).toBe("success");
    expect(pullRequestWatchTone({ watch: "stale" })).toBe("warning");
    expect(pullRequestWatchTone({ watch: "unknown" })).toBe("danger");
    expect(pullRequestWatchTone({ watch: "none" })).toBe("neutral");
  });
});

describe("seatTone", () => {
  it("draws a seated pull request as info", () => {
    expect(seatTone({ kind: "seated" })).toBe("info");
  });

  it("draws a pull request a channel has, nobody named, as info, never the danger of a pause", () => {
    expect(seatTone({ kind: "shared" })).toBe("info");
  });

  it("draws paused and nobody as danger", () => {
    expect(seatTone({ kind: "paused" })).toBe("danger");
    expect(seatTone({ kind: "nobody" })).toBe("danger");
  });

  it("draws a seat this machine cannot place as neutral", () => {
    expect(seatTone({ kind: "unattended" })).toBe("neutral");
    expect(seatTone({ kind: "unmatched" })).toBe("neutral");
    expect(seatTone({ kind: "unknown" })).toBe("neutral");
  });

  it("draws a seat whose Slack history is too stale to know whether anyone was asked as neutral, never danger", () => {
    expect(seatTone({ kind: "stale-history" })).toBe("neutral");
  });
});

describe("toneVariant", () => {
  it("draws neutral as the muted pill and every hue by its own name", () => {
    expect(toneVariant({ tone: "neutral" })).toBe("muted");
    expect(toneVariant({ tone: "info" })).toBe("info");
    expect(toneVariant({ tone: "success" })).toBe("success");
    expect(toneVariant({ tone: "warning" })).toBe("warning");
    expect(toneVariant({ tone: "danger" })).toBe("danger");
  });
});
