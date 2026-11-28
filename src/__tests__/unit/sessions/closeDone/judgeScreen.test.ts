/**
 * What a done-chat seat's screen says: idle, busy, queued, or unreadable — and an unreadable one is never idle.
 */
import { describe, expect, it } from "vitest";

import { judgeScreen } from "../../../../sessions/screenVerdict.js";

describe("judgeScreen", () => {
  it("reads a screen with no markers as idle", () => {
    expect(judgeScreen({ screen: "> \n? for shortcuts" })).toBe("idle");
  });

  it("reads a running turn as busy", () => {
    expect(judgeScreen({ screen: "Thinking… (esc to interrupt)" })).toBe("busy");
  });

  it("reads a background shell or a Monitor on an at-rest footer as busy", () => {
    expect(judgeScreen({ screen: "❯ \n  ⏵⏵ bypass permissions on · 1 shell · esc to interrupt" })).toBe("busy");
    expect(judgeScreen({ screen: "❯ \n  ⏵⏵ bypass permissions on · 1 monitor" })).toBe("busy");
    expect(judgeScreen({ screen: "❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)" })).toBe("idle");
  });

  it("reads a queued line as queued, ahead of busy", () => {
    expect(judgeScreen({ screen: "esc to interrupt\nPress up to edit queued messages" })).toBe("queued");
  });

  it("reads an unreadable screen as unreadable, never idle", () => {
    expect(judgeScreen({ screen: undefined })).toBe("unreadable");
  });
});

/**
 * A synthetic retired chair: an Edit diff whose blank source line renders as its bare line number, and a bullet
 * alone on its line, both higher up a transcript that ends on Claude Code's idle prompt and footer. Either line,
 * read as Codex's, is a background terminal or a running turn.
 */
const TRANSCRIPT_WITH_CODEX_SHAPED_LINES = [
  "⏺ Update(notes.md)",
  "      41  - an earlier line",
  "      42 ",
  "      43 +- an added line",
  "•",
  "⏺ Done.",
  "",
  "✻ Cogitated for 27s",
  "───────────────────────",
  "❯ ",
  "───────────────────────",
].join("\n");

describe("judgeScreen with a host's composer at the bottom", () => {
  it("reads only Claude Code's markers when its footer is the bottom, so transcript lines shaped like Codex's do not hold the seat", () => {
    const screen = `${TRANSCRIPT_WITH_CODEX_SHAPED_LINES}\n  ⏵⏵ bypass permissions on (shift+tab to cycle)`;
    expect(judgeScreen({ screen })).toBe("idle");
  });

  it("still reads a real background shell on Claude Code's footer as busy over the same transcript", () => {
    const screen = `${TRANSCRIPT_WITH_CODEX_SHAPED_LINES}\n  ⏵⏵ bypass permissions on · 1 shell`;
    expect(judgeScreen({ screen })).toBe("busy");
  });

  it("still reads Claude Code's running turn as busy over the same transcript", () => {
    const screen = `${TRANSCRIPT_WITH_CODEX_SHAPED_LINES}\n  ⏵⏵ bypass permissions on · esc to interrupt`;
    expect(judgeScreen({ screen })).toBe("busy");
  });

  // A bare bullet is Codex's queued header and its running line cut to nothing, so queued wins.
  it("holds the same lines on a screen with no host's composer at the bottom", () => {
    expect(judgeScreen({ screen: "$ cat diff.txt\n      42 \n$ " })).toBe("busy");
    expect(judgeScreen({ screen: "$ printf '•\\n'\n•" })).toBe("queued");
  });

  it("holds a Codex screen on its own background terminal count", () => {
    const screen = [
      "  1 background terminal running · /ps to view · /stop to close",
      "",
      "› ",
      "",
      "  GPT-5.6-Sol default · ~/dev/repo",
    ].join("\n");
    expect(judgeScreen({ screen })).toBe("busy");
  });
});
