import { describe, expect, it } from "vitest";

import { decideTitleRepair, fallbackTitleFor, isGenericWorkspaceTitle } from "../../../cmux/title.js";

describe("isGenericWorkspaceTitle", () => {
  it("catches the exact string four live rows were showing at once", () => {
    expect(isGenericWorkspaceTitle({ title: "✳ Claude Code" })).toBe(true);
    expect(isGenericWorkspaceTitle({ title: "◐ Claude Code" })).toBe(true);
    expect(isGenericWorkspaceTitle({ title: "◑ Claude Code" })).toBe(true);
  });

  it("catches a bare title with no glyph, and an empty one", () => {
    expect(isGenericWorkspaceTitle({ title: "Claude Code" })).toBe(true);
    expect(isGenericWorkspaceTitle({ title: "" })).toBe(true);
    expect(isGenericWorkspaceTitle({ title: "   " })).toBe(true);
  });

  it("catches the other hosts' defaults, and a bare shell", () => {
    expect(isGenericWorkspaceTitle({ title: "codex" })).toBe(true);
    expect(isGenericWorkspaceTitle({ title: "✳ zsh" })).toBe(true);
  });

  it("does NOT eat a real title that merely starts with the generic one", () => {
    expect(isGenericWorkspaceTitle({ title: "✳ Claude Code plugin loader bug" })).toBe(false);
    expect(isGenericWorkspaceTitle({ title: "Claude Code v2 migration" })).toBe(false);
  });

  it("leaves the good pane titles measured on the live fleet alone", () => {
    expect(isGenericWorkspaceTitle({ title: "◐ Cmux sidebar mockups and role tint" })).toBe(false);
    expect(isGenericWorkspaceTitle({ title: "✳ Live bot loop 26 aug" })).toBe(false);
    expect(isGenericWorkspaceTitle({ title: "✳ PR-15959 backtest proof handover" })).toBe(false);
  });
});

describe("decideTitleRepair", () => {
  it("pins the fallback on a bare row that nobody has renamed", () => {
    const repair = decideTitleRepair({
      fallbackTitle: "slopweaver-teamready-tests",
      hasCustomTitle: false,
      renderedTitle: "✳ Claude Code",
    });

    expect(repair).toStrictEqual({ kind: "set", title: "slopweaver-teamready-tests" });
  });

  it("leaves a pane title that says something, which is the case this exists to protect", () => {
    const repair = decideTitleRepair({
      fallbackTitle: "slopweaver-teamready-docs-structure",
      hasCustomTitle: false,
      renderedTitle: "✳ Sidebar mockups and role taxonomy",
    });

    expect(repair).toStrictEqual({ kind: "leave" });
  });

  it("never overrules a title somebody deliberately set, even a long one", () => {
    const repair = decideTitleRepair({
      customTitle: "recipe-scheduler: all 5 slots 26 Aug completed (24 total), idle",
      fallbackTitle: "recipe-scheduler",
      hasCustomTitle: true,
      renderedTitle: "recipe-scheduler: all 5 slots 26 Aug completed (24 total), idle",
    });

    expect(repair).toStrictEqual({ kind: "leave" });
  });

  it("leaves a chosen custom title alone even when the PANE underneath it went bare", () => {
    const repair = decideTitleRepair({
      customTitle: "Code-quality survey DONE — 17 items",
      fallbackTitle: "slopweaver-teamready-code-quality",
      hasCustomTitle: true,
      renderedTitle: "Code-quality survey DONE — 17 items",
    });

    expect(repair).toStrictEqual({ kind: "leave" });
  });

  it("still repairs a row whose custom title flag is set but whose title is blank", () => {
    const repair = decideTitleRepair({
      customTitle: "   ",
      fallbackTitle: "a-real-slug",
      hasCustomTitle: true,
      renderedTitle: "",
    });

    expect(repair).toStrictEqual({ kind: "set", title: "a-real-slug" });
  });

  it("refuses to replace a bare title with a blank fallback, which would be worse", () => {
    expect(decideTitleRepair({ fallbackTitle: "", hasCustomTitle: false, renderedTitle: "Claude Code" })).toStrictEqual(
      { kind: "leave" },
    );
    expect(
      decideTitleRepair({ fallbackTitle: "   ", hasCustomTitle: false, renderedTitle: "Claude Code" }),
    ).toStrictEqual({ kind: "leave" });
  });

  it("refuses a fallback that is itself generic, so a row cannot be repaired to the same thing", () => {
    const repair = decideTitleRepair({
      fallbackTitle: "claude code",
      hasCustomTitle: false,
      renderedTitle: "✳ Claude Code",
    });

    expect(repair).toStrictEqual({ kind: "leave" });
  });

  it("trims the fallback it pins", () => {
    const repair = decideTitleRepair({
      fallbackTitle: "  burst-queue-per-user  ",
      hasCustomTitle: false,
      renderedTitle: "Claude Code",
    });

    expect(repair).toStrictEqual({ kind: "set", title: "burst-queue-per-user" });
  });
});

describe("fallbackTitleFor", () => {
  it("reads the slug straight off a spawn's worktree path", () => {
    expect(
      fallbackTitleFor({
        currentDirectory: "/repos/slopweaver/.claude/worktrees/slopweaver-teamready-tests",
      }),
    ).toBe("slopweaver-teamready-tests");
  });

  it("tolerates a trailing slash", () => {
    expect(fallbackTitleFor({ currentDirectory: "/repos/thing/" })).toBe("thing");
  });

  it("names a plain checkout by its own directory", () => {
    expect(fallbackTitleFor({ currentDirectory: "/repos/some-repo" })).toBe("some-repo");
  });

  it("returns an empty string for a path with no segments, which decideTitleRepair then refuses", () => {
    expect(fallbackTitleFor({ currentDirectory: "/" })).toBe("");
    expect(fallbackTitleFor({ currentDirectory: "" })).toBe("");
  });
});
