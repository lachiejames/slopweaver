import { describe, expect, it } from "vitest";

import { type CardReferences, NO_CARD_REFERENCES, resolveInline } from "../../../lib/inlineCitations";
import { pr, TEAM } from "./fixtures";

describe("resolveInline's unlinked mentions: a mention with no resolvable target is a lint finding", () => {
  it("names a #N, a PR N and a known team's key that cite nothing, once each, first seen first", () => {
    expect(
      resolveInline({ references: TEAM, text: "III-204 blocks #17376 and PR 17380; III-204 again, #17376 too" })
        .unlinked,
    ).toEqual([
      { kind: "linear", label: "III-204" },
      { kind: "github", label: "#17376" },
      { kind: "github", label: "PR 17380" },
    ]);
  });

  it("names nothing a spelling does not claim: option #1, UTC-5, a port, a date, a bare number, an unknown team", () => {
    const text = "option #1 at UTC-5 on port 3001, 2026-09-27, CI 93, ISO-8601 and ABC-12";
    expect(resolveInline({ references: TEAM, text }).unlinked).toEqual([]);
  });

  it("names nothing a carried address resolves", () => {
    const known = [pr({ n: 17376 }), "https://linear.app/acme/issue/III-204"];
    expect(resolveInline({ known, references: TEAM, text: "III-204 blocks #17376" }).unlinked).toEqual([]);
  });

  it("names a #N kept as words beside a different pull request's address", () => {
    expect(
      resolveInline({
        references: TEAM,
        text: "#123 (https://github.com/acme/repo/pull/124) and #125 https://github.com/acme/repo/pull/126",
      }).unlinked,
    ).toEqual([
      { kind: "github", label: "#123" },
      { kind: "github", label: "#125" },
    ]);
  });

  it("names another repository's number and a range's far end once each, never twice", () => {
    expect(
      resolveInline({ references: TEAM, text: "see other-repo #4521 and PR 17380 – 17382, then #4521" }).unlinked,
    ).toEqual([
      { kind: "github", label: "#4521" },
      { kind: "github", label: "PR 17380" },
      { kind: "github", label: "#17382" },
    ]);
  });

  it("draws a link naming another target than its address as its label, then its address's own chip", () => {
    const text =
      "[#123](https://github.com/acme/repo/pull/124), <https://github.com/acme/repo/pull/126|III-9 and #125>";
    const resolution = resolveInline({ references: TEAM, text });
    expect(resolution.segments).toEqual([
      { kind: "text", text: "#123 " },
      { kind: "cite", label: "#124", url: "https://github.com/acme/repo/pull/124" },
      { kind: "text", text: ", III-9 and #125 " },
      { kind: "cite", label: "#126", url: "https://github.com/acme/repo/pull/126" },
    ]);
    expect(resolution.unlinked).toEqual([
      { kind: "github", label: "#123" },
      { kind: "linear", label: "III-9" },
      { kind: "github", label: "#125" },
    ]);
  });

  it("names a one-digit PR N and range end, which say what they are, and not a one-digit #N", () => {
    expect(resolveInline({ references: TEAM, text: "PR 9 and PR 7–8, but option #1" }).unlinked).toEqual([
      { kind: "github", label: "PR 9" },
      { kind: "github", label: "PR 7" },
      { kind: "github", label: "#8" },
    ]);
  });

  it("resolves a one-digit PR N and range end through home, never a one-digit #N", () => {
    const references: CardReferences = {
      ...NO_CARD_REFERENCES,
      attested: new Map([["acme/repo", 99]]),
      home: "acme/repo",
    };
    expect(resolveInline({ references, text: "PR 1–2, but #1 and PR 123" })).toEqual({
      segments: [
        { kind: "cite", label: "PR 1", url: "https://github.com/acme/repo/pull/1" },
        { kind: "text", text: "–" },
        { kind: "cite", label: "2", url: "https://github.com/acme/repo/pull/2" },
        { kind: "text", text: ", but #1 and PR 123" },
      ],
      unlinked: [{ kind: "github", label: "PR 123" }],
    });
  });

  it("names another repository's one-digit PR N, and not its one-digit #N", () => {
    expect(resolveInline({ references: TEAM, text: "other/repo PR 1 and other/repo #2" }).unlinked).toEqual([
      { kind: "github", label: "other/repo PR 1" },
    ]);
  });

  it("names a PR N written before a different pull request's address, and chips an owner/repo#N there, which needs none", () => {
    const text =
      "PR 123 (https://github.com/acme/repo/pull/124), acme/repo#7 https://github.com/acme/repo/pull/8 and PR 9 (https://github.com/acme/repo/pull/9)";
    const resolution = resolveInline({ references: TEAM, text });
    expect(resolution.unlinked).toEqual([{ kind: "github", label: "PR 123" }]);
    expect(resolution.segments.filter((segment) => segment.kind === "cite").map((segment) => segment.label)).toEqual([
      "#124",
      "acme/repo#7",
      "#8",
      "#9",
    ]);
  });

  it("names one unresolved target once, however it is cased or spelled", () => {
    expect(
      resolveInline({ references: TEAM, text: "PR 12 and pr 12, then #12, Pull Request 12, PRs #12, iii-9 and III-9" })
        .unlinked,
    ).toEqual([
      { kind: "github", label: "PR 12" },
      { kind: "linear", label: "iii-9" },
    ]);
  });

  it("names one repository-qualified target once, however its repository and number are joined", () => {
    expect(resolveInline({ text: "PR acme/repo 12 and acme/repo PR 12, then acme/repo#12" }).unlinked).toEqual([
      { kind: "github", label: "PR acme/repo 12" },
    ]);
  });

  it("names both ends of a range joined by any dash — a plain or non-breaking hyphen, a minus sign — and nothing in a hyphenated word", () => {
    expect(resolveInline({ text: "PR 7-8 and PRs 12\u201113, PRs 14\u221215, then pr-16360-rebase" }).unlinked).toEqual(
      [
        { kind: "github", label: "PR 7" },
        { kind: "github", label: "#8" },
        { kind: "github", label: "PRs 12" },
        { kind: "github", label: "#13" },
        { kind: "github", label: "PRs 14" },
        { kind: "github", label: "#15" },
      ],
    );
  });

  it("names both ends of a spaced-hash range, PRs #M–N and PR #M–N", () => {
    expect(resolveInline({ text: "PRs #12–13 and PR #14–15" }).unlinked).toEqual([
      { kind: "github", label: "PRs #12" },
      { kind: "github", label: "#13" },
      { kind: "github", label: "PR #14" },
      { kind: "github", label: "#15" },
    ]);
  });

  it("names both of two PR N spelled back to back, never reading the first number as a repository", () => {
    expect(resolveInline({ text: "PR 12 PR 13" }).unlinked).toEqual([
      { kind: "github", label: "PR 12" },
      { kind: "github", label: "PR 13" },
    ]);
  });

  it("names a known team's key written in lower or mixed case, and none of an unknown team's", () => {
    expect(resolveInline({ references: TEAM, text: "iii-9, IiI-10, then utc-5" }).unlinked).toEqual([
      { kind: "linear", label: "iii-9" },
      { kind: "linear", label: "IiI-10" },
    ]);
  });

  it("links a known team's key written in lower or mixed case through the workspace, as it is reported", () => {
    const references: CardReferences = { ...TEAM, linearWorkspace: "acme" };
    expect(resolveInline({ references, text: "iii-9, IiI-10, then utc-5" })).toEqual({
      segments: [
        { kind: "cite", label: "iii-9", url: "https://linear.app/acme/issue/III-9" },
        { kind: "text", text: ", " },
        { kind: "cite", label: "IiI-10", url: "https://linear.app/acme/issue/III-10" },
        { kind: "text", text: ", then utc-5" },
      ],
      unlinked: [],
    });
  });

  it("names an unresolved PR-N as a ticket when the install has a PR team, apart from the pull request PR N", () => {
    const references: CardReferences = { ...NO_CARD_REFERENCES, linearTeamKeys: ["PR"], linearWorkspace: undefined };
    expect(resolveInline({ references, text: "PR-12 and PR 12" }).unlinked).toEqual([
      { kind: "linear", label: "PR-12" },
      { kind: "github", label: "PR 12" },
    ]);
    expect(resolveInline({ references, text: "PR-012" }).unlinked).toEqual([{ kind: "linear", label: "PR-12" }]);
  });

  it("names a PR N written just before another site's address, and chips it when the row carries its own", () => {
    expect(resolveInline({ references: TEAM, text: "PR 12 https://example.com" })).toEqual({
      segments: [
        { kind: "text", text: "PR 12 " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
      ],
      unlinked: [{ kind: "github", label: "PR 12" }],
    });
    const known = ["https://github.com/acme/repo/pull/12"];
    expect(resolveInline({ known, references: TEAM, text: "PR 12 https://example.com" })).toEqual({
      segments: [
        { kind: "cite", label: "PR 12", url: known[0] },
        { kind: "text", text: " " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
      ],
      unlinked: [],
    });
  });

  it("names one unresolved target once whatever leading zeros its number is written with", () => {
    expect(resolveInline({ references: TEAM, text: "#12 and PR 012, then iii-9 and III-09" }).unlinked).toEqual([
      { kind: "github", label: "#12" },
      { kind: "linear", label: "iii-9" },
    ]);
    // Only the trailing number's zeros fold: a zero inside a repository or a team key names another one.
    expect(resolveInline({ text: "repo-012#34 and repo-12#34" }).unlinked).toEqual([
      { kind: "github", label: "repo-012#34" },
      { kind: "github", label: "repo-12#34" },
    ]);
    const teams: CardReferences = { ...TEAM, linearTeamKeys: ["A01", "A1"] };
    expect(resolveInline({ references: teams, text: "A01-09 and A1-9" }).unlinked).toEqual([
      { kind: "linear", label: "A01-9" },
      { kind: "linear", label: "A1-9" },
    ]);
  });
});
