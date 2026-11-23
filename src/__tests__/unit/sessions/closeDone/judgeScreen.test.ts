/**
 * What a done-chat seat's screen says: idle, busy, queued, or unreadable — and an unreadable one is never idle.
 */
import { describe, expect, it } from "vitest";

import { judgeScreen } from "../../../../sessions/closeDone.js";

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
