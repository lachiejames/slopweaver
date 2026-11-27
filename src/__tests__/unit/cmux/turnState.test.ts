/**
 * `turnState` — every Codex case reads a verbatim capture from a live measurement
 * (`../../fixtures/codexTui.ts`), never a screen written to suit the classifier.
 */
import { describe, expect, it } from "vitest";

import {
  classifyTurnScreen,
  claudeComposerAtBottom,
  screenHostAtBottom,
  screenProvesAtRest,
} from "../../../cmux/turnState.js";
import {
  CODEX_AFTER_INTERRUPT,
  CODEX_IDLE_AFTER_TURNS,
  CODEX_IDLE_BOOT,
  CODEX_QUEUED,
  CODEX_RUNNING,
  CODEX_TRUST_MENU,
} from "../../fixtures/codexTui.js";
import { ONE_SHELL } from "../sessions/keepAliveChairFixture.js";

/** Claude Code at rest: its input box, a rule, its mode footer last. */
const CLAUDE_IDLE = [
  "⏺ REACHED",
  "",
  "───────────────────────────────────────────────────────────────────",
  "❯ ",
  "───────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents",
].join("\n");

describe("classifyTurnScreen on codex", () => {
  it("reads a freshly booted composer as idle", () => {
    expect(classifyTurnScreen({ host: "codex", screen: CODEX_IDLE_BOOT })).toBe("idle");
  });

  it("reads the composer after finished turns as idle", () => {
    expect(classifyTurnScreen({ host: "codex", screen: CODEX_IDLE_AFTER_TURNS })).toBe("idle");
  });

  it("reads the Working status line as running", () => {
    expect(classifyTurnScreen({ host: "codex", screen: CODEX_RUNNING })).toBe("running");
  });

  it("reads the measured queued header as queued, ahead of the running line beside it", () => {
    expect(classifyTurnScreen({ host: "codex", screen: CODEX_QUEUED })).toBe("queued");
  });

  it("reads a queued header and a Working line a narrow pane cut off as live, never idle", () => {
    const composer = ["› Ask Codex to do anything", " ", "  GPT-5.6-Sol default · ~/repo"];
    const queued = ["• Messages to be submitted after…", "  ↳ REVIEW-PICKUP", " ", ...composer].join("\n");
    const running = ["• Work…", " ", ...composer].join("\n");
    expect(classifyTurnScreen({ host: "codex", screen: queued })).toBe("queued");
    expect(classifyTurnScreen({ host: "codex", screen: running })).toBe("running");
    expect(screenProvesAtRest({ screen: queued })).toBe(false);
  });

  it("reads a status line cut down to its first letter as live", () => {
    const composer = ["› Ask Codex to do anything", " ", "  GPT-5.6-Sol default · ~/repo"];
    const wor = ["• Wor…", " ", ...composer].join("\n");
    const w = ["• W…", " ", ...composer].join("\n");
    const m = ["• M…", "  ↳ REVIEW-PICKUP", " ", ...composer].join("\n");
    expect(classifyTurnScreen({ host: "codex", screen: wor })).toBe("running");
    expect(classifyTurnScreen({ host: "codex", screen: w })).toBe("running");
    expect(classifyTurnScreen({ host: "codex", screen: m })).toBe("queued");
  });

  it("reads a status line cut down to its bare bullet as busy, never idle", () => {
    const composer = ["› Ask Codex to do anything", " ", "  GPT-5.6-Sol default · ~/repo"];
    const spaced = ["• …", " ", ...composer].join("\n");
    const tight = ["•…", " ", ...composer].join("\n");
    expect(classifyTurnScreen({ host: "codex", screen: spaced })).toBe("queued");
    expect(classifyTurnScreen({ host: "codex", screen: tight })).toBe("queued");
  });

  it("reads the bullet left alone on its line, with no ellipsis, as busy", () => {
    const composer = ["› Ask Codex to do anything", " ", "  GPT-5.6-Sol default · ~/repo"];
    expect(classifyTurnScreen({ host: "codex", screen: ["•", " ", ...composer].join("\n") })).toBe("queued");
    expect(classifyTurnScreen({ host: "codex", screen: ["•  ", " ", ...composer].join("\n") })).toBe("queued");
  });

  it("still reads a composer under a cut-off line that is not a status line as idle", () => {
    const screen = ["• Messages were…", " ", "› Ask Codex to do anything", " ", "  GPT-5.6-Sol default · ~/repo"];
    expect(classifyTurnScreen({ host: "codex", screen: screen.join("\n") })).toBe("idle");
  });

  it("does not call a screen idle while a background terminal outlives the turn", () => {
    expect(classifyTurnScreen({ host: "codex", screen: CODEX_AFTER_INTERRUPT })).toBe("unknown");
  });

  it("does not read the trust menu's selected item as a composer", () => {
    expect(classifyTurnScreen({ host: "codex", screen: CODEX_TRUST_MENU })).toBe("unknown");
  });

  it("does not borrow Claude Code's at-rest layout", () => {
    expect(classifyTurnScreen({ host: "codex", screen: CLAUDE_IDLE })).toBe("unknown");
  });

  it("refuses to guess about an unreadable screen", () => {
    expect(classifyTurnScreen({ host: "codex", screen: undefined })).toBe("unknown");
  });

  it("refuses to guess about a bare shell", () => {
    expect(classifyTurnScreen({ host: "codex", screen: "some-worktree $ \n" })).toBe("unknown");
  });

  // A `›` a command printed, above a shell prompt, is not the composer.
  it("does not read a printed `›` above a shell prompt as the composer", () => {
    const screen = "worktree $ printf '›\\nREVIEW-PICKUP\\n'\n›\nREVIEW-PICKUP\nworktree $";
    expect(classifyTurnScreen({ host: "codex", screen })).toBe("unknown");
    expect(screenProvesAtRest({ screen })).toBe(false);
  });

  // A shell whose prompt is `›` and whose last output is ` · `-joined is not Codex's footer.
  it("does not read a `›` shell prompt above ordinary command output as at rest", () => {
    const screen = ["› ./build &", "[1] 123", "›", "", "  build complete · success"].join("\n");
    expect(classifyTurnScreen({ host: "codex", screen })).toBe("unknown");
  });

  it("does not read a composer with text between it and the footer as at rest", () => {
    const screen = ["› Ask Codex to do anything", "  not the footer", "  GPT-5.6-Sol default · ~/repo"].join("\n");
    expect(classifyTurnScreen({ host: "codex", screen })).toBe("unknown");
  });
});

