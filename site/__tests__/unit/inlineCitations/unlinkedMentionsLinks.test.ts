import { describe, expect, it } from "vitest";

import { resolveInline, unlinkedMentions } from "../../../lib/inlineCitations";
import { TEAM } from "./fixtures";

describe("resolveInline's unlinked mentions: a mention with no resolvable target is a lint finding", () => {
  it("resolves a link's label and a spelling before an address against the sentence's other addresses", () => {
    const pull = "https://github.com/acme/repo/pull/12";
    expect(resolveInline({ references: TEAM, text: `[#12](https://example.com) and ${pull}` })).toEqual({
      segments: [
        { kind: "cite", label: "#12", url: pull },
        { kind: "text", text: " " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
        { kind: "text", text: " and " },
        { kind: "cite", label: "#12", url: pull },
      ],
      unlinked: [],
    });
    expect(resolveInline({ references: TEAM, text: `PR 12 https://example.com and ${pull}` }).unlinked).toEqual([]);
  });

  it("reads a known team's key in a link's label in any case, so a mixed-case one is named apart", () => {
    expect(resolveInline({ references: TEAM, text: "[IiI-9](https://example.com)" })).toEqual({
      segments: [
        { kind: "text", text: "IiI-9 " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
      ],
      unlinked: [{ kind: "linear", label: "IiI-9" }],
    });
  });

  it("names a range's far end written just before an address, and chips it when the row carries its own", () => {
    expect(resolveInline({ references: TEAM, text: "PRs 12-13 https://example.com" })).toEqual({
      segments: [
        { kind: "text", text: "PRs 12-13 " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
      ],
      unlinked: [
        { kind: "github", label: "PRs 12" },
        { kind: "github", label: "#13" },
      ],
    });
    const known = ["https://github.com/acme/repo/pull/12", "https://github.com/acme/repo/pull/13"];
    expect(resolveInline({ known, references: TEAM, text: "PRs 12-13 https://example.com" })).toEqual({
      segments: [
        { kind: "cite", label: "PRs 12", url: known[0] },
        { kind: "text", text: "-" },
        { kind: "cite", label: "13", url: known[1] },
        { kind: "text", text: " " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
      ],
      unlinked: [],
    });
  });

  it("reads a leading-zero PR 0N as the pull request N its address or the row carries", () => {
    const pull = "https://github.com/acme/repo/pull/12";
    expect(resolveInline({ text: `PR 012 ${pull}` })).toEqual({
      segments: [
        { kind: "text", text: "PR 012 " },
        { kind: "cite", label: "#12", url: pull },
      ],
      unlinked: [],
    });
    expect(resolveInline({ known: [pull], text: "see PR 012" })).toEqual({
      segments: [
        { kind: "text", text: "see " },
        { kind: "cite", label: "PR 012", url: pull },
      ],
      unlinked: [],
    });
    // A `#0N` keeps its zero on the chip while it links N, alone or beside its own address.
    expect(resolveInline({ known: [pull], text: "#012" })).toEqual({
      segments: [{ kind: "cite", label: "#012", url: pull }],
      unlinked: [],
    });
    expect(resolveInline({ text: `#012 (${pull}) and #012 ${pull}` })).toEqual({
      segments: [
        { kind: "cite", label: "#012", url: pull },
        { kind: "text", text: " and " },
        { kind: "cite", label: "#012", url: pull },
      ],
      unlinked: [],
    });
    expect(resolveInline({ text: "#12 (https://github.com/acme/repo/pull/012)" }).unlinked).toEqual([]);
    const padded = "https://github.com/acme/repo/pull/012";
    expect(resolveInline({ known: [padded], text: "repo#12" })).toEqual({
      segments: [{ kind: "cite", label: "repo#12", url: padded }],
      unlinked: [],
    });
    expect(resolveInline({ text: `<${padded}|#12>` })).toEqual({
      segments: [{ kind: "cite", label: "#12", url: padded }],
      unlinked: [],
    });
    const issue = "https://linear.app/acme/issue/III-09";
    expect(resolveInline({ known: [issue], references: TEAM, text: "III-9" })).toEqual({
      segments: [{ kind: "cite", label: "III-9", url: issue }],
      unlinked: [],
    });
  });

  it("names pull request#N once, never its request#N again as a repository's", () => {
    expect(resolveInline({ text: "pull request#12 and PR#13" }).unlinked).toEqual([
      { kind: "github", label: "pull request#12" },
      { kind: "github", label: "PR#13" },
    ]);
  });

  it("reads a slug's #12-notes as words, carried or not, like PR-12-seed", () => {
    const known = ["https://github.com/acme/repo/pull/12"];
    expect(resolveInline({ known, text: "#12-notes" })).toEqual({
      segments: [{ kind: "text", text: "#12-notes" }],
      unlinked: [],
    });
    expect(resolveInline({ text: "#12-notes" }).unlinked).toEqual([]);
    const slugs =
      "acme-admin#12-notes, acme/repo#12-notes, issue acme/repo#12-notes, PR acme-admin 12-notes, #12-éclair, #12-\u0301clair, PR-12-été, PR-12-34-notes, PR 12-34-notes, PR 12–34-notes, PRs 12 — 34-notes, PR 12–34\u0301clair, PR 12–34clair, PRs #12–34clair, acme-admin PR 12–34é, acme/repo#12-34-notes, acme/repo#12-34, issue acme/repo#12-34, acme-admin#12-34, acme/repo#12-34éclair, #12éclair, PR 12éclair and QQQQ-134-über";
    expect(resolveInline({ text: slugs })).toEqual({ segments: [{ kind: "text", text: slugs }], unlinked: [] });
    expect(resolveInline({ known, text: slugs })).toEqual({ segments: [{ kind: "text", text: slugs }], unlinked: [] });
  });

  it("reads a repository's dash-joined number as prose whatever the dash, a range only after a PR word", () => {
    const known = ["https://github.com/acme/repo/pull/12", "https://github.com/acme/acme-admin/pull/12"];
    const spans =
      "acme/repo#12–34, acme/repo#12 – 34, issue acme/repo#12—34, PR acme/repo#12–34, acme-admin#12–34, acme-admin #12–34, acme-admin 12-34, acme-admin 12–34, acme-admin 12-notes and PR acme-admin 12–34";
    expect(resolveInline({ known, text: spans })).toEqual({ segments: [{ kind: "text", text: spans }], unlinked: [] });
    expect(resolveInline({ known, text: "acme-admin 12 and acme-admin PR 12–13" })).toEqual({
      segments: [
        { kind: "cite", label: "acme-admin 12", url: "https://github.com/acme/acme-admin/pull/12" },
        { kind: "text", text: " and " },
        { kind: "cite", label: "acme-admin PR 12", url: "https://github.com/acme/acme-admin/pull/12" },
        { kind: "text", text: "–13" },
      ],
      unlinked: [{ kind: "github", label: "#13" }],
    });
  });

  it("takes back a spelling's finding once the address after it resolves it, and chips a prose-led PR N", () => {
    const pull = "https://github.com/owner/repo/pull/1";
    expect(resolveInline({ text: "PR 1 owner/repo#1" })).toEqual({
      segments: [
        { kind: "cite", label: "PR 1", url: pull },
        { kind: "text", text: " " },
        { kind: "cite", label: "owner/repo#1", url: pull },
      ],
      unlinked: [],
    });
    expect(resolveInline({ text: "see PR 12 owner/repo#12" })).toEqual({
      segments: [
        { kind: "text", text: "see " },
        { kind: "cite", label: "PR 12", url: "https://github.com/owner/repo/pull/12" },
        { kind: "text", text: " " },
        { kind: "cite", label: "owner/repo#12", url: "https://github.com/owner/repo/pull/12" },
      ],
      unlinked: [],
    });
    expect(resolveInline({ text: "see PR 12 https://example.com" }).unlinked).toEqual([
      { kind: "github", label: "PR 12" },
    ]);
  });

  it("reads a known team's key before a spaced #N or PR N as the ticket, never as its repository", () => {
    expect(resolveInline({ references: TEAM, text: "III-1 #12, then QQQQ-2 PR 13" }).unlinked).toEqual([
      { kind: "linear", label: "III-1" },
      { kind: "github", label: "#12" },
      { kind: "linear", label: "QQQQ-2" },
      { kind: "github", label: "PR 13" },
    ]);
  });

  it("counts a zero-padded #0N as the one-digit #N it names, prose", () => {
    expect(resolveInline({ text: "option #01 and step#01" }).unlinked).toEqual([]);
    expect(resolveInline({ text: "#012" }).unlinked).toEqual([{ kind: "github", label: "#12" }]);
  });

  it("reads an unresolved glued step#N whole, never its #N against another repository's address", () => {
    expect(resolveInline({ known: ["https://github.com/acme/other/pull/12"], text: "step#12" })).toEqual({
      segments: [{ kind: "text", text: "step#12" }],
      unlinked: [{ kind: "github", label: "step#12" }],
    });
  });

  it("reads a #N glued inside a word of any script as prose, a repository being ASCII", () => {
    const glued = "café#12, 仓库#12, repó#12 and caféstep#12";
    expect(resolveInline({ text: glued })).toEqual({ segments: [{ kind: "text", text: glued }], unlinked: [] });
    expect(resolveInline({ text: "café #12" }).unlinked).toEqual([{ kind: "github", label: "#12" }]);
  });

  it("splits a link whose label is a key the row carries from its address, never a key it does not", () => {
    const known = ["https://linear.app/acme/issue/UTF-8"];
    const apart = [
      { kind: "cite", label: "utf-8", url: "https://linear.app/acme/issue/UTF-8" },
      { kind: "text", text: " " },
      { kind: "cite", label: "example.com", url: "https://example.com" },
    ];
    expect(resolveInline({ known, text: "[utf-8](https://example.com)" })).toEqual({ segments: apart, unlinked: [] });
    expect(resolveInline({ known, text: "<https://example.com|utf-8>" })).toEqual({ segments: apart, unlinked: [] });
    expect(resolveInline({ known, text: "[utf-16](https://example.com)" })).toEqual({
      segments: [{ kind: "cite", label: "utf-16", url: "https://example.com" }],
      unlinked: [],
    });
  });

  it("names a spaced plural PRs #1 at one digit, never the compact PRs#1", () => {
    expect(resolveInline({ text: "PRs #1" }).unlinked).toEqual([{ kind: "github", label: "PRs #1" }]);
    expect(resolveInline({ text: "PRs#1" }).unlinked).toEqual([]);
  });

  it("reads a compact repo#N the same before an address as anywhere else, PRs#N a repository's N", () => {
    expect(
      resolveInline({ references: TEAM, text: "acme-admin#12 https://example.com and PRs#13 https://example.com" }),
    ).toEqual({
      segments: [
        { kind: "text", text: "acme-admin#12 " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
        { kind: "text", text: " and PRs#13 " },
        { kind: "cite", label: "example.com", url: "https://example.com" },
      ],
      unlinked: [
        { kind: "github", label: "acme-admin#12" },
        { kind: "github", label: "PRs#13" },
      ],
    });
    expect(resolveInline({ references: TEAM, text: "acme-admin#12 and PRs#13" }).unlinked).toEqual([
      { kind: "github", label: "acme-admin#12" },
      { kind: "github", label: "PRs#13" },
    ]);
  });

  it("chips a PR N written before a different pull request's address when the row carries its own", () => {
    const pull = (n: number): string => `https://github.com/acme/repo/pull/${n}`;
    const resolution = resolveInline({ known: [pull(123)], references: TEAM, text: `PR 123 (${pull(124)})` });
    expect(resolution.segments).toEqual([
      { kind: "cite", label: "PR 123", url: pull(123) },
      { kind: "text", text: " (" },
      { kind: "cite", label: "#124", url: pull(124) },
      { kind: "text", text: ")" },
    ]);
    expect(resolution.unlinked).toEqual([]);
  });

  it("names a PR N that labels another site's link, drawn as words beside that site's chip", () => {
    const resolution = resolveInline({ references: TEAM, text: "[PR 12](https://example.com)" });
    expect(resolution.segments).toEqual([
      { kind: "text", text: "PR 12 " },
      { kind: "cite", label: "example.com", url: "https://example.com" },
    ]);
    expect(resolution.unlinked).toEqual([{ kind: "github", label: "PR 12" }]);
  });

  it("names a compact PR#N or repo#N, and a PR repo N, that a second read would never find", () => {
    const text =
      "[PR#41](https://github.com/acme/repo/pull/42), acme-admin#43, PR acme-admin 5, PR acme-admin #6 and acme-admin #47";
    expect(resolveInline({ references: TEAM, text }).unlinked).toEqual([
      { kind: "github", label: "PR#41" },
      { kind: "github", label: "acme-admin#43" },
      { kind: "github", label: "PR acme-admin 5" },
      { kind: "github", label: "PR acme-admin #6" },
      { kind: "github", label: "#47" },
    ]);
  });

  it("names nothing in a link whose label agrees with its address", () => {
    expect(resolveInline({ references: TEAM, text: "[#124](https://github.com/acme/repo/pull/124)" }).unlinked).toEqual(
      [],
    );
  });

  it("gathers every sentence's findings, once each across them", () => {
    expect(
      unlinkedMentions({ references: TEAM, texts: ["#17376 is red", "still #17376 and QQQQ-9", "all clear"] }),
    ).toEqual([
      { kind: "github", label: "#17376" },
      { kind: "linear", label: "QQQQ-9" },
    ]);
  });
});
