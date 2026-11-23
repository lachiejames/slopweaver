import { describe, expect, it } from "vitest";
import {
  addressMarkers,
  findingHeader,
  findingTitle,
  isCoderabbit,
  replyCommitCitation,
  reviewBodyCounts,
} from "../../../review/coderabbitYieldEvidence.js";

// Opener shapes copied from two real pull requests, the prompt block trimmed.
const CURRENT_OPENER = [
  "_🎯 Functional Correctness_ | _🟡 Minor_ | _⚡ Quick win_",
  "",
  "**State that the 60-word limit applies to each section.**",
  "",
  "<!-- cr-indicator-types:potential_issue -->",
  "",
  "<!-- This is an auto-generated reply by CodeRabbit -->",
  "",
  "✅ Addressed in commits d554e5f to aa406db",
].join("\n");

describe("findingHeader", () => {
  it("reads category, severity and the indicator type off a current three-part header", () => {
    expect(findingHeader({ body: CURRENT_OPENER })).toEqual({
      category: "Functional Correctness",
      findingType: "potential-issue",
      rawHeader: "_🎯 Functional Correctness_ | _🟡 Minor_ | _⚡ Quick win_",
      severity: "minor",
    });
  });

  it("reads the type from a legacy two-part header and leaves category unknown", () => {
    expect(findingHeader({ body: "_⚠️ Potential issue_ | _🟠 Major_\n\n**Guard the null.**" })).toEqual({
      category: "unknown",
      findingType: "potential-issue",
      rawHeader: "_⚠️ Potential issue_ | _🟠 Major_",
      severity: "major",
    });
  });

  it("keeps Trivial rather than folding it into Minor", () => {
    expect(
      findingHeader({ body: "_📐 Maintainability & Code Quality_ | _🔵 Trivial_ | _⚡ Quick win_" }).severity,
    ).toBe("trivial");
  });

  it("answers unknown on every dimension when there is no header", () => {
    expect(findingHeader({ body: "Just a sentence." })).toEqual({
      category: "unknown",
      findingType: "unknown",
      rawHeader: "",
      severity: "unknown",
    });
  });
});

describe("findingTitle", () => {
  it("reads the bold summary under the header, and answers empty when there is none", () => {
    expect([
      findingTitle({ body: CURRENT_OPENER }),
      findingTitle({ body: "_🟠 Major_\n\nNo bold line, **only inline** bold." }),
    ]).toEqual(["State that the 60-word limit applies to each section.", ""]);
  });
});

describe("addressMarkers", () => {
  it("finds the plural commit marker CodeRabbit edits into its own opener", () => {
    const markers = addressMarkers({ comment: { authorLogin: "coderabbitai", body: CURRENT_OPENER, url: "u" } });
    expect(markers).toEqual([{ kind: "commit-marker", line: "✅ Addressed in commits d554e5f to aa406db" }]);
  });

  it("finds the confirmation marker", () => {
    const body = "text\n\n✅ Confirmed as addressed by @octocat";
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai[bot]", body, url: "u" } })).toEqual([
      { kind: "confirmed-marker", line: "✅ Confirmed as addressed by @octocat" },
    ]);
  });

  it("ignores a marker a person quoted, and one inside a code fence", () => {
    const quoted = "> ✅ Addressed in commit c9a58b8\n\nThat range is wrong.";
    const fenced = "```\n✅ Addressed in commit c9a58b8\n```";
    const tilde = "~~~text\n✅ Addressed in commit c9a58b8\n```\n~~~";
    const falseClose = "```text\n```not-a-closing-fence\n✅ Addressed in commit c9a58b8\n```";
    const indented = "Example output:\n\n    ✅ Addressed in commit c9a58b8";
    const lazy = "> Example of the bot output:\n✅ Addressed in commit c9a58b8";
    const pre = "Example output:\n\n<pre><code>\n\n✅ Addressed in commit c9a58b8\n</code></pre>";
    const htmlQuoted = "<blockquote>\n✅ Addressed in commit c9a58b8\n</blockquote>\n\n✅ Confirmed as addressed by @x";
    expect(addressMarkers({ comment: { authorLogin: "someone", body: quoted, url: "u" } })).toEqual([]);
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body: fenced, url: "u" } })).toEqual([]);
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body: tilde, url: "u" } })).toEqual([]);
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body: falseClose, url: "u" } })).toEqual([]);
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body: indented, url: "u" } })).toEqual([]);
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body: lazy, url: "u" } })).toEqual([]);
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body: pre, url: "u" } })).toEqual([]);
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body: htmlQuoted, url: "u" } })).toEqual([
      { kind: "confirmed-marker", line: "✅ Confirmed as addressed by @x" },
    ]);
  });

  it("does not take a generic 'resolved' line for a marker", () => {
    const body = "✅ Review thread resolved.";
    expect(addressMarkers({ comment: { authorLogin: "coderabbitai", body, url: "u" } })).toEqual([]);
  });
});