describe("classifyTurnScreen on claude-code", () => {
  it("reads its own footer layout as idle", () => {
    expect(classifyTurnScreen({ host: "claude-code", screen: CLAUDE_IDLE })).toBe("idle");
  });

  it("does not borrow Codex's composer", () => {
    expect(classifyTurnScreen({ host: "claude-code", screen: CODEX_IDLE_AFTER_TURNS })).toBe("unknown");
  });
});

describe("screenProvesAtRest", () => {
  it("accepts either host's own at-rest layout", () => {
    expect(screenProvesAtRest({ screen: CLAUDE_IDLE })).toBe(true);
    expect(screenProvesAtRest({ screen: CODEX_IDLE_AFTER_TURNS })).toBe(true);
  });

  it("refuses a Codex seat mid-turn, queued, or holding a background terminal", () => {
    expect(screenProvesAtRest({ screen: CODEX_RUNNING })).toBe(false);
    expect(screenProvesAtRest({ screen: CODEX_QUEUED })).toBe(false);
    expect(screenProvesAtRest({ screen: CODEX_AFTER_INTERRUPT })).toBe(false);
  });
});

describe("claudeComposerAtBottom", () => {
  it("finds the prompt above a footer counting a background shell, which screenProvesAtRest refuses", () => {
    expect(claudeComposerAtBottom({ screen: ONE_SHELL })).toBe(true);
    expect(screenProvesAtRest({ screen: ONE_SHELL })).toBe(false);
  });

  it("finds Claude's own idle layout and never Codex's composer", () => {
    expect(claudeComposerAtBottom({ screen: CLAUDE_IDLE })).toBe(true);
    expect(claudeComposerAtBottom({ screen: CODEX_IDLE_AFTER_TURNS })).toBe(false);
  });
});

describe("screenHostAtBottom", () => {
  it("names the host whose own composer layout is the bottom, mid-turn and with background work included", () => {
    const screens = [CLAUDE_IDLE, ONE_SHELL, CODEX_IDLE_BOOT, CODEX_IDLE_AFTER_TURNS, CODEX_RUNNING, CODEX_QUEUED];

    expect(screens.map((screen) => screenHostAtBottom({ screen }))).toEqual([
      "claude-code",
      "claude-code",
      "codex",
      "codex",
      "codex",
      "codex",
    ]);
  });

  it("names no host for a shell, a selection menu, or a footer printed above the last line", () => {
    const screens = ["$ ", "", CODEX_TRUST_MENU, `${CLAUDE_IDLE}\n$ `];

    expect(screens.map((screen) => screenHostAtBottom({ screen }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
