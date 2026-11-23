/**
 * `parkSeatRefusal` on the caller's OWN seat: its running turn is the park itself and never counts, but a line
 * queued behind it is input addressed to the seat that closing would drop. The queued screen below is a
 * measured park's own `screenTail`, cut to its last lines.
 */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { parkSeatRefusal, refusalShows } from "../../../handover/parkPolicy.js";
import { CODEX_QUEUED } from "../../fixtures/codexTui.js";

const OWN: CmuxWorkspaceSummary = {
  currentDirectory: "/wt/sign-in",
  description: undefined,
  latestConversationMessage: undefined,
  latestSubmittedAtIso: undefined,
  latestSubmittedMessage: undefined,
  pinned: false,
  selected: true,
  title: undefined,
  windowId: "window-1",
  workspaceId: "id-43",
  workspaceRef: "workspace:43",
};

/** The seat's own park running, the chair's relay queued in its composer. */
const OWN_PARK_WITH_QUEUED_RELAY = [
  "⏺ Park the run until after the 12:46Z proof window · 3s",
  "  ⎿  $ slopweaver handover park named-plan-boot --wake-at 2026-11-11T13:00:00Z",
  "",
  "❯ Relay of 1605 characters, sent as a file because a paste this long can",
  "  ctrl+enter to send now",
  "",
  "✶ Considering… (2m 39s · ↓ 4.1k tokens)",
  "───────────────────────────────────────────────────────────────────────────",
  "❯ Press up to edit queued messages",
  "───────────────────────────────────────────────────────────────────────────",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3…",
].join("\n");

/** The seat's own park running, nothing queued behind it. */
const OWN_PARK_RUNNING = [
  "✻ Parking… (4s · ↓ 120 tokens)",
  "❯ ",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt",
].join("\n");

const AT_REST = ["⏺ Recorded the question.", "", "❯ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");

describe("parkSeatRefusal on the caller's own seat", () => {
  it("refuses a Claude Code seat whose composer holds a queued line behind its own park", () => {
    const refusal = parkSeatRefusal({
      callerWorkspaceId: "id-43",
      holderHost: "claude-code",
      screen: OWN_PARK_WITH_QUEUED_RELAY,
      target: OWN,
    });
    const queuedTurn = { kind: "mid-turn", queued: true } as const;
    expect(refusal).toStrictEqual(queuedTurn);
    expect(refusalShows({ refusal: queuedTurn })).toBe("a line queued behind a running turn");
  });

  it("refuses a Codex seat with its measured queued composer", () => {
    expect(
      parkSeatRefusal({ callerWorkspaceId: "id-43", holderHost: "codex", screen: CODEX_QUEUED, target: OWN }),
    ).toStrictEqual({ kind: "mid-turn", queued: true });
  });

  it("refuses on either host's marker when the journal recorded no host", () => {
    expect(
      parkSeatRefusal({
        callerWorkspaceId: "id-43",
        holderHost: undefined,
        screen: OWN_PARK_WITH_QUEUED_RELAY,
        target: OWN,
      }),
    ).toStrictEqual({ kind: "mid-turn", queued: true });
  });

  it("still lets the seat park itself over its own running turn when nothing is queued", () => {
    expect(
      parkSeatRefusal({ callerWorkspaceId: "id-43", holderHost: "claude-code", screen: OWN_PARK_RUNNING, target: OWN }),
    ).toBeUndefined();
  });

  it("lets an own seat at rest park", () => {
    expect(
      parkSeatRefusal({ callerWorkspaceId: "id-43", holderHost: "claude-code", screen: AT_REST, target: OWN }),
    ).toBeUndefined();
  });

  it("reads the same queued screen on a FOREIGN seat as mid-turn, as before", () => {
    expect(
      parkSeatRefusal({
        callerWorkspaceId: "id-1",
        holderHost: "claude-code",
        screen: OWN_PARK_WITH_QUEUED_RELAY,
        target: OWN,
      }),
    ).toStrictEqual({ kind: "mid-turn", queued: true });
  });
});
