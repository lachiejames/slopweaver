/**
 * `cmux takeover --dry-run`'s one line for every pairing of hosts: it names only the acts that pairing really takes —
 * no unpin or title for an app session, and an app predecessor closed through the desktop app.
 */
import { describe, expect, it } from "vitest";

import { type GatedPredecessor, takeoverDryRunLine } from "../../../../../cli/commands/cmux/takeoverHosts.js";
import type { TakeoverCaller } from "../../../../../supervisor/takeoverSeat.js";
import { workspace } from "../session/closeDoneHarness.js";

const APP_PREDECESSOR_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
const APP_CALLER_ID = "7a1d3e5f-2b4c-4d6e-8f0a-1c3e5a7b9d20";

const CMUX_PREDECESSOR: GatedPredecessor = {
  kind: "cmux",
  run: {
    row: {
      lastEventIso: "2026-11-25T01:00:00.000Z",
      sessionKey: "k-367",
      status: "open",
      workspaceRef: "workspace:367",
    },
    slug: "abc-1-chair",
  },
  workspace: workspace({
    currentDirectory: "/wt/abc-1-chair",
    title: "/slopweaver:supervisor",
    workspaceId: "ws-367",
    workspaceRef: "workspace:367",
  }),
};

const APP_PREDECESSOR: GatedPredecessor = {
  appSessionId: APP_PREDECESSOR_ID,
  kind: "app",
  label: `app:${APP_PREDECESSOR_ID}`,
  run: {
    row: {
      lastEventIso: "2026-11-25T01:00:00.000Z",
      sessionId: APP_PREDECESSOR_ID,
      sessionKey: "k-368",
      status: "open",
    },
    slug: "abc-2-chair",
  },
  target: {
    session: {
      description: undefined,
      directory: "/wt/abc-2-chair",
      groupId: "app",
      handle: `app:${APP_PREDECESSOR_ID}`,
      id: APP_PREDECESSOR_ID,
      latestConversationMessage: undefined,
      latestSubmittedAtIso: undefined,
      latestSubmittedMessage: undefined,
      pinned: false,
      selected: false,
      title: "abc-2-chair",
    },
  },
};

const CMUX_CALLER: TakeoverCaller = { kind: "cmux", workspaceId: "ws-400" };
const APP_CALLER: TakeoverCaller = { appSessionId: APP_CALLER_ID, kind: "app" };

const CMUX_CLOSE =
  "close workspace:367 (forced only when its screen proves it idle, or its one background work is a keep-alive another watch covers)";
const APP_CLOSE = `close app:${APP_PREDECESSOR_ID} through the desktop app, which holds a session it cannot prove finished`;

describe("takeoverDryRunLine", () => {
  it("unpins, pins and titles, and closes through cmux when both sides are cmux workspaces", () => {
    expect(takeoverDryRunLine({ caller: CMUX_CALLER, predecessor: CMUX_PREDECESSOR })).toBe(
      `cmux takeover: --dry-run — would unpin workspace:367, pin+title this session, ${CMUX_CLOSE}, then close abc-1-chair's board row either way`,
    );
  });

  it("records the app caller instead of pinning or titling it, after a cmux predecessor", () => {
    expect(takeoverDryRunLine({ caller: APP_CALLER, predecessor: CMUX_PREDECESSOR })).toBe(
      `cmux takeover: --dry-run — would unpin workspace:367, record app:${APP_CALLER_ID} as the supervisor, ${CMUX_CLOSE}, then close abc-1-chair's board row either way`,
    );
  });

  it("removes an app predecessor's record rather than unpinning it, and closes it through the app", () => {
    expect(takeoverDryRunLine({ caller: CMUX_CALLER, predecessor: APP_PREDECESSOR })).toBe(
      `cmux takeover: --dry-run — would remove app:${APP_PREDECESSOR_ID}'s supervisor pin record, pin+title this session, ${APP_CLOSE}, then close abc-2-chair's board row either way`,
    );
  });

  it("names no cmux act at all when both sides are app sessions", () => {
    expect(takeoverDryRunLine({ caller: APP_CALLER, predecessor: APP_PREDECESSOR })).toBe(
      `cmux takeover: --dry-run — would remove app:${APP_PREDECESSOR_ID}'s supervisor pin record, record app:${APP_CALLER_ID} as the supervisor, ${APP_CLOSE}, then close abc-2-chair's board row either way`,
    );
  });
});