describe("replyCommitCitation", () => {
  it("finds the commit in the fleet's 'Fixed in' reply", () => {
    const body = "Fixed in `98ad962724`. The strip now matches real tag syntax.";
    expect(replyCommitCitation({ comment: { authorLogin: "octocat", body, url: "u" } })).toBe("98ad962724");
  });

  it("refuses a request id a reply quotes, a hex run with no commit cue, and a hex prefix of a longer word", () => {
    const uuid = "The failing request ID is 94c5152d-1234-4567-890a-123456789abc. No code change was made.";
    const uncued = "See 94c5152d9d for context.";
    const cuedUuid = "Fixed in 94c5152d-1234-4567-890a-123456789abc.";
    const cuedWord = "Fixed in 2026abc_preview, the deployed configuration version.";
    const cuedUnicode = "Fixed in 94c5152d9dβeta, the configuration label.";
    const cuedDash = "Fixed in 94c5152d9d‐preview, and 94c5152d9d.preview too.";
    expect(
      [uuid, uncued, cuedUuid, cuedWord, cuedUnicode, cuedDash].map((body) =>
        replyCommitCitation({ comment: { authorLogin: "alice", body, url: "u" } }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads a commit cue in its other shapes", () => {
    const bodies = [
      "Addressed by commit ABC1234f.",
      "commit 1a2b3c4 moved it",
      "Half taken in b6f67c80ee.",
      "Commit: 438538b20c.",
      "see https://github.com/o/r/commit/5d6e7f8a9b",
    ];
    expect(bodies.map((body) => replyCommitCitation({ comment: { authorLogin: "alice", body, url: "u" } }))).toEqual([
      "abc1234f",
      "1a2b3c4",
      "b6f67c80ee",
      "438538b20c",
      "5d6e7f8a9b",
    ]);
  });

  it("refuses a hex-letters-only word and an all-digit number", () => {
    const body = "Fixed in 1234567 records, commit deadbeef aside.";
    expect(replyCommitCitation({ comment: { authorLogin: "someone", body, url: "u" } })).toBe(undefined);
  });

  it("never reads CodeRabbit's own reply as a citation", () => {
    const body = "Thanks — 94c5152d9d looks right.";
    expect(replyCommitCitation({ comment: { authorLogin: "coderabbitai", body, url: "u" } })).toBe(undefined);
  });
});

describe("reviewBodyCounts", () => {
  it("reads the outer nitpick summary count, from a real shape", () => {
    const body = "<details>\n<summary>🧹 Nitpick comments (2)</summary><blockquote>\n<summary>a.ts (2)</summary>";
    expect(reviewBodyCounts({ body })).toEqual({ nitpicks: 2, outsideDiff: null });
  });

  it("reads an outside-diff count and answers null for an absent section", () => {
    expect(reviewBodyCounts({ body: "<summary>⚠️ Outside diff range comments (3)</summary>" })).toEqual({
      nitpicks: null,
      outsideDiff: 3,
    });
    expect(reviewBodyCounts({ body: "**Actionable comments posted: 4**" })).toEqual({
      nitpicks: null,
      outsideDiff: null,
    });
  });
});

describe("isCoderabbit", () => {
  it("matches CodeRabbit with or without the bot suffix, and nobody else", () => {
    expect([
      isCoderabbit({ login: "coderabbitai" }),
      isCoderabbit({ login: "CodeRabbitAI[bot]" }),
      isCoderabbit({ login: "renovate[bot]" }),
      isCoderabbit({ login: null }),
    ]).toEqual([true, true, false, false]);
  });
});
