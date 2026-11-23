/**
 * `turnBusy` — pure, so every measured screen shape is a plain call.
 *
 * The four fixtures below are verbatim captures from a live measurement (a scratch cmux
 * workspace running Claude Code 2.1.241, parked mid-turn on a foreground command), not screens written to
 * suit the matchers. That distinction is the whole point of this file: the bug being fixed was a verb that
 * reported `submitted` for a line the real surface was visibly holding in a queue, so a test built from
 * invented screens could pass while production still could not read the one screen that matters.
 */
import { describe, expect, it } from "vitest";

import {
  classifySendDisposition,
  describeSendDisposition,
  queuedMessageIsAssertable,
  screenShowsQueuedMessage,
  screenShowsRunningTurn,
} from "../../../cmux/turnBusy.js";

/** A session that has finished its turn and is waiting for input. */
const IDLE_SCREEN = [
  "⏺ REACHED",
  "",
  "✻ Baked for 6s · done 9:55 pm",
  "",
  "───────────────────────────────────────────────────────────────────",
  "❯ ",
  "───────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents",
].join("\n");

/** A session mid-turn on a foreground command, with nothing waiting behind it. */
const RUNNING_SCREEN = [
  "✻ Vibing… (19s · ↓ 140 tokens)",
  "  ⎿  Tip: Send messages to Claude while it works to steer Claude in real-time",
  "",
  "───────────────────────────────────────────────────────────────────",
  "❯ ",
  "───────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3 agents",
].join("\n");

/** The same session one second after a `cmux send` — the line is visibly held, not accepted. */
const QUEUED_SCREEN = [
  "  ❯ QUEUE MARKER PROBE: reply with the single word REACHED.",
  "",
  "───────────────────────────────────────────────────────────────────",
  "❯ Press up to edit queued messages",
  "───────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3 agents",
].join("\n");

/** The same session three seconds after one `escape`. */
const INTERRUPTED_SCREEN = [
  "⏺ Running the 200s foreground python sleep now.",
  "",
  "  Ran 1 shell command ",
  "  ⎿  Interrupted · What should Claude do instead?",
  "",
  "───────────────────────────────────────────────────────────────────",
  "❯ ",
  "───────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents",
].join("\n");

/** A surface that never booted a host at all — the workspace is a bare shell. */
const BARE_SHELL_SCREEN = ["some-worktree $ ", ""].join("\n");

describe("screenShowsRunningTurn", () => {
  it("sees the running turn on a session parked mid-command", () => {
    expect(screenShowsRunningTurn({ screen: RUNNING_SCREEN })).toBe(true);
  });

  it("still sees it while a line is queued behind that turn", () => {
    expect(screenShowsRunningTurn({ screen: QUEUED_SCREEN })).toBe(true);
  });

  it("sees no running turn once the turn was interrupted", () => {
    expect(screenShowsRunningTurn({ screen: INTERRUPTED_SCREEN })).toBe(false);
  });

  it("sees no running turn on an idle session", () => {
    expect(screenShowsRunningTurn({ screen: IDLE_SCREEN })).toBe(false);
  });

  it("treats an unreadable screen as no running turn, so nothing is interrupted on a guess", () => {
    expect(screenShowsRunningTurn({ screen: undefined })).toBe(false);
  });
});

describe("screenShowsQueuedMessage", () => {
  it("sees the queued line one second after the send", () => {
    expect(screenShowsQueuedMessage({ screen: QUEUED_SCREEN })).toBe(true);
  });

  it("sees none on a session that is merely busy", () => {
    expect(screenShowsQueuedMessage({ screen: RUNNING_SCREEN })).toBe(false);
  });

  it("sees none on an idle session", () => {
    expect(screenShowsQueuedMessage({ screen: IDLE_SCREEN })).toBe(false);
  });
});

describe("queuedMessageIsAssertable", () => {
  it("can read a queued line off Claude Code", () => {
    expect(queuedMessageIsAssertable({ host: "claude-code" })).toBe(true);
  });

  it("reads one off codex, whose queued header was measured live", () => {
    expect(queuedMessageIsAssertable({ host: "codex" })).toBe(true);
  });
});

describe("classifySendDisposition", () => {
  it("calls a line held behind a running turn queued", () => {
    expect(classifySendDisposition({ screen: QUEUED_SCREEN })).toBe("queued");
  });

  it("calls a line submitted when a recognised host is holding nothing", () => {
    expect(classifySendDisposition({ screen: IDLE_SCREEN })).toBe("submitted");
  });

  it("calls a send onto a now-busy session submitted, because busy alone is what success looks like", () => {
    expect(classifySendDisposition({ screen: RUNNING_SCREEN })).toBe("submitted");
  });

  it("refuses to guess when the screen could not be read", () => {
    expect(classifySendDisposition({ screen: undefined })).toBe("unknown");
  });

  it("refuses to guess about a surface it cannot recognise as a readable host", () => {
    expect(classifySendDisposition({ screen: BARE_SHELL_SCREEN })).toBe("unknown");
  });
});

describe("describeSendDisposition", () => {
  it("names the flag that would have delivered a queued line", () => {
    expect(describeSendDisposition({ disposition: "queued", interrupted: false, workspaceRef: "workspace:12" })).toBe(
      "cmux send: QUEUED behind a running turn on workspace:12 — it lands only when that turn ends; pass --interrupt to stop the turn and deliver now",
    );
  });

  it("reports a plain submitted send", () => {
    expect(
      describeSendDisposition({ disposition: "submitted", interrupted: false, workspaceRef: "workspace:12" }),
    ).toBe("cmux send: submitted to workspace:12");
  });

  it("does not tell a caller who already passed --interrupt to pass it, and says what queued instead", () => {
    expect(describeSendDisposition({ disposition: "queued", interrupted: true, workspaceRef: "workspace:12" })).toBe(
      "cmux send: interrupted the running turn and QUEUED behind a running turn on workspace:12 — a turn that started after the interrupt — most likely an earlier queued line the interrupt released; send again to interrupt that one too",
    );
  });

  it("says an interrupt happened when one did", () => {
    expect(describeSendDisposition({ disposition: "submitted", interrupted: true, workspaceRef: "workspace:12" })).toBe(
      "cmux send: interrupted the running turn and submitted to workspace:12",
    );
  });

  it("admits it could not tell rather than claiming a submit", () => {
    expect(describeSendDisposition({ disposition: "unknown", interrupted: false, workspaceRef: "workspace:12" })).toBe(
      "cmux send: delivered to workspace:12, but the screen could not say whether it was submitted or queued behind a running turn",
    );
  });
});
