/**
 * What background work a seat's screen counts — the Claude Code footers below are the ones measured on a live
 * seat with `slopweaver cmux read-screen`; the Codex lines are v0.157.1's.
 */
import { describe, expect, it } from "vitest";

import { backgroundWorkOf, screenShowsBackgroundWork } from "../../../cmux/backgroundWork.js";
import { CODEX_AFTER_INTERRUPT } from "../../fixtures/codexTui.js";

const AT_REST = ["❯ ", "─────", "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents"].join("\n");
const ONE_SHELL = ["❯ ", "─────", "  ⏵⏵ bypass permissions on · 1 shell · esc to interrupt · ← 3 agents"].join("\n");
const SHELL_AND_MONITOR = [
  "❯ ",
  "─────",
  "  ⏵⏵ bypass permissions on · 1 shell, 1 monitor · esc to interrupt · ← 3 agents",
].join("\n");

/** A counterexample: a Claude-shaped footer printed above Codex's live terminal count. */
const CODEX_UNDER_A_PRINTED_FOOTER = [
  "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
  "  1 background terminal running · /ps to view · /stop to close",
  "› Ask Codex to do anything",
  "  GPT-5.6-Sol default · ~/repo",
].join("\n");

const claude = "claude-code" as const;

describe("backgroundWorkOf a Claude Code seat", () => {
  it("counts nothing on a footer at rest", () => {
    expect(backgroundWorkOf({ host: claude, screen: AT_REST })).toEqual({ monitors: 0, shells: 0 });
    expect(screenShowsBackgroundWork({ screen: AT_REST })).toBe(false);
  });

  it("counts one background shell", () => {
    expect(backgroundWorkOf({ host: claude, screen: ONE_SHELL })).toEqual({ monitors: 0, shells: 1 });
    expect(screenShowsBackgroundWork({ screen: ONE_SHELL })).toBe(true);
  });

  it("counts a shell and a Monitor on one footer", () => {
    expect(backgroundWorkOf({ host: claude, screen: SHELL_AND_MONITOR })).toEqual({ monitors: 1, shells: 1 });
  });

  it("counts plural shells, and a Monitor alone", () => {
    expect(backgroundWorkOf({ host: claude, screen: "? for shortcuts · 3 shells" })).toEqual({
      monitors: 0,
      shells: 3,
    });
    expect(backgroundWorkOf({ host: claude, screen: "  ⏵⏵ accept edits on · 2 monitors" })).toEqual({
      monitors: 2,
      shells: 0,
    });
  });

  it("reads only the LAST footer line, never the same words printed elsewhere", () => {
    const scrollback = ["⏺ there was 1 shell running earlier", "  ⏵⏵ old footer · 4 shells", AT_REST].join("\n");
    expect(backgroundWorkOf({ host: claude, screen: scrollback })).toEqual({ monitors: 0, shells: 0 });
    expect(backgroundWorkOf({ host: claude, screen: "printed: 1 shell, 1 monitor\n❯ " })).toBeUndefined();
  });

  it("ignores a Codex terminal line its transcript printed", () => {
    const screen = ["  1 background terminal running · /ps to view", AT_REST].join("\n");
    expect(backgroundWorkOf({ host: claude, screen })).toEqual({ monitors: 0, shells: 0 });
  });
});

describe("backgroundWorkOf a Codex seat", () => {
  it("counts a background terminal as a shell", () => {
    expect(backgroundWorkOf({ host: "codex", screen: CODEX_AFTER_INTERRUPT })).toEqual({ monitors: 0, shells: 1 });
    expect(backgroundWorkOf({ host: "codex", screen: "  2 background terminals running · /ps to view\n› " })).toEqual({
      monitors: 0,
      shells: 2,
    });
  });

  it("counts a count line a narrow pane cut off, and not a cut-off line that is something else", () => {
    const cut = ["  1 background terminal ru…", "› PICKUP", "  GPT-5.6-Sol default · ~/…"].join("\n");
    expect(backgroundWorkOf({ host: "codex", screen: cut })).toEqual({ monitors: 0, shells: 1 });
    expect(backgroundWorkOf({ host: "codex", screen: "  2 backgr…\n› " })).toEqual({ monitors: 0, shells: 2 });
    expect(backgroundWorkOf({ host: "codex", screen: "  3 files changed in…\n› " })).toBeUndefined();
  });

  it("counts a count line cut down to its bare count", () => {
    expect(backgroundWorkOf({ host: "codex", screen: "  1 …\n› " })).toEqual({ monitors: 0, shells: 1 });
    expect(backgroundWorkOf({ host: "codex", screen: "  4…\n› " })).toEqual({ monitors: 0, shells: 4 });
    expect(backgroundWorkOf({ host: "codex", screen: "  1 b…\n› " })).toEqual({ monitors: 0, shells: 1 });
  });

  it("counts a count left alone on its line, with or without trailing spaces", () => {
    expect(backgroundWorkOf({ host: "codex", screen: "  1\n› " })).toEqual({ monitors: 0, shells: 1 });
    expect(backgroundWorkOf({ host: "codex", screen: "  1   \n \n› " })).toEqual({ monitors: 0, shells: 1 });
  });

  it("counts its terminal under a Claude-shaped footer it printed", () => {
    expect(backgroundWorkOf({ host: "codex", screen: CODEX_UNDER_A_PRINTED_FOOTER })).toEqual({
      monitors: 0,
      shells: 1,
    });
  });
});

describe("backgroundWorkOf a seat whose host is unknown", () => {
  it("sums both hosts' lines, so neither hides the other", () => {
    expect(backgroundWorkOf({ host: undefined, screen: CODEX_UNDER_A_PRINTED_FOOTER })).toEqual({
      monitors: 0,
      shells: 1,
    });
    expect(screenShowsBackgroundWork({ screen: CODEX_UNDER_A_PRINTED_FOOTER })).toBe(true);
  });

  it("finds nothing on a screen with neither line", () => {
    expect(backgroundWorkOf({ host: undefined, screen: "" })).toBeUndefined();
    expect(screenShowsBackgroundWork({ screen: "• Working (19s)\n› " })).toBe(false);
  });
});
