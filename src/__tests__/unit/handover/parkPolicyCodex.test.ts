/**
 * Parking a foreign seat a Codex host holds — every screen a verbatim capture from the measurement
 * (`../../fixtures/codexTui.ts`). Before it, a Codex holder was `unreadable` however idle it visibly was.
 */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { parkSeatRefusal } from "../../../handover/parkPolicy.js";
import { closeForceDecision } from "../../../sessions/closeForce.js";
import {
  CODEX_AFTER_INTERRUPT,
  CODEX_IDLE_AFTER_TURNS,
  CODEX_IDLE_BOOT,
  CODEX_QUEUED,
  CODEX_RUNNING,
  CODEX_TRUST_MENU,
} from "../../fixtures/codexTui.js";

/** One live, unpinned workspace. */
function workspace({ id, dir }: { id: string; dir: string }): CmuxWorkspaceSummary {
  return {
    currentDirectory: dir,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
    windowId: "window-1",
    workspaceId: `id-${id}`,
    workspaceRef: `workspace:${id}`,
  };
}

const CHAIR_ID = "id-1";
const SEAT = workspace({ dir: "/wt/codex-seat", id: "238" });

/** The refusal for one screen on the foreign Codex seat. */
function refusalFor({ screen }: { screen: string }): ReturnType<typeof parkSeatRefusal> {
  return parkSeatRefusal({ callerWorkspaceId: CHAIR_ID, holderHost: "codex", screen, target: SEAT });
}

describe("parkSeatRefusal on a foreign Codex seat", () => {
  it("parks one whose own composer is at rest", () => {
    expect(refusalFor({ screen: CODEX_IDLE_AFTER_TURNS })).toBe(undefined);
    expect(refusalFor({ screen: CODEX_IDLE_BOOT })).toBe(undefined);
  });

  it("refuses one mid-turn, and one with a line queued behind the turn", () => {
    expect(refusalFor({ screen: CODEX_RUNNING })).toEqual({ kind: "mid-turn", queued: false });
    expect(refusalFor({ screen: CODEX_QUEUED })).toEqual({ kind: "mid-turn", queued: true });
  });

  it("refuses one whose background terminal outlived the turn, and one showing a menu", () => {
    expect(refusalFor({ screen: CODEX_AFTER_INTERRUPT })).toEqual({
      kind: "background-work",
      work: { monitors: 0, shells: 1 },
    });
    expect(refusalFor({ screen: CODEX_TRUST_MENU })).toEqual({ kind: "unreadable" });
  });

  it("refuses one whose live terminal sits under a Claude-shaped footer it printed", () => {
    const screen = [
      "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
      "  1 background terminal running · /ps to view · /stop to close",
      "› Ask Codex to do anything",
      "  GPT-5.6-Sol default · ~/repo",
    ].join("\n");
    expect(refusalFor({ screen })).toEqual({ kind: "background-work", work: { monitors: 0, shells: 1 } });
    expect(closeForceDecision({ screen })).toEqual({ kind: "held", verdict: "busy" });
  });
});

describe("parkSeatRefusal on a foreign Claude Code seat that printed Codex's markers", () => {
  it("still parks it, because a Claude holder is read by Claude Code's own markers only", () => {
    const screen = [
      "⏺ Quoted status:",
      "• Working (8s)",
      "• Messages to be submitted after next tool call",
      "",
      "❯ ",
      "────────────────",
      "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
    ].join("\n");
    expect(parkSeatRefusal({ callerWorkspaceId: CHAIR_ID, holderHost: "claude-code", screen, target: SEAT })).toBe(
      undefined,
    );
  });
});
