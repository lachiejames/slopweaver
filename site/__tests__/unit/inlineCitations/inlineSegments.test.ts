import { describe, expect, it } from "vitest";

import { inlineSegments } from "../../../lib/inlineCitations";
import { ACME_ADMIN_QUESTION, pr } from "./fixtures";

describe("inlineSegments", () => {
  it("folds every #N (URL) and #N URL of the acme-admin question into its number, and links the bare repeats", () => {
    expect(inlineSegments({ text: ACME_ADMIN_QUESTION })).toEqual([
      { kind: "text", text: "Should the fleet bump " },
      { kind: "cite", label: "#16676", url: pr({ n: 16676 }) },
      { kind: "text", text: " and send " },
      { kind: "cite", label: "#16670", url: pr({ n: 16670 }) },
      { kind: "text", text: " its first review ask now, or hold each until the PR below it lands (" },
      { kind: "cite", label: "#16672", url: pr({ n: 16672 }) },
      { kind: "text", text: ", " },
      { kind: "cite", label: "#16367", url: pr({ n: 16367 }) },
      { kind: "text", text: ")? " },
      { kind: "cite", label: "#17560", url: pr({ n: 17560 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "#16672", url: pr({ n: 16672 }) },
      {
        kind: "text",
        text: ", the two red ones in the doc, are now 93/93 green with CodeRabbit clean on their content, and ",
      },
      { kind: "cite", label: "#16672", url: pr({ n: 16672 }) },
      { kind: "text", text: " was chased last week." },
    ]);
  });

  it("reads a bare pull-request URL as its number, leaving the sentence's full stop outside it", () => {
    expect(inlineSegments({ text: `Landed as ${pr({ n: 17560 })}.` })).toEqual([
      { kind: "text", text: "Landed as " },
      { kind: "cite", label: "#17560", url: pr({ n: 17560 }) },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps a tab on the URL it links, so a diff link still opens the diff", () => {
    expect(inlineSegments({ text: `see ${pr({ n: 1 })}/files` })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "#1", url: `${pr({ n: 1 })}/files` },
    ]);
  });

  it("folds a number with a trailing-slash address into one link", () => {
    expect(inlineSegments({ text: `#9 (${pr({ n: 9 })}/)` })).toEqual([
      { kind: "cite", label: "#9", url: `${pr({ n: 9 })}/` },
    ]);
  });

  it("links a bare number only through a pull request the row publishes", () => {
    expect(inlineSegments({ known: [pr({ n: 1233 })], text: "Built on #1233." })).toEqual([
      { kind: "text", text: "Built on " },
      { kind: "cite", label: "#1233", url: pr({ n: 1233 }) },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves a number no pull request carries as words — option #1 is a position", () => {
    expect(inlineSegments({ text: "Take option #1." })).toEqual([{ kind: "text", text: "Take option #1." }]);
  });

  it("leaves a number two repositories both claim as words rather than guessing", () => {
    const known = [pr({ n: 12 }), "https://github.com/lachiejames/slopweaver/pull/12"];
    expect(inlineSegments({ known, text: "See #12." })).toEqual([{ kind: "text", text: "See #12." }]);
  });

  it("never links a number to the URL of a DIFFERENT pull request, and still draws that URL as its own chip", () => {
    expect(inlineSegments({ text: `#5 (${pr({ n: 6 })}) is wrong` })).toEqual([
      { kind: "text", text: "#5 (" },
      { kind: "cite", label: "#6", url: pr({ n: 6 }) },
      { kind: "text", text: ") is wrong" },
    ]);
  });

  it("draws nothing for an empty sentence", () => {
    expect(inlineSegments({ text: "" })).toEqual([]);
  });

  it("links the incident heading's `acme-admin 17564` through the pull request the row carries, as written", () => {
    expect(
      inlineSegments({ known: [pr({ n: 17564 })], text: "Open acme-admin 17564: every screenshot above the fold?" }),
    ).toEqual([
      { kind: "text", text: "Open " },
      { kind: "cite", label: "acme-admin 17564", url: pr({ n: 17564 }) },
      { kind: "text", text: ": every screenshot above the fold?" },
    ]);
  });

  it("links an owner-qualified `acme/acme-admin 17564` only when the owner matches too", () => {
    const text = "see acme/acme-admin 17564 and other-org/acme-admin 17564";
    expect(inlineSegments({ known: [pr({ n: 17564 })], text })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "acme/acme-admin 17564", url: pr({ n: 17564 }) },
      { kind: "text", text: " and other-org/acme-admin 17564" },
    ]);
  });

  it("leaves `repo N` as words when the row's pull request is another repository's same number", () => {
    const text = "Open slopweaver 17564.";
    expect(inlineSegments({ known: [pr({ n: 17564 })], text })).toEqual([{ kind: "text", text }]);
  });

  it("leaves a counted noun as words — `CI 93` and `5 servers` name nothing", () => {
    const text = "CI 93 of 5 servers";
    expect(inlineSegments({ known: [pr({ n: 93 })], text })).toEqual([{ kind: "text", text }]);
  });

  it("never links one of the row's repositories then a number it has no pull request for — `slopweaver #N`", () => {
    const known = [pr({ n: 17564 }), "https://github.com/lachiejames/slopweaver/pull/99"];
    const text = "Merge slopweaver PR 17564, slopweaver PR #17564 and slopweaver #17564 today";
    expect(inlineSegments({ known, text })).toEqual([{ kind: "text", text }]);
  });

  it("links a repository then `PR N` or `#N` when the row's pull request is that repository's", () => {
    expect(
      inlineSegments({ known: [pr({ n: 1275 })], text: "Merge acme-admin PR 1275, then Acme-Admin #1275." }),
    ).toEqual([
      { kind: "text", text: "Merge " },
      { kind: "cite", label: "acme-admin PR 1275", url: pr({ n: 1275 }) },
      { kind: "text", text: ", then " },
      { kind: "cite", label: "Acme-Admin #1275", url: pr({ n: 1275 }) },
      { kind: "text", text: "." },
    ]);
  });

  it("links a `PR N` naming no repository to the one address carried for it", () => {
    const one = "https://github.com/lachiejames/slopweaver/pull/478";
    expect(
      inlineSegments({
        known: [one],
        text: "Merge other-org/infra PR 478, then the PR 478, PR #478 and pull request 478",
      }),
    ).toEqual([
      { kind: "text", text: "Merge other-org/infra PR 478, then the " },
      { kind: "cite", label: "PR 478", url: one },
      { kind: "text", text: ", " },
      { kind: "cite", label: "PR #478", url: one },
      { kind: "text", text: " and " },
      { kind: "cite", label: "pull request 478", url: one },
    ]);
    expect(inlineSegments({ known: [one, pr({ n: 478 })], text: "the PR 478" })).toEqual([
      { kind: "text", text: "the PR 478" },
    ]);
    expect(inlineSegments({ text: "the PR 478" })).toEqual([{ kind: "text", text: "the PR 478" }]);
  });

  it("still links a `#N` after a word that names no repository the row carries — `follow-up #5`, `UTC-5 #5`", () => {
    expect(inlineSegments({ known: [pr({ n: 5 })], text: "the follow-up #5, UTC-5 #5" })).toEqual([
      { kind: "text", text: "the follow-up " },
      { kind: "cite", label: "#5", url: pr({ n: 5 }) },
      { kind: "text", text: ", UTC-5 " },
      { kind: "cite", label: "#5", url: pr({ n: 5 }) },
    ]);
  });

  it("leaves `#N (URL)` to fold itself when a repository is written before it, printing no address twice", () => {
    expect(inlineSegments({ text: `acme-admin #5 (${pr({ n: 5 })}) and acme-admin #6 (${pr({ n: 5 })})` })).toEqual([
      { kind: "text", text: "acme-admin " },
      { kind: "cite", label: "#5", url: pr({ n: 5 }) },
      { kind: "text", text: " and acme-admin #6 (" },
      { kind: "cite", label: "#5", url: pr({ n: 5 }) },
      { kind: "text", text: ")" },
    ]);
  });

  it("links `owner/repo#N` as written with no address needed, since the spelling names the repository", () => {
    expect(inlineSegments({ text: "lachiejames/slopweaver#1075 landed" })).toEqual([
      {
        kind: "cite",
        label: "lachiejames/slopweaver#1075",
        url: "https://github.com/lachiejames/slopweaver/pull/1075",
      },
      { kind: "text", text: " landed" },
    ]);
  });

  it("reads a Linear issue address as its key, and links the bare key that address names elsewhere", () => {
    const issue = "https://linear.app/acme/issue/EEEE-840/let-ev-test-run";
    expect(inlineSegments({ text: `Filed as ${issue}. EEEE-840 blocks it.` })).toEqual([
      { kind: "text", text: "Filed as " },
      { kind: "cite", label: "EEEE-840", url: issue },
      { kind: "text", text: ". " },
      { kind: "cite", label: "EEEE-840", url: "https://linear.app/acme/issue/EEEE-840" },
      { kind: "text", text: " blocks it." },
    ]);
  });

  it("leaves a key-shaped word no Linear address names as words — `UTC-5`, `ISO-8601`, an unknown ticket", () => {
    const text = "UTC-5 per ISO-8601, see JJJJ-1642";
    expect(inlineSegments({ known: ["https://linear.app/acme/issue/EEEE-840"], text })).toEqual([
      { kind: "text", text },
    ]);
  });

  it("still finds a key a failed `word N` match began at — `EEEE-840 5` links its key", () => {
    const issue = "https://linear.app/acme/issue/EEEE-840";
    expect(inlineSegments({ known: [issue], text: "EEEE-840 5 times" })).toEqual([
      { kind: "cite", label: "EEEE-840", url: issue },
      { kind: "text", text: " 5 times" },
    ]);
  });
});
