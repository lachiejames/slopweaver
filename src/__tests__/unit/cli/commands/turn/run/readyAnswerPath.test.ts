/*
 * `readyAnswerPathFromLiveScreen`: a current-generation durable marker resolves the ready answer path before cmux is
 * ever reached.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readyAnswerPathFromLiveScreen } from "../../../../../../cli/commands/turn/run.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../../../live/ask/store.js";
import { dispatchIdOf } from "../../../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../../../live/turn/dispatchStore.js";
import { writeTurnMarker } from "../../../../../../live/turn/turnMarkerStore.js";
import { DECISION, fixtureDirs, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

/**
 * The exact regression found gold-proofing a pull request live: `turn answer --dispatch` had its OWN screen-check
 * call site, calling `readScreen`/`freshScreenTruth` directly rather than going through the same durable-marker
 * fallback `turn dispatch --poll`/`--sweep` already got fixed. A real collapsed-TUI dispatch resolved via
 * `--poll` but then still refused at `turn answer --dispatch` with "work still in progress" — this is that
 * fix, at this exact call site.
 */
describe("readyAnswerPathFromLiveScreen — the durable marker, checked before cmux", () => {
  const ASK_IDENTITY = { channel: "C1", messageTs: "1786992375.917659", threadTs: "1786992375.917659" };
  const DISPATCH_ID = dispatchIdOf({ askIdentity: ASK_IDENTITY });
  const CURRENT_LEASE = "2099-01-01T00:00:00.000Z";

  it("resolves ready from a current-generation durable marker, without ever reaching cmux", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-answer-marker-"));
    fixtureDirs.push(home);
    ensureCapturedAskLifecycle({ askIdentity: ASK_IDENTITY, home, surface: "dm", userId: "U0OWNER" });
    appendAskLifecycleEvent({
      event: {
        ...ASK_IDENTITY,
        decision: DECISION,
        kind: "dispatched",
        leaseExpiresAt: CURRENT_LEASE,
        tier: "fresh-visible-session",
        tsIso: "2026-08-17T00:00:00.000Z",
      },
      home,
    });
    writeDispatchRecord({
      home,
      record: {
        ...ASK_IDENTITY,
        askPermalink: "https://example.slack.com/archives/C1/p1786992375917659",
        briefPath: "/tmp/brief.json",
        decision: DECISION,
        dispatchId: DISPATCH_ID,
        execution: { mode: "single-turn", supervisorHost: "claude-code" },
        leaseExpiresAt: CURRENT_LEASE,
        schemaVersion: 3,
        session: {
          host: "claude-code",
          surfaceId: "id-unreachable-surface",
          surfaceRef: "unreachable-surface",
          workspaceId: "id-unreachable-workspace",
          workspaceRef: "unreachable-workspace",
        },
      },
    });
    writeTurnMarker({
      askIdentity: ASK_IDENTITY,
      home,
      marker: { answerPath: "/tmp/answer.json", dispatchId: DISPATCH_ID, kind: "ready", leaseExpiresAt: CURRENT_LEASE },
    });

    const result = await readyAnswerPathFromLiveScreen({
      askIdentity: ASK_IDENTITY,
      dispatchId: DISPATCH_ID,
      home,
      readSurface: () => Promise.resolve({ unreachable: "no cmux in a unit test" }),
      surfaceId: "unreachable-surface",
      workspaceId: "unreachable-workspace",
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value : "not ok").toBe("/tmp/answer.json");
  });
});
