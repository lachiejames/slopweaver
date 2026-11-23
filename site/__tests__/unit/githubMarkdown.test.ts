/*
 * What a pull request body draws on GitHub that the console's renderer would not: a shields badge read from its own
 * address (and only a badge — any other picture stays undrawn), a named anchor that is a link target rather than a
 * blocked link, and GitHub's alert box. The plugin is exercised over hand-built hast, since Streamdown is the site's
 * dependency and not the root's.
 */

import { describe, expect, it } from "vitest";

import { badgeInk, type HastNode, rehypeGithubBody, shieldBadgeOf } from "../../lib/githubMarkdown";

/** Run the plugin over a root holding the given children, and hand back the children it left. */
function rendered({ children }: { children: HastNode[] }): HastNode[] {
  const root = { children, type: "root" } satisfies HastNode;
  rehypeGithubBody()(root);
  return root.children;
}

/** A hast element. */
function el({
  tag,
  properties = {},
  children = [],
}: {
  tag: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}): HastNode {
  return { children, properties, tagName: tag, type: "element" };
}

/** A hast text node. */
function text({ value }: { value: string }): HastNode {
  return { type: "text", value };
}

describe("shieldBadgeOf", () => {
  it("reads a label, a message and a hex colour off a static badge, decoding shields' escapes", () => {
    expect(
      shieldBadgeOf({ src: "https://img.shields.io/badge/solved-silver%20%C2%B7%202%20gaps-9ea7ad?style=flat" }),
    ).toEqual({ color: "#9ea7ad", label: "solved", labelColor: "#555555", message: "silver · 2 gaps", square: false });
    expect(shieldBadgeOf({ src: "https://img.shields.io/badge/a--b-c__d_e-red.svg" })).toEqual({
      color: "#e05d44",
      label: "a-b",
      labelColor: "#555555",
      message: "c_d e",
      square: false,
    });
  });

  it("reads a message-only badge and the query overrides", () => {
    expect(
      shieldBadgeOf({
        src: "https://img.shields.io/badge/passing-brightgreen?label=build&labelColor=000&style=flat-square",
      }),
    ).toEqual({ color: "#44cc11", label: "build", labelColor: "#000", message: "passing", square: true });
  });

  it("draws nothing for another host, a dynamic badge, or a colour that is not a known name or bare hex", () => {
    expect(shieldBadgeOf({ src: "https://example.com/badge/risk-low-green" })).toBeUndefined();
    expect(shieldBadgeOf({ src: "https://img.shields.io/github/stars/a/b" })).toBeUndefined();
    expect(shieldBadgeOf({ src: "https://img.shields.io/badge/risk-low-url(evil)" })).toBeUndefined();
    expect(shieldBadgeOf({ src: "https://img.shields.io/badge/risk-low-red?labelColor=red;x:y" })).toBeUndefined();
    expect(shieldBadgeOf({ src: "http://img.shields.io/badge/risk-low-red" })).toBeUndefined();
    expect(shieldBadgeOf({ src: "not a url" })).toBeUndefined();
  });
});

describe("badgeInk", () => {
  it("puts white on a mid ground and dark on a bright one, as shields does", () => {
    expect(badgeInk({ color: "#dbab09" })).toBe("#ffffff");
    expect(badgeInk({ color: "#9ea7ad" })).toBe("#ffffff");
    expect(badgeInk({ color: "#fff" })).toBe("#333333");
  });
});

describe("rehypeGithubBody", () => {
  it("swaps a badge image for two drawn spans, and leaves any other image for the media filter", () => {
    const badge = el({
      properties: { alt: "risk: unchecked", src: "https://img.shields.io/badge/risk-unchecked-dbab09?style=flat" },
      tag: "img",
    });
    const shot = el({
      properties: { alt: "a screenshot", src: "https://github.com/user-attachments/assets/x" },
      tag: "img",
    });
    const [drawn, kept] = rendered({ children: [badge, shot] });
    expect(drawn).toEqual(
      el({
        children: [
          el({
            children: [text({ value: "risk" })],
            properties: { className: ["gh-badge-part"], style: "background-color:#555555;color:#ffffff" },
            tag: "span",
          }),
          el({
            children: [text({ value: "unchecked" })],
            properties: { className: ["gh-badge-part"], style: "background-color:#dbab09;color:#ffffff" },
            tag: "span",
          }),
        ],
        properties: { ariaLabel: "risk: unchecked", className: ["gh-badge"], role: "img" },
        tag: "span",
      }),
    );
    expect(kept).toEqual(shot);
  });

  it("turns a named anchor into its target, nested inside a heading, and leaves a real link alone", () => {
    const heading = el({
      children: [el({ properties: { name: "problem" }, tag: "a" }), text({ value: "Problem" })],
      tag: "h3",
    });
    const link = el({ children: [text({ value: "x" })], properties: { href: "#problem" }, tag: "a" });
    expect(rendered({ children: [heading, link] })).toEqual([
      el({ children: [el({ properties: { id: "problem" }, tag: "span" }), text({ value: "Problem" })], tag: "h3" }),
      link,
    ]);
  });

  it("draws a marked blockquote as GitHub's alert, dropping the marker's emptied paragraph", () => {
    const quote = el({
      children: [
        text({ value: "\n" }),
        el({ children: [text({ value: "[!IMPORTANT]" })], tag: "p" }),
        el({ children: [text({ value: "Draft PR not reviewed" })], tag: "h2" }),
      ],
      tag: "blockquote",
    });
    expect(rendered({ children: [quote] })).toEqual([
      el({
        children: [
          el({ children: [text({ value: "Important" })], properties: { className: ["gh-alert-title"] }, tag: "p" }),
          text({ value: "\n" }),
          el({ children: [text({ value: "Draft PR not reviewed" })], tag: "h2" }),
        ],
        properties: { className: ["gh-alert", "gh-alert-important"] },
        tag: "div",
      }),
    ]);
  });

  it("keeps the text after a marker on the same paragraph, and leaves an unmarked or unknown quote a quote", () => {
    const quote = el({
      children: [el({ children: [text({ value: "[!NOTE]\nRead this." })], tag: "p" })],
      tag: "blockquote",
    });
    expect(rendered({ children: [quote] })).toEqual([
      el({
        children: [
          el({ children: [text({ value: "Note" })], properties: { className: ["gh-alert-title"] }, tag: "p" }),
          el({ children: [text({ value: "Read this." })], tag: "p" }),
        ],
        properties: { className: ["gh-alert", "gh-alert-note"] },
        tag: "div",
      }),
    ]);
    const plain = el({ children: [el({ children: [text({ value: "[!SHOUT] hi" })], tag: "p" })], tag: "blockquote" });
    expect(rendered({ children: [plain] })).toEqual([plain]);
  });
});
