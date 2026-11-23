/*
 * The shared harness for the `turn resume` test files: the dispatched home `dispatchedFixture()` writes, and the
 * durable dispatch record `writeRecord()` adds to it. The homes it mints go into `turn/dispatch/harness.ts`'s
 * `fixtureDirs`, so each test file registers that module's `removeFixtureDirs` with `afterEach`. It moved here when
 * `resume.test.ts` was split by behaviour.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StartedChecklist } from "../../../../../../live/ask/checklist.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../../../live/ask/store.js";
import { buildTurnRoutingBrief } from "../../../../../../live/turn/brief.js";
import { writeDispatchRecord } from "../../../../../../live/turn/dispatchStore.js";
import type { RespondDecision } from "../../../../../../live/turn/tier.js";
import { fixtureDirs } from "../dispatch/harness.js";
import { ASK_IDENTITY, DECISION, DISPATCH_ID, RESUME_CARD, ROUTING_INPUT } from "./fixtures.js";

/**
 * A fresh temp home with a brief written, and a real `dispatched(fresh-visible-session)` lifecycle entry.
 *
 * @returns the brief path written, and the home it sits in
 */
export function dispatchedFixture({
  decision = DECISION,
  leaseExpiresAt = "2099-01-01T00:00:00.000Z",
  started = RESUME_CARD,
}: {
  decision?: RespondDecision;
  leaseExpiresAt?: string;
  /** `null` writes a CARD-LESS brief. A destructuring default cannot express that — `undefined` takes it. */
  started?: StartedChecklist | null;
} = {}): { readonly briefPath: string; readonly home: string } {
  // The temp dir is the home, but the brief is this fixture's own scratch file rather than state-home layout,
  // so it is joined onto `dir`.
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-resume-"));
  fixtureDirs.push(dir);
  const briefPath = join(dir, "brief.json");
  writeFileSync(
    briefPath,
    JSON.stringify(
      buildTurnRoutingBrief({
        ...ASK_IDENTITY,
        question: "what are my open PRs?",
        routingInput: ROUTING_INPUT,
        ...(started === null ? {} : { started }),
        surface: "channel",
        unavailableCapabilities: [],
        userId: "U0OWNER",
      }),
    ),
    "utf8",
  );
  ensureCapturedAskLifecycle({ askIdentity: ASK_IDENTITY, home: dir, surface: "channel", userId: "U0OWNER" });
  appendAskLifecycleEvent({
    event: {
      ...ASK_IDENTITY,
      decision,
      kind: "dispatched",
      leaseExpiresAt,
      tier: "fresh-visible-session",
      tsIso: "2026-08-13T00:00:00.000Z",
    },
    home: dir,
  });
  return { briefPath, home: dir };
}

/** Write the durable dispatch record a real `turn dispatch` would have written for the fixture above. */
export function writeRecord({
  briefPath,
  decision = DECISION,
  home,
  leaseExpiresAt = "2099-01-01T00:00:00.000Z",
}: {
  briefPath: string;
  decision?: RespondDecision;
  home: string;
  leaseExpiresAt?: string;
}): void {
  writeDispatchRecord({
    home,
    record: {
      ...ASK_IDENTITY,
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
      briefPath,
      decision,
      dispatchId: DISPATCH_ID,
      execution: ROUTING_INPUT.execution,
      leaseExpiresAt,
      schemaVersion: 3,
      session: {
        host: "claude-code",
        surfaceId: "id-surface:1",
        surfaceRef: "surface:1",
        workspaceId: "id-workspace:1",
        workspaceRef: "workspace:1",
      },
    },
  });
}
